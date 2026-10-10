import "server-only";
import { db } from "@/lib/db";
import { detectEntrySourceFromUa } from "@/lib/fitness/entry-source";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v198 — کاتالوگ رویدادهای قیف فروش (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * «تمام مراحل خرید رو در همه جا رویداد گذاری کنی و در پنل مدیر برام بیاری»
 *
 * این فایل سمت سرور است (ثبت + برچسب‌های داشبورد از API می‌آیند). کلاینت فقط
 * نام رویداد را می‌فرستد و سرور با همین whitelist اعتبارسنجی می‌کند.
 *
 * طراحی قیف:
 *   • مراحل اصلی خط قیف با step صعودی (۱۰تایی برای جای‌گذاری آینده)
 *   • دو شاخهٔ تحویل موازی: درگاه (gateway_redirecting) و لینک پیامکی
 *     (payment_link_sms_sent) — هر دو به pay_page_viewed می‌رسند
 *   • رویدادهای «خارج از خط قیف» (شکست‌ها/جانبی‌ها) step منفی دارند تا در
 *     داشبورد جدا نمایش داده شوند ولی در همان جدول بمانند
 *   • منبع/دستگاه هر رویداد سمت سرور از UA استخراج می‌شود (غیرقابل جعل از بادی)
 */

export interface FunnelEventDef {
  /** ترتیب در خط اصلی قیف (منفی = رویداد جانبی/شکست) */
  step: number;
  /** برچسب فارسی برای داشبورد مدیر */
  label: string;
}

/**
 * کاتالوگ کامل رویدادها — whitelist سختِ API ثبت.
 * ⚠️ افزودن رویداد جدید = فقط همین‌جا؛ سرور و داشبورد خودکار می‌بینند.
 */
export const FUNNEL_EVENTS: Record<string, FunnelEventDef> = {
  // ─── خط اصلی قیف ───
  plans_viewed: { step: 10, label: "مشاهدهٔ صفحهٔ پلن‌ها / بخش قیمت" },
  analysis_screen_viewed: { step: 12, label: "مشاهدهٔ صفحهٔ تحلیل آنبوردینگ" },
  purchase_modal_opened: { step: 20, label: "انتخاب پلن و باز شدن مدال خرید" },
  discount_attempted: { step: 30, label: "تلاش برای اعمال کد تخفیف" },
  discount_applied: { step: 31, label: "کد تخفیف اعمال شد" },
  checkout_clicked: { step: 40, label: "کلیک روی دکمهٔ پرداخت" },
  checkout_created: { step: 50, label: "ایجاد پرداخت در سرور" },
  gateway_redirecting: { step: 60, label: "انتقال به درگاه زرین‌پال" },
  payment_link_sms_sent: { step: 60, label: "ارسال لینک پرداخت امن پیامکی" },
  payment_link_shown: { step: 61, label: "نمایش وضعیت پیامک در مدال" },
  pay_page_viewed: { step: 70, label: "باز شدن صفحهٔ میانی پرداخت" },
  payment_succeeded: { step: 90, label: "پرداخت موفق و فعال‌سازی" },

  // ─── شاخهٔ بازار (IAP) ───
  bazaar_iap_started: { step: 55, label: "شروع پرداخت درون‌برنامه‌ای بازار" },
  bazaar_iap_succeeded: { step: 90, label: "خرید بازار موفق" },

  // ─── رویدادهای جانبی (step منفی = خارج از خط قیف) ───
  plan_card_clicked_landing: { step: -5, label: "کلیک روی کارت پلن در لندینگ (پیش از ورود)" },
  discount_rejected: { step: -10, label: "کد تخفیف رد شد" },
  payment_method_selected: { step: -11, label: "تغییر روش پرداخت" },
  checkout_deadend: { step: -12, label: "بن‌بست ایجاد پرداخت (درگاه نشد / خطای سرور)" },
  checkout_network_error: { step: -13, label: "خطای شبکه هنگام پرداخت" },
  payment_failed: { step: -14, label: "پرداخت ناموفق/لغو" },
  bazaar_iap_canceled: { step: -15, label: "لغو پرداخت بازار" },
  bazaar_iap_failed: { step: -16, label: "شکست پرداخت بازار" },
  pay_page_manual_click: { step: -17, label: "کلیک دستی روی دکمهٔ درگاه (انتقال خودکار مسدود بود)" },
  analysis_discount_granted: { step: -18, label: "صدور توکن تخفیف صفحهٔ تحلیل" },
  analysis_discount_revoked: { step: -19, label: "ابطال تخفیف (خروج از صفحهٔ تحلیل)" },
  // ─── v229 — ممیزی قیف (کشف سه تحقیق) ───
  // «مشاهدهٔ صفحهٔ تحلیل» قبلاً روی mount شلیک می‌شد (قبل از آماده‌شدن AI) و
  // ریزشِ انتظار را با ریزشِ محتوا قاطی می‌کرد — این رویداد در لحظهٔ دیدنِ نتیجه است.
  analysis_ready_viewed: { step: 13, label: "دیدن نتیجهٔ تحلیل (آماده شد)" },
  // مصرف واقعی توکن تخفیف تحلیل — قبلاً هیچ رویدادی نداشت و «۶ تلاش» فقط
  // تایپ کد‌های دستی را می‌سنجید؛ حالا نرخ واقعی استفاده از تخفیف قابل‌محاسبه است.
  analysis_discount_used: { step: -20, label: "تخفیف صفحهٔ تحلیل واقعاً مصرف شد" },
  // کاربرِ تخفیف‌دارِ بازار-قدیمی (ممکن نبودن قیمت پویا) — پیام «بروز کنید» به او نشان داده شد
  bazaar_update_prompted: { step: -21, label: "درخواست بروزرسانی از کاربر بازار (تخفیف پویا ممکن نبود)" },
  // قبلاً کلاینت می‌فرستاد ولی در whitelist نبود → بی‌صدا دور انداخته می‌شد
  bazaar_iap_dynamic_skipped: { step: -22, label: "ادامه با قیمت کامل (ثبت قیمت تخفیف‌دار بازار ممکن نشد)" },
} as const;

export const FUNNEL_EVENT_NAMES = Object.keys(FUNNEL_EVENTS);

export function isValidFunnelEvent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FUNNEL_EVENTS, name);
}

