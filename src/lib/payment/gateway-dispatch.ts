/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v252 — لایه دیسپچ درگاه (زرین‌پال / زیبال) — نقطهٔ واحد تصمیم‌گیری
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * رکورد Payment فیلد gateway دارد ("zarinpal" | "zibal" | null).
 *  • null → ردیف قدیمیِ قبل از زیبال → همیشه زرین‌پال (رفتار بایت‌به‌بایت قبلی)
 *  • "zibal" → مسیرهای verify/inquiry/start به زیبال می‌روند
 *  • هر مقدار دیگری → زرین‌پال (امنِ پیش‌فرض)
 *
 * قاعدهٔ خط قرمز: سازوکار کافه‌بازار (paymentMethod="bazaar") کاملاً مستقل است
 * و هیچ‌کدام از توابع این ماژول برای آن صدا زده نمی‌شود.
 */

import type { ZarinpalVerifyResult } from "./providers/zarinpal";
import {
  ZibalProviderInstance,
  zibalStatusMessage,
  type ZibalInquiryResult,
} from "./providers/zibal";
import { zarinpalVerify, zarinpalInquiry } from "./providers/zarinpal";
import { db } from "@/lib/db";

export type PaymentGateway = "zarinpal" | "zibal";

/** حل درگاه از روی رکورد Payment — null/نامشخص = زرین‌پال (سازگاری با گذشته) */
export function resolvePaymentGateway(
  gateway: string | null | undefined
): PaymentGateway {
  return gateway === "zibal" ? "zibal" : "zarinpal";
}

/** برچسب فارسی درگاه — برای UI پنل مدیر */
export function gatewayLabel(gateway: string | null | undefined): string {
  return resolvePaymentGateway(gateway) === "zibal" ? "زیبال" : "زرین‌پال";
}

/** شکل ورودی حداقلی (Payment یا هر آبجکتی با همین فیلدها) */
export interface GatewayPaymentRef {
  gateway?: string | null;
  authority: string | null;
  amount: number;
}

/**
 * verify چنددرگاهی — خروجی دقیقاً هم‌شکل ZarinpalVerifyResult قدیمی است تا
 * همهٔ مسیرهای موجود (verify/recover/cron/legacy) بدون تغییر منطقی کار کنند:
 *  · ok + code:100 → تایید موفق همین حالا
 *  · ok + code:101 + alreadyVerified → قبلاً تایید شده (سیاست replay موجود)
 *  · !ok + transportError → خطای شبکه غیرقطعی (claim آزاد و retry)
 *  · !ok بدون transportError → خطای قطعی درگاه
 */
export async function gatewayVerify(
  payment: GatewayPaymentRef
): Promise<ZarinpalVerifyResult> {
  const gw = resolvePaymentGateway(payment.gateway);

  if (gw === "zibal") {
    const res = await ZibalProviderInstance.verify({
      authority: payment.authority ?? "",
      amount: payment.amount,
    });
    // نگاشت به شکل قدیمی — code: 100=موفق، 101=قبلاً تایید شده
    return {
      ok: res.ok,
      code: res.ok ? (res.alreadyVerified ? 101 : 100) : null,
      refId: res.refId,
      cardPan: res.cardPan ?? null,
      cardHash: res.cardHash ?? null,
      fee: res.fee ?? null,
      error: res.error,
      alreadyVerified: res.alreadyVerified,
      transportError: res.transportError === true,
    };
  }

  // زرین‌پال — همان مسیر قبلی (بایت‌به‌بایت)
  return zarinpalVerify({
    authority: payment.authority ?? "",
    amount: payment.amount,
  });
}

/** نتیجهٔ استعلام چنددرگاهی — سه‌حالته: پرداخت‌شده / پرداخت‌نشده / نامعلوم */
export type GatewayPaidState = "paid" | "not-paid" | "unknown";

