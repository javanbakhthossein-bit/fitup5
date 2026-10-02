/**
 * تست واحد v156 — سپر شبکهٔ سراسری + موتور خودترمیمی + transport تاب‌آور پنل
 *
 * سناریوهای مالک (تیکت VPN/حالت خواب):
 *   ① هر fetch بدون signal تایم‌اوت سخت می‌گیرد (دیگر هیچ آویزان‌شدن ابدی وجود ندارد)
 *   ② درخواست‌های دارای signal فراخوان (پرداخت تاب‌آور) دست‌نخورده می‌مانند — خط قرمز
 *   ③ abortAllInFlight همهٔ زامبی‌ها را فوراً آزاد می‌کند (استخر اتصال برای کلیک پرداخت)
 *   ④ مسیرهای AI طولانی شناخته می‌شوند (isLongTimeoutUrl)
 *   ⑤ noteNetworkFailure → probe → رویداد connection-restored (بازیابی بدون بستن اپ)
 *   ⑥ fetch-json: GET خطای شبکه = یک تلاش دوباره؛ POST هرگز دوباره ارسال نمی‌شود
 *   ⑦ fetch-json: پاسخ HTML (صفحهٔ خطای گیت‌وی) → خطای فارسی
 *
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v156-net-shield.test.ts
 */

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─────────────── شبیه‌سازی مینیمال window (سندباکس bun) ─────────────── */
class StubTarget {
  private map = new Map<string, Set<() => void>>();
  addEventListener(t: string, fn: () => void) {
    if (!this.map.has(t)) this.map.set(t, new Set());
    this.map.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.map.get(t)?.delete(fn);
  }
  dispatchEvent(ev: any) {
    this.dispatchEventName(ev?.type);
    return true;
  }
  dispatchEventName(t: string) {
    this.map.get(t)?.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }
}

const windowStub: any = new StubTarget();
windowStub.location = { origin: "https://fittup.ir", href: "https://fittup.ir/" };
windowStub.navigator = { userAgent: "BunTest" };
windowStub.document = new StubTarget() as any;
(windowStub.document as any).visibilityState = "visible";
// ماژول‌ها به document/navigator به‌صورت global ارجاع می‌دهند (همانند مرورگر)
(globalThis as any).document = windowStub.document;

/* native قابل‌کنترل — هر بخش پیاده‌سازی خودش را تزریق می‌کند.
   window.fetch هرگز بعد از نصب shield بازنویسی نمی‌شود (همان قرارداد مرورگر). */
let nativeImpl: (url: any, init: any) => Promise<any> = async () => {
  throw new TypeError("no impl installed");
};
const controllableNative = (url: any, init: any) => nativeImpl(url, init);
Object.defineProperty(controllableNative, "name", { value: "controllableNative" });
windowStub.fetch = controllableNative as any;

(globalThis as any).window = windowStub;
(globalThis as any).fetch = windowStub.fetch;

/* CustomEvent هم شبیه‌سازی شود تا fireConnectionRestored دیده شود */
(globalThis as any).CustomEvent =
  (globalThis as any).CustomEvent ||
  class CustomEvent {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };

let restoredEvents = 0;
windowStub.addEventListener("fitup:connection-restored", () => {
  restoredEvents++;
});

/** پیاده‌سازی native: آویزان ابدی ولی به signal محترم (مثل سوکت مردهٔ واقعی + abort مرورگر) */
function makeHangNative(): (url: any, init: any) => Promise<any> {
  return (_url: any, init: any) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
}

/* ─────────────── import ماژول‌ها ─────────────── */
import {
  installNetShield,
  abortAllInFlight,
  inflightCount,
  isLongTimeoutUrl,
} from "../../src/lib/fitness/net-shield";
import {
  noteNetworkFailure,
  initNetworkRecovery,
  __resetRecoveryForTests,
} from "../../src/lib/fitness/network-recovery";
import {
  fetchJson,
  ApiError,
  SERVER_UNREACHABLE_MESSAGE,
} from "../../src/lib/fitness/fetch-json";

// در مرورگر window.fetch === globalThis.fetch — پس از نصب shield هر دو shielded هستند.
// نصب یک‌بار در ابتدای main انجام می‌شود؛ nativeImpl در هر بخش عوض می‌شود.

