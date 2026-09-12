import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

// Default settings keys (labels + safe defaults)
const SETTING_KEYS: Record<string, string> = {
  brandName: "نام برند",
  slogan: "شعار برند",
  heroTitle: "عنوان صفحه اصلی",
  heroSubtitle: "زیرعنوان صفحه اصلی",
  primaryColor: "رنگ اصلی",
  referral_reward_amount: "مبلغ هدیه دعوت‌کننده (تومان)",
  referral_invitee_reward_amount: "مبلغ هدیه دعوت‌شونده (تومان) — خالی = مثل دعوت‌کننده",
  // درصد کدهای تخفیف پیامکی (v32) — قالب‌های 461291 و 604678
  onboarding_discount_percent: "درصد کد تخفیف پیامک بعد از آنبوردینگ (قالب 461291)",
  expiry_discount_percent: "درصد کد تخفیف تمدید (قالب‌های 604678 و 883325)",
  // v47 — قالب جدید 612964 (۸ روز بعد از ثبت موبایل)
  welcome_offer_discount_percent: "درصد کد تخفیف پیامک خوش‌آمدگویی ۸ روزه (قالب 612964)",
  // v53 — سناریوی «ترک درگاه پرداخت» (کد نمایشی 248945 — کد داخلی ۲ساعته)
  abandoned_cart_enabled: "سناریوی پیامک ترک درگاه پرداخت (۱ = فعال، ۰ = خاموش)",
  abandoned_cart_discount_percent: "درصد کد تخفیف ترک درگاه پرداخت (کد 248945 — ۲ ساعته)",
  abandoned_cart_sms_template_id: "شناسه قالب sms.ir برای پیامک ترک درگاه (خالی = ارسال با متن آزاد bulk)",
  // کدهای نسخه اپ کافه‌بازار — کنترل آپدیت اجباری/اختیاری اپ کاربران (ممیزی 2-c)
  app_latest_version_code: "کد آخرین نسخه اپ بازار",
  app_min_version_code: "کد حداقل نسخه اپ (زیر این = آپدیت اجباری)",
  // v36 — توکن‌های بازار از پنل ادمین (قبلاً فقط env بود و مستندات به مسیری اشاره می‌کرد که وجود نداشت)
  // عامل اصلی «خرید بازار ولی فعال نشدن پلن»: توکن تنظیم نبود → راستی‌آزمایی fail-closed می‌شد
  bazaar_api_secret: "توکن Developer API بازار (پیشخان → برنامه → API پیشخان بازار) — راستی‌آزمایی خریدها",
  bazaar_dynamic_price_token: "توکن سرویس قیمت پویا بازار (کلید تخفیف پویا از پیشخان)",
  // v66/v69 — بکاپ دوره‌ای دیتابیس (کارت «بکاپ دیتابیس» تب تنظیمات) — v69: مقصد = ربات بله
  db_backup_enabled: "بکاپ خودکار دیتابیس (۱ = فعال، ۰ = خاموش)",
  db_backup_interval_hours: "بازهٔ بکاپ دیتابیس (ساعت) — ۱ تا ۲۴",
  db_backup_retention_hours: "نگهداری بکاپ‌ها (ساعت) — قدیمی‌ترها حذف می‌شوند (پیش‌فرض ۴۸)",
  db_backup_bale_token: "توکن ربات بله (خالی = از env BALE_BOT_TOKEN)",
  db_backup_bale_chat_id: "شناسهٔ چت مقصد در بله (chat_id)",
};

// v36: کلیدهای محرمانه — در GET ماسک می‌شوند (فقط ۴ کاراکتر آخر)
// v69: توکن ربات بله هم محرمانه است (هرگز نباید عمومی شود)
const SECRET_SETTING_KEYS = new Set([
  "bazaar_api_secret",
  "bazaar_dynamic_price_token",
  "db_backup_bale_token",
]);

