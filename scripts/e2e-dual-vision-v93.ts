/**
 * E2E v93 — آزمون معماری دو‌مسیرهٔ ضدکور ویژن deepseek-v4.1-flash
 * (دیرکتیو مالک: کل سیستم روی V4.1 Flash؛ هیچ پاسخ کوری نباید به‌عنوان
 * تحلیل موفق پذیرفته شود و هیچ سهمیه‌ای در شکست کم نشود.)
 *
 * سناریوها (با سرور موک محلی روی 3041):
 *   A) native-blind  — مسیر بومی chat/completions کور است (شبیه‌سازی رگرسیون گیت‌وی)
 *                      → باید به آداپتور /v1/messages سوئیچ کند و تحلیل واقعی برگرداند.
 *   B) native-ok     — مسیر بومی سالم → مستقیم از همان پاسخ واقعی بیاید (۱ کال).
 *   C) both-blind    — هر دو مسیر کور → پس از retryها فال‌بک gemini جواب واقعی دهد؛
 *                      پاسخ کور هرگز «موفق» پنداشته نشود.
 *   D) adapter-error — مسیر بومی 500 بدهد → آداپتور جواب دهد.
 *
 * اجرا: bun scripts/e2e-dual-vision-v93.ts
 */

// ─── env قبل از import ماژول‌ها ست شود (ai.ts در زمان import می‌خواند) ───
process.env.AVALAI_BASE_URL = "http://localhost:3041/v1";
process.env.AVALAI_API_KEY = "test-key-e2e";
process.env.AVALAI_VISION_MODEL = ""; // پیش‌فرض کد → deepseek-v4.1-flash

const PORT = 3041;

// ── حالت موک — از سناریوها کنترل می‌شود ──
type Mode = "native-blind" | "native-ok" | "both-blind" | "adapter-error";
let mode: Mode = "native-ok";

const counts = {
  nativeCalls: 0, // /v1/chat/completions
  adapterCalls: 0, // /v1/messages
  geminiFallbackCalls: 0, // chat/completions با مدل gemini (فال‌بک)
};

const REAL_ANALYSIS =
  "فریم‌ها یک اسکوات با هالتر را نشان می‌دهند؛ پهنای قدم مناسب، زانو در راستای پنجه، کمر خنثی. در فاز پایین عمق کافی است. نکته: بارفیکس سرعت پایین‌آمدن کنترل‌شده‌تر باشد.";
const BLIND_TEXT = "متاسفانه ویدیویی به من نرسیده است تا بتوانم تحلیل کنم.";

function hasImage(msgs: any[]): boolean {
  return (msgs || []).some((m: any) =>
    Array.isArray(m?.content)
      ? m.content.some((p: any) => p?.type === "image_url" || p?.type === "image")
      : false
  );
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as any;

    if (url.pathname === "/v1/chat/completions") {
      counts.nativeCalls++;
      const isGemini = String(body?.model || "").includes("gemini");
      if (isGemini) counts.geminiFallbackCalls++;
      if (isGemini) {
        // فال‌بک همیشه جواب واقعی می‌دهد (مدل اثبات‌شده)
        return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
      }
      if (mode === "native-ok") {
        return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
      }
      if (mode === "native-blind" || mode === "both-blind") {
        if (hasImage(body?.messages)) {
          // گیت‌وی بلاک تصویر را حذف کرده → مدل کور ولی 200
          return json({ choices: [{ index: 0, message: { role: "assistant", content: BLIND_TEXT }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
        }
        return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
      }
      if (mode === "adapter-error") {
        return json({ error: { message: "internal gateway error" } }, 500);
      }
      return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: {} });
    }

    if (url.pathname === "/v1/messages") {
      counts.adapterCalls++;
      const blocks = (body?.messages || []).flatMap((m: any) =>
        Array.isArray(m?.content) ? m.content : []
      );
      const hasImg = blocks.some((b: any) => b?.type === "image");
      if (mode === "both-blind" || !hasImg) {
        return json({ content: [{ type: "text", text: BLIND_TEXT }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 10 } });
      }
      if (mode === "adapter-error") {
        // در این سناریو آداپتور باید موفق باشد (مسیر بومی 500 بود)
        return json({ content: [{ type: "text", text: REAL_ANALYSIS }], stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 60 } });
      }
      return json({ content: [{ type: "text", text: REAL_ANALYSIS }], stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 60 } });
    }

    return new Response("Not Found", { status: 404 });
  },
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function reset() {
  counts.nativeCalls = 0;
  counts.adapterCalls = 0;
  counts.geminiFallbackCalls = 0;
}

