import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { normalizeMobileForSmsIr } from "@/lib/fitness/smsir";
import { sendInviteFriendSms } from "@/lib/fitness/sms-flows";
import {
  generateUniqueReferralCode,
  getReferralInviteeRewardAmount,
} from "@/lib/fitness/referral";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * POST /api/referral/invite — دعوت دوست با پیامک (v32 — قالب 852193 sms.ir)
 *
 * کاربر نام و شمارهٔ موبایل دوستش را می‌فرستد؛ سرور پیامک دعوت با لینک
 * اختصاصی معرف (?ref=CODE) را ارسال می‌کند.
 *
 * محافظت‌ها:
 *  - requireAuth (سشن کوکی)
 *  - Rate limit: ۵ دعوت در ساعت برای هر کاربر + ۱۰ در ساعت برای هر IP
 *  - دداپ ابدی داخل sendTemplateSms است: هر (شمارهٔ دوست، دعوت‌کننده) فقط
 *    یک بار در عمر سیستم پیامک می‌گیرد (کلید `invite_friend_{inviterUserId}`)
 *
 * نکتهٔ مهم: اگر env قالب (SMSIR_TEMPLATE_INVITE_FRIEND) یا کلید API تنظیم
 * نشده باشد، ارسال با skipped:"no_template" بی‌صدا رد می‌شود — قابلیت باید
 * هرگز نشکند و UI پیام محترمانهٔ «از لینک دعوت استفاده کنید» نشان می‌دهد.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const body = (await req
      .json()
      .catch(() => null)) as { friendName?: unknown; friendMobile?: unknown } | null;
    const friendName =
      typeof body?.friendName === "string" ? body.friendName.replace(/[\r\n\t]/g, " ").trim() : "";
    const friendMobileRaw = typeof body?.friendMobile === "string" ? body.friendMobile : "";

    // ─── اعتبارسنجی نام دوست: ۲ تا ۴۰ حرف پس از trim ───
    if (friendName.length < 2 || friendName.length > 40) {
      return Response.json(
        { ok: false, error: "نام دوست باید بین ۲ تا ۴۰ حرف باشد." },
        { status: 400 }
      );
    }

    // ─── اعتبارسنجی شمارهٔ دوست: ۰۹…/۹۸…/+۹۸…/۰۰۹۸… → 9XXXXXXXXX ───
    const friendMobile = normalizeMobileForSmsIr(friendMobileRaw);
    if (!/^9\d{9}$/.test(friendMobile)) {
      return Response.json({ ok: false, error: "شماره موبایل معتبر نیست." }, { status: 400 });
    }

    // ─── گارد دعوت خودی: مقایسهٔ نرمال‌شده با موبایل خود کاربر ───
    const ownMobile = normalizeMobileForSmsIr(user.mobile || "");
    if (ownMobile && ownMobile === friendMobile) {
      return Response.json(
        { ok: false, error: "نمی‌توانید به شمارهٔ خودتان دعوت‌نامه بفرستید." },
        { status: 400 }
      );
    }

    // ─── محدودیت نرخ: ۵ دعوت در ساعت برای هر کاربر + ۱۰ در ساعت برای هر IP ───
    // بعد از اعتبارسنجی فرم گذاشته شده تا خطای تایپیِ ساده بودجهٔ دعوت را نسوزاند؛
    // درخواستِ معتبر (همان که پیامک می‌تواند بسازد) همیشه سد این دو سقف را می‌خورد.
    const rlUser = rateLimit(`referral-invite:${user.id}`, 5, 60 * 60 * 1000);
    if (!rlUser.ok) {
      return rateLimitResponse(rlUser.retryAfterSec);
    }
    const rlIp = rateLimit(`referral-invite:ip:${getClientIp(req)}`, 10, 60 * 60 * 1000);
    if (!rlIp.ok) {
      return rateLimitResponse(rlIp.retryAfterSec);
    }

    // ─── کد معرفی کاربر — در صورت نبود، تولید و ذخیره می‌شود ───
    // (همان الگوی GET /api/referral/code)
    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = await generateUniqueReferralCode();
      await db.user.update({
        where: { id: user.id },
        data: { referralCode },
      });
    }

    // ─── ارسال پیامک دعوت (داپ ابدی + ثبت SmsLog داخل خودش انجام می‌شود) ───
    const sms = await sendInviteFriendSms({
      inviterUserId: user.id,
      friendMobile,
      friendName,
      referralCode,
    });

    // مبلغ هدیهٔ دعوت‌شونده — برای نمایش «هدیهٔ دعوت‌شونده: X تومان» در UI
    const giftAmount = await getReferralInviteeRewardAmount();

    // ─── نگاشت نتیجهٔ ارسال به پیام فارسی دوستانه ───
    if (sms.sent) {
      return Response.json({
        ok: true,
        message: `دعوت‌نامه برای «${friendName}» ارسال شد ✅`,
        giftAmount,
      });
    }

    if (sms.skipped === "already_sent") {
      return Response.json(
        { ok: false, error: "به این شماره قبلاً دعوت‌نامه فرستاده‌اید.", giftAmount },
        { status: 409 }
      );
    }

    if (sms.skipped === "no_template") {
      // قالب/env تنظیم نشده — قابلیت پیامکی «خاموش» است؛ کاربر به لینک دعوت هدایت می‌شود
      return Response.json(
        {
          ok: false,
          error: "سرویس دعوت پیامکی هنوز فعال نشده؛ می‌توانید از لینک دعوت استفاده کنید.",
          giftAmount,
        },
        { status: 503 }
      );
    }

    if (sms.skipped === "invalid_mobile") {
      return Response.json(
        { ok: false, error: "شماره موبایل معتبر نیست.", giftAmount },
        { status: 400 }
      );
    }

    // ارسال واقعی شکست خورده (گیت‌وی/شبکه) — تلاش دوباره ممکن است
    // (رکورد failed سد دداپ نیست؛ طبق smsir.ts فقط status=sent دداپ می‌شود)
    return Response.json(
      { ok: false, error: "ارسال پیامک ناموفق بود؛ کمی بعد دوباره تلاش کنید.", giftAmount },
      { status: 502 }
    );
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/referral/invite — مبلغ هدیهٔ دعوت‌شونده برای نمایش زیر فرم دعوت.
 * واکشی تنبل در mount ویو (قبل از هر ارسال) تا یادداشت «هدیهٔ دعوت‌شونده»
 * با مقدار واقعیِ پنل مدیر (referral_invitee_reward_amount) پر شود.
 */
export async function GET() {
  try {
    await requireAuth();
    const giftAmount = await getReferralInviteeRewardAmount();
    return Response.json({ ok: true, giftAmount });
  } catch (e) {
    return apiError(e);
  }
}