// مقادیر پیش‌فرض برای کلیدهایی که هنوز در DB ذخیره نشده‌اند
// v1.4.0 (versionCode 5) — مجوزهای دوربین/میکروفون در زمان خودش + فیکس رفرش:
// نسخه‌های قدیمی آپدیت بگیرند؛ ادمین می‌تواند از تنظیمات تغییر دهد.
const SETTING_DEFAULTS: Record<string, string> = {
  app_latest_version_code: "5",
  app_min_version_code: "3",
  onboarding_discount_percent: "15",
  expiry_discount_percent: "30",
  welcome_offer_discount_percent: "30",
  // v53 — ترک درگاه پرداخت
  abandoned_cart_enabled: "1",
  abandoned_cart_discount_percent: "10",
  abandoned_cart_sms_template_id: "",
  // v66/v69 — بکاپ دوره‌ای دیتابیس
  db_backup_enabled: "1",
  db_backup_interval_hours: "2",
  db_backup_retention_hours: "48",
  db_backup_bale_token: "",
  db_backup_bale_chat_id: "",
};

// کلیدهای کد نسخه اپ — عدد صحیح ۱..۱,۰۰۰,۰۰۰
const APP_VERSION_KEYS = new Set(["app_latest_version_code", "app_min_version_code"]);
// کلیدهای درصد تخفیف پیامکی — عدد صحیح ۵..۹۰ (v32 + v47 + v53)
const PERCENT_KEYS = new Set([
  "onboarding_discount_percent",
  "expiry_discount_percent",
  "welcome_offer_discount_percent",
  "abandoned_cart_discount_percent",
]);
// v53 — کلیدهای دووضعیتی ۰/۱ (فعال/خاموش سناریوها)
const BINARY_KEYS = new Set(["abandoned_cart_enabled", "db_backup_enabled"]);
// v66 — بازهٔ بکاپ: عدد صحیح ۱..۲۴ ساعت
const BACKUP_INTERVAL_KEYS = new Set(["db_backup_interval_hours"]);
// v66 — نگهداری بکاپ: عدد صحیح ۱۲..۷۲۰ ساعت (۱۲ ساعت تا ۳۰ روز)
const BACKUP_RETENTION_KEYS = new Set(["db_backup_retention_hours"]);
// v69 — شناسهٔ چت بله: عدد (مثبت/منفی برای گروه) یا خالی
const BACKUP_BALE_CHAT_KEYS = new Set(["db_backup_bale_chat_id"]);
// v53 — کلیدهای شناسه قالب sms.ir — خالی مجاز یا عدد صحیح مثبت
const TEMPLATE_ID_KEYS = new Set(["abandoned_cart_sms_template_id"]);
// کلیدهای مبلغ تومانی — ۱..۱۰,۰۰۰,۰۰۰
const AMOUNT_KEYS = new Set(["referral_reward_amount", "referral_invitee_reward_amount"]);
/** سقف پاداش معرفی (تومان) — جلوگیری از خطای تایپی ۹ رقمی (ممیزی 2-c P2) */
const MAX_REFERRAL_REWARD = 10_000_000;

