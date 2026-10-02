/**
 * پرب ایزولهٔ مسیر بومی — آیا chat/completions با ۱ فریم کوچک هم کور است؟
 * اجرا: bun scripts/probe-native-isolated.ts
 */
import { readFileSync } from "fs";
import { config } from "dotenv";

config();

const API_KEY = process.env.AVALAI_API_KEY || "";
const BASE_URL = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
const VISION_MODEL = process.env.AVALAI_VISION_MODEL || "deepseek-v4.1-flash";

async function nativeProbe(dataUrl: string, label: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "این تصویر دقیقاً چیست؟ در یک جمله بگو." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json: any = res.ok ? await res.json() : await res.text();
  const text: string =
    typeof json === "string" ? json : json?.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 200);
  console.log(`[${label}] پاسخ: ${text.slice(0, 250) || "(خالی)"}`);
}

async function main() {
  // ۱) فریم کوچک واقعی (نوار رنگی SMPTE) — ۶۴۰px
  const bars = `data:image/jpeg;base64,${readFileSync("/tmp/vcheck/frame1.jpg").toString("base64")}`;
  console.log(`فریم ۱ حجم base64: ${Math.round(bars.length / 1024)}KB`);
  await nativeProbe(bars, "۱ فریم ۴۲KB نوار رنگی");

  // ۲) عکس چت واقعی موجود در uploads (webp)
  const p = "uploads/chat/chat-image-1789147687653-3y92dh.webp";
  try {
    const img = `data:image/webp;base64,${readFileSync(p).toString("base64")}`;
    console.log(`\nعکس چت حجم base64: ${Math.round(img.length / 1024)}KB`);
    await nativeProbe(img, "۱ عکس چت webp");
  } catch (e: any) {
    console.log("عکس چت خوانده نشد:", e.message);
  }
}

main().catch((e) => {
  console.error("ERR:", e?.message || e);
  process.exit(1);
});
