/**
 * v73 — تست زندهٔ مهاجرت به deepseek-v4.1-flash روی AvalAI
 *
 * دیریکتیو مالک: «کل سیستم با دیپ‌سیک جدید بره جلو؛ تولید برنامه تفکر مکس،
 * بقیه low. باید تست کنی که تصویر و قسمت ویدیو رو درست تحلیل کنه.»
 *
 * پوشش تست:
 *   T1 — متن ساده با reasoning_effort=low (مسیر چت/نیکا/تحلیل‌ها)
 *   T2 — پذیرش reasoning_effort=max (مسیر تولید برنامه)
 *   T3 — ویژن: تحلیل عکس واقعی (data URL base64) — مسیر عکس غذا/بدن/چت
 *   T4 — شبیه‌سازی تولید برنامه: max_tokens=65536 + تفکر مکس + خروجی JSON
 *   T5 — پروب مقادیر مجاز reasoning_effort (اگر max رد شد → high)
 *
 * اجرا:  bun scripts/test-real-ai-v73.ts
 * هزینه: ناچیز (~< $0.01 — توکن‌های کوتاه، عکس کم‌حجم)
 */
import { readFileSync } from "fs";

const BASE = process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1";
const KEY = process.env.AVALAI_API_KEY || "";
const MODEL = "deepseek-v4.1-flash";

if (!KEY || KEY === "your_key") {
  console.error("❌ AVALAI_API_KEY در .env نیست — تست زنده ممکن نیست.");
  process.exit(1);
}

interface TCase {
  name: string;
  body: Record<string, unknown>;
  check: (r: any) => string | null; // null = OK، رشته = توضیح شکست
}

const IMAGE_PATH = process.argv[2] || "upload/IMG_20260907_003540_799.jpg";
const results: { name: string; ok: boolean; detail: string; ms: number }[] = [];

function b64Image(path: string): { url: string; kb: number } {
  const buf = readFileSync(path);
  const ext = path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return {
    url: `data:image/${ext};base64,${buf.toString("base64")}`,
    kb: Math.round(buf.length / 1024),
  };
}

async function runCase(tc: TCase, timeoutMs = 150_000): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ model: MODEL, ...tc.body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      results.push({
        name: tc.name,
        ok: false,
        detail: `HTTP ${res.status} — ${text.slice(0, 220).replace(/\s+/g, " ")}`,
        ms,
      });
      return;
    }
    const json = JSON.parse(text);
    const choice = json?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const usage = json?.usage || {};
    const fail = tc.check({ ...json, content, choice, usage });
    results.push({
      name: tc.name,
      ok: !fail,
      detail: fail
        ? fail
        : `✓ finish=${choice?.finish_reason} | in=${usage.prompt_tokens} out=${usage.completion_tokens} tok | ${content.slice(0, 140).replace(/\s+/g, " ")}`,
      ms,
    });
  } catch (e: any) {
    const ms = Date.now() - t0;
    results.push({ name: tc.name, ok: false, detail: `EXC: ${String(e?.message || e).slice(0, 180)}`, ms });
  }
}

