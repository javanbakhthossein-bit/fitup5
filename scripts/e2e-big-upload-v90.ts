/**
 * E2E v90 — آپلود چانکی فایل ۹۵ مگابایتی (شبیه‌سازی دقیق باگ ۸۶MB مالک)
 * فقط آپلود + سرهم‌سازی + اعتبارسنجی ffprobe (بدون تحلیل AI برای صرفهٔ هزینه)
 */
import { scryptSync } from "crypto";
import { readFileSync, existsSync } from "fs";

const SECRET = (() => { // سکرت فقط از .env خوانده می‌شود — هرگز در کد/زیپ جاسازی نمی‌شود
  const env = readFileSync(".env", "utf-8");
  const m = env.match(/^SESSION_SECRET=(.+)$/m);
  return m ? m[1].trim() : "";
})();
const USER_ID = "cmtziv0780002kuc3sp76qkrp";
const BASE = "http://localhost:3000";

const payload = Buffer.from(JSON.stringify({ uid: USER_ID, t: Date.now() })).toString("base64url");
const sig = scryptSync(payload, SECRET, 32).toString("hex");
const COOKIE = `sc_session=${payload}.${sig}`;

const videoBuf = readFileSync("/tmp/fitup-e2e-big.mp4");
console.log(`ویدیوی بزرگ: ${(videoBuf.length / 1024 / 1024).toFixed(1)}MB`);

const uploadId = `up${Date.now().toString(36)}bigtest`;
const CHUNK = 4 * 1024 * 1024; // دقیقاً مثل کلاینت v90
const totalChunks = Math.ceil(videoBuf.length / CHUNK);
console.log(`تعداد چانک: ${totalChunks} (هر کدام ۴ مگابایت)`);

const t0 = Date.now();
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
  if (!res.ok) {
    console.log(`چانک ${i} شکست:`, res.status, await res.text());
    process.exit(1);
  }
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${totalChunks} چانک ✓ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`همهٔ چانک‌ها ارسال شد در ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const completeRes = await fetch(`${BASE}/api/coach/upload-complete`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    uploadId,
    target: "chat",
    fileName: "big-workout.mp4",
    fileType: "video/mp4",
    size: videoBuf.length,
    totalChunks,
  }),
});
const data = await completeRes.json();
if (!completeRes.ok) throw new Error("سرهم‌سازی شکست: " + JSON.stringify(data));
console.log("mediaUrl:", data.mediaUrl, "| size:", data.size);

// اعتبارسنجی فایل نهایی — قابل پخش؟
const { execSync } = await import("child_process");
const abs = "/home/z/my-project" + data.mediaUrl;
const dur = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${abs}"`).toString().trim();
const size = execSync(`stat -c %s "${abs}"`).toString().trim();
console.log("اعتبارسنجی ffprobe: مدت =", dur, "ثانیه | حجم =", (Number(size) / 1024 / 1024).toFixed(1), "MB");
console.log("چانک‌ها پاک شدند:", !existsSync(`/home/z/my-project/uploads/chat/.chunks/${uploadId}`));
console.log("کامل:", Number(size) === videoBuf.length ? "✅ حجم دقیق" : "❌ حجم مغایرت دارد");
