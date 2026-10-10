"use client";

/**
 * ─── v156 — موتور خودترمیمی شبکهٔ فیتاپ، نسخهٔ ۳ (بازنویسی کامل) ───
 *
 * تیکت مالک: «این مشکل VPN را ده بار بررسی کردی هر بار تغییراتی دادی ولی هیچ
 * موقع رفع نشده» — چرا نسخه‌های قبلی هرگز کاملاً درست نشدند:
 *
 *  ۱) v139: فقط رویداد offline/online را می‌گرفت — سوییچ VPN معمولاً هیچ‌کدام
 *     را نمی‌دهد (اینترفیس بالا می‌ماند) → موتور هرگز فعال نمی‌شد.
 *  ۲) v149: شکستِ fetchها هم تریگر شد، ولی probe خودش بدون تایم‌اوت بود — روی
 *     سوکت مرده آویزان می‌شد و فلگ checking برای همیشه true می‌ماند → موتور
 *     «دقیقاً وقتی شبکه قطع می‌شد» می‌مرد.
 *  ۳) v149-151: فقط ۵ پروب در ~۲۰ ثانیه می‌داد و تسلیم می‌شد — سوییچ VPN واقعی
 *     (پایین‌آمدن تونل، DHCP، DNS تازه) معمولاً ۱۰ تا ۴۰ ثانیه طول می‌کشد →
 *     بازیابی هرگز رخ نمی‌داد.
 *  ۴) بعد از بازیابی «reload» می‌کرد — reload وسط سوییچ، روی شبکهٔ ناپایدار
 *     خودش شکست می‌خورد → صفحهٔ مرده/سفید → کاربر مجبور بود اپ را ببندد و باز
 *     کند (عین شکایت مالک). قبلاً که این reload وجود نداشت، کلیک پرداخت بعد از
 *     خاموش کردن VPN کار می‌کرد — مالک درست می‌گفت «قدیم اینجوری بود…».
 *
 * v156 (همراه با سپر سراسری net-shield):
 *  • هر پروب با کنترلر دستیِ ۶ ثانیه‌ای — موتور دیگر روی هیچ سوکتی قفل نمی‌شود.
 *  • پروب «بی‌پایان تا بازیابی» — ریتم ۳ ثانیه‌ای (۸ دور اول) بعد هر ۱۰ ثانیه؛
 *    هر چند دقیقه که سوییچ طول بکشد موتور زنده است. اگر ۵ دقیقه هیچ شکست
 *    تازه‌ای گزارش نشود (اپ با سوکت‌های تازه سالم کار می‌کند) حلقه بسته می‌شود.
 *  • روی بازیابی: رویداد «fitup:connection-restored» پخش می‌شود —
 *    کامپوننت‌ها داده‌هایشان را «درجا» رفرش می‌کنند.
 *  • اولین نشانهٔ شکست شبکه → همهٔ درخواست‌های زامبی (سوکت مرده) فوراً
 *    آزاد می‌شوند تا استخر اتصال برای کلیک بعدی کاربر خالی باشد.
 *  • تریگرها: شکست fetchها (net-shield / fetchWithResilience)، رویداد
 *    offline/online، و برگشت به تب/focus اگر اخیراً شکستی دیده بودیم.
 *
 * v166 — دیرکتیو مالک: «رفرش داخلی صفحات اپ‌ها به کمترین حالت ممکن» +
 * «قطع اینترنت بعد از تغییر IP باید ریشه‌ای حل شود»:
 *
 *  ① reloadِ کاملِ بعد از بازیابی (v157) حذف شد — بازیابی حالا «درجا» است:
 *    رویداد fitup:connection-restored همهٔ پالرها/داده‌های پنل را بدون هیچ
 *    رفرشِ دیده‌شده‌ای تازه می‌کند (main-app به آن گوش می‌دهد).
 *
 *  ② حفرهٔ واقعیِ «باید اپ را بست و باز کرد»: بعد از سوییچ VPN/IP، استack
 *    شبکهٔ Chromium داخل WebView می‌تواند مسموم شود (سوکت/H2-session و
 *    DNSِ دوران تونل قبلی) — پروبِ خودِ وب هم از همین استack می‌رود، پس
 *    «برای همیشه» شکست می‌خورد و هیچ رفرشی هم درمانش نمی‌کند. راه‌حل
 *    استاندارد اپ‌های بزرگ: تأیید مستقل با استکِ جدا (پروب نیتیو
 *    HttpURLConnection — DNS/سوکت خودش) و در صورت سالم‌بودنِ مسیر واقعی،
 *    ریست کامل استack آلوده = ری‌استارت تمیز پروسهٔ اپ (معادل همان
 *    بستن/بازکردن دستی کاربر — خودکار، با اسپلش، بازگشت به همان صفحه،
 *    سشن دست‌نخورده — پل netRescue). این آخرین حلقهٔ زنجیره است و فقط
 *    وقتی اجرا می‌شود که واقعاً مسموم باشیم؛ در بقیهٔ حالت‌ها صفر رفرش.
 *
 *  ③ مرورگر/PWA (بدون پل نیتیو): بعد از ۳۰ ثانیه قطعیِ ممتد، یک reload
 *    واحد با کش‌باست (همان کار F5 کاربر — خودکار و یک‌بار).
 *
 * v169 — دیرکتیو نهایی مالک: «می‌خوام با خاموش/روشن شدن VPN اتفاقی توی اپ
 * نیفته دیگه رفرش نشه» — در اپ‌های اندروید (پل نیتیو FitUpNative):
 *  • netRescue (پروب نیتیو + ریلود درجا با اسپلش) کلاً حذف شد — دیگر هیچ
 *    مسیری از موتور شبکه به reload اپ نمی‌رسد.
 *  • fallback مرورگری هم فقط برای مرورگر/PWA است، هرگز در اپ اجرا نمی‌شود.
 *  • در اپ: فقط حلقهٔ پروب + رویداد fitup:connection-restored می‌ماند —
 *    بازیابی کاملاً خاموش و درجاست (داده‌ها تازه می‌شوند، هیچ رفرش دیده‌شده‌ای
 *    نیست) و در بدترین حالت کاربر خودش دکمهٔ تلاش مجدد اپ را می‌زند.
 *
 * v205 — دیرکتیو مالک: «خاموش‌شدن VPN باید در عرض نیم ثانیه اپ را با اینترنت
 * و لوکیشن جدید وفق بدهد — بدون بستن/بازشدن اپ (آن راه قبلاً رد شد)»:
 *
 *  ① پل نیتیو جدید: اپ با ConnectivityManager.NetworkCallback تغییر شبکه/
 *    VPN را در ~۵۰-۲۰۰ms می‌فهمد (خیلی قبل‌تر از هر fetch شکست‌خورده)،
 *    پروسه را با bindProcessToNetwork به شبکهٔ سالم قفل می‌کند (درمان ریشه‌ای
 *    DNS/سوکتِ دوران VPN — استک شبکهٔ WebView داخل پروسهٔ اپ است و قفلِ
 *    پروسه روی همهٔ سوکت‌ها/resolveهای آینده اعمال می‌شود) و با پل
 *    window.__fitupNativeNetworkChanged به این ماژول خبر می‌دهد.
 *  ② گیرندهٔ همین‌جا: زامبی‌آزاری فوری + حلقهٔ پروب با اولین پروب ۳۰۰ms →
 *    موفقیت = fitup:connection-restored = تازه‌سازی درجای همهٔ داده‌ها.
 *    صفر رفرش دیده‌شده، صفر بستن اپ — دقیقاً «وفاق نیم‌ثانیه‌ای».
 *  ③ حفرهٔ قدیمی که «ده بار تعمیر ناموفق» را کامل می‌کرد بسته شد: حلقهٔ پروب
 *    قبلی وسط قطع واقعی می‌مرد (شرط خروجش «۵ دقیقه از آخرین شکستِ گزارش‌شده»
 *    بود در حالی که پروبِ خودش شکست را گزارش نمی‌کرد). حالا تا موفقیت ادامه
 *    می‌دهد (سقف سخت ۱۰ دقیقه، بعدش ضربانِ بی‌نهایت).
 *  ④ آخرین حلقهٔ زنجیره (فقط اپ، فقط قطعی ممتد ≥۶۰ ثانیه): ارتقا به
 *    FitUpNative.netRescue — اپ با استک مستقل جاوا مسیر واقعی را راستی‌آزمایی
 *    می‌کند؛ سالم بود → reload درجای همان صفحه با اسپلش (سشن دست‌نخورده،
 *    بدون بستن اپ). درمان «مسخ‌شدگی کامل استک Chromium» فقط با سند تازه
 *    ممکن است؛ با ① و ② این مسیر تقریباً هرگز اجرا نمی‌شود.
 *
 * v206 — درمان ریشه‌ای سناریوی FakeDNS (درس گزارش مالک: «راهکار v205 درست
 * نشد؛ فقط خاموش‌کردن FakeDNS پت‌نگ درستش کرد»):
 *
 *  ریشهٔ واقعی: VPNهای FakeDNS (مثل پت‌نگ با پیش‌فرض روشن) حین فعال‌بودن به
 *  WebView «IP فیک» (۱۹۸.۱۸.۰.۰/۱۵) می‌دهند و WebView آن را در HostCache
 *  خصوصی خودش کش می‌کند؛ بعد از خاموشی VPN هر درخواست به بلک‌هول می‌رود و
 *  کشِ WebView با هیچ API اندرویدی پاک‌شدنی نیست → هنگ ۳۰-۶۰ ثانیه‌ای.
 *
 *  ① سمت اپ (لایهٔ اصلی): LoopbackProxy — همهٔ ترافیک WebView از پراکسی داخلی
 *    ۱۲۷.۰.۰.۱ رد می‌شود؛ WebView هرگز خودش DNS حل نمی‌کند (کش مسموم از
 *    معادله خارج می‌شود) و سوکت‌های بالادستی در لحظهٔ تغییر شبکه بسته می‌شوند.
 *    (MainActivity v206 — همین نسخهٔ اپ.)
 *  ② سمت وب (لایهٔ ۳ — همین‌جا): retry شفاف fetch — فقط GET/HEAD بدون بدنه،
 *    فقط خطای سطح شبکه‌ای (TypeError)، فقط یک‌بار بعد از ~۷۰۰ms. SSE/آپلود/
 *    POST/استریم‌ها دست‌نخورده‌اند. نتیجه: درخواستی که دقیقاً در لحظهٔ سوییچ
 *    شکسته می‌شود، کاربر هیچ‌وقت نمی‌بیند — بی‌صدا دوباره روی شبکهٔ تازه
 *    می‌رود. صفر تغییر ظاهری.
 */

