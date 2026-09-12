import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { toPersianDigits, DEFAULT_REFERRAL_REWARD_TOMAN } from "@/lib/fitness/types";

/**
 * مبلغ پاداش معرفی به دوست‌دار (به تومان) — پیش‌فرض
 * این مبلغ از SiteSetting خوانده می‌شود تا ادمین بتواند آن را تغییر دهد.
 * کلید: referral_reward_amount
 * v47 — ثابت به types.ts منتقل شد (مشترک سرور/کلاینت، بدون import دیتابیس)
 */
export { DEFAULT_REFERRAL_REWARD_TOMAN };

/**
 * دریافت مبلغ پاداش معرفی از دیتابیس (قابل تغییر توسط ادمین)
 */
export async function getReferralRewardAmount(): Promise<number> {
  try {
    const setting = await db.siteSetting.findUnique({
      where: { key: "referral_reward_amount" },
      select: { value: true },
    });
    if (setting) {
      const val = parseInt(setting.value, 10);
      if (!isNaN(val) && val > 0) {
        // سقف ایمن (ممیزی 2-c P2): مقدار ۹رقمی (خطای تایپی ادمین) پرداخت نمی‌شود
        return Math.min(val, 10_000_000);
      }
    }
  } catch {
    // DB may not be available — use default
  }
  return DEFAULT_REFERRAL_REWARD_TOMAN;
}

/**
 * مبلغ هدیه دعوت‌شونده (به تومان) — کلید پنل مدیر: referral_invitee_reward_amount.
 * اگر تنظیم نشده/خالی باشد، برای حفظ سازگاری با گذشته، مبلغ دعوت‌کننده استفاده می‌شود.
 * (v32 — درخواست مالک: «میزان مبلغ هدیه دعوت‌کننده و دعوت‌شونده در پنل مدیر وجود دارد و قابل تغییر است»)
 */
export async function getReferralInviteeRewardAmount(): Promise<number> {
  try {
    const setting = await db.siteSetting.findUnique({
      where: { key: "referral_invitee_reward_amount" },
      select: { value: true },
    });
    if (setting && setting.value.trim() !== "") {
      const val = parseInt(setting.value, 10);
      if (!isNaN(val) && val >= 0) return Math.min(val, 10_000_000);
    }
  } catch {}
  return getReferralRewardAmount(); // fallback به مبلغ دعوت‌کننده
}

// دامنه‌ی اصلی برای لینک معرفی (در صورت تنظیم در env از همان استفاده می‌شود)
export const REFERRAL_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://fittup.ir";

// الفبای کد معرفی — بدون کاراکترهای مبهم (0/O, 1/I/L)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * تولید کد معرفی منحصربه‌فرد در قالب FIT-XXXXXX (۶ کاراکتر تصادفی + پیشوند FIT-).
 * در صورت تکرار (احتمال بسیار کم) تا ۵ بار تلاش می‌شود.
 */
