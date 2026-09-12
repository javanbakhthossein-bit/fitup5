/**
 * SMS.ir OTP Gateway helper
 * Docs: https://api.sms.ir/v1/send/verify
 *
 * Authentication: HTTP header `x-api-key: <API_KEY>` (NOT Bearer).
 * Mobile format: endpoint «verify» (قالب) موبایل را با صفر ابتدا می‌خواهد
 * («09123456789» — فرمت رسمی مستندات sms.ir؛ در postVerify خودکار اضافه می‌شود).
 * فرمت داخلی/داپ (SmsLog): همیشه «9123456789» (خروجی normalizeMobileForSmsIr).
 * Body (verify): { mobile, templateId, parameters: [{ name, value }] }
 * Response: { status: 1, message: "موفق", data: { messageId, cost } }
 *
 * ─── v61 — دیریکتیو مالک: «همهٔ پیامک‌های فیتاپ تحویل قالبی است، نه بولک» ───
 * مالک خط اختصاصی ندارد؛ خط سرویس‌دهنده، خط خدماتی خود sms.ir (+98500033003)
 * است که فقط «تحویل قالبی» را پشتیبانی می‌کند — endpoint bulk با آن همیشه
 * خطای ۱۰۱ می‌دهد (تست زندهٔ v60 با ۴ فرمت شماره). بنابراین:
 *   • تمام مسیرهای bulk/متن-آزاد (WebOTP خام، فال‌بک متن آزاد ترک خرید) حذف شدند.
 *   • OTP همیشه مستقیم از endpoint قالب (verify) می‌رود — یک فراخوانی، بدون فال‌بک.
 *   • درج خودکار کد در اپ‌های موبایل از «سرور خودمان» است (OTP Bridge — v57)،
 *     نه از روی پیامک؛ حذف bulk هیچ قابلیتی از اپ‌ها نمی‌گیرد.
 *   • متغیر SMSIR_USE_RAW_SEND در env دیگر هیچ اثری ندارد (حذفش اختیاری است).
 */

import { db } from "@/lib/db";
import { getSmsCostPerMessageToman, logSmsCost } from "@/lib/fitness/costs";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";

const SMSIR_API_URL = "https://api.sms.ir/v1/send/verify";

export interface SmsIrResult {
  success: boolean;
  status?: number;
  raw?: unknown;
  error?: string;
  /** v52 — هزینهٔ گزارش‌شدهٔ این ارسال از پاسخ sms.ir (data.data.cost) — در صورت وجود */
  cost?: number;
}

/**
 * v52 حسابداری — استخراج عددی «هزینهٔ ارسال» از بدنهٔ پاسخ sms.ir.
 * verify:  { status, message, data: { messageId, cost } }
 * bulk:    ساختار data ممکن است آبجکت یا آرایهٔ نتیجه‌ها باشد — هر دو پوشش داده می‌شود.
 * اگر هزینه‌ای گزارش نشد undefined برمی‌گردد (لاگر خودش نرخ پیش‌فرض می‌گذارد).
 */
function extractSmsCost(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const candidates: unknown[] = [d.cost];
  const inner = d.data;
  if (inner && typeof inner === "object") {
    if (Array.isArray(inner)) {
      const first = inner[0];
      if (first && typeof first === "object") {
        candidates.push((first as Record<string, unknown>).cost);
      }
    } else {
      candidates.push((inner as Record<string, unknown>).cost);
    }
  }
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
    if (typeof c === "string" && c.trim() !== "" && Number.isFinite(Number(c))) return Number(c);
  }
  return undefined;
}

/**
 * v52 حسابداری — ثبت هزینه/وضعیت یک ارسال پیامک در SmsMessageLog (best-effort).
 * ⚠️ جدول SmsLog (داپ ابدی) کاملاً دست‌نخورده می‌ماند — این فقط لاگ مالی است
 * و شکستش هرگز نتیجهٔ ارسال پیامک را تغییر نمی‌دهد (logSmsCost خودش try/catch است).
 * واحد cost «تومان» فرض شده است؛ اگر sms.ir هزینه گزارش نکند نرخ پیش‌فرض ادمین
 * (sms_cost_per_message_toman) جایگزین می‌شود.
 */
