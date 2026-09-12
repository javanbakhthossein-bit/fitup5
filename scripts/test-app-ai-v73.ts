/**
 * v73c — تست یکپارچه از راه کلاینت واقعی برنامه (Proxy + آداپتور ویژن)
 * اجرا: bun scripts/test-app-ai-v73.ts
 * تأیید می‌کند:
 *   1) متن deepseek-v4.1-flash با reasoning_effort=low از chat/completions
 *   2) ویژن با VISION_MODEL از مسیر آداپتور /v1/messages (همان مسیر عکس غذا/بدن/فریم ویدیو)
 *   3) ویژن چند-فریمی (شبیه‌سازی فریم‌های ویدیو — دو تصویر در یک پیام)
 */
import { readFileSync } from "fs";

async function main() {
  const ai = await import("@/lib/fitness/ai");
  // ⚠️ باید از avalaiClient (Proxy) استفاده شود — همان مسیر production؛
  // getAvalaiClient کلاینت خامِ بدون Proxy/آداپتور است و فقط برای این Proxy ساخته می‌شود.
  const client = (ai as any).avalaiClient as import("openai").default;
  const img = readFileSync("upload/IMG_20260907_003540_799.jpg").toString("base64");
  const dataUrl = `data:image/jpeg;base64,${img}`;
  let ok = true;

  console.log("models → TEXT:", ai.TEXT_MODEL, "| VISION:", ai.VISION_MODEL, "| TASK:", ai.TEXT_TASK_MODEL, "| PLAN:", ai.PLAN_MODEL);

  // 1) متن low
  try {
    const t0 = Date.now();
    const r: any = await client.chat.completions.create({
      model: ai.TEXT_TASK_MODEL,
      messages: [{ role: "user", content: "فقط بنویس: «متن دیپ‌سیک سالم است»" }],
      max_tokens: 512,
      reasoning_effort: "low",
    } as any);
    const c = r?.choices?.[0]?.message?.content || "";
    console.log(`✅ 1) متن low (${((Date.now() - t0) / 1000).toFixed(1)}s):`, c.slice(0, 100).replace(/\s+/g, " "));
    if (!c.trim()) throw new Error("خالی");
  } catch (e: any) {
    ok = false;
    console.log("❌ 1) متن low:", String(e?.message || e).slice(0, 180));
  }

  // 2) ویژن تک‌عکس (مسیر آداپتور)
  try {
    const t0 = Date.now();
    const r: any = await client.chat.completions.create({
      model: ai.VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "این تصویر را در دو جملهٔ فارسی توصیف کن — چه اپ/سایتی و چه مرحله‌ای دیده می‌شود؟" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      reasoning_effort: "low",
    } as any);
    const c = r?.choices?.[0]?.message?.content || "";
    const usage = r?.usage || {};
    console.log(`✅ 2) ویژن تک‌عکس (${((Date.now() - t0) / 1000).toFixed(1)}s) usage=${usage.prompt_tokens}/${usage.completion_tokens}:`, c.slice(0, 160).replace(/\s+/g, " "));
    if (!c.trim() || /(هیچ تصویری|دسترسی ندارم|نمی‌توانم ببینم|فریمی دریافت)/i.test(c)) throw new Error("ویژن کور: " + c.slice(0, 80));
  } catch (e: any) {
    ok = false;
    console.log("❌ 2) ویژن تک‌عکس:", String(e?.message || e).slice(0, 220));
  }

  // 3) ویژن چند-فریمی (شبیه‌سازی تحلیل ویدیو — extractVideoFramesAsDataUrls)
  try {
    const t0 = Date.now();
    const r: any = await client.chat.completions.create({
      model: ai.VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "دو فریم از یک ویدیو به تو داده شده است. به فارسی بگو آیا هر دو فریم یک صحنه‌اند یا متفاوت." },
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      reasoning_effort: "low",
    } as any);
    const c = r?.choices?.[0]?.message?.content || "";
    console.log(`✅ 3) ویژن دو-فریم (${((Date.now() - t0) / 1000).toFixed(1)}s):`, c.slice(0, 160).replace(/\s+/g, " "));
    if (!c.trim()) throw new Error("خالی");
  } catch (e: any) {
    ok = false;
    console.log("❌ 3) ویژن دو-فریم:", String(e?.message || e).slice(0, 220));
  }

  console.log(ok ? "\n🎉 تست یکپارچهٔ کلاینت v73 سبز" : "\n⚠️ تست یکپارچه قرمز");
  process.exit(ok ? 0 : 2);
}

main();