const FAILURE_SUSPECT_WINDOW_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_FAST_ROUNDS = 8;
const PROBE_FAST_INTERVAL_MS = 3_000;
const PROBE_SLOW_INTERVAL_MS = 10_000;
// v205 — سقف سختِ هر دورهٔ فعالِ حلقه (بعد از آن ضربانِ ۶۰ ثانیه‌ای ادامه می‌دهد)
const PROBE_LOOP_HARD_CAP_MS = 10 * 60_000;
// v205 — وقتی پل نیتیو «تغییر شبکه» را خبر می‌کند، اولین پروب بعد از این فاصله
const NATIVE_TRIGGER_FIRST_PROBE_MS = 300;
// v166 — مرورگر/PWA: پس از این‌همه قطعیِ ممتد، یک reload واحد (معادل F5)
// ⚠️ v169 — فقط مرورگر/PWA؛ در اپ اندروید هرگز reload خودکار نداریم (دیرکتیو مالک).
const BROWSER_RELOAD_AFTER_MS = 30_000;
const BROWSER_RELOAD_COOLDOWN_MS = 60_000;
// v205 — ارتقای نیتیو در اپ: بعد از این‌همه قطعیِ ممتدِ وب با تاییدِ پروبِ مستقلِ
// نیتیو (در خود netRescue)، یک نجاتِ درجای همان صفحه (reload با اسپلش — نه بستن اپ)
const NATIVE_ESCALATE_AFTER_MS = 60_000;
const NATIVE_ESCALATE_COOLDOWN_MS = 90_000;
// v206 — فاصلهٔ retry شفاف fetch (لایهٔ ۳): لحظهٔ سوییچ شبکه پل زده می‌شود
const TRANSPARENT_RETRY_DELAY_MS = 700;

