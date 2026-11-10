import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/fitness/auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  recordFunnelEvent,
  isValidFunnelEvent,
  FUNNEL_EVENTS,
  FUNNEL_EVENT_NAMES,
  deriveDeviceFromUa,
  deriveSourceFromUa,
} from "@/lib/analytics/funnel";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v198 — POST /api/analytics/track — ثبت رویدادهای قیف فروش (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * عمومی (کاربر ناشناس هم مرحلهٔ مشاهدهٔ پلن/باز کردن مدال را دارد) — اما:
 *   • event فقط از whitelist کاتالوگ (FUNNEL_EVENTS)
 *   • batch حداکثر ۲۰ رویداد؛ فیلدها با سقف طول سخت
 *   • rate limit ۹۰ درخواست/دقیقه per-IP (هر درخواست تا ۲۰ رویداد)
 *   • device/source همیشه سمت سرور از UA استخراج می‌شود — بادی قابل جعل است
 *   • userId از سشن (اگر لاگین است) — نه از بادی
 *   • هر خطا = پاسخ 204 خالی؛ هرگز چیزی را نمی‌شکند
 */

const MAX_BATCH = 20;
const MAX_STRING = 300;

const cap = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
};

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`funnel:${getClientIp(req)}`, 90, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json().catch(() => null)) as {
      events?: unknown;
    } | null;
    const rawEvents = Array.isArray(body?.events) ? body!.events : [];
    if (rawEvents.length === 0) {
      return new Response(null, { status: 204 });
    }

    const ua = req.headers.get("user-agent");
    const device = deriveDeviceFromUa(ua);
    const source = deriveSourceFromUa(ua);

    // سشن اختیاری — برای پیوند رویدادهای ناشناس
    let userId: string | null = null;
    try {
      const user = await getCurrentUser();
      if (user) userId = user.id;
    } catch {
      /* ناشناس — عادی است */
    }

    let inserted = 0;
    for (const raw of rawEvents.slice(0, MAX_BATCH)) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const event = typeof e.event === "string" ? e.event : "";
      if (!isValidFunnelEvent(event)) continue; // رویداد ناشناس → دور انداخته
      const sessionId = cap(e.sessionId, 80) ?? "";
      const path = cap(e.path, MAX_STRING);
      const planId = cap(e.planId, 40);
      // v202 ممیزی — مبلغِ رویداد هرگز از کلاینت پذیرفته نمی‌شود (فیلد amount بادی
      // قابل جعل است و قبلاً مستقیم ذخیره می‌شد). درآمد واقعی از جدول Payment می‌آید
      // و کال‌های سروری هم مستقیم recordFunnelEvent را صدا می‌زنند نه این مسیر عمومی.
      // داشبورد قیف (admin/funnel) amount خالی را تحمل می‌کند.
      const amount = null;
      let meta: Record<string, unknown> | null = null;
      if (e.meta && typeof e.meta === "object") {
        meta = Object.fromEntries(
          Object.entries(e.meta as Record<string, unknown>)
            .slice(0, 8)
            .map(([k, v]) => [
              cap(k, 40)?.slice(0, 40) ?? "k",
              typeof v === "string" ? v.slice(0, 120) : typeof v === "number" || typeof v === "boolean" ? v : null,
            ])
            .filter(([, v]) => v !== null)
        );
      }
      await recordFunnelEvent({
        event,
        userId,
        sessionId,
        path,
        planId,
        amount,
        // device/source سروری — از بادی پذیرفته نمی‌شود
        device,
        source,
        meta,
        userAgent: ua,
      });
      inserted++;
    }
    void inserted; // پاسخ همیشه خاموش — کلاینت منتظر معنا نیست
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}

/**
 * GET — سلامت مسیر (برای ممیزی): فقط شمارش کل و آخرین رویداد.
 * عمومی نیست — چیز حساسی هم نیست؛ بدون جزئیات.
 */
export async function GET() {
  try {
    const [total, last] = await Promise.all([
      db.funnelEvent.count(),
      db.funnelEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { event: true, createdAt: true } }),
    ]);
    return Response.json({
      ok: true,
      total,
      knownEvents: FUNNEL_EVENT_NAMES.length,
      last: last ?? null,
    });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