/**
 * استعلام چنددرگاهی برای تصمیم «آیا واقعاً پول آمده؟» — هم‌قرارداد منطق
 * gatewaySaysPaid مسیر verify:
 *  · زرین‌پال: status PAID/VERIFIED → paid؛ FAILED/REVERSED → not-paid؛
 *    بقیه وضعیت‌های شناخته‌شده → unknown؛ پاسخ قطعیِ خطادار → not-paid
 *  · زیبال (جدول وضعیت‌های مستندات): status 1 یا 2 (پرداخت‌شده تاییدشده/
 *    تاییدنشده) → paid؛ 3 (لغو) و 15/16/18 (استرداد/ریورس) و خطاهای قطعی
 *    بانکی (4..12, 21) → not-paid؛ -1 (در انتظار) → unknown؛
 *    خطای transport → unknown؛ پاسخ قطعیِ خطادار (203 و…) → not-paid
 */
export async function gatewayInquiryPaid(
  payment: Pick<GatewayPaymentRef, "gateway" | "authority">
): Promise<GatewayPaidState> {
  if (!payment.authority) return "unknown";
  const gw = resolvePaymentGateway(payment.gateway);

  try {
    if (gw === "zibal") {
      const inq: ZibalInquiryResult = await ZibalProviderInstance.inquiry(
        payment.authority
      );
      // v254 — رد IP/خطای transport = نامعلوم؛ هرگز مبنای not-paid/failed (باگ مالی:
      // گزارش NOK کلاینت + رد IP درگاه → پرداختِ واقعاً پرداخت‌شده failed می‌شد)
      if (inq.transportError) return "unknown";
      if (inq.ok) {
        const s = inq.status;
        if (s === 1 || s === 2) return "paid";
        if (s != null && [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 18, 21].includes(s)) {
          return "not-paid";
        }
        return "unknown"; // -1 (در انتظار) و بقیه — قطعی اعلام نمی‌کنیم
      }
      // پاسخ قطعی درگاه (کد خطای مشخص مثل 203) ≠ خطای شبکه — قطعی not-paid
      return inq.result !== null && inq.result !== undefined ? "not-paid" : "unknown";
    }

    // زرین‌پال — همان منطق v222 مسیر verify (دست‌نخورده)
    const inq = await zarinpalInquiry({ authority: payment.authority });
    if (inq.ok && (inq.status === "PAID" || inq.status === "VERIFIED")) return "paid";
    if (inq.ok && (inq.status === "FAILED" || inq.status === "REVERSED")) return "not-paid";
    if (inq.ok) return "unknown";
    return inq.code !== null && inq.code !== undefined ? "not-paid" : "unknown";
  } catch {
    return "unknown";
  }
}

/** پیام فارسی وضعیت درگاه برای لاگ/آلرت ادمین */
export function gatewayStatusHuman(
  gateway: string | null | undefined,
  rawStatus: string | number | null
): string {
  if (resolvePaymentGateway(gateway) === "zibal") {
    return zibalStatusMessage(typeof rawStatus === "number" ? rawStatus : null);
  }
  const map: Record<string, string> = {
    VERIFIED: "وریفای شده",
    PAID: "پرداخت شده (وریفای نشده)",
    IN_BANK: "در حال پرداخت",
    FAILED: "ناموفق",
    REVERSED: "ریورس شده",
  };
  return (typeof rawStatus === "string" && map[rawStatus]) || String(rawStatus ?? "نامشخص");
}

