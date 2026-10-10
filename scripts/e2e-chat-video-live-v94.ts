/**
 * E2E v94 — آزمون زندهٔ کامل ویدیو در «چت با فیتاپ» با deepseek-v4.1-flash
 * (دیرکتیو مالک: «در چت با فیتاپ ویدیو بفرستی و ببینی تحلیل می‌کند یا نه و
 *  جوابی که می‌دهد مناسب است یا نه»)
 *
 * زنجیره: چانک‌آپلود → سرهم‌سازی → POST چت → استخراج فریم → تحلیل بینایی (آداپتور
 * اول — v94) → تزریق به دیپ‌سیک متن → پاسخ نهایی → ممیزی DB + سهمیه
 *
 * اجرا: bun scripts/e2e-chat-video-live-v94.ts
 */
import { scryptSync } from "crypto";
import { readFileSync, existsSync } from "fs";

const SECRET = (() => {
  const env = readFileSync(".env", "utf-8");
  const m = env.match(/^SESSION_SECRET=(.+)$/m);
  return m ? m[1].trim() : "";
})();
const USER_ID = "cmtwa9lce002j2blon7u3rzcr"; // حسین جوان — ultimate (دیتابیس واقعی ۲۰۲۶-۰۹-۱۲)
const BASE = "http://localhost:3000";

const payload = Buffer.from(JSON.stringify({ uid: USER_ID, t: Date.now() })).toString("base64url");
const sig = scryptSync(payload, SECRET, 32).toString("hex");
const COOKIE = `sc_session=${payload}.${sig}`;

function step(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ─── ۱) ساخت ویدیوی «اسکوات‌مانند» — مستطیل تیره که پایین/بالا می‌رود (مثل فرم اسکوات) ───
step("۱) ساخت ویدیوی تستی اسکوات‌مانند");
const videoPath = "/tmp/fitup-e2e-squat-v94.mp4";
const dur = 12;
// پس‌زمینه روشن + مستطیل عمودی که y آن با سینوس نوسان می‌کند (فرورفتن/برگشتن) + خط زمین ثابت
const vf =
  "drawbox=x=0:y=ih-40:w=iw:h=40:color=gray@0.6:t=fill," +
  "drawbox=x=290:y='120+140*abs(sin(2*PI*t/3))':w=60:h='200-140*abs(sin(2*PI*t/3))':color=black:t=fill";
Bun.spawnSync(
  ["ffmpeg", "-y", "-f", "lavfi", "-i", `color=c=white:s=640x480:rate=30:duration=${dur}`, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", videoPath],
  { stdout: "ignore", stderr: "ignore" }
);
if (!existsSync(videoPath)) throw new Error("ساخت ویدیو شکست خورد");
const videoBuf = readFileSync(videoPath);
console.log(`ویدیو ساخته شد: ${(videoBuf.length / 1024).toFixed(0)}KB — مستطیل عمودی با نوسان پایین/بالا (شبیه فرورفتن اسکوات)`);

// ─── سهمیهٔ قبل ───
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const quotaBefore = await db.quotaUsage.findFirst({ where: { userId: USER_ID, category: "movement_video" } });
console.log(`سهمیهٔ ویدیو قبل: ${JSON.stringify(quotaBefore)}`);

// ─── ۲) آپلود چانکی ───
step("۲) آپلود چانکی");
const uploadId = `up${Date.now().toString(36)}e2ev94`;
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
  console.log(`چانک ${i + 1}/${totalChunks} ✓`);
}

// ─── ۳) سرهم‌سازی ───
step("۳) upload-complete");
const completeRes = await fetch(`${BASE}/api/coach/upload-complete`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    uploadId,
    target: "chat",
    fileName: "squat-form-v94.mp4",
    fileType: "video/mp4",
    size: videoBuf.length,
    totalChunks,
  }),
});
const completeData = await completeRes.json();
if (!completeRes.ok) throw new Error(`سرهم‌سازی شکست: ${JSON.stringify(completeData)}`);
console.log("mediaUrl:", completeData.mediaUrl);

