/**
 * E2E v99 — ممیزی اجراییِ کامل خط لولهٔ رسانهٔ «چت با فیتاپ»
 *
 * سؤال مالک: «چرا فقط در چت، عکس/ویدیو به دست هوش مصنوعی نمی‌رسد (حتی فال‌بک)؟»
 *
 * این تست با رسانهٔ واقعی (ویدیوی H.264 ساختهٔ ffmpeg + عکس webp واقعی مثل تولید)
 * کل زنجیرهٔ سمت سرور را اجرا می‌کند و با موک ضبط‌کنندهٔ AvalAI ثابت می‌کند:
 *   ① استخراج فریم از ویدیوی واقعی → فریم‌های JPEG معتبر
 *   ② payload رسیده به «مدل» شامل بلاک‌های image_url با base64 سالم و mime درست است
 *   ③ در هر سناریوی خرابیِ مدل اصلی (کور/خالی/۵۰۰) فال‌بک gemini-3.5 نجات می‌دهد
 *   ④ وقتی هر دو مدل کورند → شکست صریح؛ هیچ پاسخ کوری کش/قبول نمی‌شود
 * تشخیص کوری فقط با گارد رسمی rejectBlindMediaResponse (چک naive فالس‌پوزتیو دارد —
 * تحلیل واقعی هم می‌گوید «زانو به عمق نرسیده»!).
 *
 * اجرا: bun scripts/e2e-chat-media-pipeline-v99.ts
 */
process.env.AVALAI_BASE_URL = "http://localhost:3043/v1";
process.env.AVALAI_API_KEY = "mock-key-e2e";
process.env.AVALAI_VISION_MODEL = "gemini-3.8-flash";
process.env.AVALAI_FALLBACK_VISION_MODEL = "gemini-3.5-flash";
process.env.AVALAI_TEXT_MODEL = "deepseek-v4.1-flash";
process.env.AVALAI_FALLBACK_TEXT_MODEL = "gemini-3.8-flash";

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PORT = 3043;
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── ساخت رسانهٔ واقعی ───
const dir = mkdtempSync(join(tmpdir(), "fitup-e2e-v99-"));
const videoPath = join(dir, "squat-test.mp4");
const imagePath = join(dir, "body-test.webp");

console.log("🎬 ساخت ویدیوی آزمایشی H.264 با ffmpeg...");
{
  const r = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=640x480:rate=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath,
  ], { stdio: "ignore" });
  check("ویدیوی آزمایشی ساخته شد", r.status === 0, `exit=${r.status}`);
}
console.log("🖼 ساخت عکس webp واقعی با sharp (شبیه‌سازی saveOptimizedImage تولید)...");
{
  const sharp = (await import("sharp")).default;
  const buf = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).jpeg().toBuffer();
  const webp = await sharp(buf).webp({ quality: 75 }).toBuffer();
  writeFileSync(imagePath, webp);
  check("عکس webp ساخته شد", webp.length > 1000, `${webp.length}B`);
}

// ─── موک AvalAI ضبط‌کننده ───
type Mode = "healthy" | "blind" | "empty" | "error500";
let mode: Mode = "healthy";
let fallbackBlindToo = false;
const recorded: { path: string; model: string; imageParts: number; imageMimes: string[]; imageBytesOK: boolean[]; textHead: string }[] = [];

