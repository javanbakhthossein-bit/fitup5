/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v171 — تشخیص منبع ورود کاربر (سند بازطراحی جریان پرداخت — بخش ۱)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * چهار مقدار مستقل — هرگز با هم ترکیب نمی‌شوند:
 *   instagram   → User-Agent شامل Instagram یا FB_IAB یا FBAN (مرورگر درون‌اپی)
 *   app_android → UA سفارشی اپ اختصاصی ما (FitUpApp/ — واقعیت اپ فعلی) یا
 *                 AppAndroid (مارکر سند). ⚠️ اپ کافه‌بازار (FitUpBazaar/) عمداً
 *                 «قبل از همه» چک می‌شود و unknown می‌گیرد — اپ بازار صفر تا صد
 *                 مستثناست و نباید هیچ‌وقت وارد فلوی app_android یا اینستاگرام شود.
 *   web         → مرورگرهای واقعی (Chrome/Firefox/Samsung/Brave/Opera/Edge)
 *   unknown     → هیچ‌کدام
 *
 * این فایل pure است و نه به fs و نه به headers وابستگی ندارد — هم سمت سرور
 * (با req.headers.get("user-agent")) و هم سمت کلاینت (با navigator.userAgent)
 * استفاده می‌شود تا برچسب دکمه و رفتار سرور همیشه از یک منطق واحد بیاید.
 */

export type EntrySource = "instagram" | "app_android" | "web" | "unknown";

/** الگوهای مرورگرهای واقعی (طبق سند: Chrome، Firefox، Samsung، Brave، Opera، Edge) */
const REAL_BROWSER_UA_RE =
  /Chrome|CriOS|Chromium|Firefox|FxiOS|SamsungBrowser|Edg(?:e|A|iOS)?|OPR|Opera|Brave|Safari|Gecko\)\sVersion/i;

/** الگوهای مرورگر درون‌اپی اینستاگرام/فیس‌بوک (طبق سند بخش ۱) */
const INSTAGRAM_UA_RE = /Instagram|FB_IAB|FBAN|FB_IAB_ORCA|FBSV/i;

/** مارکر اپ کافه‌بازار — باید قبل از همه چک شود (مستثنا بودن کامل بازار) */
const BAZAAR_UA_RE = /FitUpBazaar\//i;

/**
 * مارکر اپ اختصاصی خودمان:
 *  • «FitUpApp/» — پسوند UA واقعی که اپ فعلی (MainActivity) به همهٔ درخواست‌ها
 *    می‌چسباند (src/lib/fitness/app-bridge.ts هم با همین تشخیص می‌دهد).
 *  • «AppAndroid» — مارکر سند مشخصات؛ برای سازگاری با نسخه‌های بعدی اپ پذیرفته می‌شود.
 */
const OWN_APP_UA_RE = /FitUpApp\/|AppAndroid/i;

/**
 * تشخیص منبع ورود از روی User-Agent.
 * @param ua مقدار هدر User-Agent (null → unknown)
 */
export function detectEntrySourceFromUa(
  ua: string | null | undefined
): EntrySource {
  if (!ua || !ua.trim()) return "unknown";

  // ① اپ کافه‌بازار — مستثنای مطلق (دستور مهم ۱ سند). هیچ‌کدام از فلوهای جدید
  //    نباید برایش فعال شوند؛ پس زودتر از همه unknown برمی‌گردانیم.
  if (BAZAAR_UA_RE.test(ua)) return "unknown";

  // ② اپ اختصاصی خودمان
  if (OWN_APP_UA_RE.test(ua)) return "app_android";

  // ③ مرورگر درون‌اپی اینستاگرام / فیس‌بوک
  if (INSTAGRAM_UA_RE.test(ua)) return "instagram";

  // ④ مرورگرهای واقعی
  if (REAL_BROWSER_UA_RE.test(ua)) return "web";

  return "unknown";
}

/**
 * ماسک‌کردن شماره موبایل برای نمایش در UI پیام «پیامک شد»:
 *   09143589302 → «۰۹۱۴***۸۹۳۰۲»
 */
export function maskMobileFa(mobile: string): string {
  const m = mobile.replace(/\D/g, "");
  const faDigits = "۰۱۲۳۴۵۶۷۸۹";
  const toFa = (s: string) =>
    s.replace(/\d/g, (d) => faDigits[Number(d)] ?? d);
  if (m.length !== 11) return "۰۹xx***xxxxx";
  return `${toFa(m.slice(0, 4))}***${toFa(m.slice(-5))}`;
}