// ─── ایمپورت دینامیک — بعد از ست‌شدن env ───
const { analyzeChatMedia, VISION_MODEL, rejectBlindMediaResponse } = await import(
  "../src/lib/fitness/ai"
);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}

async function main() {
  console.log(`\n=== E2E دومیسرهٔ ویژن v93 — VISION_MODEL=${VISION_MODEL} ===`);
  check("VISION_MODEL پیش‌فرض = deepseek-v4.1-flash", VISION_MODEL === "deepseek-v4.1-flash", VISION_MODEL);
  check("گارد کور: «ویدیویی به من نرسیده» رد می‌شود", !!rejectBlindMediaResponse(BLIND_TEXT));
  check("گارد کور: تحلیل واقعی پذیرفته می‌شود", rejectBlindMediaResponse(REAL_ANALYSIS) === null);

  const dataUrls = [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=",
  ];

  // ─── A) مسیر بومی کور → سوئیچ به آداپتور ───
  console.log("\n--- A) native-blind: بومی کور → آداپتور ---");
  mode = "native-blind"; reset();
  const a = await analyzeChatMedia("video-frames", dataUrls, undefined, null);
  check("پاسخ نهایی تحلیل واقعی است (نه کور)", a === REAL_ANALYSIS, a.slice(0, 50));
  check("مسیر بومی ۱ بار صدا خورد", counts.nativeCalls === 1, String(counts.nativeCalls));
  check("آداپتور ۱ بار صدا خورد (سوئیچ)", counts.adapterCalls === 1, String(counts.adapterCalls));

  // ─── B) مسیر بومی سالم → بدون کال آداپتور ───
  console.log("\n--- B) native-ok: بومی سالم ---");
  mode = "native-ok"; reset();
  const b = await analyzeChatMedia("image", dataUrls, undefined, null);
  check("پاسخ نهایی تحلیل واقعی است", b === REAL_ANALYSIS);
  check("فقط مسیر بومی صدا خورد", counts.nativeCalls === 1 && counts.adapterCalls === 0, `native=${counts.nativeCalls} adapter=${counts.adapterCalls}`);

  // ─── C) هر دو مسیر کور → فال‌بک gemini جواب واقعی ───
  console.log("\n--- C) both-blind: هر دو کور → فال‌بک ---");
  mode = "both-blind"; reset();
  const c = await analyzeChatMedia("video-frames", dataUrls, undefined, null);
  check("پاسخ نهایی از فال‌بک واقعی است (هیچ پاسخ کوری پذیرفته نشد)", c === REAL_ANALYSIS, c.slice(0, 50));
  check("فال‌بک gemini صدا خورد", counts.geminiFallbackCalls > 0, String(counts.geminiFallbackCalls));

  // ─── D) مسیر بومی 500 → آداپتور ───
  console.log("\n--- D) adapter-error: بومی 500 → آداپتور ---");
  mode = "adapter-error"; reset();
  const d = await analyzeChatMedia("image", dataUrls, undefined, null);
  check("پاسخ نهایی تحلیل واقعی از آداپتور است", d === REAL_ANALYSIS);
  check("آداپتور صدا خورد", counts.adapterCalls >= 1, String(counts.adapterCalls));

  console.log(`\n=== نتیجه: ${pass} ✓ / ${fail} ✗ ===`);
  server.stop(true);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E failed:", e);
  server.stop(true);
  process.exit(1);
});
