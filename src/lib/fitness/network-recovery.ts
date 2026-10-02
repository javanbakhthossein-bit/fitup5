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
 */

const FAILURE_SUSPECT_WINDOW_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_FAST_ROUNDS = 8;
const PROBE_FAST_INTERVAL_MS = 3_000;
const PROBE_SLOW_INTERVAL_MS = 10_000;
// v166 — مرورگر/PWA: پس از این‌همه قطعیِ ممتد، یک reload واحد (معادل F5)
// ⚠️ v169 — فقط مرورگر/PWA؛ در اپ اندروید هرگز reload خودکار نداریم (دیرکتیو مالک).
const BROWSER_RELOAD_AFTER_MS = 30_000;
const BROWSER_RELOAD_COOLDOWN_MS = 60_000;

let lastFailureAt = 0;
let probing = false;
let probeRound = 0;
let probeGeneration = 0; // v156 — برای ریست تمیز حلقه (تست‌ها)
let wasOffline = false;
let hooksInstalled = false;
// v166 — شروع دورهٔ شکست ممتدِ جاری (برای آستانهٔ reload مرورگری)
let continuousFailureSince = 0;
let lastBrowserReloadAt = 0;

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

/** آیا اخیراً (۵ دقیقهٔ اخیر) شکست شبکه دیده‌ایم؟ */
export function isNetworkSuspect(): boolean {
  if (typeof window === "undefined") return false;
  return probing || Date.now() - lastFailureAt < 15_000;
}

/**
 * حلقهٔ پروب — تا بازیابی ادامه می‌دهد (بدون سقف دور)، اما اگر ۵ دقیقه هیچ
 * شکست تازه‌ای گزارش نشود متوقف می‌شود (شبکه عملاً سالم شده و اپ با سوکت‌های
 * تازه کار می‌کند؛ پروبِ ابدی بی‌معنی است).
 */
async function runProbeLoop(): Promise<void> {
  if (probing) return;
  probing = true;
  probeRound = 0;
  const gen = ++probeGeneration;
  try {
    while (Date.now() - lastFailureAt < FAILURE_SUSPECT_WINDOW_MS) {
      const wait = probeRound === 0 ? 1_200 : probeRound < PROBE_FAST_ROUNDS ? PROBE_FAST_INTERVAL_MS : PROBE_SLOW_INTERVAL_MS;
      await sleep(wait);
      if (gen !== probeGeneration) return; // نسل عوض شد (ریست) — حلقهٔ قدیمی بی‌اثر
      if (await probeOnce()) {
        lastFailureAt = 0;
        wasOffline = false;
        continuousFailureSince = 0;
        fireConnectionRestored();
        // v166 — بازیابی کاملاً «درجا» است: رویداد بالا پالرها/داده‌های پنل را
        // بدون هیچ رفرش دیده‌شده‌ای تازه می‌کند (دیرکتیو مالک: کمترین رفرش داخلی).
        return;
      }
      probeRound++;
      // v166 — قطعی ممتد؟ (شروع دورهٔ شکست ثبت شود)
      if (continuousFailureSince === 0) continuousFailureSince = Date.now();
      const failingForMs = Date.now() - continuousFailureSince;
      // ⚠️ v169 — دیرکتیو مالک: در اپ اندروید هیچ reload خودکاری ممنوع —
      // سوییچ VPN باید کاملاً بی‌صدا باشد (netRescue کلاً حذف شد؛ اپ هرگز
      // خودش را ریلود نمی‌کند، حتی وقتی استack وب مسموم به نظر برسد —
      // کاربر یا صبر می‌کند تا پروب بازیابی را ببیند یا خودش اپ را می‌بندد
      // و باز می‌کند؛ هیچ رفرش غافلگیرکننده‌ای در میان نیست).
      // مرورگر/PWA (نه اپ): یک reload واحد بعد از ۳۰ ثانیه (معادل F5 خودکار)
      if (!isNativeAppShell() && failingForMs >= BROWSER_RELOAD_AFTER_MS) {
        browserFallbackReload();
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
        const hadRecentFailure = wasOffline || Date.now() - lastFailureAt < FAILURE_SUSPECT_WINDOW_MS;
        const ok = await probeOnce();
        if (!ok) {
          // شکست خاموش → موتور (و زامبی‌آزاری) همان مسیر عادی روشن شود
          noteNetworkFailure();
          return;
        }
        if (hadRecentFailure) {
          // شبکه برگشته ولی هیچ poller دیگری این را نمی‌فهمد — ما می‌فهمیم
          lastFailureAt = 0;
          wasOffline = false;
          continuousFailureSince = 0;
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
 * نصب یک‌بارهٔ موتور (صفحهٔ اصلی + layout هر دو صدا می‌زنند — گارد داخلی دارد).
 */
export function initNetworkRecovery(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __fitupNetRecovery?: boolean };
  if (w.__fitupNetRecovery) return;
  w.__fitupNetRecovery = true;
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
  continuousFailureSince = 0;
  lastBrowserReloadAt = 0;
  try {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  } catch {}
}
