/**
 * E2E v95 — آزمون گارد ضدکورِ تقویت‌شده با عین پاسخ کورِ فراری از v94
 *
 * شاهد زندهٔ v94 (پرب واقعی با کلید تولیدی):
 *   • مسیر بومی chat/completions برای deepseek-v4.1-flash ۱۰۰٪ کور است (حتی ۱ فریم ۴۲KB) —
 *     پاسخ کور: «هیچ تصویری در پیام شما پیوست نشده است».
 *   • آداپتور /v1/messages واقعاً می‌بیند (الگوی SMPTE ویدیوی واقعی را عیناً توصیف کرد).
 * پس ترتیب وارون شد: آداپتور اول، بومی دوم. گارد ضدکور هم با الگوهای جدید تقویت شد.
 *
 * سناریوها (با سرور موک محلی روی 3042):
 *   A) adapter-ok     — آداپتور سالم → فقط آداپتور کال شود؛ بومی هرگز صدا زده نشود (۱ کال).
 *   B) adapter-blind  — آداپتور کور → سوئیچ به بومی و پاسخ واقعی از بومی.
 *   C) both-blind     — هر دو کور → فال‌بک gemini جواب واقعی دهد؛ هیچ پاسخ کوری پذیرفته نشود.
 *   D) adapter-error  — آداپتور 500 → بومی جواب دهد.
 *   E) گارد رجکس — پاسخ‌های کور واقعیِ پرب v94 باید رد شوند؛ تحلیل‌های واقعی باید رد شوند.
 *
 * اجرا: bun scripts/e2e-dual-vision-v95.ts
 */

// ─── env قبل از import ماژول‌ها ست شود (ai.ts در زمان import می‌خواند) ───
process.env.AVALAI_BASE_URL = "http://localhost:3042/v1";
process.env.AVALAI_API_KEY = "test-key-e2e";
process.env.AVALAI_VISION_MODEL = "deepseek-v4.1-flash";
process.env.AVALAI_FALLBACK_VISION_MODEL = "gemini-3.8-flash";

const PORT = 3042;

type Mode = "adapter-ok" | "adapter-blind" | "both-blind" | "adapter-error";
let mode: Mode = "adapter-ok";

const counts = {
  nativeCalls: 0,
  adapterCalls: 0,
  geminiFallbackCalls: 0,
};

const REAL_ANALYSIS =
  "تمام ۵ فریم ارائه‌شده، الگوی آزمایشی رنگ (نوارهای رنگی استاندارد SMPTE/EBU) با تایم‌کد ۰۰:۰۰:۰۰:۰۰ هستند؛ هیچ سوژهٔ انسانی یا حرکتی در فریم‌ها نیست.";
const BLIND_ADAPTER =
  "ویدیویی به من نرسیده است تا بتوانم تحلیل کنم.";
// عین پاسخ کورِ بومی از پرب زندهٔ v94 (که از گارد v92 فرار می‌کرد!)
const BLIND_NATIVE_V94 =
  "**گزارش تحلیل بینایی — وضعیت: بدون داده**\n\nهیچ فریم یا تصویری در پیام پیوست نشده است؛ ورودی بصری قابل بازیابی نیست. متن ارسالی فقط اشاره به وجود ویدیو و ترتیب زمانی فریم‌هاست، اما خود فریم‌ها به این مدل نرسیده‌اند.\n\n**علت محتمل:** عدم بارگذاری موفق فایل.";