/** تشخیص دستگاه از UA — سمت سرور (غیرقابل جعل) */
export function deriveDeviceFromUa(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  if (/FitUpApp\/|FitUpBazaar\//i.test(ua)) return "android";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod|iOS/i.test(ua)) return "ios";
  if (/Windows|Macintosh|Linux(?!.*Android)/i.test(ua)) return "desktop";
  return "unknown";
}

/** منبع ورود از UA — همان منطق v171 (اینستاگرام/اپ/وب) */
export function deriveSourceFromUa(ua: string | null | undefined): string {
  return detectEntrySourceFromUa(ua);
}

export interface RecordFunnelEventInput {
  event: string;
  userId?: string | null;
  sessionId?: string | null;
  path?: string | null;
  planId?: string | null;
  amount?: number | null;
  /** اگر null باشد از UA استخراج می‌شود */
  device?: string | null;
  /** اگر null باشد از UA استخراج می‌شود */
  source?: string | null;
  meta?: Record<string, unknown> | null;
  userAgent?: string | null;
}

const cap = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
};

/**
 * ثبت یک رویداد قیف — همیشه بی‌صدا: هیچ شکستی از این تابع نباید فلوی
 * خرید/پرداخت را بشکند (هر خطا فقط console.warn می‌شود).
 * برای درخواست‌های HTTP: userAgent را از req.headers.get("user-agent") بدهید
 * تا device/source واقعی استخراج شود.
 */
export async function recordFunnelEvent(input: RecordFunnelEventInput): Promise<void> {
  try {
    if (!isValidFunnelEvent(input.event)) return;
    const def = FUNNEL_EVENTS[input.event];
    const ua = input.userAgent ?? null;
    await db.funnelEvent.create({
      data: {
        event: input.event,
        step: def.step,
        userId: input.userId ?? null,
        sessionId: cap(input.sessionId, 80) ?? "",
        path: cap(input.path, 300),
        planId: cap(input.planId, 40),
        amount:
          typeof input.amount === "number" && Number.isFinite(input.amount)
            ? Math.round(input.amount)
            : null,
        device: input.device ?? deriveDeviceFromUa(ua),
        source: input.source ?? deriveSourceFromUa(ua),
        meta: input.meta ? JSON.stringify(input.meta).slice(0, 2000) : null,
      },
    });
  } catch (e) {
    console.warn("[funnel] record failed (non-blocking):", input.event, e);
  }
}