async function logSmsResultCost(opts: {
  normalizedMobile: string;
  scenario: string;
  templateId: string | null;
  result: SmsIrResult;
  userId?: string | null;
}): Promise<void> {
  try {
    if (opts.result.success) {
      const reported = typeof opts.result.cost === "number" && opts.result.cost > 0
        ? Math.round(opts.result.cost)
        : null;
      await logSmsCost({
        mobile: opts.normalizedMobile,
        scenario: opts.scenario,
        templateId: opts.templateId,
        status: "sent",
        cost: reported ?? (await getSmsCostPerMessageToman()),
        userId: opts.userId ?? null,
      });
    } else {
      await logSmsCost({
        mobile: opts.normalizedMobile,
        scenario: opts.scenario,
        templateId: opts.templateId,
        status: "failed",
        cost: 0,
        error: opts.result.error ?? null,
        userId: opts.userId ?? null,
      });
    }
  } catch (e) {
    // لاگ مالی هرگز ارسال پیامک را خراب نمی‌کند (دفاع مضاعف)
    console.warn("[smsir] logSmsResultCost failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Normalize an Iranian mobile number to the INTERNAL format (SmsLog/داپ/bulk):
 *   "09123456789"  → "9123456789"
 *   "989123456789" → "9123456789"
 *   "+989123456789"→ "9123456789"
 *   "00989123456789"→ "9123456789"
 * ⚠️ برای endpoint «verify» (قالب) در postVerify خودکار «۰» اول اضافه می‌شود
 * (فرمت رسمی sms.ir) — خروجی این تابع مستقیماً روی سیم verify نمی‌رود.
 */
export function normalizeMobileForSmsIr(mobile: string): string {
  let m = mobile.replace(/\s/g, "").replace(/[+\-()]/g, "");
  // Strip country code variants
  if (m.startsWith("0098")) m = m.slice(4);
  else if (m.startsWith("98")) m = m.slice(2);
  // Strip leading 0
  if (m.startsWith("0")) m = m.slice(1);
  return m;
}

/**
 * ارسال OTP با قالب (endpoint verify) — مستقل از حالت raw تا در زنجیرهٔ
 * fallback قابل استفاده باشد.
 * v56: انتخاب قالب بر اساس واریانت اپ — قالب اپ باید در پنل sms.ir با
 * «<#>هش اپ» تمام شود تا SMS Retriever کد را خودکار جاگذاری کند.
 */
async function sendOtpViaTemplate(
  normalizedMobile: string,
  code: string,
  apiKey: string,
  appVariant: "own" | "bazaar" | "web" = "web"
): Promise<SmsIrResult> {
  const templateIdRaw =
    (appVariant === "own" && process.env.SMSIR_TEMPLATE_OTP_OWN?.trim()) ||
    (appVariant === "bazaar" && process.env.SMSIR_TEMPLATE_OTP_BAZAAR?.trim()) ||
    process.env.SMSIR_TEMPLATE_ID;
  if (!templateIdRaw) {
    return { success: false, error: "SMSIR_TEMPLATE_ID تنظیم نشده است." };
  }
  const templateId = Number(templateIdRaw);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { success: false, error: "SMSIR_TEMPLATE_ID نامعتبر است." };
  }
  // Parameter name must match the placeholder key defined in the sms.ir
  // panel template (CODE). ارسال + parse پاسخ در postVerify مشترک است.
  // timeout ۸ ثانیه‌ای: OTP نباید کاربر را سرِ صفحهٔ ورود نگه دارد —
  // بدترین حالت ≤ ~۹ ثانیه و مرورگر/fetch هرگز timeout نمی‌خورد.
  return postVerify(
    normalizedMobile,
    templateId,
    [{ name: "CODE", value: code }],
    apiKey,
    "(otp)",
    8_000
  );
}

/**
 * Send a verification OTP via sms.ir — مسیر واحد و قطعی (فیکس ریشه‌ای v45).
 *
 * @param mobile Iranian mobile number (any common format — will be normalized)
 * @param code   4-digit code as a string (e.g. "1234")
 *
 * 🩹 گزارش مالک: OTP خیلی دیر می‌رسد / مرورگر «failed to fetch» می‌دهد / در
 * پنل sms.ir خطای «POST /v1/send/bulk — کد ۱۰۱ شماره خط نامعتبر میباشد».
 *
 * ریشهٔ اصلی: SMSIR_USE_RAW_SEND=true در production باعث می‌شد OTP اول از
 * endpoint «bulk» برود؛ بدنهٔ bulk بدون فیلد اجباری «line» (متغیر SMSIR_LINE
 * در env تعریف نشده) → HTTP 400 کد ۱۰۱ → بعد فال‌بک قالبی (رفت‌وبرگشت مضاعف
 * = تأخیر) و مدارشکنِ حافظه‌ای هم با هر ری‌استارت سرور ریست می‌شد، پس خطای
 * ۱۰۱ هر بار از نو تکرار می‌شد.
 *
 * v61 — راه‌حل نهایی (دیریکتیو مالک: «همهٔ پیامک‌ها قالبی است نه بولک»):
 *   OTP فقط و فقط از endpoint قالب (verify — قالب 829644/قالب اختصاصی اپ)
 *   با یک فراخوانی و timeout ۸ ثانیه‌ای ارسال می‌شود. مسیر bulk/WebOTP کلاً
 *   حذف شد (با خط خدماتی مالک همیشه ۱۰۱ می‌داد و فقط تأخیر/نویز می‌ساخت).
 *   درج خودکار کد در اپ‌های موبایل مسیر سروری دارد (OTP Bridge — v57) و به
 *   پیامک وابسته نیست.
 */
export async function sendOtpSms(
  mobile: string,
  code: string,
  // v52 حسابداری — اختیاری؛ مسیرهای فعلی نمی‌فرستند (OTP قبل از لاگین است)
  // v56 — appVariant: از User-Agent در send-otp تشخیص داده می‌شود تا
  //  • پیامک خام (WebOTP) فقط هشِ همان اپ را داشته باشد (فیکس SMS Retriever)
  //  • قالب OTP اختصاصی هر اپ (SMSIR_TEMPLATE_OTP_OWN / _BAZAAR) انتخاب شود —
  //    متن قالب در پنل sms.ir باید با «<#>هش اپ» تمام شود تا Retriever کار کند.
  opts?: { userId?: string | null; appVariant?: "own" | "bazaar" | "web" }
): Promise<SmsIrResult> {
  const apiKey = process.env.SMSIR_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "SMSIR_API_KEY تنظیم نشده است.",
    };
  }

  const normalized = normalizeMobileForSmsIr(mobile);
  if (!/^9\d{9}$/.test(normalized)) {
    return {
      success: false,
      error: `شماره موبایل نرمال‌شده نامعتبر است: ${normalized}`,
    };
  }

  // v61 — تک‌مسیرِ قطعی: قالب (verify). بدون bulk، بدون فال‌بک، بدون ۱۰۱.
  const result = await sendOtpViaTemplate(normalized, code, apiKey, opts?.appVariant ?? "web");
  await logSmsResultCost({ normalizedMobile: normalized, scenario: "otp", templateId: process.env.SMSIR_TEMPLATE_ID ?? null, result, userId: opts?.userId });
  return result;
}