export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = randomBytes(6);
    let code = "FIT-";
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    const exists = await db.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  // fallback با timestamp برای اطمینان از یکتایی
  return `FIT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * پردازش پاداش معرفی پس از خرید موفق اولین پلن.
 *
 * شرایط:
 *  - کاربر جدید (خریدار) باید referredById داشته باشد.
 *  - پاداش هنوز پرداخت نشده باشد (referralRewardPaid === false).
 *  - این اولین خرید پلن کاربر باشد (تعداد subscription‌های قبلی = 0).
 *
 * در صورت موفقیت:
 *  - ۱۵۰,۰۰۰ تومان به کیف پول خریدار اضافه می‌شود.
 *  - ۱۵۰,۰۰۰ تومان به کیف پول معرف اضافه می‌شود.
 *  - referralRewardPaid برای خریدار روی true قرار می‌گیرد.
 *  - تراکنش کیف پول و نوتیفیکیشن برای هر دو طرف ثبت می‌شود.
 *
 * @returns وضعیت پرداخت پاداش (true = پرداخت شد، false = شرایط برقرار نبود)
 */
export async function processReferralReward(opts: {
  buyerUserId: string;
  paymentId: string;
}): Promise<boolean> {
  const { buyerUserId, paymentId } = opts;

  // کاربر خریدار را به‌همراه معرفش بارگذاری کن
  const buyer = await db.user.findUnique({
    where: { id: buyerUserId },
    select: {
      id: true,
      referredById: true,
      referralRewardPaid: true,
      mobile: true,
      name: true,
    },
  });

  if (!buyer) return false;
  if (!buyer.referredById) return false;
  if (buyer.referralRewardPaid) return false;

  // بررسی اینکه این اولین خرید پلن کاربر است یا خیر
  // (تعداد subscription‌های قبلی با وضعیت active/expired — به‌جز همین خرید جدید)
  const priorSubsCount = await db.subscription.count({
    where: { userId: buyerUserId },
  });
  // اگر بیشتر از ۱ subscription دارد، یعنی قبلاً پلن خریده بوده
  // (۱ subscription همان است که همین الان در verify ایجاد شده)
  if (priorSubsCount > 1) return false;

  // معرف را بارگذاری کن
  const referrer = await db.user.findUnique({
    where: { id: buyer.referredById },
    select: { id: true, walletBalance: true, mobile: true, name: true },
  });
  if (!referrer) return false;

  // دریافت مبلغ پاداش از دیتابیس (قابل تغییر توسط ادمین)
  // دعوت‌کننده (معرف): referral_reward_amount | دعوت‌شونده (خریدار): referral_invitee_reward_amount
  const REFERRER_REWARD_TOMAN = await getReferralRewardAmount();
  const INVITEE_REWARD_TOMAN = await getReferralInviteeRewardAmount();

  // متن نوتیفیکیشن با مبلغ واقعی (قابل تنظیم توسط ادمین) ساخته می‌شود —
  // قبلاً «۱۵۰,۰۰۰ تومان» hardcode بود و با تغییر تنظیمات غلط می‌شد.
  const referrerTomanFa = toPersianDigits(REFERRER_REWARD_TOMAN.toLocaleString("en-US"));
  const inviteeTomanFa = toPersianDigits(INVITEE_REWARD_TOMAN.toLocaleString("en-US"));

  // --- اعتبار پاداش به خریدار و معرف — اتمیک در یک $transaction ---
  // FIX lost-update: قبلاً موجودی معرف زودتر خوانده می‌شد و به‌صورت مطلق
  // نوشته می‌شد؛ دو خرید همزمان با یک معرف، پاداش یکدیگر را overwrite می‌کرد.
  // حالا increment اتمیک استفاده می‌شود و snapshot موجودی (balance) هم بعد
  // از increment از DB خوانده می‌شود تا دفتر WalletTransaction دقیق بماند.
  await db.$transaction(async (tx) => {
    // --- اعتبار پاداش به خریدار (دعوت‌شونده) ---
    await tx.user.update({
      where: { id: buyerUserId },
      data: {
        walletBalance: { increment: INVITEE_REWARD_TOMAN },
        referralRewardPaid: true,
      },
    });
    const buyerFresh = await tx.user.findUnique({
      where: { id: buyerUserId },
      select: { walletBalance: true },
    });
    const buyerNewBalance = buyerFresh?.walletBalance ?? 0;
    await tx.walletTransaction.create({
      data: {
        userId: buyerUserId,
        type: "bonus",
        amount: INVITEE_REWARD_TOMAN,
        balance: buyerNewBalance,
        description: `هدیه دعوت‌شونده فیتاپ — ${inviteeTomanFa} تومان`,
        refId: paymentId,
      },
    });

    // --- اعتبار پاداش به معرف (دعوت‌کننده) ---
    await tx.user.update({
      where: { id: referrer.id },
      data: { walletBalance: { increment: REFERRER_REWARD_TOMAN } },
    });
    const referrerFresh = await tx.user.findUnique({
      where: { id: referrer.id },
      select: { walletBalance: true },
    });
    const referrerNewBalance = referrerFresh?.walletBalance ?? 0;
    await tx.walletTransaction.create({
      data: {
        userId: referrer.id,
        type: "bonus",
        amount: REFERRER_REWARD_TOMAN,
        balance: referrerNewBalance,
        description: `هدیه دعوت‌کننده فیتاپ — ${referrerTomanFa} تومان`,
        refId: paymentId,
      },
    });
  });

  // نوتیفیکیشن‌ها بیرون از تراکنش — خطای نوتیف نباید پاداش را rollback کند
  await db.notification.create({
    data: {
      userId: buyerUserId,
      type: "achievement",
      title: "هدیه دعوت‌شونده! 🎁",
      body: `هدیه دعوت‌شونده: ${inviteeTomanFa} تومان به کیف پول شما اضافه شد! 🎁`,
      link: "?tab=referral",
      meta: JSON.stringify({ type: "referral_reward", amount: INVITEE_REWARD_TOMAN }),
      read: false,
    },
  });

  await db.notification.create({
    data: {
      userId: referrer.id,
      type: "achievement",
      title: "هدیه دعوت‌کننده! 🎁",
      body: `دوستی با دعوت شما به فیتاپ آمد و اولین پلنش را خرید — ${referrerTomanFa} تومان به کیف پول شما اضافه شد! 🎁`,
      link: "?tab=referral",
      meta: JSON.stringify({ type: "referral_reward", amount: REFERRER_REWARD_TOMAN }),
      read: false,
    },
  });

  return true;
}