const REAL_ANALYSIS = "گزارش تحلیل: ورزشکار در حالت اسکوات است؛ در فریم سوم زانو به عمق کامل نرسیده و زاویهٔ دوربین مناسب است.";
const BLIND_TEXT = "هیچ فریم یا تصویری در ورودی این پیام به من ارائه نشده است؛ دادهٔ بصری به تحلیل‌گر نرسیده است.";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function inspectMessages(body: any) {
  const rec = { path: "", model: "", imageParts: 0, imageMimes: [] as string[], imageBytesOK: [] as boolean[], textHead: "" };
  rec.model = String(body?.model || "");
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  for (const m of msgs) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) {
      if (p?.type === "image_url" && typeof p?.image_url?.url === "string") {
        rec.imageParts++;
        const mm = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        if (mm) {
          rec.imageMimes.push(mm[1]);
          try {
            const b = Buffer.from(mm[2], "base64");
            rec.imageBytesOK.push(b.length > 500);
          } catch { rec.imageBytesOK.push(false); }
        }
      } else if (p?.type === "text" && !rec.textHead) {
        rec.textHead = String(p.text).slice(0, 60);
      }
    }
  }
  return rec;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const body: any = await req.json().catch(() => ({}));
    const isFallback = String(body?.model || "").includes("gemini-3.5");

    if (url.pathname === "/v1/chat/completions") {
      recorded.push({ ...inspectMessages(body), path: "native" });
      if (isFallback) {
        const content = fallbackBlindToo ? BLIND_TEXT : REAL_ANALYSIS;
        return json({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } });
      }
      // مدل اصلی طبق سناریو
      if (mode === "blind") return json({ choices: [{ index: 0, message: { role: "assistant", content: BLIND_TEXT }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980 } });
      if (mode === "empty") return json({ choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "length" }], usage: { prompt_tokens: 900, completion_tokens: 0, total_tokens: 900 } });
      if (mode === "error500") return json({ error: { message: "upstream overloaded" } }, 500);
      return json({ choices: [{ index: 0, message: { role: "assistant", content: REAL_ANALYSIS }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } });
    }

    if (url.pathname === "/v1/messages") {
      recorded.push({ ...inspectMessages(body), path: "adapter" });
      return json({ id: "msg_mock", content: [{ type: "text", text: REAL_ANALYSIS }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 90 } });
    }

    return json({ error: "not found" }, 404);
  },
});

// ─── اجرای زنجیرهٔ واقعی ───
const ai = await import("../src/lib/fitness/ai");
const { extractVideoFramesAsDataUrls, analyzeChatMedia, rejectBlindMediaResponse } = ai;

async function runChain(label: string, m: Mode, media: "image" | "video") {
  mode = m;
  fallbackBlindToo = false;
  recorded.length = 0;
  console.log(`\n── ${label} (مدیا: ${media}) ──`);
  let dataUrls: string[];
  if (media === "video") {
    dataUrls = await extractVideoFramesAsDataUrls(videoPath, 6);
  } else {
    const b64 = readFileSync(imagePath).toString("base64");
    dataUrls = [`data:image/webp;base64,${b64}`];
  }
  const out = await analyzeChatMedia(media === "video" ? "video-frames" : "image", dataUrls, "این حرکت چطور بود؟", "e2e-owner");
  const blindVerdict = rejectBlindMediaResponse(out);
  return { out, dataUrls, blindVerdict };
}