/* ─────────────── ① تایم‌اوت سخت روی fetch آویزان ─────────────── */
async function testHardTimeout() {
  console.log("\n① تایم‌اوت سخت — fetch هرگز resolve نمی‌شود → سپر abort می‌کند");
  __resetRecoveryForTests();
  nativeImpl = makeHangNative();
  check("نصب shield — window.fetch پوشانده شد", windowStub.fetch.name === "shielded");

  const t0 = Date.now();
  let aborted = false;
  try {
    await windowStub.fetch("/api/dashboard/pulse");
  } catch (e: any) {
    aborted = e?.name === "AbortError" || String(e?.name).includes("Abort");
  }
  const dt = Date.now() - t0;
  check("fetch آویزان در تایم‌اوت abort شد", aborted, `dt=${dt}ms`);
  check("زمان abort نزدیک سقف تزریقی (۴۰۰ms) بود", dt >= 350 && dt < 2000, `dt=${dt}ms`);
  check("رجیستری درخواست پس از abort خالی شد", inflightCount() === 0, `count=${inflightCount()}`);
  await sleep(200); // تخلیهٔ زنجیرهٔ ناهمگام گزارش شکست
  __resetRecoveryForTests();
}

/* ─────────────── ② signal فراخوان = دست‌نخوردگی کامل ─────────────── */
async function testCallerSignalUntouched() {
  console.log("\n② درخواست دارای signal فراخوان — سپر دخالت نمی‌کند (خط قرمز پرداخت)");
  __resetRecoveryForTests();
  nativeImpl = (_url: any, init: any) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("caller-abort")));
    });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
  const t0 = Date.now();
  let callerAbort = false;
  try {
    await windowStub.fetch("/api/payment/checkout", { signal: controller.signal });
  } catch (e: any) {
    callerAbort = String(e?.message) === "caller-abort";
  }
  const dt = Date.now() - t0;
  check("لغو فراخوان محترم شمرده شد", callerAbort);
  check("لغو در زمان فراخوان رخ داد (نه تایم‌اوت سپر ۴۰۰ms)", dt < 900, `dt=${dt}ms`);
  check("درخواستِ signal‌دار در رجیستری سپر ثبت نشد", inflightCount() === 0);
}

/* ─────────────── ③ abortAllInFlight — آزادسازی زامبی‌ها ─────────────── */
async function testAbortAll() {
  console.log("\n③ abortAllInFlight — استخر اتصال فوراً آزاد می‌شود");
  __resetRecoveryForTests();
  nativeImpl = makeHangNative();

  const p1 = windowStub.fetch("/api/dashboard/pulse").catch(() => "killed1");
  const p2 = windowStub.fetch("/api/notifications").catch(() => "killed2");
  const p3 = windowStub.fetch("/api/coach/plan", {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => "killed3");
  await sleep(50);
  check("سه درخواست در جریان ثبت شد", inflightCount() === 3, `count=${inflightCount()}`);

  // بدون includeLong فقط ۲ تای غیر-AI آزاد می‌شوند (AI طولانی حفظ می‌شود)
  const freed = abortAllInFlight("test", false);
  check("دو زامبی معمولی آزاد شدند (AI طولانی حفظ شد)", freed === 2, `freed=${freed}`);
  const r1 = await p1;
  const r2 = await p2;
  check("زامبی‌ها reject شدند (finally فراخوان‌ها اجرا می‌شود)", r1 === "killed1" && r2 === "killed2");

  const freedAll = abortAllInFlight("test", true);
  check("با includeLong=true AI طولانی هم آزاد شد", freedAll === 1, `freed=${freedAll}`);
  const r3 = await p3;
  check("AI طولانی هم reject شد", r3 === "killed3");
  check("رجیستری کاملاً خالی", inflightCount() === 0);
  await sleep(200); // تخلیهٔ زنجیرهٔ گزارشِ خودِ کشتن‌ها
  __resetRecoveryForTests();
}

/* ─────────────── ④ مسیرهای AI طولانی ─────────────── */
async function testLongRoutes() {
  console.log("\n④ تشخیص مسیرهای AI طولانی");
  check("چت با فیتاپ طولانی است", isLongTimeoutUrl("/api/coach/chat"));
  check("تولید برنامه طولانی است", isLongTimeoutUrl("/api/coach/plan"));
  check("تحلیل خون طولانی است", isLongTimeoutUrl("/api/coach/analyze-blood"));
  check("چت نیکا طولانی است", isLongTimeoutUrl("/api/nika/chat"));
  check("بازنویسی ادمین طولانی است", isLongTimeoutUrl("/api/admin/programs"));
  check("پالس داشبورد طولانی نیست", !isLongTimeoutUrl("/api/dashboard/pulse"));
  check("پرداخت طولانی نیست (خط قرمز تایم‌اوت کوتاه)", !isLongTimeoutUrl("/api/payment/checkout"));
}

/* ─────────────── ⑤ موتور خودترمیمی — probe → رویداد بازیابی ─────────────── */
async function testRecoveryEngine() {
  console.log("\n⑤ noteNetworkFailure → probe موفق → رویداد connection-restored");
  __resetRecoveryForTests();
  initNetworkRecovery();
  // probe روی HEAD /favicon.png — اول دو شکست (شبکهٔ ناپایدار سوییچ VPN) بعد موفق
  let headCalls = 0;
  nativeImpl = (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith("/favicon.png") && init?.method === "HEAD") {
      headCalls++;
      if (headCalls <= 2) return Promise.reject(new TypeError("network dead"));
      return Promise.resolve({ ok: true, status: 200 });
    }
    return Promise.resolve({ ok: true, status: 200 });
  };

  noteNetworkFailure(); // شبیه‌سازی شکست fetch (مثلاً پالس)
  // حلقهٔ پروب: ۱.۲s صبر اول + ۳s بین دورها — دو شکست = ~۷.۲s تا موفقیت
  await sleep(9_500);
  check("رویداد fitup:connection-restored پخش شد", restoredEvents >= 1, `events=${restoredEvents}`);
  check("probe تا موفقیت ادامه داد (بدون تسلیم بعد از ۵ دور قدیمی)", headCalls === 3, `heads=${headCalls}`);
  await sleep(150);
  __resetRecoveryForTests();
}

