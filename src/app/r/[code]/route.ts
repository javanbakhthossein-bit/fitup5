import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /r/[code] — مقصد لینک‌های کوتاه پیامکی (v48)
 *
 * پیامک‌های sms.ir سقف ۲۵ کاراکتر برای هر پارامتر دارند (خطای 114). لینک تمدید
 * کامل (go/renew?t=JWT) صدها کاراکتر است؛ در پیامک «r/XXXXXXXX» می‌رود و این
 * مسیر با 302 به مقصد واقعی هدایت می‌کند:
 *
 *   https://fittup.ir/r/Km7pQ2xN → /go/renew?t=… (صفحهٔ /go اپ را باز می‌کند)
 *
 * v68 — دیریکتیو مالک: «پیامک‌هایی که لینک دارند پس از گذشت زمان تخفیف
 * ۲ساعته یا دودوزه باید به همان کارت‌های بدون تخفیف پلن‌ها در پنل کاربری
 * بروند.» قبلاً لینک منقضی به صفحهٔ اصلی (/) پرت می‌شد؛ حالا اگر مقصد لینک،
 * صفحهٔ پلن‌ها/پنل باشد (go/plans / go/panel) حتی بعد از انقضا به همان مقصد
 * هدایت می‌شود — صفحهٔ پلن‌ها خودش کد تخفیف را سروری اعتبارسنجی می‌کند و
 * برای کد منقضی، «کارت‌های بدون تخفیف» را نشان می‌دهد (پارامتر offer حفظ
 * می‌شود تا کاربر بداند چرا تخفیفی نمی‌بیند). برای بقیهٔ مقصدها (مثل
 * go/renew که JWT خودش را داخل صفحه اعتبارسنجی می‌کند) رفتار قبلی حفظ شد.
 *
 * کد نامعتبر → صفحهٔ اصلی (تجربهٔ سالم به‌جای 404 خام).
 *
 * v65 — فیکس «لینک پیامک باز می‌شه روی 0.0.0.0:3000» (گزارش مالک):
 * قبلاً مبنا (base) از origin خودِ درخواست گرفته می‌شد؛ وقتی پراکسیِ جلوی سرور
 * هدر Host را درست پاس نمی‌داد، ریدایرکت به «http://0.0.0.0:3000/...» می‌شد.
 * حالا همیشه از دامنهٔ رسمی (NEXT_PUBLIC_SITE_URL، فال‌بک https://fittup.ir)
 * استفاده می‌شود — ریدایرکت کوتاه‌کننده هرگز به آدرس داخلی نمی‌افتد.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const rl = rateLimit(`sms-short:${getClientIp(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const { code } = await params;
  const safeCode = String(code || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);

  // v65 — دامنهٔ رسمی همیشه برنده است؛ origin درخواست (که پشت پراکسی ممکن است
  // 0.0.0.0:3000 / 127.0.0.1:3000 باشد) هرگز برای ریدایرکت کاربر استفاده نمی‌شود.
  const CANONICAL_SITE_URL = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir"
  ).replace(/\/$/, "");
  if (!safeCode) return NextResponse.redirect(`${CANONICAL_SITE_URL}/`, 302);

  try {
    const link = await db.smsShortLink.findUnique({ where: { code: safeCode } });
    if (!link) return NextResponse.redirect(`${CANONICAL_SITE_URL}/`, 302);

    // مقصد فقط مسیر نسبی داخلی — ضد open-redirect
    const target = link.target.replace(/^\/+/, "");
    if (target.includes("://") || target.startsWith("//")) {
      return NextResponse.redirect(`${CANONICAL_SITE_URL}/`, 302);
    }

    const isExpired = !!link.expiresAt && link.expiresAt.getTime() < Date.now();
    if (isExpired) {
      // v68 — لینک‌های مقصد «پلن‌ها/پنل» حتی بعد از انقضا به همان کارت‌های
      // پلن‌های پنل می‌روند (بدون تخفیف — اعتبارسنجی کد سروری است)؛ نه به صفحهٔ اصلی.
      const isPanelPlansTarget = /^(go\/plans|go\/panel)\b/.test(target);
      if (isPanelPlansTarget) {
        return NextResponse.redirect(`${CANONICAL_SITE_URL}/${target}`, 302);
      }
      return NextResponse.redirect(`${CANONICAL_SITE_URL}/`, 302);
    }

    return NextResponse.redirect(`${CANONICAL_SITE_URL}/${target}`, 302);
  } catch {
    return NextResponse.redirect(`${CANONICAL_SITE_URL}/`, 302);
  }
}
