/**
 * E2E v90 — زنجیرهٔ کامل روی ویدیوی ۹۵ مگابایتی: POST چت → استخراج فریم →
 * تحلیل بینایی → پاسخ AI — اندازه‌گیری زمان هر مرحله (ممیزی «فریم به AI نمی‌رسد»)
 */
import { scryptSync } from "crypto";
import { readFileSync } from "fs";

import { Database } from "bun:sqlite";

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

const mediaUrl = process.argv[2];
if (!mediaUrl) throw new Error("usage: bun e2e-big-chat-v90.ts <mediaUrl>");

const t0 = Date.now();
const clientId = `temp_${Date.now()}_big90`;
const chatRes = await fetch(`${BASE}/api/coach/chat`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "فرم اجرای حرکتم را تحلیل کن (تست ۹۵ مگابایتی v90)",
    clientId,
    videoUrl: mediaUrl,
  }),
});
const chatData = await chatRes.json();
if (!chatRes.ok) throw new Error("POST چت شکست: " + JSON.stringify(chatData));
console.log(`POST چت ✓ (${Date.now() - t0}ms) — pending:`, chatData.pending);
const placeholderId = chatData.aiMessage.id;

const deadline = Date.now() + 8 * 60 * 1000;
let finalAi = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000));
  const get = await fetch(`${BASE}/api/coach/chat`, { headers: { Cookie: COOKIE }, cache: "no-store" });
  const data = await get.json();
  const target = (data.messages || []).find((m) => m.id === placeholderId);
  if (target?.content?.trim()) {
    finalAi = target.content;
    break;
  }
  console.log(`  ... ${((Date.now() - t0) / 1000).toFixed(0)}s از شروع`);
}
if (!finalAi) throw new Error("پاسخ در ۸ دقیقه نیامد!");
console.log(`پاسخ رسید در ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("پاسخ مربی (سربرگ):", finalAi.slice(0, 350).replace(/\n/g, " | "));

const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const row = db.query("SELECT mediaFrames, mediaAnalysis FROM ChatMessage WHERE clientId = ?").get(clientId);
const frames = row?.mediaFrames ? JSON.parse(row.mediaFrames) : [];
console.log("\nممیزی DB: فریم‌ها =", frames.length, "| تحلیل بینایی =", row?.mediaAnalysis ? `بله (${row.mediaAnalysis.length} نویسه)` : "خیر");
const bad = /(پرونده.*ارسال|هیچ ویدیویی|ویدیویی ارسال نشده|به دستم نرسید)/.test(finalAi);
console.log(bad ? "❌ AI ویدیو را ندید" : "✅ AI بر اساس ویدیو پاسخ داد");