async function main() {
  // ── صحنهٔ ۰: استخراج فریم از ویدیوی واقعی ──
  console.log("\n── صحنهٔ ۰: استخراج فریم از ویدیوی واقعی H.264 ──");
  const frames = await extractVideoFramesAsDataUrls(videoPath, 6);
  // ویدیوی ۳ ثانیه‌ای با نمونه‌برداری ثانیه‌ای → ۳ فریم (سقف ۶ برای ویدیوهای بلندتر)
  check(`فریم استخراج شد (${frames.length} فریم — ویدیوی ۳ ثانیه‌ای)`, frames.length >= 1 && frames.length <= 6, `count=${frames.length}`);
  check("همهٔ فریم‌ها JPEG معتبرند", frames.every((f) => f.startsWith("data:image/jpeg;base64,") && Buffer.from(f.split(",")[1], "base64").length > 500));

  // ── سناریو ۱: مدل اصلی سالم + عکس webp واقعی ──
  {
    const { out, dataUrls, blindVerdict } = await runChain("سناریو ۱: مدل اصلی سالم", "healthy", "image");
    check("تحلیل موفق برگشت", out.includes("گزارش") && blindVerdict === null);
    check("دقیقاً ۱ بلاک تصویر به مدل رسید", recorded[0]?.imageParts === 1, `parts=${recorded[0]?.imageParts}`);
    check("mime عکس webp حفظ شد", recorded[0]?.imageMimes[0] === "image/webp", recorded[0]?.imageMimes.join(","));
    check("base64 عکس سالم و غیرخالی بود", recorded[0]?.imageBytesOK[0] === true);
    check("حجم payload عکس معقول (<400KB)", (dataUrls[0]?.length ?? 0) < 400_000, `${Math.round((dataUrls[0]?.length ?? 0) / 1024)}KB`);
  }

  // ── سناریو ۲: ویدیوی واقعی + مدل اصلی سالم ──
  {
    const { out, blindVerdict } = await runChain("سناریو ۲: ویدیوی واقعی → فریم‌ها → تحلیل", "healthy", "video");
    check("تحلیل موفق برگشت", out.includes("گزارش") && blindVerdict === null);
    const rec = recorded.filter((r) => r.path === "native")[0];
    check("فریم‌ها به مدل رسیدند", (rec?.imageParts ?? 0) >= 1, `parts=${rec?.imageParts}`);
    check("همهٔ فریم‌ها image/jpeg بودند", rec?.imageMimes.every((m) => m === "image/jpeg"));
    check("هیچ فریم خرابی به مدل نرفت", rec?.imageBytesOK.every(Boolean));
  }

  // ── سناریو ۳: مدل اصلی کور → فال‌بک نجات ──
  {
    const { out, blindVerdict } = await runChain("سناریو ۳: اصلی کور → فال‌بک gemini-3.5", "blind", "image");
    check("پاسخ نهایی از بینا آمد (گارد رسمی: غیرکور)", blindVerdict === null && out.includes("گزارش"), blindVerdict ?? "");
    const models = recorded.map((r) => r.model);
    check("فال‌بک gemini-3.5 صدا زده شد", models.includes("gemini-3.5-flash"), models.join(" → "));
  }

  // ── سناریو ۴: پاسخ خالی → فال‌بک ──
  {
    const { out, blindVerdict } = await runChain("سناریو ۴: اصلی خالی → فال‌بک", "empty", "image");
    check("پاسخ نهایی واقعی است", out.includes("گزارش") && blindVerdict === null);
    check("فال‌بک اجرا شد", recorded.some((r) => r.model === "gemini-3.5-flash"));
  }

  // ── سناریو ۵: ۵۰۰ → فال‌بک ──
  {
    const { out, blindVerdict } = await runChain("سناریو ۵: اصلی ۵۰۰ → فال‌بک", "error500", "image");
    check("پاسخ نهایی واقعی است", out.includes("گزارش") && blindVerdict === null);
    check("فال‌بک اجرا شد", recorded.some((r) => r.model === "gemini-3.5-flash"));
  }

  // ── سناریو ۶: هاردترین حالت — اصلی و فال‌بک هر دو کور → شکست صریح (بدون کش مسموم) ──
  {
    mode = "blind";
    fallbackBlindToo = true;
    recorded.length = 0;
    console.log("\n── سناریو ۶: اصلی و فال‌بک هر دو کور → شکست صریح ──");
    const b64 = readFileSync(imagePath).toString("base64");
    let threw = false;
    let out = "";
    try {
      out = await analyzeChatMedia("image", [`data:image/webp;base64,${b64}`], "تست", "e2e-owner");
    } catch {
      threw = true;
    }
    fallbackBlindToo = false;
    check("هر دو کور → خطای صریح یا پاسخِ گاردشده (هیچ کوری قبول نشد)", threw || rejectBlindMediaResponse(out) !== null);
    check("فال‌بک هم تلاش شد (تسلیم تک‌مدلی نداریم)", recorded.some((r) => r.model === "gemini-3.5-flash"));
  }

  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${"═".repeat(60)}`);
  console.log(`نتیجه: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E شکست خورد:", e);
  server.stop(true);
  process.exit(1);
});
