/**
 * POST /api/usage/heartbeat — ضربان‌سنج «زمان مصرف اپ‌ها» (v104 — درخواست مالک)
 *
 * کلاینت (use-usage-tracker.ts در MainApp) فقط وقتی صفحه واقعاً «دیده می‌شود»
 * (visibilityState === "visible") زمان فعالیت جمع می‌کند و هر ~۳۰ ثانیه یک فلاش
 * با مدت آن بازه می‌فرستد. سرور هر فلاش را یک ردیف AppUsageLog ثبت می‌کند و
 * داشبورد مدیر («میانگین زمان مصرف اپ‌ها — ۲۴ ساعت اخیر») جمع ردیف‌ها را
 * گزارش می‌کند:
 *   مجموع زمان = Σ(seconds) | کاربر فعال = userId متمایز | میانگین = مجموع ÷ فعال‌ها
 *
 * دقت سنجش:
 *  - تب پشت‌زمینه/صفحهٔ خاموش هیچ زمانی تولید نمی‌کند (سمت کلاینت gate شده و
 *    سمت سرور هم سقف ثانیه در هر فلاش دارد) — یعنی «فعالیت واقعی»، نه باز بودن تب.
 *  - platform سمت سرور از User-Agent تعیین می‌شود (FitUpBazaar/ = اپ کافه‌بازار،
 *    FitUpApp/ = اپ اختصاصی، بقیه = وب/PWA) — ورودی کلاینت مبنا نیست.
 *  - seconds ورودی بین ۱ تا ۱۲۰ سقف می‌خورد (فلاش نرمال ≈ ۳۰s؛ سقف برای
 *    فلاش‌های دیرهنگام بعد از suspend).
 *  - پاک‌سازی فرصت‌طلبانه: ~۲٪ فلاش‌ها ردیف‌های قدیمی‌تر از ۴۵ روز را حذف
 *    می‌کنند (نگهداشت دیتابیس کوچک بدون نیاز به کرون جدید).
 */
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

/** سقف ثانیه قابل ثبت در هر فلاش */
const MAX_SECONDS_PER_FLUSH = 120;
/** نگهداشت لاگ مصرف — بیشتر از این پاک می‌شود */
const RETENTION_DAYS = 45;
/** بخش‌های مجاز پنل — بقیه به «app» نگاشت می‌شوند */
const KNOWN_SCREENS = new Set([
  "dashboard",
  "programs",
  "workouts",
  "nutrition",
  "progress",
  "chat",
  "plans",
  "referral",
  "support",
  "mobileapp",
]);

/** تشخیص پلتفرم از User-Agent — همان الگوی stats/users (سرور داور است) */
function detectPlatform(ua: string): "web" | "bazaar" | "own" {
  if (/FitUpBazaar\//.test(ua)) return "bazaar";
  if (/FitUpApp\//.test(ua)) return "own";
  return "web";
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();

    // فلاش نرمال هر ۳۰s = ۲/min؛ سقف سخاوتمندانه برای فلاش‌های visibility/pagehide
    const rl = rateLimit(`usage-hb:${user.id}`, 40, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as {
      seconds?: number;
      screen?: string;
    };

    const rawSeconds = Number(body.seconds);
    if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
      return Response.json({ ok: true, skipped: true });
    }
    const seconds = Math.min(Math.round(rawSeconds), MAX_SECONDS_PER_FLUSH);
    if (seconds < 1) {
      return Response.json({ ok: true, skipped: true });
    }

    const screenRaw = String(body.screen || "").trim();
    const screen = KNOWN_SCREENS.has(screenRaw) ? screenRaw : "app";
    const platform = detectPlatform(req.headers.get("user-agent") || "");

    await db.appUsageLog.create({
      data: { userId: user.id, platform, screen, seconds },
    });

    // پاک‌سازی فرصت‌طلبانه (بدون کرون جدید — ۲٪ فلاش‌ها)
    if (Math.random() < 0.02) {
      try {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const res = await db.appUsageLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (res.count > 0) {
          console.log(`[usage/heartbeat] cleanup: ${res.count} rows older than ${RETENTION_DAYS}d removed`);
        }
      } catch {
        // پاک‌سازی هرگز فلاش را رد نمی‌کند
      }
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
