/**
 * E2E ممیزی v90 — آزمون کامل زنجیرهٔ ویدیوی چت با فیتاپ:
 *   چانک‌آپلود → سرهم‌سازی → POST چت → استخراج فریم (fps) → تحلیل بینایی
 *   → تزریق گزارش به دیپ‌سیک → پاسخ نهایی
 * خروجی: گزارش مرحله‌به‌مرحله + قضاوت نهایی «آیا AI ویدیو را دید؟»
 */
import { scryptSync } from "crypto";
import { readFileSync } from "fs";

const SECRET = (() => { // سکرت فقط از .env خوانده می‌شود — هرگز در کد/زیپ جاسازی نمی‌شود
  const env = readFileSync(".env", "utf-8");
  const m = env.match(/^SESSION_SECRET=(.+)$/m);
  return m ? m[1].trim() : "";
})();
const USER_ID = "cmtziv0780002kuc3sp76qkrp"; // کاربر حرفه‌ای تست (ultimate)
const BASE = "http://localhost:3000";

const payload = Buffer.from(JSON.stringify({ uid: USER_ID, t: Date.now() })).toString("base64url");
const sig = scryptSync(payload, SECRET, 32).toString("hex");
const COOKIE = `sc_session=${payload}.${sig}`;

function step(name) {
  console.log(`\n=== ${name} ===`);
}

// ─── ۱) ساخت ویدیوی تستی ~۲۰ ثانیه با فریم‌های واقعی (testsrc2 با حرکت) ───
step("۱) ساخت ویدیوی تستی");
const videoPath = "/tmp/fitup-e2e-test.mp4";
const dur = 20;
Bun.spawnSync(["ffmpeg", "-y", "-f", "lavfi", "-i", `testsrc2=size=640x480:rate=30:duration=${dur}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", videoPath], { stdout: "ignore", stderr: "ignore" });
const videoBuf = readFileSync(videoPath);
console.log(`ویدیو ساخته شد: ${(videoBuf.length / 1024 / 1024).toFixed(2)}MB`);

// ─── ۲) آپلود چانکی (شبیه‌سازی دقیق کلاینت v90 — چانک ۲ مگابایتی) ───
step("۲) آپلود چانکی");
const uploadId = `up${Date.now().toString(36)}e2etest1`;
const CHUNK = 2 * 1024 * 1024;
const totalChunks = Math.ceil(videoBuf.length / CHUNK);
for (let i = 0; i < totalChunks; i++) {
  const chunk = videoBuf.subarray(i * CHUNK, Math.min(videoBuf.length, (i + 1) * CHUNK));
  const res = await fetch(`${BASE}/api/coach/upload-chunk`, {
    method: "POST",
    headers: {
      Cookie: COOKIE,
      "Content-Type": "application/octet-stream",
      "x-upload-id": uploadId,
      "x-upload-target": "chat",
      "x-chunk-index": String(i),
    },
    body: chunk,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`چانک ${i} شکست: ${JSON.stringify(j)}`);
  console.log(`چانک ${i + 1}/${totalChunks} ✓ (${(chunk.length / 1024 / 1024).toFixed(1)}MB)`);
}

// ─── ۳) سرهم‌سازی ───
step("۳) upload-complete");
const completeRes = await fetch(`${BASE}/api/coach/upload-complete`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    uploadId,
    target: "chat",
    fileName: "workout-form.mp4",
    fileType: "video/mp4",
    size: videoBuf.length,
    totalChunks,
  }),
});
const completeData = await completeRes.json();
if (!completeRes.ok) throw new Error(`سرهم‌سازی شکست: ${JSON.stringify(completeData)}`);
console.log("mediaUrl:", completeData.mediaUrl, "size:", completeData.size);

// بررسی پاک‌سازی چانک‌ها
const { existsSync, readdirSync } = await import("fs");
const chunksDir = "/home/z/my-project/uploads/chat/.chunks";
console.log("چانک‌ها پاک شدند:", !existsSync(`${chunksDir}/${uploadId}`));

// ─── ۴) POST چت با videoUrl ───
step("۴) POST چت (ویدیو + متن)");
const clientId = `temp_${Date.now()}_e2e90`;
const chatRes = await fetch(`${BASE}/api/coach/chat`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "فرم اجرای حرکتم را تحلیل کن (ویدیوی تستی e2e v90)",
    clientId,
    videoUrl: completeData.mediaUrl,
  }),
});
const chatData = await chatRes.json();
if (!chatRes.ok) throw new Error(`POST چت شکست: ${JSON.stringify(chatData)}`);
console.log("pending:", chatData.pending, "| userMsg:", chatData.userMessage?.id, "| placeholder:", chatData.aiMessage?.id);
const placeholderId = chatData.aiMessage?.id;

// ─── ۵) پول تا تکمیل تحلیل ───
step("۵) پول نتیجه (حداکثر ۵ دقیقه)");
const deadline = Date.now() + 5 * 60 * 1000;
let finalAi = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000));
  const get = await fetch(`${BASE}/api/coach/chat`, { headers: { Cookie: COOKIE }, cache: "no-store" });
  const data = await get.json();
  const target = (data.messages || []).find((m) => m.id === placeholderId);
  if (target && target.content && target.content.trim().length > 0) {
    finalAi = target.content;
    break;
  }
  console.log("... هنوز در حال تحلیل");
}
if (!finalAi) throw new Error("پاسخ در ۵ دقیقه نیامد!");
console.log("\nپاسخ نهایی مربی:\n", finalAi.slice(0, 600));

// ─── ۶) ممیزی DB — فریم/تحلیل ثبت شده؟ ───
step("۶) ممیزی DB");
const { Database } = await import("bun:sqlite");
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const row = db.query("SELECT mediaFrames, mediaAnalysis, content FROM ChatMessage WHERE clientId = ?").get(clientId);
if (!row) throw new Error("ردیف پیام کاربر پیدا نشد!");
const frames = row.mediaFrames ? JSON.parse(row.mediaFrames) : [];
console.log("تعداد فریم ذخیره‌شده:", frames.length);
console.log("تحلیل بینایی کش‌شده:", row.mediaAnalysis ? `بله (${row.mediaAnalysis.length} نویسه)` : "خیر!");
if (row.mediaAnalysis) console.log("متن تحلیل:", row.mediaAnalysis.slice(0, 300));

// قضاوت نهایی
const bad = /(پرونده.*ارسال|هیچ ویدیویی|ویدیویی ارسال نشده|به دستم نرسید|نمی‌توانم ببینم|دسترسی ندارم)/.test(finalAi);
console.log("\n═══════ قضاوت ═══════");
console.log(bad ? "❌ پاسخ AI نشانهٔ ندیدن ویدیوست" : "✅ پاسخ AI سالم است (ویدیو دیده شده)");
console.log(frames.length > 0 && row.mediaAnalysis ? "✅ فریم + تحلیل در DB ثبت شد" : "❌ فریم/تحلیل در DB ثبت نشد");
