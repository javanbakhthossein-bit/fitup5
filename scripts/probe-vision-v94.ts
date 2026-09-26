/**
 * v94 — پرب زندهٔ ویژن deepseek-v4.1-flash با ویدیوی واقعی (دیرکتیو مالک):
 * «اول مدل ویژن deepseek v4.1 flash باید حتما حتما کار کنه و اگر یک درصد کار نکرد
 *  جمنای 3.8 فلش دقیق باید از ساختار کد استفاده بشه.»
 *
 * این اسکریپت:
 *   ۱) از ویدیوی واقعی uploads/videos فریم استخراج می‌کند (همان مسیر تولیدی ffmpeg)
 *   ۲) مسیر ۱ (chat/completions بومی با image_url) را با کلید واقعی زنده تست می‌کند
 *   ۳) مسیر ۲ (آداپتور /v1/messages) را دقیقاً مثل anthropicVisionCompletion تست می‌کند
 *   ۴) با گارد rejectBlindMediaResponse (عیناً از ai.ts) پاسخ کور را رد می‌کند
 *   ۵) نتیجه: کدام مسیر(ها) واقعاً می‌بینند؟ اگر هیچ‌کدام → gemini-3.8-flash لازم است.
 *
 * اجرا: bun scripts/probe-vision-v94.ts
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { config } from "dotenv";

config();

const API_KEY = process.env.AVALAI_API_KEY || "";
const BASE_URL = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
const VISION_MODEL = process.env.AVALAI_VISION_MODEL || "deepseek-v4.1-flash";
const FALLBACK_VISION_MODEL = process.env.AVALAI_FALLBACK_VISION_MODEL || "gemini-3.8-flash";

if (!API_KEY) {
  console.error("❌ AVALAI_API_KEY تنظیم نشده");
  process.exit(1);
}

// ─── گارد کور — عیناً از ai.ts (v95 همگام شد — شامل «فریم» + «ارائه نشد» +
// «محتوای بصری قابل تشخیص نیست» + «دادهٔ بصری نرسیده») ───
function rejectBlindMediaResponse(text: string): string | null {
  const N = "(?:ویدیو|عکس|تصویر|فایل|رسانه|لینک|فریم)(?:یی|ی)?";
  const blind = new RegExp(
    `${N} ?(?:به من )?(?:نرسید|نرسیده|دریافت نشد|دریافت نشده|دریافت نکردم)` +
      `|${N}[^.\n]{0,25}به (?:این )?مدل نرسید` +
      `|${N} نمی‌?بینم` +
      `|نمی‌[ ‌]?توانم (?:هیچ )?${N}[^.]{0,12}(?:ببینم|مشاهده کنم)` +
      `|دسترسی به (?:تصویر|عکس|ویدیو|رسانه|فایل)` +
      `|${N}[^.\n]{0,40}(?:پیوست|ارسال|ضمیمه|ارائه|تحویل|بارگذاری) نشد` +
      `|ورودی بصری|قابل بازیابی نیست` +
      `|عدم (?:بارگذاری|دریافت) (?:موفق )?(?:فایل|تصویر|ویدیو|رسانه|فریم)` +
      `|محتوای بصری[^.\n]{0,30}قابل (?:تشخیص|بازیابی|مشاهده) نیست` +
      `|داده[ٔ‌]? ?بصری[^.\n]{0,25}نرسید` +
      `|به (?:من|تحلیل[‌ـ]?گر|این مدل) ارائه نشد` +
      `|cannot (?:see|view) (?:the |any |your )?(?:image|video|media|attachment|frame)` +
      `|(?:unable|not able) to (?:see|view|open|process) (?:the |any |your )?(?:image|video|media|attachment|frame)` +
      `|no (?:image|video|media|frames?) (?:was|were|is|are) (?:received|attached|found|visible|provided)` +
      `|(?:the )?(?:image|video|media|attachment|frame)s? (?:was|were|is|are) not (?:received|attached|found|visible|available|provided)`,
    "i"
  );
  return blind.test(text) ? "BLIND" : null;
}

// ─── پرامپت تحلیل رسانهٔ چت — عیناً از ai.ts ───
const CHAT_MEDIA_ANALYSIS_SYSTEM_PROMPT = `تو «چشم مربی فیتاپ» هستی — یک تحلیل‌گر بینایی دقیق و فنی. وظیفهٔ تو فقط یک چیز است: تحلیل محتوای تصاویر/فریم‌های ویدیویی که کاربر در چت با مربی فرستاده است. پاسخ تو به کاربر نشان داده نمی‌شود؛ به‌عنوان گزارش ورودی به مربی هوشمند (مدل متنی) داده می‌شود تا پاسخ نهایی را بنویسد. پس فارسی، خلاصه، دقیق و ساختارمند بنویس (حداکثر ~۲۰۰ کلمه):

- عکس غذا: همهٔ خوراکی‌های قابل تشخیص، تخمین حجم هر آیتم، تخمین کالری و درشت‌مغذی، نکات ظاهری (روغن، نان، نوشیدنی و…).
- عکس بدن/پیشرفت: ترکیب بدنی ظاهری، توزیع چربی، فرم و وضعیت بدن، وضعیت عضلات، هر تغییر قابل‌مشاهده.
- عکس/فریم‌های تمرین: نام حرکت (در صورت تشخیص)، فرم اجرا در هر فریم (برای ویدیو به ترتیب زمانی از شروع تا پایان)، دامنهٔ حرکتی، وضعیت زانو/کمر/ستون فقرات، خطاهای تکنیکی، کیفیت زاویهٔ دوربین.
- هر چیز دیگر: دقیقاً گزارش کن تصویر چیست.

اگر تصویر مبهم/تیره/ناقص است صادقانه و کوتاه بگو چه چیزی قابل تشخیص نیست، اما هرچه قابل تشخیص است را کامل گزارش کن. هیچ توصیهٔ نهایی به کاربر نده، هیچ سلام و مقدمهٔ چت ننویس و هیچ سوال از کاربر نپرس؛ فقط گزارش تحلیلی خالص.`;

// ─── استخراج فریم از ویدیوی واقعی ───
function extractFrames(videoPath: string, count: number): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "fitup-probe-"));
  execSync(
    `ffmpeg -y -i "${videoPath}" -vf "select='not(mod(n\\,15))',scale=640:-2" -frames:v ${count} -q:v 5 "${tmp}/f%d.jpg" -loglevel error`
  );
  const frames: string[] = [];
  for (let i = 1; i <= count; i++) {
    const p = join(tmp, `f${i}.jpg`);
    if (!existsSync(p)) continue;
    frames.push(`data:image/jpeg;base64,${readFileSync(p).toString("base64")}`);
  }
  return frames;
}

// ─── مسیر ۱: chat/completions بومی ───
async function probeNative(frames: string[]): Promise<{ ok: boolean; text: string; note: string }> {
  const content: unknown[] = [
    {
      type: "text",
      text: "کاربر ویدیو فرستاده است؛ فریم‌های بالا به ترتیب زمانی از شروع تا پایان حرکت‌اند. تحلیل فنی توالی را طبق دستور سیستم تولید کن.",
    },
    ...frames.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: CHAT_MEDIA_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      max_tokens: 1200,
      reasoning_effort: "low",
    }),
    signal: AbortSignal.timeout(165_000),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, text: t.slice(0, 300), note: `HTTP ${res.status}` };
  }
  const json: any = await res.json();
  const text: string = json?.choices?.[0]?.message?.content || "";
  if (!text.trim()) return { ok: false, text, note: "پاسخ خالی" };
  if (rejectBlindMediaResponse(text)) return { ok: false, text, note: "پاسخ کور (گارد رد کرد)" };
  return { ok: true, text, note: "بینایی واقعی ✓" };
}

// ─── مسیر ۲: آداپتور /v1/messages (عین anthropicVisionCompletion) ───
async function probeAdapter(frames: string[]): Promise<{ ok: boolean; text: string; note: string }> {
  const blocks: unknown[] = [
    {
      type: "text",
      text: "کاربر ویدیو فرستاده است؛ فریم‌های بالا به ترتیب زمانی از شروع تا پایان حرکت‌اند. تحلیل فنی توالی را طبق دستور سیستم تولید کن.",
    },
    ...frames.map((url) => {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url)!;
      return { type: "image", source: { type: "base64", media_type: m[1] || "image/jpeg", data: m[3] } };
    }),
  ];
  const res = await fetch(`${BASE_URL.replace("/v1", "")}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: Math.max(4096, 1200),
      system: CHAT_MEDIA_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: blocks }],
    }),
    signal: AbortSignal.timeout(165_000),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, text: t.slice(0, 300), note: `HTTP ${res.status}` };
  }
  const json: any = await res.json();
  const parts: any[] = json?.content || [];
  const text: string = parts
    .filter((p) => p?.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text.trim()) return { ok: false, text: JSON.stringify(json).slice(0, 300), note: "پاسخ خالی" };
  if (rejectBlindMediaResponse(text)) return { ok: false, text, note: "پاسخ کور (گارد رد کرد)" };
  return { ok: true, text, note: "بینایی واقعی ✓" };
}

async function main() {
  const videoPath = join(process.cwd(), "uploads/videos/video-cmtyioxz50000onkyey62ckte-1789225940629-u70wuc.mp4");
  console.log("═".repeat(70));
  console.log(`پرب زندهٔ ویژن — مدل: ${VISION_MODEL}`);
  console.log(`ویدیو: ${videoPath}`);
  console.log("═".repeat(70));

  const frames = extractFrames(videoPath, 5);
  console.log(`\n✅ ${frames.length} فریم استخراج شد (نمونه: ${frames[0].slice(0, 60)}...)`);
  writeFileSync("probe-frames-meta.txt", frames.map((f) => f.length).join(", "));

  console.log("\n─── مسیر ۱: chat/completions بومی (image_url) ───");
  let r1: { ok: boolean; text: string; note: string };
  try {
    r1 = await probeNative(frames);
  } catch (e: any) {
    r1 = { ok: false, text: String(e?.message || e).slice(0, 300), note: "خطا/تایم‌اوت" };
  }
  console.log(`نتیجه: ${r1.ok ? "✅ موفق" : "❌ شکست"} — ${r1.note}`);
  console.log(`متن: ${r1.text.slice(0, 600) || "(خالی)"}`);

  console.log("\n─── مسیر ۲: آداپتور /v1/messages (image/base64) ───");
  let r2: { ok: boolean; text: string; note: string };
  try {
    r2 = await probeAdapter(frames);
  } catch (e: any) {
    r2 = { ok: false, text: String(e?.message || e).slice(0, 300), note: "خطا/تایم‌اوت" };
  }
  console.log(`نتیجه: ${r2.ok ? "✅ موفق" : "❌ شکست"} — ${r2.note}`);
  console.log(`متن: ${r2.text.slice(0, 600) || "(خالی)"}`);

  console.log("\n" + "═".repeat(70));
  console.log("جمع‌بندی:");
  console.log(`  مسیر بومی chat/completions : ${r1.ok ? "✅ می‌بیند" : "❌ کور/شکست"}`);
  console.log(`  مسیر آداپتور /v1/messages  : ${r2.ok ? "✅ می‌بیند" : "❌ کور/شکست"}`);
  if (r1.ok || r2.ok) {
    console.log(`\n🏆 نتیجه: deepseek-v4.1-flash ویژن واقعی دارد (${r1.ok ? "بومی" : "آداپتور"}) — فال‌بک gemini لازم نیست.`);
    console.log("   دومیسرهٔ موجود در ai.ts دقیقاً همین را اتومات پوشش می‌دهد.");
  } else {
    console.log(`\n⚠️ نتیجه: deepseek ویژن ندارد → باید VISION_MODEL = ${FALLBACK_VISION_MODEL} شود (دیرکتیو مالک).`);
  }
  console.log("═".repeat(70));
}

main().catch((e) => {
  console.error("پرب شکست خورد:", e);
  process.exit(1);
});