/**
 * ارسال پیامک با قالب عمومی verify (استفاده داخلی).
 * ساختار پاسخ sms.ir: { status: 1, message: "موفق", data: {...} }
 */
async function postVerify(
  normalizedMobile: string,
  templateId: number,
  parameters: Array<{ name: string; value: string }>,
  apiKey: string,
  label: string,
  timeoutMs = 15_000
): Promise<SmsIrResult> {
  try {
    const res = await fetch(SMSIR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // CRITICAL: sms.ir uses `x-api-key`, NOT `Authorization: Bearer`.
        "x-api-key": apiKey,
      },
      // 🩹 v58 — فیکس باگ پیامک (گزارش مالک: قالب 248945 → HTTP 400 «101 شماره
      // خط نامعتبر» با بدنهٔ بدون-صفر): endpoint رسمی «verify» موبایل را با صفر
      // ابتدا می‌خواهد (فرمت مستندات sms.ir: «09123456789»). فرمت داخلی/داپ
      // (SmsLog) همچنان بدون-صفر می‌ماند — فقط سیمِ درخواست تغییر می‌کند.
      body: JSON.stringify({ mobile: `0${normalizedMobile}`, templateId, parameters }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response — keep data null.
    }

    if (!res.ok) {
      // 🩹 v45: کد وضعیت و پیام sms.ir (مثل «۱۰۱ — شماره خط نامعتبر میباشد»)
      // هم در status/error بیاید تا لاگ pm2 دقیقاً مثل پنل خوانا باشد
      // (هم‌تراز با رفتار bulk از v35).
      const bodyMsg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message ?? "")
          : "";
      const bodyStatus =
        data && typeof data === "object" && "status" in data
          ? (data as { status: unknown }).status
          : undefined;
      return {
        success: false,
        status: typeof bodyStatus === "number" ? bodyStatus : res.status,
        raw: data,
        error: `sms.ir ${label} خطای HTTP ${res.status}${
          bodyStatus !== undefined ? ` (کد وضعیت ${String(bodyStatus)})` : ""
        }${bodyMsg ? ` — ${bodyMsg}` : ""}`,
      };
    }

    const statusField =
      data && typeof data === "object" && "status" in data
        ? (data as { status: unknown }).status
        : undefined;

    if (statusField !== undefined && statusField !== 1) {
      const messageField =
        data && typeof data === "object" && "message" in data
          ? (data as { message: unknown }).message
          : undefined;
      return {
        success: false,
        status: typeof statusField === "number" ? statusField : res.status,
        raw: data,
        error: `sms.ir ${label} خطای وضعیت ${String(statusField)}${
          messageField ? ` — ${String(messageField)}` : ""
        }`,
      };
    }

    return { success: true, status: res.status, raw: data, cost: extractSmsCost(data) };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : `خطای ناشناخته در اتصال به sms.ir (${label})`,
    };
  }
}