async function main() {
  console.log(`🧪 تست زندهٔ v73 — مدل: ${MODEL} @ ${BASE}\n`);

  // ─── T1: متن + تفکر low (مسیر چت/تحلیل‌ها) ───
  await runCase({
    name: "T1 متن+low",
    body: {
      messages: [
        { role: "system", content: "تو مربی فیتاپ هستی. فقط فارسی جواب بده." },
        { role: "user", content: "در یک جمله: فایدهٔ اسکوات؟" },
      ],
      max_tokens: 512,
      reasoning_effort: "low",
    },
    check: (r) => (r.content.trim() ? null : "محتوای خالی"),
  });

  // ─── T2: پذیرش تفکر max (مسیر تولید برنامه) ───
  await runCase({
    name: "T2 متن+max",
    body: {
      messages: [
        { role: "user", content: "فقط بنویس: «تفکر مکس فعال است» و یکی از تمرین‌های پا را نام ببر." },
      ],
      max_tokens: 2048,
      reasoning_effort: "max",
    },
    check: (r) => (r.content.trim() ? null : "محتوای خالی (احتمالاً بودجه توسط reasoning خورده شد)"),
  }, 200_000);

  // ─── T3: ویژن — تحلیل عکس واقعی (مسیر عکس غذا/بدن/فریم ویدیو) ───
  let img: { url: string; kb: number } | null = null;
  try {
    img = b64Image(IMAGE_PATH);
  } catch {
    console.warn(`⚠️ عکس تست پیدا نشد (${IMAGE_PATH}) — T3 رد شد.`);
    results.push({ name: "T3 ویژن+low", ok: false, detail: `فایل ${IMAGE_PATH} نبود`, ms: 0 });
  }
  if (img) {
    console.log(`   (عکس تست: ${IMAGE_PATH} — ${img.kb}KB)`);
    await runCase({
      name: "T3 ویژن+low",
      body: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "این تصویر را در ۲ جملهٔ فارسی توصیف کن. اگر غذا/بدن/محیط ورزشی است بگو چه می‌بینی." },
              { type: "image_url", image_url: { url: img.url } },
            ],
          },
        ],
        max_tokens: 1024,
        reasoning_effort: "low",
      },
      check: (r) => {
        if (!r.content.trim()) return "محتوای خالی — ویژن کار نکرد";
        if (/(نمی[-‌ ]?توانم|دسترسی ندارم|تصویری دریافت|image.*not)/i.test(r.content) && r.content.length < 200)
          return `مدل مدعی بی‌دسترسی به تصویر: ${r.content.slice(0, 100)}`;
        return null;
      },
    }, 180_000);
  }

  // ─── T4: شبیه‌سازی تولید برنامه — max_tokens=65536 + تفکر مکس + JSON ───
  await runCase({
    name: "T4 برنامه‌سازی+max+JSON",
    body: {
      messages: [
        {
          role: "system",
          content: "تو مولد برنامهٔ تمرینی فیتاپ هستی. فقط و فقط JSON معتبر برگردان — بدون هیچ متن اضافه.",
        },
        {
          role: "user",
          content:
            'برای یک روز تمرینیِ پا (مبتدی، بدون تجهیزات) خروجی JSON با این شکل بده: {"dayTitle": "…", "exercises": [{"name": "…", "sets": 3, "reps": "10-12", "restSec": 60}]} — حداقل ۴ حرکت.',
        },
      ],
      max_tokens: 65536,
      reasoning_effort: "max",
      temperature: 0.7,
    },
    check: (r) => {
      if (!r.content.trim()) {
        const cd = r.usage?.completion_tokens_details || {};
        return `خالی — finish=${r.choice?.finish_reason} reasoning=${cd.reasoning_tokens}`;
      }
      const s = r.content.indexOf("{");
      const e = r.content.lastIndexOf("}");
      if (s === -1 || e === -1) return "JSON پیدا نشد در پاسخ";
      try {
        const parsed = JSON.parse(r.content.slice(s, e + 1));
        if (!parsed?.exercises?.length) return "JSON بدون exercises";
        return null;
      } catch (err: any) {
        return `JSON نامعتبر: ${String(err?.message).slice(0, 80)}`;
      }
    },
  }, 240_000);

  // ─── T5: پروب مقادیر reasoning_effort — پذیرش high (برای گزارش مالک) ───
  await runCase({
    name: "T5 پروب high",
    body: {
      messages: [{ role: "user", content: "سلام" }],
      max_tokens: 256,
      reasoning_effort: "high",
    },
    check: (r) => (r.content.trim() ? null : "خالی"),
  }, 120_000);

  // ─── گزارش ───
  console.log("\n══════════ نتیجهٔ تست‌ها ══════════");
  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.name}  (${(r.ms / 1000).toFixed(1)}s)`);
    console.log(`   ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  console.log(allOk ? "\n🎉 همهٔ تست‌های زندهٔ v73 سبز — مهاجرت تأیید شد." : "\n⚠️ حداقل یک تست قرمز — به گزارش مراجعه شود.");
  process.exit(allOk ? 0 : 2);
}

main();
