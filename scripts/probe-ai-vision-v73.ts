/**
 * v73b — پروب فرمت‌های ارسال تصویر به deepseek-v4.1-flash روی AvalAI
 * هدف: پیدا کردن فرمتی که ویژن واقعاً کار می‌کند (data URL رد شد — T3).
 * پروب‌ها:
 *   P1 — remote URL در chat/completions (image_url.http)
 *   P2 — /v1/messages (فرمت Anthropic) با source.base64
 *   P3 — /v1/messages با source.url (لینک http)
 *   P4 — chat/completions با بلاک type:"image" (فرمت مستند AvalAI برخی مدل‌ها)
 * هزینهٔ هر پروب: ناچیز (max_tokens=200، عکس 45KB)
 */
import { readFileSync } from "fs";

const BASE = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
const KEY = process.env.AVALAI_API_KEY || "";
const MODEL = "deepseek-v4.1-flash";
const IMG_PATH = process.argv[2] || "upload/IMG_20260907_003540_799.jpg";

const buf = readFileSync(IMG_PATH);
const b64 = buf.toString("base64");
const dataUrl = `data:image/jpeg;base64,${b64}`;
// عکس عمومی معروف برای پروب URL (گرگ/حیوان قابل‌توصیف — تست کلاسیک ویژن)
const REMOTE_URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Collage_of_Nine_Dogs.jpg/640px-Collage_of_Nine_Dogs.jpg";

const PROMPT = "در یک جملهٔ فارسی بگو در این تصویر چه می‌بینی. اگر تصویری نمی‌بینی صریح بگو «تصویری نمی‌بینم».";

async function probe(name: string, url: string, body: unknown): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    const text = await res.text();
    if (!res.ok) {
      console.log(`❌ ${name} — HTTP ${res.status} (${ms}s): ${text.slice(0, 180).replace(/\s+/g, " ")}`);
      return;
    }
    const json = JSON.parse(text);
    // chat/completions یا messages — هر دو پشتیبانی شود
    const content =
      json?.choices?.[0]?.message?.content ??
      (Array.isArray(json?.content) ? json.content.map((c: any) => c?.text ?? "").join(" ") : json?.content) ??
      "";
    const c = typeof content === "string" ? content : JSON.stringify(content);
    const blind = /(تصویری نمی|نمی[-‌ ]?توانم.*ببینم|دسترسی.*(ندارم|نمی)|no image|cannot see)/i.test(c);
    console.log(`${blind ? "⚠️" : "✅"} ${name} (${ms}s): ${c.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (e: any) {
    console.log(`❌ ${name} — EXC: ${String(e?.message || e).slice(0, 140)}`);
  }
}

async function main() {
  console.log(`🔬 پروب ویژن — ${MODEL} (عکس: ${IMG_PATH} ${Math.round(buf.length / 1024)}KB)\n`);

  await probe("P1 chat/completions + remote URL", `${BASE}/chat/completions`, {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: REMOTE_URL } },
        ],
      },
    ],
    max_tokens: 200,
    reasoning_effort: "low",
  });

  await probe("P2 v1/messages + base64", `${BASE}/messages`, {
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  await probe("P3 v1/messages + url", `${BASE}/messages`, {
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: REMOTE_URL } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  await probe("P4 chat/completions + type:image b64", `${BASE}/chat/completions`, {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        ],
      },
    ],
    max_tokens: 200,
    reasoning_effort: "low",
  });

  await probe("P5 chat/completions + data URL دوباره (کنترل)", `${BASE}/chat/completions`, {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 200,
    reasoning_effort: "low",
  });
}

main();