/**
 * ارسال پیامک «تیکت جدید» با قالب اختصاصی sms.ir — کد قالب ۹۴۲۷۶۳.
 *
 * قالب فقط یک متغیر دارد: #NAME# (نام کاربر) — متن کامل پیامک در پنل sms.ir
 * تعریف و توسط sms.ir تأیید می‌شود. تا زمان تأیید قالب، ارسال خطای وضعیت
 * می‌خورد که کاملاً بی‌اثر است (جریان ساخت تیکت هرگز نباید به پیامک وابسته باشد).
 *
 * تنظیمات env:
 *   SMSIR_TICKET_TEMPLATE_ID  → کد قالب (پیش‌فرض 942763)
 */
export async function sendTicketSms(
  mobile: string,
  name: string,
  // v52 حسابداری — اختیاری؛ مسیرهای فعلی نمی‌فرستند و رفتار تغییری نکرده است
  opts?: { userId?: string | null }
): Promise<SmsIrResult> {
  const apiKey = process.env.SMSIR_API_KEY;
  const templateIdRaw = process.env.SMSIR_TICKET_TEMPLATE_ID || "942763";
  const normalized = normalizeMobileForSmsIr(mobile);

  if (!apiKey) {
    return { success: false, error: "SMSIR_API_KEY تنظیم نشده است." };
  }
  if (!/^9\d{9}$/.test(normalized)) {
    return { success: false, error: `شماره موبایل نرمال‌شده نامعتبر است: ${normalized}` };
  }
  const templateId = Number(templateIdRaw);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { success: false, error: "SMSIR_TICKET_TEMPLATE_ID نامعتبر است." };
  }

  // v42 — دیریکتیو مالک: هیچ پیامکی نباید به‌جای نام «کاربر» بنویسد.
  // اگر نام کاربر ثبت نشده باشد، پیامک تیکت ارسال نمی‌شود (جریان تیکت
  // هرگز به پیامک وابسته نیست و این شکست non-blocking است).
  const safeName = String(name || "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 40);
  if (!safeName) {
    return { success: false, error: "نام کاربر ثبت نشده است؛ پیامک تیکت بدون نام ارسال نمی‌شود." };
  }

  const result = await postVerify(
    normalized,
    templateId,
    [{ name: "NAME", value: safeName }],
    apiKey,
    "(ticket)"
  );
  await logSmsResultCost({ normalizedMobile: normalized, scenario: "ticket", templateId: String(templateId), result, userId: opts?.userId ?? null });
  return result;
}

// v61 — هش‌های SMS Retriever اپ‌ها (own: hVswmB0y7Qr / bazaar: 5W389jh9yas)
// دیگر در کد استفاده نمی‌شوند چون مسیر پیامک خام (bulk/WebOTP/SMS Retriever)
// با دیریکتیو مالک («همهٔ پیامک‌ها قالبی») حذف شد. درج خودکار کد در اپ‌ها از
// سرور (OTP Bridge — v57) انجام می‌شود. اگر روزی خط اختصاصی گرفته شد، هش‌ها
// در worklog v57 مستندند.

/**
 * v56: تشخیص واریانت اپ از User-Agent — برای انتخاب قالب OTP درست.
 * MainActivity هر دو اپ در UA عبارت «FitUpApp/» یا «FitUpBazaar/» می‌گذارد.
 */
export function detectOtpAppVariant(ua?: string | null): "own" | "bazaar" | "web" {
  const s = (ua ?? "").toLowerCase();
  if (s.includes("fitupapp/")) return "own";
  if (s.includes("fitupbazaar/")) return "bazaar";
  return "web";
}