/** اعتبارسنجی مقدار کلیدهای عددی (کد نسخه اپ و پاداش معرفی) */
function validateNumericSetting(key: string, value: string): string | null {
  if (APP_VERSION_KEYS.has(key)) {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      return "کد نسخه اپ باید عدد صحیح بین ۱ تا ۱,۰۰۰,۰۰۰ باشد.";
    }
    return null;
  }
  if (key === "referral_reward_amount" || key === "referral_invitee_reward_amount") {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 0 || n > MAX_REFERRAL_REWARD) {
      return `مبلغ هدیه باید عدد صحیح بین ۰ تا ${MAX_REFERRAL_REWARD.toLocaleString("en-US")} تومان باشد.`;
    }
    return null;
  }
  if (PERCENT_KEYS.has(key)) {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 5 || n > 90) {
      return "درصد تخفیف باید عدد صحیح بین ۵ تا ۹۰ باشد.";
    }
    return null;
  }
  if (BINARY_KEYS.has(key)) {
    const v = value.trim();
    if (v !== "0" && v !== "1") {
      return "مقدار این تنظیم باید ۱ (فعال) یا ۰ (خاموش) باشد.";
    }
    return null;
  }
  if (TEMPLATE_ID_KEYS.has(key)) {
    const v = value.trim();
    if (v === "") return null; // خالی = ارسال با متن آزاد bulk
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      return "شناسه قالب باید عدد صحیح مثبت باشد (یا خالی برای ارسال با متن آزاد).";
    }
    return null;
  }
  // v66 — بازهٔ بکاپ: عدد صحیح ۱..۲۴ ساعت
  if (BACKUP_INTERVAL_KEYS.has(key)) {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      return "بازهٔ بکاپ باید عدد صحیح بین ۱ تا ۲۴ ساعت باشد.";
    }
    return null;
  }
  // v66 — نگهداری بکاپ: عدد صحیح ۱۲..۷۲۰ ساعت
  if (BACKUP_RETENTION_KEYS.has(key)) {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 12 || n > 720) {
      return "مدت نگهداری باید عدد صحیح بین ۱۲ تا ۷۲۰ ساعت باشد.";
    }
    return null;
  }
  // v69 — شناسهٔ چت بله: عدد صحیح (چت خصوصی مثبت، گروه منفی) یا خالی
  if (BACKUP_BALE_CHAT_KEYS.has(key)) {
    const v = value.trim();
    if (v === "") return null;
    if (!/^-?\d{3,25}$/.test(v)) {
      return "شناسهٔ چت باید عدد باشد (مثل 1566730423) یا خالی. از دکمهٔ «کشف خودکار» در کارت بکاپ استفاده کنید.";
    }
    return null;
  }
  return null;
}

// GET /api/admin/settings — admin: list all settings
export async function GET() {
  try {
    await requireAdmin();
    const rows = await db.siteSetting.findMany();
    const map = new Map(rows.map((r) => [r.key, r]));
    return Response.json({
      settings: Object.keys(SETTING_KEYS).map((k) => {
        const raw = map.get(k)?.value ?? SETTING_DEFAULTS[k] ?? "";
        // v36: مقدار توکن‌های محرمانه ماسک می‌شود — ادمین فقط وقتی مقدار جدید بگذارد عوض می‌شود
        const value =
          SECRET_SETTING_KEYS.has(k) && raw
            ? raw.length > 8
              ? `••••••••${raw.slice(-4)}`
              : "••••••••"
            : raw;
        return { key: k, label: SETTING_KEYS[k], value, id: map.get(k)?.id ?? null, isSecret: SECRET_SETTING_KEYS.has(k) };
      }),
    });
  } catch (e) {
    return apiError(e);
  }
}

// PUT /api/admin/settings — admin: update single setting (body: { key, value })
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const { key, value } = await req.json();
    if (!key || typeof key !== "string" || !SETTING_KEYS[key]) {
      return Response.json({ error: "کلید تنظیمات نامعتبر است." }, { status: 400 });
    }
    if (typeof value !== "string") {
      return Response.json({ error: "مقدار نامعتبر است." }, { status: 400 });
    }

    // Validate primaryColor is hex
    if (key === "primaryColor" && value && !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value)) {
      return Response.json({ error: "رنگ باید در قالب هگز (مثل #F4C542) باشد." }, { status: 400 });
    }

    // اعتبارسنجی کلیدهای عددی — کد نسخه اپ (۱..۱۰۰۰۰۰۰) و پاداش معرفی (۰..۱۰میلیون)
    const numericError = validateNumericSetting(key, value);
    if (numericError) {
      return Response.json({ error: numericError }, { status: 400 });
    }

    // v36: اگر ادمین مقدار ماسک‌شده را دست‌نخورده برگرداند، مقدار قبلی حفظ شود
    if (SECRET_SETTING_KEYS.has(key) && value.startsWith("••••")) {
      const existing = await db.siteSetting.findUnique({ where: { key } });
      return Response.json({ setting: existing ?? { key, value: "", label: SETTING_KEYS[key] } });
    }

    const updated = await db.siteSetting.upsert({
      where: { key },
      create: { key, value, label: SETTING_KEYS[key] },
      update: { value },
    });

    return Response.json({ setting: updated });
  } catch (e) {
    return apiError(e);
  }
}