// ═══════════════════════════════════════════════════════════════════════════
// v254 — نجات «پرداخت روی authority جایگزین» (ریشه‌کنی باگ ابدی زیبال در اپ)
// ═══════════════════════════════════════════════════════════════════════════
//
// سناریوی واقعی (گزارش مالک): در فلو اپ، /pay/start ممکن است trackId تازه
// صادر کند (تازه‌سازی authority) و کاربر روی trackId «قبلی» پول داده باشد
// (دو-بار باز شدن Custom Tabs، لمس دوبارهٔ دکمهٔ پرداخت، بک‌ور-dot). قبلاً
// verify فقط payment.authority (جدیدترین trackId) را می‌پرسید → پاسخ 202
// («پرداخت نشده») → status pending → صفحهٔ اپ برای همیشه بین «در حال تایید»
// و «در حال استعلام» می‌چرخید و تراکنش در زیبال «تاییدنشده» می‌ماند.
//
// راه‌حل (هم‌الگوی سازوکار چند-authority زرین‌پال در verify — v171/F2):
//   ۱) verify authority اصلی رکورد
//   ۲) اگر قطعاً «پرداخت نشده» (202/203 برای زیبال) بود → همهٔ authorityهای
//      جایگزین ثبت‌شدهٔ همین پرداخت (PaymentAuthority) به‌ترتیب جدیدترین verify
//      می‌شوند — فقط پاسخ ok + تطابق مبلغ پذیرفته می‌شود (F2: اعتماد فقط به
//      پاسخ سرورِ درگاه، نه پارامترهای کلاینت/کال‌بک)
//   ۳) خروجی شامل effectiveAuthority تا کالر DB را هم‌تراز کند و تحویل دهد.
//
// ⚠️ خطای transport (شبکه/رد IP) نجات را قطع می‌کند — غیرقطعی است و نباید
// authority را جابه‌جا کنیم.

/** آیا پاسخ verify یعنی «روی این authority قطعاً پرداخت نشده»؟ */
function isDefinitelyUnpaidVerify(res: ZarinpalVerifyResult): boolean {
  if (res.ok || res.transportError) return false;
  // زرین‌پال: کد خطای قطعی غیر از 101؛ زیبال (نگاشت‌شده): code=null + error
  // — زیبال 202/203 در error پیام دارد؛ تشخیص دقیق: کد 100/101 نیست و transport هم نیست
  return true;
}

export interface GatewayVerifyRecoveryResult {
  /** نتیجهٔ verify نهایی (ممکن است از authority جایگزین آمده باشد) */
  res: ZarinpalVerifyResult;
  /** authorityای که واقعاً verify شد و باید مبنای DB/تحویل باشد */
  effectiveAuthority: string | null;
  /** آیا از authority جایگزین نجات پیدا کرد؟ */
  recoveredViaAltAuthority: boolean;
}

/**
 * verify با نجات authority جایگزین — جایگزین drop-in برای gatewayVerify در
 * همهٔ مسیرهای تعیین‌تکلیف (verify route / recover / server-verify کال‌بک).
 */
export async function gatewayVerifyWithRecovery(
  payment: GatewayPaymentRef & { id?: string }
): Promise<GatewayVerifyRecoveryResult> {
  const primary = await gatewayVerify(payment);
  if (primary.ok || !isDefinitelyUnpaidVerify(primary) || !payment.authority) {
    return {
      res: primary,
      effectiveAuthority: payment.authority,
      recoveredViaAltAuthority: false,
    };
  }

  // فقط وقتی paymentId داریم می‌توانیم alt authorities را پیدا کنیم
  if (!payment.id) {
    return {
      res: primary,
      effectiveAuthority: payment.authority,
      recoveredViaAltAuthority: false,
    };
  }

  try {
    const alts = await db.paymentAuthority.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "desc" },
      select: { authority: true },
    });
    for (const alt of alts) {
      const altAuthority = (alt.authority || "").trim();
      if (!altAuthority || altAuthority === payment.authority) continue;
      const altRes = await gatewayVerify({ ...payment, authority: altAuthority });
      if (altRes.ok) {
        console.info(
          `[gateway-verify-recovery] paid on ALT authority — payment=${payment.id} primary=${payment.authority} alt=${altAuthority} → adopting`
        );
        return {
          res: altRes,
          effectiveAuthority: altAuthority,
          recoveredViaAltAuthority: true,
        };
      }
      // خطای transport روی alt → ادامه به alt بعدی (قطعی نیست ولی شانس کم — ok نیست)
    }
  } catch (e) {
    console.warn(
      "[gateway-verify-recovery] alt-authority lookup failed:",
      e instanceof Error ? e.message : e
    );
  }

  return {
    res: primary,
    effectiveAuthority: payment.authority,
    recoveredViaAltAuthority: false,
  };
}