// ═══════════════════════════════════════════════════════════════════════════
// پیامک‌های تمپلیتی سیستمی (قالب‌های تأییدشدهٔ sms.ir) — v32/v33
// ═══════════════════════════════════════════════════════════════════════════
// هر سناریو یک کلید (key) و یک env-template دارد. شناسه قالب‌ها از env خوانده
// می‌شوند؛ اگر متغیر تنظیم نشده باشد سناریو «بی‌صدا» رد می‌شود (skip) تا دیپلوی
// بدون کلید sms.ir هرگز نشکند. متن قالب‌ها در پنل sms.ir تعریف و تأیید شده‌اند
// و اینجا فقط پارامترها (NAME/CODE/LINK) پر می‌شوند.
//
//   کلید                | قالب   | پارامترها     | env
//   --------------------|--------|---------------|----------------------------------
//   onboarding_nudge    | 669068 | NAME          | SMSIR_TEMPLATE_ONBOARDING_NUDGE
//   onboarding_winback  | 461291 | NAME, CODE    | SMSIR_TEMPLATE_ONBOARDING_WINBACK
//   program_ready       | 663678 | NAME          | SMSIR_TEMPLATE_PROGRAM_READY
//   checkup_reminder    | 761137 | NAME          | SMSIR_TEMPLATE_CHECKUP_REMINDER
//   plan_expired        | 322780 | NAME, LINK    | SMSIR_TEMPLATE_PLAN_EXPIRED
//   plan_expiring_soon  | 184777 | NAME, LINK    | SMSIR_TEMPLATE_PLAN_EXPIRING
//   invite_friend       | 852193 | NAME, LINK    | SMSIR_TEMPLATE_INVITE_FRIEND
//   expired_winback     | 604678 | NAME, CODE, LINK | SMSIR_TEMPLATE_EXPIRED_WINBACK
//   purchase_advanced   | 423726 | NAME?         | SMSIR_TEMPLATE_PURCHASE_ADVANCED
//   purchase_ultimate   | 612405 | NAME?         | SMSIR_TEMPLATE_PURCHASE_ULTIMATE
//   purchase_basic      | 565185 | NAME?         | SMSIR_TEMPLATE_PURCHASE_BASIC
//   plan_upgrade_premium  | 275042 | NAME, PLANBASE, PLANUPDATE | SMSIR_TEMPLATE_PLAN_UPGRADE_PREMIUM
//   plan_upgrade_standard | 324322 | NAME, PLANBASE, PLANUPDATE | SMSIR_TEMPLATE_PLAN_UPGRADE_STANDARD
//   wallet_topup          | 556023 | NAME?, AMOUNT?  | SMSIR_TEMPLATE_WALLET_TOPUP
//   welcome_offer         | 612964 | NAME, CODE      | SMSIR_TEMPLATE_WELCOME_OFFER
//   renewal_boost         | 883325 | NAME, CODE, LINK| SMSIR_TEMPLATE_RENEWAL_BOOST
//
//   (_purchase_* = پیامک‌های خرید موفق v33 — بلافاصله بعد از تأیید پرداخت درگاه؛
//    «NAME?» یعنی اگر قالب متغیر داشته باشد NAME پر می‌شود، وگرنه بدون پارامتر
//    ارسال می‌شود — خودترمیم در sms-flows.ts)
//   plan_upgrade_* = پیامک‌های ارتقای پلن v36 (متغیرها: #NAME# + #PLANBASE# + #PLANUPDATE#)
//   wallet_topup   = پیامک شارژ موفق کیف پول v36 — بعد از تأیید پرداخت درگاه
//   welcome_offer  = پیامک «۸ روز بعد از ثبت موبایل» v47 — قهرمان بازگشت به خرید
//                    (NAME = «ورزشکار» برای کاربر بدون آنبوردینگ، CODE = تخفیف خوش‌آمدگویی)
//   renewal_boost  = پیامک «۸ روز از انقضای پلن» v47 — هم‌خانوادهٔ 604678 با
//                    لینک هوشمند go/renew (اپ باز می‌شود، نه مرورگر)

export const SMS_TEMPLATE_ENV_KEYS = {
  onboarding_nudge: "SMSIR_TEMPLATE_ONBOARDING_NUDGE",
  onboarding_winback: "SMSIR_TEMPLATE_ONBOARDING_WINBACK",
  program_ready: "SMSIR_TEMPLATE_PROGRAM_READY",
  checkup_reminder: "SMSIR_TEMPLATE_CHECKUP_REMINDER",
  plan_expired: "SMSIR_TEMPLATE_PLAN_EXPIRED",
  plan_expiring_soon: "SMSIR_TEMPLATE_PLAN_EXPIRING",
  invite_friend: "SMSIR_TEMPLATE_INVITE_FRIEND",
  expired_winback: "SMSIR_TEMPLATE_EXPIRED_WINBACK",
  welcome_offer: "SMSIR_TEMPLATE_WELCOME_OFFER",
  renewal_boost: "SMSIR_TEMPLATE_RENEWAL_BOOST",
  purchase_advanced: "SMSIR_TEMPLATE_PURCHASE_ADVANCED",
  purchase_ultimate: "SMSIR_TEMPLATE_PURCHASE_ULTIMATE",
  purchase_basic: "SMSIR_TEMPLATE_PURCHASE_BASIC",
  plan_upgrade_premium: "SMSIR_TEMPLATE_PLAN_UPGRADE_PREMIUM",
  plan_upgrade_standard: "SMSIR_TEMPLATE_PLAN_UPGRADE_STANDARD",
  wallet_topup: "SMSIR_TEMPLATE_WALLET_TOPUP",
} as const;