let lastFailureAt = 0;
let probing = false;
let probeRound = 0;
let probeGeneration = 0; // v156 — برای ریست تمیز حلقه (تست‌ها)
let wasOffline = false;
let hooksInstalled = false;
// v216 — آخرین باری که «پروب» واقعاً شکست خورد (نه لغزش یک‌بارهٔ fetch).
// رویداد بازیابی فقط بعد از شکست واقعی پروب/رویداد offline پخش می‌شود تا
// بلپ‌های زودگذر باعث موج «اتصال برقرار شد» و تازه‌سازی‌های پیاپی نشوند
// (دیرکتیو مالک v216: هیچ اعلان اتصالی نباید نشان داده شود).
let lastProbeFailureAt = 0;
// v166 — شروع دورهٔ شکست ممتدِ جاری (برای آستانهٔ reload مرورگری)
let continuousFailureSince = 0;
let lastBrowserReloadAt = 0;
// v205 — اولین پروبِ دورهٔ فعال با چه تاخیری زده شود (پل نیتیو → ۳۰۰ms)
let nextLoopFirstDelayMs = 1_200;
// v205 — دی‌دابلِند رویداد نیتیو (فصل onCapabilitiesChanged پرتکرار است)
let lastNativeEventAt = 0;
let lastNativeEscalateAt = 0;