/* ─────────────── ⑥ fetch-json — ریتری GET، بدون ریتری POST ─────────────── */
async function testFetchJsonTransport() {
  console.log("\n⑥ fetch-json — transport تاب‌آور (GET ریتری، POST بدون ریتری)");
  __resetRecoveryForTests();
  // GET: دو TypeError بعد موفق
  let getAttempts = 0;
  nativeImpl = (url: any) => {
    const u = String(url);
    if (u.startsWith("/api/coach/program-history")) {
      getAttempts++;
      if (getAttempts <= 2) return Promise.reject(new TypeError("dead socket"));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, plans: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })
    );
  };

  const { res } = await fetchJson("/api/coach/program-history");
  check("GET با سوکت مرده: تلاش سوم موفق شد (ریتری تازه اجرا شد)", res.ok && getAttempts === 3, `attempts=${getAttempts}`);

  // POST: یک TypeError → بدون ریتری همان‌جا خطا
  let postAttempts = 0;
  nativeImpl = (_url: any, init: any) => {
    if (String(init?.method).toUpperCase() === "POST") {
      postAttempts++;
      return Promise.reject(new TypeError("dead socket"));
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })
    );
  };
  let postFailed = false;
  try {
    await fetchJson("/api/nutrition/log", { method: "POST", body: "{}" });
  } catch (e) {
    postFailed = e instanceof ApiError && (e as ApiError).status === 0;
  }
  check("POST شکست شبکه: بدون ریتری خطا داد (خطر ارسال دوباره صفر)", postFailed && postAttempts === 1, `attempts=${postAttempts}`);

  check("پیام خطای فارسی شبکه درست است", SERVER_UNREACHABLE_MESSAGE.includes("ارتباط با سرور"));
  await sleep(200);
  __resetRecoveryForTests();
}

/* ─────────────── ⑦ پاسخ HTML (صفحهٔ خطای گیت‌وی) ─────────────── */
async function testHtmlResponse() {
  console.log("\n⑦ پاسخ HTML گیت‌وی → خطای فارسی (نه crash JSON)");
  __resetRecoveryForTests();
  nativeImpl = () =>
    Promise.resolve(
      new Response("<!DOCTYPE html><html>gateway error</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      })
    );
  let mapped = false;
  try {
    const { fetchJsonOrThrow } = await import("../../src/lib/fitness/fetch-json");
    await fetchJsonOrThrow("/api/coach/plan");
  } catch (e: any) {
    mapped = e instanceof ApiError && e.message === SERVER_UNREACHABLE_MESSAGE;
  }
  check("HTML ۵۰۲ → ApiError پیام «ارتباط با سرور برقرار نشد»", mapped);
}

/* ─────────────── اجرا ─────────────── */
async function main() {
  console.log("════════════════════════════════════════════");
  console.log(" تست v156 — سپر شبکهٔ سراسری + خودترمیمی + transport پنل");
  console.log("════════════════════════════════════════════");
  installNetShield({ defaultTimeoutMs: 400 });
  // هویت مرورگری: بعد از نصب، globalThis.fetch هم همان shielded است
  (globalThis as any).fetch = windowStub.fetch;

  await testHardTimeout();
  await testCallerSignalUntouched();
  await testAbortAll();
  await testLongRoutes();
  await testRecoveryEngine();
  await testFetchJsonTransport();
  await testHtmlResponse();
  __resetRecoveryForTests();
  await sleep(300); // فرصت برای بازگشت حلقه‌های خوابیده به نسل مرده
  console.log("\n────────────────────────────────────────────");
  console.log(` نتیجه: ${pass} پاس / ${fail} شکست`);
  if (fail > 0) process.exit(1);
}
void main();