export type SmsTemplateKey = keyof typeof SMS_TEMPLATE_ENV_KEYS;

/**
 * v66 — شناسه‌های پیش‌فرض قالب‌ها (همه قالب‌های تأییدشدهٔ پنل sms.ir فیتاپ).
 *
 * چرا: شناسهٔ قالب‌ها از env خوانده می‌شود ولی اگر متغیر env روی سرور تنظیم
 * نشده باشد (مثلاً بعد از هر تغییر .env یکی جا افتاده باشد)، سناریو بی‌صدا با
 * «no_template» رد می‌شد — ریشهٔ «پیامک کلاً ارسال نمیشه» بدون هیچ رد پایی
 * در لاگ. حالا اگر env نباشد، شناسهٔ تأییدشدهٔ همین جدول استفاده می‌شود؛
 * env همچنان ارجحیت دارد (ادمین بتواند قالب را عوض کند) و templateIdOverride
 * (SiteSetting) از همه بالاتر است.
 */
export const DEFAULT_SMS_TEMPLATE_IDS: Record<SmsTemplateKey, string> = {
  onboarding_nudge: "669068",
  onboarding_winback: "461291",
  program_ready: "663678",
  checkup_reminder: "761137",
  plan_expired: "322780",
  plan_expiring_soon: "184777",
  invite_friend: "852193",
  expired_winback: "604678",
  welcome_offer: "612964",
  renewal_boost: "883325",
  purchase_advanced: "423726",
  purchase_ultimate: "612405",
  purchase_basic: "565185",
  plan_upgrade_premium: "275042",
  plan_upgrade_standard: "324322",
  wallet_topup: "556023",
};

/**
 * v66 — رزولوشن شفاف شناسهٔ قالب برای ممیزی پنل ادمین.
 * ترتیب ارجحیت: override (SiteSetting) > env > پیش‌فرض هاردکد.
 */
export function resolveTemplateId(
  templateEnvKey?: SmsTemplateKey,
  templateIdOverride?: string | number | null
): { id: string | null; source: "override" | "env" | "default" | "none" } {
  const overrideRaw =
    templateIdOverride != null ? String(templateIdOverride).trim() : "";
  if (overrideRaw) return { id: overrideRaw, source: "override" };
  if (templateEnvKey) {
    const envRaw = process.env[SMS_TEMPLATE_ENV_KEYS[templateEnvKey]];
    if (envRaw && envRaw.trim()) return { id: envRaw.trim(), source: "env" };
    const def = DEFAULT_SMS_TEMPLATE_IDS[templateEnvKey];
    if (def) return { id: def, source: "default" };
  }
  return { id: null, source: "none" };
}

export interface SendTemplateSmsOptions {
  key: SmsTemplateKey | string; // کلید دداپ (برای invite_friend می‌تواند پسوند داشته باشد)
  /** v53 — با templateIdOverride اختیاری شد (ارسال با شناسهٔ صریح از SiteSetting) */
  templateEnvKey?: SmsTemplateKey; // کدام env برای شناسه قالب
  mobile: string;
  params: Array<{ name: string; value: string }>;
  userId?: string | null;
  /** true = دداپ (mobile,key) نادیده گرفته می‌شود — فقط برای ارسال دستی/تستی ادمین */
  force?: boolean;
  /**
   * v53 — شناسهٔ قالب صریح (مثلاً از SiteSetting مثل abandoned_cart_sms_template_id).
   * اگر تنظیم شود بر env مربوط به templateEnvKey ارجحیت دارد؛ خالی/نال = رفتار قبلی (env).
   */
  templateIdOverride?: string | number | null;
}

export interface SendTemplateSmsResult {
  sent: boolean;
  /** "already_sent" = قبلاً همین سناریو به این شماره رفته (داپ) | "no_template" = env تنظیم نیست | "no_name" = نام کاربر ثبت نشده */
  skipped?: "already_sent" | "no_template" | "invalid_mobile" | "no_name";
  error?: string;
}

