import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logError } from "@/lib/error-logger";
import { requireAdmin, apiError, getCurrentUser } from "@/lib/fitness/auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { isNoiseError } from "@/lib/fitness/error-noise";

/* v65 — دِداپ در-حافظه برای «یک عالمه لاگ تکراری» در پنل مدیریت.
 * یک صفحهٔ باز که chunk گمشده دارد (مثل گزارش واقعی Loading chunk failed در
 * IAB اینستاگرام) با هر تلاش/ریلود، همان پیام را دوباره می‌فرستد — درجِ همه‌شان
 * فقط تب لاگ ادمین را کور می‌کند. FIX: پیام یکسان از همان URL/UA در پنجرهٔ
 * ۱۵ دقیقه‌ای فقط یک‌بار درج می‌شد؛ ولی گزارش مالک (chunk 9711 شش بار در دو
 * ساعت از یک دستگاه) نشان داد مشکل جاری هر ۱۵ دقیقه یک رکورد جدید می‌سازد و
 * باز اسپم است. v67: پنجره به ۶۰ دقیقه بلند شد — یک خطای جاری حداکثر یک
 * رکورد در ساعت می‌گیرد؛ سیگنال «هنوز جاری است» حفظ می‌شود، اسپم نه.
 * (سمت کلاینت هم reportClientError با دِداپ ۱۰ دقیقه‌ای اضافه شد — لایهٔ اول.) */
const ERROR_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const ERROR_DEDUPE_MAX = 2000;
const recentErrorKeys = new Map<string, number>();

function isDuplicateError(key: string): boolean {
  const now = Date.now();
  if (recentErrorKeys.size > ERROR_DEDUPE_MAX) {
    for (const [k, t] of recentErrorKeys) {
      if (now - t > ERROR_DEDUPE_WINDOW_MS) recentErrorKeys.delete(k);
    }
    if (recentErrorKeys.size > ERROR_DEDUPE_MAX) recentErrorKeys.clear();
  }
  const last = recentErrorKeys.get(key);
  if (last !== undefined && now - last < ERROR_DEDUPE_WINDOW_MS) return true;
  recentErrorKeys.set(key, now);
  return false;
}

/**
 * POST /api/error-log
 * Public endpoint — anyone can submit error logs (client-side errors).
 * ترتیب: parse → اعتبارسنجی → فیلتر نویز اینستاگرام → دِداپ تکرارها (v65) → rate limit → درج
 * (نویزِ iabjs سهمیهٔ rate-limit کاربر را هدر نمی‌دهد و هرگز درج نمی‌شود؛
 * این گارد باندل‌های کش‌شدهٔ قدیمی را هم می‌پوشاند.)
 * Rate limit per-IP (۳۰/دقیقه) + سقف طول فیلدها برای جلوگیری از DoS دیسک/DB.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Try to get user ID from session (optional — errors can be anonymous)
    let userId: string | undefined;
    try {
      const user = await getCurrentUser();
      if (user) userId = user.id;
    } catch {
      // anonymous error — that's fine
    }
    // ─── سقف طول فیلدها قبل از درج در DB ───
    const truncate = (v: unknown, max: number): string | undefined =>
      typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
    // ─── اعتبارسنجی source (whitelist) — قبلاً هر رشته‌ای با هر طولی قبول می‌شد ───
    const VALID_SOURCES = ["client", "api", "server"] as const;
    const source: (typeof VALID_SOURCES)[number] = (
      VALID_SOURCES as readonly string[]
    ).includes(body.source)
      ? body.source
      : "client";
    const message = truncate(body.message, 500) || "Unknown error";
    const stack = truncate(body.stack, 2000);

    // ─── فیلتر نویز مرورگر داخلی اینستاگرام (Script error / iabjs://… ) ───
    // بدون درج در DB و بدون مصرف سهمیهٔ rate-limit. hasErrorObject نامشخص است
    // → true تا فقط الگوهای پیام/استک سمت سرور اعمال شوند (سخت‌گیرانه‌تر نشود).
    if (isNoiseError({ message, stack, hasErrorObject: true })) {
      return Response.json({ ok: true, filtered: true });
    }

    // ─── v65 — دِداپ: پیام یکسان از همان صفحه/دستگاه در ۱۵ دقیقه فقط یک‌بار درج ───
    // قبل از rate-limit تا سهمیهٔ IP هم برای خطاهای تکراری هدر نرود.
    const dedupeKey = [
      message,
      truncate(body.url, 300),
      truncate(body.userAgent, 300),
    ]
      .map((p) => (p ?? "").slice(0, 200))
      .join("|");
    if (isDuplicateError(dedupeKey)) {
      return Response.json({ ok: true, deduped: true });
    }

    // ─── Rate limit (per-IP) — ضد درج بی‌نهایت رکورد در SQLite ───
    const rl = rateLimit(`error-log:${getClientIp(req)}`, 30, 60 * 1000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    await logError({
      source,
      message,
      stack,
      url: truncate(body.url, 300),
      method: truncate(body.method, 10),
      statusCode: body.statusCode,
      userId,
      userAgent: truncate(body.userAgent, 300),
      context: body.context,
    });
    // ─── هرس دوره‌ای ErrorLog (بدون این، جدول بی‌نهایت رشد می‌کرد) ───
    // با احتمال ~۵٪ در هر درج، رکوردهای قدیمی‌تر از ۳۰ روز حذف می‌شوند —
    // بدون cron جدید و بدون بار محسوس روی مسیر لاگ‌ing
    if (Math.random() < 0.05) {
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await db.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      } catch {
        // هرس best-effort است — نباید لاگ‌ing را شکست بدهد
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/error-log
 * Admin-only — returns error logs with filtering.
 * Query params: ?source=client|api|server &reviewed=true|false &limit=50 &offset=0
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || undefined;
    const reviewed = url.searchParams.get("reviewed");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const where: {
      source?: string;
      reviewed?: boolean;
    } = {};
    if (source) where.source = source;
    if (reviewed === "true") where.reviewed = true;
    if (reviewed === "false") where.reviewed = false;

    const [logs, total] = await Promise.all([
      db.errorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, name: true, mobile: true },
          },
        },
      }),
      db.errorLog.count({ where }),
    ]);

    return Response.json({ logs, total, limit, offset });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * PATCH /api/error-log
 * Admin-only — mark error(s) as reviewed.
 * Body: { ids: string[] } or { markAll: true }
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    if (body.markAll) {
      const result = await db.errorLog.updateMany({
        where: { reviewed: false },
        data: { reviewed: true },
      });
      return Response.json({ ok: true, updated: result.count });
    } else if (Array.isArray(body.ids)) {
      const result = await db.errorLog.updateMany({
        where: { id: { in: body.ids } },
        data: { reviewed: true },
      });
      return Response.json({ ok: true, updated: result.count });
    }
    return Response.json({ ok: true, updated: 0 });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/error-log
 * Admin-only — delete error log(s).
 * Body: { ids: string[] } or { deleteAll: true }
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    if (body.deleteAll) {
      const result = await db.errorLog.deleteMany({});
      return Response.json({ ok: true, deleted: result.count });
    } else if (Array.isArray(body.ids)) {
      const result = await db.errorLog.deleteMany({
        where: { id: { in: body.ids } },
      });
      return Response.json({ ok: true, deleted: result.count });
    }
    return Response.json({ ok: true, deleted: 0 });
  } catch (e) {
    return apiError(e);
  }
}