// ─── ۴) POST چت با ویدیو ───
step("۴) POST چت (ویدیو + متن)");
const clientId = `temp_${Date.now()}_e2ev94`;
const chatRes = await fetch(`${BASE}/api/coach/chat`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "ویدیوی اسکواتم را تحلیل کن — فرمم درست است؟ (تست v94)",
    clientId,
    videoUrl: completeData.mediaUrl,
  }),
});
const chatData = await chatRes.json();
if (!chatRes.ok) throw new Error(`POST چت شکست: ${JSON.stringify(chatData)}`);
console.log("pending:", chatData.pending, "| placeholder:", chatData.aiMessage?.id);
const placeholderId = chatData.aiMessage?.id;

// ─── ۵) پول تا تکمیل ───
step("۵) پول نتیجه (حداکثر ۵ دقیقه)");
const deadline = Date.now() + 5 * 60 * 1000;
let finalAi: string | null = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000));
  const get = await fetch(`${BASE}/api/coach/chat`, { headers: { Cookie: COOKIE }, cache: "no-store" });
  const data = await get.json();
  const target = (data.messages || []).find((m: any) => m.id === placeholderId);
  if (target && target.content && target.content.trim().length > 0) {
    finalAi = target.content;
    break;
  }
  console.log("... هنوز در حال تحلیل");
}
if (!finalAi) throw new Error("پاسخ در ۵ دقیقه نیامد!");
console.log("\nپاسخ نهایی مربی:\n", finalAi.slice(0, 700));

// ─── ۶) ممیزی DB + سهمیهٔ بعد ───
step("۶) ممیزی DB + سهمیه");
const row = await db.chatMessage.findFirst({ where: { clientId } });
const frames = row?.mediaFrames ? (JSON.parse(row.mediaFrames) as string[]) : [];
console.log("تعداد فریم ذخیره‌شده:", frames.length);
console.log("تحلیل بینایی کش‌شده:", row?.mediaAnalysis ? `بله (${row.mediaAnalysis.length} نویسه)` : "خیر!");
if (row?.mediaAnalysis) console.log("\nمتن تحلیل بینایی:\n", row.mediaAnalysis.slice(0, 500));
const quotaAfter = await db.quotaUsage.findFirst({ where: { userId: USER_ID, category: "movement_video" } });
console.log("\nسهمیهٔ ویدیو قبل/بعد:", quotaBefore, "→", quotaAfter);

// ─── قضاوت نهایی ───
console.log("\n" + "═".repeat(60));
console.log("قضاوت v94:");
const blindPatterns = /(ویدیویی به من نرسید|هیچ ویدیویی|ارسال نشده|پیوست نشده|نرسیده‌اند|نمی‌توانم ببینم|دسترسی ندارم|به من نرسید)/;
const looksBlind = blindPatterns.test(finalAi || "") || blindPatterns.test(row?.mediaAnalysis || "");
console.log(looksBlind ? "❌ پاسخ نشانهٔ کوری است" : "✅ هیچ ادعای کوری در تحلیل/پاسخ نیست");
const describesMotion = /(مستطیل|شکل|حرکت|پایین|بالا|نوسان|فرورفتن|اسکوات|زوایه|دامنه|فرم)/i.test(row?.mediaAnalysis || "");
console.log(describesMotion ? "✅ تحلیل بینایی محتوای واقعی ویدیو را توصیف کرده" : "⚠️ تحلیل محتوای ویدیو را توصیف نکرد — بررسی دستی لازم");
const quotaDelta = (quotaAfter?.count ?? 0) - (quotaBefore?.count ?? 0);
console.log(row?.mediaAnalysis && frames.length > 0 ? "✅ فریم + تحلیل در DB ثبت شد" : "❌ فریم/تحلیل در DB ثبت نشد");
console.log(quotaDelta === 1 ? "✅ سهمیه دقیقاً ۱ واحد بعد از تحلیل موفق کم شد" : `⚠️ تغییر سهمیه: ${quotaDelta}`);

await db.$disconnect();