/**
 * v43 — دیریکتیو مالک: برای کاربری که آنبوردینگ را تکمیل نکرده و نام ندارد،
 * پیامک یادآوری آنبوردینگ (قالب 669068) باید بفرستد و به‌جای نام «ورزشکار»
 * نوشته شود — نه متغیر خالی، نه skip. بقیهٔ قالب‌ها استثنا ندارند (skip).
 *
 * v47 — قالب 612964 هم به همین خانواده اضافه شد: دیریکتیو صریح مالک —
 * «اگر کاربر آنبوردینگ رو تکمیل نکرده بود بجای متغیر نیم باید بنویسی ورزشکار
 * و در صورت تکمیل اسمش رو.»
 */
const NAME_FALLBACK_BY_TEMPLATE: Partial<Record<SmsTemplateKey, string>> = {
  onboarding_nudge: "ورزشکار",
  welcome_offer: "ورزشکار",
};

/**
 * ارسال پیامک با قالب sms.ir + دداپ ابدی با جدول SmsLog.
 *
 * هر (mobile, key) فقط یک بار در عمر سیستم «sent» می‌شود؛ تلاش‌های بعدی
 * skipped:"already_sent" برمی‌گردانند — پس اجرای مجدد backfill یا sweep هرگز
 * پیامک تکراری نمی‌فرستد. اگر ارسال failed شود، رکورد با status=failed ثبت
 * می‌شود ولی چون unique constraint فقط بعد از sent سد می‌شود (رکورد failed
 * با upsert ثبت و در صورت موفقیت بعدی به sent تبدیل می‌شود)، ارسال دوباره
 * در sweep بعدی ممکن است.
 */