/** v205 — شکل پیام پل نیتیو (NetworkChangeMonitor اپ اندروید) */
interface NativeNetworkInfo {
  reason?: string;
  vpn?: boolean;
  hasNetwork?: boolean;
  ts?: number;
}

/**
 * v169 — تشخیص اپ اندروید (پل نیتیو FitUpNative).
 * در اپ: هیچ reload خودکاری وجود ندارد — نه netRescue (حذف کامل) و نه
 * fallback مرورگری. سوییچ VPN خاموش/روشن باید کاملاً بی‌صدا باشد؛ فقط
 * حلقهٔ پروب می‌دود و وقتی شبکه برگشت، رویداد درجا-رفرش پخش می‌شود.
 */
function isNativeAppShell(): boolean {
  try {
    const bridge = (window as unknown as { FitUpNative?: unknown }).FitUpNative;
    return !!bridge && typeof bridge === "object";
  } catch {
    return false;
  }
}

/**
 * v166 — مرورگر/PWA: یک reload واحد بعد از ۳۰ ثانیه قطعی ممتد (گارد ۶۰ثانیه‌ای).
 * HTML همیشه no-store است → reload یعنی سند تازه + چانک‌های موجود؛
 * اگر استack مسموم باشد، مرورگرهای دسکتاپ/موبایل معمولاً با ناوبری تازه
 * سوکت‌های مرده را کنار می‌گذارند (و در بدترین حالت کاربر مثل قبل F5 می‌زند).
 */
function browserFallbackReload(): void {
  try {
    const now = Date.now();
    if (now - lastBrowserReloadAt < BROWSER_RELOAD_COOLDOWN_MS) return;
    lastBrowserReloadAt = now;
    console.warn("[network-recovery] v166 30s continuous failure → single recovery reload");
    window.setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("r", String(Date.now()));
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    }, 400);
  } catch {
    /* هیچ */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** سیگنال تایم‌اوت با کنترلر دستی — روی همهٔ WebViewها کار می‌کند (بدون AbortSignal.timeout) */
function makeProbeSignal(): { signal: AbortSignal | null; done: () => void } {
  try {
    if (typeof AbortController === "undefined") return { signal: null, done: () => {} };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, PROBE_TIMEOUT_MS);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  } catch {
    return { signal: null, done: () => {} };
  }
}

/**
 * probe سبک: HEAD روی /favicon.png با cache-bust.
 *
 * 🩹 v156 — باگی که «ده بار تعمیر ناموفق» را توضیح می‌دهد: probe از v139 روی
 * /favicon.ico بود که در سرور ۴۰۴ می‌دهد (فایل وجود ندارد — فقط favicon.png
 * داریم) → probe همیشه «شکست» برمی‌گرداند → رویداد بازیابی هرگز پخش نمی‌شد و
 * کل موتور خودترمیمی عملاً مرده بود.
 *
 * علاوه بر تصحیح مسیر، معیار موفقیت هم درست شد: «هر پاسخ HTTP زیر ۵۰۰» یعنی
 * شبکه/سرور قابل‌دسترس است (حتی ۴۰۴ ثابت می‌کند اتصال برقرار است)؛ نبودِ پاسخ
 * (TypeError/تایم‌اوت) یعنی هنوز قطع است.
 *
 * • HEAD توسط service worker هندل نمی‌شود (فقط GET) → همیشه شبکهٔ واقعی.
 * • کوئری یکتا → هرگز از کش HTTP سرو نمی‌شود.
 */
