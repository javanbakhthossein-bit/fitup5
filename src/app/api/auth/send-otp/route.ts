import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { validateMobile, apiError } from "@/lib/fitness/auth";
import { sendOtpSms, detectOtpAppVariant } from "@/lib/fitness/smsir";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

// OTP lifetime: 10 minutes — پیامک‌رسان‌ها (sms.ir) در ساعات پیک گاهی چند
// دقیقه تأخیر دارند؛ TTL کوتاه باعث «پیامک رسید ولی کد منقضی شد» می‌شد
// (گزارش واقعی کاربران). ۱۰ دقیقه + سقف ۵ تلاش + rate-limit = امن و بدون دردسر.
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_SEC = 10 * 60;
// Minimum gap between consecutive OTP requests for the same mobile: 60s
// — هر ارسال مجدد کد قبلی را باطل می‌کند؛ فاصله کوتاه (۱۰ ثانیه) باعث می‌شد
// کاربر پیش از رسیدن پیامک اول، کد دوم بخواهد و بعد دو پیامک برسد و اولی
// «منقضی» تلقی شود. ۶۰ ثانیه با کول‌داون UI هم‌خوان است.
const OTP_RESEND_GAP_MS = 60 * 1000;
// Maximum OTP attempts per mobile per 10 minutes (anti-abuse)
const OTP_MAX_PER_WINDOW = 20;
const OTP_WINDOW_MS = 10 * 60 * 1000;
// Rate limit per-IP — ضد سوءاستفاده هزینه‌ی SMS با چرخاندن شماره‌ها:
// محدودیت موبایل به‌تنهایی کافی نیست؛ هر IP حداکثر ۱۰ درخواست در ۱۰ دقیقه.
const OTP_IP_MAX_PER_WINDOW = 10;
const OTP_IP_WINDOW_MS = 10 * 60 * 1000;

function generate4DigitCode(): string {
  // Cryptographically random 4-digit code (1000..9999)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 1000 + (buf[0] % 9000);
  return String(n);
}