export async function sendTemplateSms(opts: SendTemplateSmsOptions): Promise<SendTemplateSmsResult> {
  const apiKey = process.env.SMSIR_API_KEY;

  // v53 — شناسهٔ صریح (templateIdOverride) بر env ارجحیت دارد
  // v66 — اگر env تنظیم نبود، شناسهٔ پیش‌فرض هاردکد قالب‌های تأییدشده استفاده
  // می‌شود (قبلاً سناریو بی‌صدا با no_template رد می‌شد — ریشهٔ «پیامک ارسال نمیشه»)
  const resolved = resolveTemplateId(opts.templateEnvKey, opts.templateIdOverride);
  const templateIdRaw = resolved.id ?? undefined;

  const normalized = normalizeMobileForSmsIr(opts.mobile);
  if (!/^9\d{9}$/.test(normalized)) {
    return { sent: false, skipped: "invalid_mobile", error: `شماره نامعتبر: ${normalized}` };
  }

  // ─── دداپ ابدی ───
  if (!opts.force) {
    const existing = await db.smsLog.findUnique({
      where: { mobile_key: { mobile: normalized, key: opts.key } },
      select: { status: true },
    });
    if (existing?.status === "sent") {
      return { sent: false, skipped: "already_sent" };
    }
  }

  if (!apiKey) {
    // بدون کلید API — سناریو بی‌صدا رد می‌شود (سیستم پیامک اختیاری است)
    return { sent: false, skipped: "no_template", error: "SMSIR_API_KEY تنظیم نشده است." };
  }
  if (!templateIdRaw) {
    return { sent: false, skipped: "no_template", error: "شناسه قالب تنظیم نشده است (env یا override)." };
  }
  const templateId = Number(templateIdRaw);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { sent: false, skipped: "no_template", error: "شناسه قالب نامعتبر است." };
  }

  let params = opts.params;

  // ─── v57 — ضد چسبیدگی در پارامترهای متنی فارسی (دیریکتیو مالک: هیچ
  // پیامکی کلمهٔ چسبیده نداشته باشد) ───
  // فقط پارامترهای «متنِ خالص فارسی» را اصلاح می‌کنیم؛ LINK هرگز! چون
  // fixPersianTypography بعد از نقطه فاصله می‌گذارد و URL را خراب می‌کند.
  params = params.map((p) =>
    p.name === "NAME" || p.name === "PLANBASE" || p.name === "PLANUPDATE"
      ? { ...p, value: fixPersianTypography(String(p.value ?? "")) }
      : p
  );

  // ─── v48 گارد طول پارامتر — فیکس ریشه‌ای خطای 114 sms.ir ───
  // «طول رشته مقدار پارامتر، بیش از حد مجاز (۲۵ کاراکتر) میباشد»
  //  • NAME طولانی → به ۲۵ کاراکتر کوتاه می‌شود (پیامک می‌رود)
  //  • هر پارامتر دیگر (LINK و…) اگر بعد از این گارد هنوز بلند باشد → حذف
  //    می‌شود (مثل نردبان خودترمیمِ بدون لینک) تا هرگز 400/114 نخوریم.
  // لینک‌های تمدید حالا از sms-short-link.ts می‌آیند (r/XXXXXXXX = ۱۰ کاراکتر)
  // و عملاً هرگز به این شاخه نمی‌خورند — این گارد ایمنیِ ساختاری است.
  {
    const MAX = 25;
    const clamped: Array<{ name: string; value: string }> = [];
    for (const p of params) {
      const v = String(p.value ?? "");
      if (v.length > MAX) {
        if (p.name === "NAME") {
          clamped.push({ name: p.name, value: v.slice(0, MAX) });
          console.warn(`[sendTemplateSms] (${opts.key}) NAME > ${MAX} chars → truncated to ${MAX}`);
        } else {
          console.warn(
            `[sendTemplateSms] (${opts.key}) پارامتر ${p.name} طولش ${v.length} بود (سقف ${MAX}) → حذف شد (ضد خطای 114)`
          );
          // پارامتر حذف می‌شود
        }
      } else {
        clamped.push(p);
      }
    }
    params = clamped;
  }

  // ─── v42 گارد نام خالی — دیریکتیو مالک ───
  // «در هیچ‌کدام از پیام‌ها نباید به‌جای نام کاربر «کاربر» نوشته شود.»
  // اگر پارامتر NAME خالی است (کاربر هنوز نامش را ثبت نکرده — مثل کاربرانی که
  // فقط با OTP وارد شده‌اند و آنبوردینگ را تمام نکرده‌اند)، پیامک با نامِ
  // جعلی «کاربر» نمی‌رود.
  //
  // 🩹 v43 — اصلاح دیریکتیو مالک (قالب 669068):
  // «همون برای کاربری که انبوردینگ تکمیل نکرده و اسمش نیست بجای اینکه متغیر
  //  نیم رو خالی بذاری یا پیامک نفرستی. پیامک بفرست و بنویس ورزشکار.»
  // → قالب onboarding_nudge استثناست: NAME خالی خودکار با «ورزشکار» پر و
  //   پیامک ارسال می‌شود. بقیهٔ قالب‌ها همان گارد سخت v42 را دارند (skip
  //   با no_name — پیامک بدون نام یا با placeholder هرگز نمی‌رود).
  const fallbackName =
    NAME_FALLBACK_BY_TEMPLATE[opts.templateEnvKey as SmsTemplateKey];
  if (opts.params.some((p) => p.name === "NAME" && !String(p.value ?? "").trim())) {
    if (fallbackName) {
      params = opts.params.map((p) =>
        p.name === "NAME" ? { ...p, value: fallbackName } : p
      );
      console.info(
        `[sendTemplateSms] (${opts.key}) NAME خالی بود → «${fallbackName}» (دیریکتیو مالک v43 — قالب 669068)`
      );
    } else {
      console.warn(
        `[sendTemplateSms] (${opts.key}) skipped: empty NAME param — user has no registered name yet`
      );
      return {
        sent: false,
        skipped: "no_name",
        error: "نام کاربر ثبت نشده است؛ پیامک بدون نام ارسال نمی‌شود.",
      };
    }
  }

  const result = await postVerify(normalized, templateId, params, apiKey, `(${opts.key})`);

  // ─── v52 حسابداری — لاگ هزینهٔ ارسال (best-effort، مستقل از داپ) ───
  await logSmsResultCost({
    normalizedMobile: normalized,
    scenario: opts.key,
    templateId: String(templateId),
    result,
    userId: opts.userId ?? null,
  });

  // ─── ثبت در SmsLog (upsert — رکورد failed قبلی به sent ارتقا می‌یابد) ───
  try {
    await db.smsLog.upsert({
      where: { mobile_key: { mobile: normalized, key: opts.key } },
      create: {
        mobile: normalized,
        key: opts.key,
        templateId: String(templateId),
        userId: opts.userId ?? null,
        status: result.success ? "sent" : "failed",
        error: result.success ? null : (result.error ?? null),
      },
      update: {
        templateId: String(templateId),
        userId: opts.userId ?? undefined,
        status: result.success ? "sent" : "failed",
        error: result.success ? null : (result.error ?? null),
        createdAt: result.success ? new Date() : undefined,
      },
    });
  } catch (e) {
    // دداپ هرگز نباید نتیجهٔ ارسال را خراب کند
    console.warn("[sendTemplateSms] smsLog upsert failed:", e);
  }

  if (!result.success) {
    return { sent: false, error: result.error };
  }
  return { sent: true };
}