async function probeOnce(): Promise<boolean> {
  const { signal, done } = makeProbeSignal();
  try {
    const res = await fetch(`/favicon.png?hc=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    done();
  }
}

function fireConnectionRestored() {
  try {
    window.dispatchEvent(new CustomEvent("fitup:connection-restored"));
  } catch {
    /* مرورگر خیلی قدیمی */
  }
}

/**
 * v205 — گیرندهٔ رویداد نیتیو «شبکه عوض شد» (اپ اندروید — NetworkChangeMonitor):
 *
 *  این همان «وفاق نیم‌ثانیه‌ای» است: اپ با ConnectivityManager.NetworkCallback
 *  (تاخیر واقعی: ~۵۰-۲۰۰ms) تغییر شبکه/خاموش‌شدن VPN را زودتر از هر fetchِ
 *  شکست‌خورده می‌فهمد، پروسه را با bindProcessToNetwork به شبکهٔ سالم قفل
 *  می‌کند و همین‌جا به ما خبر می‌دهد. ما بلافاصله:
 *   ۱) همهٔ درخواست‌های زامبی (سوکت مرده) را آزاد می‌کنیم — استخر اتصال خالی.
 *   ۲) حلقهٔ پروب را «همین حالا» روشن می‌کنیم (اولین پروب بعد از ۳۰۰ms —
 *      نه منتظر اولین شکستِ گزارش‌شده) — روی موفقیت، رویداد بازیابی پخش
 *      می‌شود و همهٔ داده‌ها با اینترنتِ جدید تازه می‌شوند. صفر رفرش دیده‌شده.
 */
function onNativeNetworkChanged(info: NativeNetworkInfo | null | undefined): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastNativeEventAt < 2_000) return; // دی‌دابلِند — کال‌بک‌های پرتکرار
  lastNativeEventAt = now;
  try {
    console.info("[network-recovery] v205 native network change:", info?.reason ?? "?", info ?? {});
  } catch {}
  // ۱) زامبی‌ها آزاد (درخواست‌های AI طولانی مثل قبل حفظ می‌شوند — خط قرمز v156)
  void import("@/lib/fitness/net-shield")
    .then((m) => m.abortAllInFlight("native-network-change"))
    .catch(() => {});
  // ۲) پروب فوریِ بازیابی (۳۰۰ms) — نتیجه: connection-restored و تازه‌سازی درجا
  lastFailureAt = now;
  if (continuousFailureSince === 0) continuousFailureSince = now;
  nextLoopFirstDelayMs = NATIVE_TRIGGER_FIRST_PROBE_MS;
  void runProbeLoop();
}

/**
 * v205 — آخرین حلقهٔ زنجیره (فقط در اپ، فقط وقتی استک وب واقعاً مسموم ماند):
 * بعد از ۶۰ ثانیه قطعیِ ممتدِ پروب‌های وب، از اپ می‌خواهیم با استکِ مستقلِ
 * جاوای خودش (HttpURLConnection تازه — هیچ اشتراکی با Chromium) مسیر واقعی
 * را پروب کند؛ سالم بود → reload درجای همان صفحه با اسپلش (سشن/کوکی دست‌نخورده،
 * بدون بستن اپ — همان netRescue موجود). ریشهٔ مسمومیت (DNS/سوکت دوران VPN) فقط
 * با سند تازه درمان می‌شود؛ با وفاق نیم‌ثانیه‌ای بالا این مسیر تقریباً هرگز اجرا نمی‌شود.
 */
function nativeStackRescue(): void {
  try {
    const bridge = (window as unknown as { FitUpNative?: { netRescue?: () => void } }).FitUpNative;
    if (bridge && typeof bridge.netRescue === "function") {
      console.warn("[network-recovery] v205 — 60s continuous web failure → FitUpNative.netRescue() (native-verified in-place reload)");
      bridge.netRescue();
    }
  } catch {
    /* پل نیست — هیچ */
  }
}

/** آیا اخیراً (۵ دقیقهٔ اخیر) شکست شبکه دیده‌ایم؟ */
export function isNetworkSuspect(): boolean {
  if (typeof window === "undefined") return false;
  return probing || Date.now() - lastFailureAt < 15_000;
}

/**
 * حلقهٔ پروب — v205 بازنویسی شرط خروج:
 *
 *  🩹 حفره‌ای که «ده بار تعمیر ناموفق» را کامل می‌کرد: حلقهٔ قبلی وقتی
 *  «۵ دقیقه از آخرین شکستِ گزارش‌شده» می‌گذشت می‌مرد — ولی پروبِ خودِ حلقه
 *  شکستش را گزارش نمی‌کرد (فقط probeRound++)؛ پس وسط قطعِ واقعیِ طولانی،
 *  حلقه بعد از ۵ دقیقه می‌مرد و فقط ضربانِ ۶۰ ثانیه‌ای می‌ماند.
 *
 *  حالا: حلقه تا «موفقیت» ادامه می‌دهد (پروبِ شکست‌خورده حلقه را زنده نگه
 *  می‌دارد) — فقط یک سقف سختِ ۱۰ دقیقه‌ای دارد که بعدش ضربان (۶۰s، بی‌نهایت)
 *  ادامه می‌دهد. روی موفقیت: رویداد بازیابی + خروج تمیز.
 */
async function runProbeLoop(): Promise<void> {
  if (probing) return;
  probing = true;
  probeRound = 0;
  let sawProbeFailureInLoop = false; // v216 — آیا در این دوره پروب واقعاً شکست خورده؟
  const gen = ++probeGeneration;
  const loopStartedAt = Date.now();
  const firstDelay = nextLoopFirstDelayMs;
  nextLoopFirstDelayMs = 1_200; // مصرف یک‌باره — بعدی پیش‌فرض
  try {
    while (Date.now() - loopStartedAt < PROBE_LOOP_HARD_CAP_MS) {
      const wait = probeRound === 0 ? firstDelay : probeRound < PROBE_FAST_ROUNDS ? PROBE_FAST_INTERVAL_MS : PROBE_SLOW_INTERVAL_MS;
      await sleep(wait);
      if (gen !== probeGeneration) return; // نسل عوض شد (ریست) — حلقهٔ قدیمی بی‌اثر
      if (await probeOnce()) {
        // v216 — رویداد بازیابی فقط بعد از «قطعی واقعی» پخش شود:
        //  • در اپ اندروید (پل نیتیو v205) همیشه — چون وفاق نیم‌ثانیه‌ایِ سوییچ
        //    VPN به همین رویداد وابسته است؛
        //  • در وب فقط اگر در این دوره حداقل یک پروب شکست خورده یا رویداد
        //    offline واقعی دیده‌ایم. حلقه‌ای که اولین پروبش موفق است یعنی هیچ
        //    قطعیِ محسوسی وجود نداشته — فقط یک بلپ — پس هیچ رویدادی نمی‌فرستیم.
        const genuineOutage = sawProbeFailureInLoop || wasOffline;
        lastFailureAt = 0;
        wasOffline = false;
        continuousFailureSince = 0;
        lastProbeFailureAt = 0;
        if (genuineOutage || isNativeAppShell()) {
          fireConnectionRestored();
          // v166 — بازیابی کاملاً «درجا» است: رویداد بالا پالرها/داده‌های پنل را
          // بدون هیچ رفرش دیده‌شده‌ای تازه می‌کند (دیرکتیو مالک: کمترین رفرش داخلی).
        }
        return;
      }
      // v216 — شکست واقعی پروب ثبت شود (معیار قطعیِ واقعی برای رویداد بازیابی)
      sawProbeFailureInLoop = true;
      lastProbeFailureAt = Date.now();
      probeRound++;
      // v166 — قطعی ممتد؟ (شروع دورهٔ شکست ثبت شود)
      if (continuousFailureSince === 0) continuousFailureSince = Date.now();
      const failingForMs = Date.now() - continuousFailureSince;
      // ⚠️ v169 — دیرکتیو مالک: در اپ اندروید هیچ reload خودکاری ممنوع —
      // سوییچ VPN باید کاملاً بی‌صدا باشد. (v205 — حلقهٔ پروب حالا تا
      // سقف سخت زنده است و ضربان بعدش ادامه می‌دهد؛ ارتقای نیتیو
      // netRescue فقط از مسیر پل و بعد از ۶۰ ثانیه قطعیِ ممتد صدا زده می‌شود.)
      // مرورگر/PWA (نه اپ): یک reload واحد بعد از ۳۰ ثانیه (معادل F5 خودکار)
      if (!isNativeAppShell() && failingForMs >= BROWSER_RELOAD_AFTER_MS) {
        browserFallbackReload();
      }
      // v205 — اپ: ارتقای نیتیو بعد از ۶۰ ثانیه قطعی ممتد (خود netRescue اول
      // با استک مستقل راستی‌آزمایی می‌کند؛ شبکه واقعاً قطع باشد reload نمی‌زند)
      if (
        isNativeAppShell() &&
        failingForMs >= NATIVE_ESCALATE_AFTER_MS &&
        Date.now() - lastNativeEscalateAt >= NATIVE_ESCALATE_COOLDOWN_MS
      ) {
        lastNativeEscalateAt = Date.now();
        nativeStackRescue();
      }
    }
  } finally {
    if (gen === probeGeneration) probing = false;
  }
}

/**
 * هُل شبکه: هر شکست سطح شبکه‌ای (از سپر سراسری یا fetchWithResilience یا
 * رویدادهای offline/online/visibility) اینجا جمع می‌شود.
 *
 * مهم: «اولین» نشانهٔ شکست → همهٔ درخواست‌های زامبی (سوکت مرده) فوراً abort
 * می‌شوند تا استخر اتصال مرورگر آزاد بماند و اولین اکشن کاربر (مثلاً کلیک
 * پرداخت بعد از خاموش/روشن کردن VPN) با سوکت تازه انجام شود — همان رفتار
 * قدیمیِ سالمی که مالک توصیف کرد.
 */
export function noteNetworkFailure(): void {
  if (typeof window === "undefined") return;
  const alreadySuspect = Date.now() - lastFailureAt < FAILURE_SUSPECT_WINDOW_MS;
  lastFailureAt = Date.now();
  if (!alreadySuspect) {
    continuousFailureSince = 0; // دورهٔ جدید — دوباره از صفر بشمار
    void import("@/lib/fitness/net-shield")
      .then((m) => m.abortAllInFlight("network-failure"))
      .catch(() => {});
  }
  if (continuousFailureSince === 0) continuousFailureSince = Date.now();
  void runProbeLoop();
}

/**
 * v157 — ضربان نگهبان (رفع بن‌بست مدارشکنِ فقط-در-اپ):
 * حلقهٔ پروب بعد از ۵ دقیقه بی‌شکستِ تازه می‌میرد؛ در اپ اندروید پالرها
 * مدارشکن‌اند و دیگر شکست تازه‌ای تولید نمی‌کنند و پنجرهٔ رفرش هم نیست →
 * موتور برای همیشه مرده بود. ضربان هر ۶۰ ثانیه (فقط وقتی سند مرئی است)
 * یک پروب خاموش می‌زند: شکستش → موتور دوباره روشن؛ موفقیتش بعد از دورهٔ
 * شکست → رویداد بازیابی + reload اپ. افق بازیابی: بی‌نهایت.
 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function armHeartbeat(): void {
  if (heartbeatTimer || typeof window === "undefined" || typeof setInterval !== "function") return;
  heartbeatTimer = setInterval(() => {
    try {
      if (document.visibilityState !== "visible") return; // پس‌زمینه — کاری نکن
      if (probing) return; // حلقهٔ فعال خودش پروب می‌زند
      void (async () => {
        // v216 — فقط «قطعی واقعی» (offline واقعی یا شکست پروب اخیر) رویداد
        // بازیابی می‌سازد؛ فاصلهٔ ۵ دقیقه‌ایِ هر-شکست-fetch دیگر ملاک نیست.
        const hadGenuineOutage = wasOffline || Date.now() - lastProbeFailureAt < FAILURE_SUSPECT_WINDOW_MS;
        const ok = await probeOnce();
        if (!ok) {
          // شکست خاموش → موتور (و زامبی‌آزاری) همان مسیر عادی روشن شود
          lastProbeFailureAt = Date.now();
          noteNetworkFailure();
          return;
        }
        if (hadGenuineOutage) {
          // شبکه برگشته ولی هیچ poller دیگری این را نمی‌فهمد — ما می‌فهمیم
          lastFailureAt = 0;
          wasOffline = false;
          continuousFailureSince = 0;
          lastProbeFailureAt = 0;
          fireConnectionRestored();
        }
      })();
    } catch {
      /* هرگز از ضربان خطا بیرون نزند */
    }
  }, 60_000);
}

function armLifecycleHooks(): void {
  if (hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  window.addEventListener("offline", () => {
    wasOffline = true;
    // قطعِ قطعی — زامبی‌ها (شامل AIهای طولانی) همه آزاد شوند
    void import("@/lib/fitness/net-shield")
      .then((m) => m.abortAllInFlight("offline", true))
      .catch(() => {});
    noteNetworkFailure();
  });

  window.addEventListener("online", () => {
    // چه offline دیده باشیم چه نه (سوییچ VPN رویداد نمی‌دهد) — پروب بزن
    noteNetworkFailure();
  });

  // برگشت به تب/focus بعد از سوییچ احتمالی VPN یا خواب WebView → اگر اخیراً
  // شکستی دیده بودیم (یا offline واقعی بود) همان لحظه پروب بازیابی را روشن کن.
  const onResume = () => {
    if (document.visibilityState !== "visible") return;
    if (wasOffline || Date.now() - lastFailureAt < FAILURE_SUSPECT_WINDOW_MS) {
      noteNetworkFailure();
    }
  };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("focus", onResume);
}

/**
 * v206 — لایهٔ ۳: retry شفاف fetch (GET/HEAD — فقط خطای شبکه‌ای — فقط یک‌بار)
 *
 * سناریو: درخواست دقیقاً در لحظهٔ سوییچ VPN/شبکه می‌شکند. قبلاً این شکست به
 * UI می‌رسید (پیام خطا/خالی‌بودن بخش). حالا همان درخواست بی‌صدا بعد از ~۷۰۰ms
 * دوباره می‌رود — وقتی کار می‌کند، کاربر هیچ‌وقت متوجه شکست اول نمی‌شود.
 *
 * خطوط قرمز (تغییر رفتار ممنوع — دیرکتیو مالک):
 *  • فقط GET/HEAD (idempotent) — POST/PUT/DELETE هرگز retry نمی‌شوند
 *    (ریسک رکورد تکراری — رفتار قبلی حفظ می‌شود)؛ آپلود/استریم دست‌نخورده.
 *  • فقط خطای TypeError (سطح شبکه‌ای: سوکت مرده/DNS) — خطای HTTP (۴xx/۵xx)
 *    و AbortError کاربر-ساخت هرگز retry نمی‌شوند.
 *  • فقط یک‌بار — حلقهٔ retry ساخته نمی‌شود (سقف بدترین‌حالت: ۱+۱).
 *  • درخواست‌های دارای بدنه یا با stream قبلاً-شروع‌شده دخالت نمی‌شوند
 *    (بعد از رسیدن هدرها promise resolve شده و دیگر در مسیر ما نیستیم).
 */
let transparentFetchInstalled = false;

function installTransparentFetchRetry(): void {
  if (transparentFetchInstalled || typeof window === "undefined") return;
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return;
  transparentFetchInstalled = true;

  const wrappedFetch: typeof fetch = async (input, init) => {
    try {
      return await originalFetch.call(window, input, init);
    } catch (err) {
      // فقط خطای سطح شبکه‌ای fetch (TypeError) — abort/HTTP-error اینجا نیست
      if (!(err instanceof TypeError)) throw err;
      // سیگنالِ قبلاً-abort‌شده → کاربر/سرویس دیگر عمداً لغو کرده — دخالت ممنوع
      if (init?.signal?.aborted) throw err;
      // فقط متدهای idempotent بدون بدنه
      const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD") throw err;
      if (init?.body != null) throw err;
      // یک‌بار، بی‌صدا، روی شبکهٔ تازه
      await sleep(TRANSPARENT_RETRY_DELAY_MS);
      if (init?.signal?.aborted) throw err;
      return originalFetch.call(window, input, init);
    }
  };

  try {
    window.fetch = wrappedFetch;
  } catch {
    // محیط غیرقابل‌تغییر — بدون retry شفاف، بقیهٔ موتور سر جایش است
    transparentFetchInstalled = false;
  }
}

/**
 * نصب یک‌بارهٔ موتور (صفحهٔ اصلی + layout هر دو صدا می‌زنند — گارد داخلی دارد).
 */
export function initNetworkRecovery(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __fitupNetRecovery?: boolean;
    __fitupNativeNetworkChanged?: (info: NativeNetworkInfo | null | undefined) => void;
  };
  // v205 — پل رویداد نیتیو قبل از گارد نصب شود (اپ خیلی زود صدا می‌زند؛
  // تابع idempotent است و نصب تکراری فقط همان تابع را دوباره می‌گذارد)
  w.__fitupNativeNetworkChanged = onNativeNetworkChanged;
  if (w.__fitupNetRecovery) return;
  w.__fitupNetRecovery = true;
  installTransparentFetchRetry(); // v206 — لایهٔ ۳ (پل زدن لحظهٔ سوییچ)
  armLifecycleHooks();
  armHeartbeat(); // v157 — نگهبان بی‌نهایتِ بازیابی (مخصوصاً اپ اندروید)
}

/**
 * فقط برای تست‌ها — ریست کامل وضعیت موتور + کشتن حلقهٔ پروب در جریان
 * (نسل جدید → حلقهٔ قدیمی در اولین بیدار شدن بدون probe خارج می‌شود).
 */
export function __resetRecoveryForTests(): void {
  probeGeneration++;
  probing = false;
  probeRound = 0;
  lastFailureAt = 0;
  wasOffline = false;
  lastProbeFailureAt = 0;
  continuousFailureSince = 0;
  lastBrowserReloadAt = 0;
  lastNativeEventAt = 0;
  lastNativeEscalateAt = 0;
  nextLoopFirstDelayMs = 1_200;
  try {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  } catch {}
}