export async function POST(req: NextRequest) {
  try {
    // ─── Rate limit per-IP — قبل از هر کار دیگری (ارسال پیامک پول است) ───
    const ipRl = rateLimit(`send-otp-ip:${getClientIp(req)}`, OTP_IP_MAX_PER_WINDOW, OTP_IP_WINDOW_MS);
    if (!ipRl.ok) {
      return rateLimitResponse(ipRl.retryAfterSec);
    }

    const body = await req.json().catch(() => ({}));
    const mobile = String(body?.mobile || "").replace(/\s/g, "");

    if (!validateMobile(mobile)) {
      return Response.json(
        { error: "شماره موبایل نامعتبر است. مثال: 09123456789" },
        { status: 400 }
      );
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - OTP_WINDOW_MS);

    // Rate-limit: count recent OTP codes for this mobile in the window
    const recentCount = await db.otpCode.count({
      where: { mobile, createdAt: { gte: windowStart } },
    });
    if (recentCount >= OTP_MAX_PER_WINDOW) {
      return Response.json(
        { error: "تعداد درخواست کد بیش از حد مجاز است. لطفاً چند دقیقه بعد تلاش کنید." },
        { status: 429 }
      );
    }

    // Enforce resend gap: last unused OTP must be at least 60s old
    const latest = await db.otpCode.findFirst({
      where: { mobile },
      orderBy: { createdAt: "desc" },
    });
    if (
      latest &&
      !latest.used &&
      latest.createdAt.getTime() > now.getTime() - OTP_RESEND_GAP_MS
    ) {
      const waitSec = Math.ceil(
        (latest.createdAt.getTime() + OTP_RESEND_GAP_MS - now.getTime()) / 1000
      );
      return Response.json(
        {
          error: `برای ارسال مجدد ${String(Math.max(waitSec, 1))} ثانیه صبر کنید.`,
          code: "RESEND_TOO_SOON",
          waitSeconds: Math.max(waitSec, 1),
        },
        { status: 429 }
      );
    }

    const code = generate4DigitCode();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    // Mark all previous unused OTPs for this mobile as used
    await db.otpCode.updateMany({
      where: { mobile, used: false },
      data: { used: true },
    });

    // Persist the new OTP code
    await db.otpCode.create({
      data: { mobile, code, expiresAt },
    });

    // Send via sms.ir
    // v56: تشخیص واریانت اپ از User-Agent — پیامک OTP فقط هشِ همان اپ را
    // می‌گیرد (SMS Retriever) و قالب OTP اختصاصی همان اپ انتخاب می‌شود.
    const appVariant = detectOtpAppVariant(req.headers.get("user-agent"));

    // ═══ v57 — ورود خودکار کد در اپ از «سرور خودمان» (درخواست صریح مالک) ═══
    // مالک: «کاری کن که در اپ موبایل و سایت کد از روی سرور خودمون یا از روی
    // یامک خونده بشه و جاگذاری بشه — مثل اسنپ، بدون هیچ دکمهٔ اضافه.»
    // مسیر پیامکی (SMS Retriever/WebOTP) به «خط فرستنده» در پنل sms.ir وابسته
    // است؛ تا وقتی خط ثبت نشده، اپ‌ها کد را خودکار نمی‌خواندند. راه‌حل: وقتی
    // درخواست از خود اپ می‌آید (UA اپ + کلید bridge که داخل هر دو APK جاسازی
    // شده — FitUpNative.getOtpBridgeKey)، کد در «همان پاسخ» برمی‌گردد و صفحهٔ
    // ورود بلافاصله آن را جا می‌گذارد و خودکار verify می‌کند → کاربر مستقیم
    // وارد پنل می‌شود (بدون تایپ، بدون دکمه).
    // ⚠️ گاردها: فقط برای واریانت اپ (هرگز وب) + تطابق دقیق راز env
    //    OTP_BRIDGE_SECRET + همهٔ rate-limitهای قبلی سرِ جایشان هستند.
    const bridgeKey =
      String(req.headers.get("x-fitup-otp-bridge") || body?.otpBridgeKey || "").trim();
    const expectedBridgeKey = (process.env.OTP_BRIDGE_SECRET || "").trim();
    const bridgeTrusted =
      appVariant !== "web" &&
      expectedBridgeKey.length >= 16 &&
      bridgeKey.length >= 16 && // مقایسهٔ طول-ثابت ساده برای ضد timing
      bridgeKey.length === expectedBridgeKey.length &&
      bridgeKey === expectedBridgeKey;

    // ═══ v63 — عیب‌یابی «کد خودکار در اپ گذاشته نمی‌شود» (گزارش مالک) ═══
    // سه حالت شکست bridge قابل‌تشخیص روی سرور است — لاگ می‌کنیم تا ریشه از
    // روی لاگ مشخص شود (APK قدیمی بدون getOtpBridgeKey / راز env ناهمخوان /
    // UA میانی واسط):
    if (appVariant !== "web" && !bridgeKey) {
      console.warn(
        `[send-otp] app=${appVariant} بدون کلید bridge — احتمالاً APK قدیمی قبل از v1.3.0/v1.5.8 (بدون FitUpNative.getOtpBridgeKey) یا کلید خالی`
      );
    } else if (appVariant !== "web" && bridgeKey && !bridgeTrusted) {
      console.warn(
        `[send-otp] app=${appVariant} کلید bridge ناهمخوان (len=${bridgeKey.length} vs env=${expectedBridgeKey.length}) — OTP_BRIDGE_SECRET سرور یا APK قدیمی را چک کنید`
      );
    } else if (bridgeTrusted) {
      console.log(`[send-otp] bridge trusted — ورود خودکار فعال (app=${appVariant})`);
    }

    const result = await sendOtpSms(mobile, code, { appVariant });
    if (!result.success) {
      // 🩹 فیکس v35: رکورد OTP تازه‌ساخته را «used» کن تا گپ ۶۰ثانیه‌ایِ resend
      // تلاش فوری بعدی کاربر را نبندد (قبلاً بعد از یک خطا، کاربر مجبور بود
      // ۶۰ ثانیه صبر کند و بعد دوباره همان خطا را می‌دید).
      // v57: برای اپِ معتبر، کد در پاسخ برمی‌گردد (پیامک هرچه شد مهم نیست —
      // ورود خودکار از سرور انجام می‌شود؛ خطای پیامک هم لاگ می‌شود).
      // 🩹 v63 — باگ بحرانی: قبلاً حتی برای اپِ bridge-trusted هم رکورد «used»
      // می‌شد و بعد bridgeCode برمی‌گشت → verify-otp فقط used:false را قبول
      // می‌کند → ورود خودکار همیشه با «این کد منقضی شده است» می‌شکست!
      // حالا فقط وقتی کد به اپ برگردانده نمی‌شود used می‌کنیم.
      if (!bridgeTrusted) {
        await db.otpCode
          .updateMany({ where: { mobile, code, used: false }, data: { used: true } })
          .catch(() => {});
      }
      console.error("[send-otp] sms.ir failure", {
        mobile,
        status: result.status,
        error: result.error,
        raw: result.raw ?? null,
        // کد به‌صورت ماسکشده لاگ می‌شود تا در لاگ سرور لو نرود
        maskedCode: `**${code.slice(-2)}`,
      });
      // devCode فقط در محیط توسعه (NODE_ENV !== production) و با فعال‌سازی صریح
      // DEV_OTP_ENABLED=true برمی‌گردد.
      // ⚠️ امنیت: در production هرگز کد OTP به کلاینت برگردانده نمی‌شود —
      // حتی اگر env اشتباهاً تنظیم شده باشد (باگ حساب‌های کاربری جلوگیری می‌شود).
      if (
        process.env.NODE_ENV !== "production" &&
        process.env.DEV_OTP_ENABLED === "true"
      ) {
        return Response.json({ ok: true, devCode: code });
      }
      if (bridgeTrusted) {
        // اپ معتبر — ورود خودکار حتی وقتی درگاه پیامک خطا می‌دهد
        return Response.json({ ok: true, expiresIn: OTP_TTL_SEC, bridgeCode: code });
      }
      return Response.json(
        { error: "ارسال پیامک با خطا مواجه شد. لطفاً چند لحظه بعد تلاش کنید." },
        { status: 502 }
      );
    }

    // Never reveal whether the mobile is already registered.
    // expiresIn: مدت اعتبار کد (ثانیه) — UI برای شمارش معکوس «اعتبار کد»
    // نمایشش می‌دهد تا کاربر بداند کد بعد از تمام شدن «تایمر ارسال مجدد» هنوز
    // معتبر است و شتاب‌زده ریسند نکند.
    // v57: bridgeCode فقط برای اپ معتبر (UA اپ + راز bridge) — ورود خودکار.
    return Response.json({
      ok: true,
      expiresIn: OTP_TTL_SEC,
      ...(bridgeTrusted ? { bridgeCode: code } : {}),
    });
  } catch (e) {
    return apiError(e);
  }
}