// ⚠️ v95 — عین پاسخ کورِ بومی از پرب زندهٔ v95 (این یکی از گارد v94 «فرار می‌کرد» —
// ریشهٔ «ویدیو تحلیل نشد + سهمیه کم شد + مربی پرونده را تحلیل کرد»)
const BLIND_NATIVE_V95_LIVE =
  "گزارش تحلیل تصویری:\n\nهیچ فریم یا تصویری در ورودی این پیام به من ارائه نشده است. محتوای بصری قابل تشخیص نیست: نه فریم‌های آغاز، نه میانه، نه پایان حرکت، و نه هیچ عنصر دیگری (ورزشکار، تجهیزات، محیط، زاویهٔ دوربین) قابل مشاهده نیست. تنها متن همراه پیام («ویدیو فرستاده شده، فریم‌ها به ترتیب زمانی») در دسترس است و این متن به‌تنهایی برای تحلیل فرم حرکتی، دامنهٔ حرکتی یا وضعیت مفاصل و ستون فقرات کافی نیست.\n\nبنابراین گزارش فنی ممکن نیست و باید به مربی اطلاع داده شود که دادهٔ بصری به تحلیل‌گر نرسیده است.";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as any;

    if (url.pathname === "/v1/chat/completions") {
      counts.nativeCalls++;
      const isGemini = String(body?.model || "").includes("gemini");
      if (isGemini) {
        counts.geminiFallbackCalls++;
        return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
      }
      // بومی (بر اساس شاهد زنده) همیشه کور است — مگر در حالت C که فال‌بک لازم است و همین کور بودنش استفاده می‌شود
      return json({ choices: [{ index: 0, message: { role: "assistant", content: BLIND_NATIVE_V95_LIVE }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
    }

    if (url.pathname === "/v1/messages") {
      counts.adapterCalls++;
      if (mode === "adapter-ok") {
        return json({ id: "msg_test", content: [{ type: "text", text: REAL_ANALYSIS }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 80 } });
      }
      if (mode === "adapter-blind") {
        return json({ id: "msg_test", content: [{ type: "text", text: BLIND_ADAPTER }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 80 } });
      }
      if (mode === "both-blind") {
        return json({ id: "msg_test", content: [{ type: "text", text: BLIND_ADAPTER }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 80 } });
      }
      if (mode === "adapter-error") {
        return json({ error: { message: "gateway overloaded" } }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

// ─── تست‌ها ───
const TINY_FRAME =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDA1NDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/vwooooA//9k=";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function runScenario(name: string, mode_: Mode, fn: () => Promise<void>) {
  mode = mode_;
  counts.nativeCalls = 0;
  counts.adapterCalls = 0;
  counts.geminiFallbackCalls = 0;
  console.log(`\n── سناریو ${name} (mode=${mode_}) ──`);
  await fn();
}

async function main() {
  const { analyzeChatMedia, rejectBlindMediaResponse } = await import("../src/lib/fitness/ai");

  // ── سناریو A: آداپتور سالم → فقط آداپتور، بدون کال بومی ──
  await runScenario("A: adapter-ok", "adapter-ok", async () => {
    const out = await analyzeChatMedia("video-frames", [TINY_FRAME, TINY_FRAME]);
    check("پاسخ واقعی برگشت", out.includes("SMPTE"), out.slice(0, 80));
    check("فقط آداپتور کال شد (۱ کال)", counts.adapterCalls === 1, `adapter=${counts.adapterCalls}`);
    check("بومی هرگز کال نشد (مسیر اول جواب داد)", counts.nativeCalls === 0, `native=${counts.nativeCalls}`);
  });

  // ── سناریو B: آداپتور کور → سوئیچ به بومی — و پاسخ کورِ «پیوست نشده» بومی هم گارد می‌خورد → فال‌بک ──
  await runScenario("B: adapter-blind → بومی کور (v94) → فال‌بک", "adapter-blind", async () => {
    const out = await analyzeChatMedia("video-frames", [TINY_FRAME]);
    check("پاسخ نهایی واقعی است (نه کور)", out.includes("SMPTE"), out.slice(0, 80));
    check("هیچ پاسخ کوری پذیرفته نشد", !out.includes("نرسیده") && !out.includes("پیوست نشده"));
    check("آداپتور کال شد", counts.adapterCalls >= 1, `adapter=${counts.adapterCalls}`);
    check("بومی هم کال شد (مسیر دوم)", counts.nativeCalls >= 1, `native=${counts.nativeCalls}`);
    check("فال‌بک gemini نجات داد", counts.geminiFallbackCalls >= 1, `gemini=${counts.geminiFallbackCalls}`);
  });

  // ── سناریو C: هر دو کور → فال‌بک gemini ──
  await runScenario("C: both-blind", "both-blind", async () => {
    const out = await analyzeChatMedia("image", [TINY_FRAME]);
    check("پاسخ نهایی از فال‌بک واقعی است", out.includes("SMPTE"), out.slice(0, 80));
    check("هیچ پاسخ کوری پذیرفته نشد", !out.includes("نرسیده"));
  });

  // ── سناریو D: آداپتور 500 → بومی (کور) → فال‌بک ──
  await runScenario("D: adapter-error", "adapter-error", async () => {
    const out = await analyzeChatMedia("image", [TINY_FRAME]);
    check("پاسخ نهایی واقعی است", out.includes("SMPTE"), out.slice(0, 80));
    check("بومی بعد از خطای آداپتور کال شد", counts.nativeCalls >= 1, `native=${counts.nativeCalls}`);
  });

  // ── سناریو E: گارد رجکس تقویت‌شده ──
  console.log("\n── سناریو E: گارد رجکس rejectBlindMediaResponse ──");
  const mustReject = [
    BLIND_NATIVE_V94,
    BLIND_NATIVE_V95_LIVE, // ⚠️ عین پاسخ کورِ فراری از گارد v94 — ریشهٔ باگ مالک
    "هیچ تصویری در پیام شما پیوست نشده است، بنابراین نمیتوانم بگویم دقیقاً چیست.",
    "هیچ تصویری در پیام شما ارسال نشده است، بنابراین نمیتوانم بگویم چیست.",
    "متاسفانه ویدیویی به من نرسیده است تا بتوانم تحلیل کنم.",
    "فریم‌ها به این مدل نرسیده‌اند.",
    "**علت محتمل:** عدم بارگذاری موفق فایل",
    "ورودی بصری قابل بازیابی نیست.",
    "فریمی به من ارائه نشده است.",
    "ویدیویی تحویل نشد تا تحلیل شود.",
    "دادهٔ بصری به تحلیل‌گر نرسیده است.",
    "محتوای بصری قابل تشخیص نیست.",
    "I cannot see the image you attached.",
    "No video frames were provided in the request.",
    "دسترسی به تصویر ندارم.",
  ];
  for (const t of mustReject) {
    check(`رد: «${t.replace(/\n/g, " ").slice(0, 48)}…»`, rejectBlindMediaResponse(t) !== null);
  }
  const mustPass = [
    REAL_ANALYSIS,
    "تحلیل عکس اول: توزیع چربی بیشتر در ناحیهٔ شکم؛ وضعیت عضلات بالا تنه نسبتاً خوب است.",
    "در فریم سوم زانو کمی جلوتر از پنجه می‌رود؛ دامنهٔ حرکتی ۸۰ درجه است.",
    "گزارش: فریم آخر به موقعیت کامل اسکوات نرسیده — عمق کافی نیست.",
    "The first frame shows a proper deadlift setup with neutral spine.",
  ];
  for (const t of mustPass) {
    check(`پذیرش: «${t.slice(0, 48)}…»`, rejectBlindMediaResponse(t) === null);
  }

  server.stop(true);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`نتیجه: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E شکست خورد:", e);
  server.stop(true);
  process.exit(1);
});
