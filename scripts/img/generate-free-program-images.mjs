/**
 * v247 — تولید تصاویر «برنامه‌های بدنسازی رایگان» با مدل تصویرساز اختصاصی مالک
 * (AvalAI — gemini-3.1-flash-lite-image).
 *
 * قواعد دیرکتیو مالک:
 *  • همهٔ عکس‌ها یک نسبت تصویر یکسان (1376×768 — خروجی ثابت مدل با size=1344x768)
 *  • مردان → عکس مرد با هدف مخصوص مردها، زنان → عکس زن با هدف مخصوص زن‌ها
 *  • بدون حجاب، رئال، کیفیت بالا، تمیز — بدون متن و واترمارک
 *  • پالت رنگ برند فیتاپ: باشگاه تیره با نورپردازی گرم نارنجی
 *
 * اجرا: bun run scripts/img/generate-free-program-images.mjs
 */
import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.AVALAI_IMAGE_API_KEY || "aa-zNeavvOx0lBA6ZVtl8pmsLJbq8c8gAFNOLPuNRXgW6gowssI";
const MODEL = process.env.AVALAI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const OUT_DIR = path.resolve(process.cwd(), "public/free-programs");

const STYLE =
  "Ultra-realistic professional fitness photography, natural skin texture with visible sweat details, high resolution, " +
  "modern premium gym interior with dark charcoal walls and warm orange accent lighting, cinematic soft light, " +
  "shallow depth of field, wide 16:9 landscape composition, subject centered, clean uncluttered background, " +
  "absolutely no text, no letters, no logos, no watermark";

const HOME_STYLE =
  "Ultra-realistic professional lifestyle photography, natural skin texture, bright modern living room with large windows, " +
  "soft daylight, warm tones, high resolution, wide 16:9 landscape composition, subject centered, clean uncluttered space, " +
  "absolutely no text, no letters, no logos, no watermark";

const IMAGES = [
  {
    file: "hero.jpg",
    prompt:
      "A fit muscular young man holding a dumbbell next to an athletic slim young woman holding a dumbbell, both standing confidently side by side in a dark premium gym, wearing black sportswear, realistic athletic European physique, natural posture, warm orange rim light, " +
      STYLE,
  },
  {
    file: "goal-muscle-gain-male.jpg",
    prompt:
      "An athletic young man with a natural muscular build performing a barbell bench press on a flat bench in a premium dark gym, black sleeveless shirt, focused expression, loaded barbell, realistic proportions not exaggerated, warm orange lighting, " +
      STYLE,
  },
  {
    file: "goal-muscle-gain-female.jpg",
    prompt:
      "A fit athletic young woman with toned shoulders and arms performing a dumbbell shoulder press seated on a bench in a premium dark gym, wearing a black sports top and leggings, hair in a ponytail, focused expression, warm orange accent light, " +
      STYLE,
  },
  {
    file: "goal-fat-loss-male.jpg",
    prompt:
      "A lean athletic man swinging a kettlebell with perfect hip hinge form in a premium dark gym, black t-shirt and shorts, dynamic mid-motion shot, slight sweat glow, energetic atmosphere with warm orange backlight, " +
      STYLE,
  },
  {
    file: "goal-fat-loss-female.jpg",
    prompt:
      "A fit energetic young woman training with a kettlebell in a premium dark gym, wearing a modern black athletic outfit, athletic toned body, dynamic fat-burning workout motion, hair tied back, warm orange rim lighting, " +
      STYLE,
  },
  {
    file: "goal-glutes-male.jpg",
    prompt:
      "A strong athletic man performing a barbell Romanian deadlift focusing on hamstrings and glutes in a premium dark gym, black training outfit, perfect posterior chain form, side-angle shot, warm orange gym lighting, " +
      STYLE,
  },
  {
    file: "goal-glutes-female.jpg",
    prompt:
      "A fit young woman performing a barbell hip thrust on a bench in a premium dark gym, black athletic wear, glute-training focus, barbell with plates over hips, determined expression, side-angle shot, warm orange accent lighting, " +
      STYLE,
  },
  {
    file: "goal-home-male.jpg",
    prompt:
      "A fit young man doing push-ups on a workout mat in a bright modern living room at home, gray t-shirt and shorts, wooden floor, large window with daylight, clean minimal interior, " +
      HOME_STYLE,
  },
  {
    file: "goal-home-female.jpg",
    prompt:
      "A fit young woman doing a reverse lunge workout on a yoga mat in a bright modern living room at home, black leggings and a gray top, hair in a ponytail, wooden floor, large window with soft daylight, clean minimal interior, " +
      HOME_STYLE,
  },
];

async function generate({ file, prompt }, attempt = 1) {
  const res = await fetch("https://api.avalai.ir/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, prompt, n: 1, size: "1344x768" }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("no b64_json in response: " + JSON.stringify(data).slice(0, 200));
  return Buffer.from(b64, "base64");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2); // نام فایل‌های مشخص برای بازتولید
  const targets = only.length ? IMAGES.filter((i) => only.includes(i.file)) : IMAGES;
  const results = [];
  for (const item of targets) {
    const outPath = path.join(OUT_DIR, item.file);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const t0 = Date.now();
        const buf = await generate(item, attempt);
        fs.writeFileSync(outPath, buf);
        console.log(`✔ ${item.file} — ${(buf.length / 1024).toFixed(0)}KB in ${((Date.now() - t0) / 1000).toFixed(1)}s (attempt ${attempt})`);
        ok = true;
      } catch (e) {
        console.error(`✖ ${item.file} attempt ${attempt} failed:`, e.message);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    results.push({ file: item.file, ok });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FAILED: ${failed.map((f) => f.file).join(", ")}` : "ALL OK");
  process.exit(failed.length ? 1 : 0);
}

main();
