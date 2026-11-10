import "server-only";
import { db } from "@/lib/db";

/**
 * تشخیص و ثبت نصب اپ نیتیو فیتاپ (v47)
 *
 * مالک: «بفهمم چند نفر اپ موبایل خودمون و چند نفر اپ بازار رو نصب کردن.»
 *
 * هر دو اپ WebView به همهٔ درخواست‌ها پسوند UA اختصاصی می‌چسبانند:
 *   - اپ اختصاصی (ir.fittup.panel)  →  "... FitUpApp/1.2.5"
 *   - اپ کافه‌بازار (ir.fittup.app) →  "... FitUpBazaar/1.5.4"
 *
 * پس لازم نیست اپ‌ها آپدیت شوند؛ کافی است در مسیرهای احرازهویت
 * (/api/auth/me و /api/auth/verify-otp) که در هر باز شدن اپ صدا زده
 * می‌شوند، UA را نگاه کنیم و اولین بار را در User ثبت کنیم.
 *
 * PWA جداگانه با رویداد appinstalled در pwaInstalledAt ثبت می‌شود
 * (قبل‌تر از این وجود داشت) و در آمار ادمین به‌عنوان نصب PWA شمرده می‌شود.
 */

export type AppInstallSource = "panel" | "bazaar";

/** UA → منبع نصب اپ نیتیو (null = مرورگر/PWA) */
export function detectAppInstallSource(userAgent: string | null | undefined): AppInstallSource | null {
  if (!userAgent) return null;
  // ترتیب مهم است: هر دو اپ «FitUp» دارند؛ پسوند دقیق را چک می‌کنیم
  if (/FitUpBazaar\//.test(userAgent)) return "bazaar";
  if (/FitUpApp\//.test(userAgent)) return "panel";
  return null;
}

// throttle در-حافظه: هر کاربر حداکثر هر ۶ ساعت یکبار بررسی/نوشتن DB
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const recentCheck = new Map<string, number>();
const RECENT_MAX = 5000;

function shouldCheck(userId: string): boolean {
  const now = Date.now();
  const last = recentCheck.get(userId);
  if (last && now - last < CHECK_INTERVAL_MS) return false;
  if (recentCheck.size > RECENT_MAX) recentCheck.clear();
  recentCheck.set(userId, now);
  return true;
}

/**
 * ثبت منبع نصب اپ برای کاربر (اگر هنوز ثبت نشده یا منبع عوض شده).
 * نباید هیچ‌وقت جریان auth را بشکند — همه‌جا با try/catch صدا زده می‌شود.
 */
export async function recordAppInstall(
  userId: string,
  userAgent: string | null | undefined
): Promise<void> {
  try {
    const source = detectAppInstallSource(userAgent);
    if (!source) return;
    if (!shouldCheck(userId)) return;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { appInstallSource: true },
    });
    if (!user) return;
    if (user.appInstallSource === source) return;
    await db.user.update({
      where: { id: userId },
      data:
        user.appInstallSource === null
          ? { appInstallSource: source, appInstalledAt: new Date() }
          : // قبلاً با منبع دیگری ثبت شده — فقط منبع را به‌روز می‌کنیم
            { appInstallSource: source },
    });
  } catch {
    // سکوت — نباید auth را بشکند
  }
}
