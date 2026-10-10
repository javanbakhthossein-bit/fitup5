/**
 * Task 4-a — تولید ۳۴ کارت چالش + ۲ بنر با همان سیستم تصویرساز داخلی فیتاپ
 * (AvalAI — gemini-3.1-flash-lite-image / Nano Banana 2 Lite — همان مسیر
 * تصاویر مقالات در src/lib/fitness/avalai-image.ts)
 *
 * اجرا:  bun scripts/generate-challenge-covers.mjs
 * Idempotent: فایل موجود و سالم (>20KB) رد می‌شود → دوباره اجرا فقط جاافتاده‌ها را می‌سازد.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// ─── خواندن .env (بدون وابستگی) ───
function loadEnv() {
  const raw = fs.readFileSync("/home/z/my-project/.env", "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const BASE_URL = ENV.AVALAI_BASE_URL || "https://api.avalai.ir/v1";
const API_KEY = ENV.AVALAI_IMAGE_API_KEY;
const MODEL = ENV.AVALAI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
if (!API_KEY) {
  console.error("AVALAI_IMAGE_API_KEY تنظیم نشده — توقف.");
  process.exit(1);
}

const OUT_ROOT = "/home/z/my-project/public/images/challenges";

// ─── قالب پرامت — عکس واقعی، جذاب، لوگوی FitUp نارنجی روی لباس ───
// سبک ثابت برند: نورپردازی سینمایی کهربایی/نارنجی، باشگاه مدرن، عکس ریل (نه کارتونی)
const STYLE = [
  "Ultra-realistic professional fitness photography, shot on 85mm lens, shallow depth of field",
  "cinematic warm lighting with orange (#F97316) and amber rim light accents",
  "modern gym environment, dark charcoal tones with glowing orange highlights",
  "energetic powerful mood, high detail skin and fabric texture, 4k quality",
  "The athlete wears clothing with the word 'FitUp' printed in bold orange (#F97316) modern sans-serif letters — the printed text must read exactly 'FitUp' in latin letters",
  "no watermark, no extra text, no logo overlays",
].join(", ");

const MEN = [
  { slug: "m-sixpack-45",      desc: "a very muscular fit Iranian man with defined six-pack abs doing an intense v-sit crunch on a black training mat, focused expression, sweat drops, sleeveless black training tank top" },
  { slug: "m-shoulders-60",    desc: "a broad-shouldered muscular Iranian man performing an overhead dumbbell shoulder press, dramatic silhouette emphasizing wide shoulders, fitted grey athletic t-shirt" },
  { slug: "m-mass-60",         desc: "a big muscular Iranian bodybuilder doing a heavy barbell biceps curl, huge arms, veins visible, sleeveless compression shirt" },
  { slug: "m-classic-45",      desc: "an aesthetic Iranian classic-physique athlete performing a classic side-chest bodybuilding pose under a golden spotlight, golden-tan skin, posing trunks with a tank top nearby" },
  { slug: "m-arms-30",         desc: "a fit Iranian man seated on a gym bench doing a concentrated dumbbell biceps curl, flexed bicep peak, black t-shirt" },
  { slug: "m-chest-30",        desc: "a powerful Iranian man doing a barbell bench press viewed from a low side angle, loaded barbell, fitted athletic t-shirt" },
  { slug: "m-power-30",        desc: "a strong Iranian powerlifter gripping a heavily loaded barbell at a deadlift setup, chalk dust in the air, heavy cotton t-shirt, powerlifting platform" },
  { slug: "m-crossfit-21",     desc: "an athletic Iranian man exploding mid-air during a box jump, dynamic motion, breathable training t-shirt, crossfit box with tires and battle ropes in background" },
  { slug: "m-calisthenics-30", desc: "a lean muscular Iranian man holding the top position of a pull-up on an outdoor bar at sunset, defined back muscles, sleeveless top, street workout park" },
  { slug: "m-pullup-30",       desc: "a determined Iranian man hanging from a pull-up bar engaging his shoulder blades, athletic t-shirt, minimal gym with an orange gradient wall" },
  { slug: "m-hiit-21",         desc: "an energetic Iranian man doing an explosive jump squat with glowing orange light motion trails, light training t-shirt, dark studio" },
  { slug: "m-functional-30",   desc: "a strong Iranian man swinging a kettlebell at shoulder height, perfect form, training t-shirt, turf functional training area with ropes and cones" },
  { slug: "m-trx-21",          desc: "a fit Iranian man performing a TRX suspension row at an angle, suspended body line, fitted top, minimal studio with orange accent wall" },
  { slug: "m-pilates-21",      desc: "a focused Iranian man holding a perfect plank on a mat, controlled breathing, fitted training t-shirt, calm studio with warm wood floor" },
  { slug: "m-balance-14",      desc: "an athletic Iranian man standing on one leg on a balance pad while holding a medicine ball, training t-shirt, bright studio with an amber circle backdrop" },
  { slug: "m-fresh-start-14",  desc: "a friendly motivated Iranian man giving a confident fist up after finishing push-ups on a home living-room floor, casual sports t-shirt, warm cozy light" },
  { slug: "m-legs-30",         desc: "a powerful Iranian man at the bottom of a deep barbell back squat, strong legs, t-shirt, squat rack with dramatic orange spotlights" },
];

const WOMEN = [
  // ⚠️ سبک پرامت هم‌خانوادهٔ بنر موفق w-hero: «young woman + long dark hair» بدون
  // هیچ اشارهٔ حجاب/محجبه — مدل تصویرساز با ذکر «Iranian athlete» حجاب می‌سازد.
  { slug: "w-glutes-30",       desc: "a beautiful attractive fit young woman with long dark wavy hair down over her shoulders, athletic hourglass physique, doing a hip thrust on a bench, perfect glute form, fitted orange-accent sports top and high-waist leggings, modern gym with warm amber tones" },
  { slug: "w-fatburn-60",      desc: "a beautiful attractive athletic young woman with long flowing dark hair, slim toned body, jumping rope mid-skip with glowing orange energy motion trails, fitted black crop top and leggings, bright studio" },
  { slug: "w-core-21",         desc: "a beautiful fit young woman with a long dark ponytail, toned waist, holding a perfect side plank on a mat, fitted athletic top and leggings, calm pilates studio with soft amber glow" },
  { slug: "w-legs-30",         desc: "a beautiful athletic young woman with long dark hair, toned legs, doing a dumbbell goblet squat, fitted sportswear, gym with warm orange spotlights" },
  { slug: "w-toning-30",       desc: "a beautiful fit young woman with long dark hair over her shoulder, sculpted arms and back, doing a standing resistance-band row, fitted athletic top and leggings, bright functional studio" },
  { slug: "w-physique-45",     desc: "a beautiful strong young woman with long dark hair in a high ponytail, toned shoulders and arms, doing a dumbbell shoulder press, fitted athletic top and leggings, gym mirror with amber rim light" },
  { slug: "w-bikini-30",       desc: "a beautiful athletic young woman in competition-ready shape with long dark hair, confident stance doing an overhead resistance band press, sculpted physique, sporty athletic training top and shorts, stage-style golden lighting" },
  { slug: "w-power-30",        desc: "a beautiful strong young woman with long dark braided hair, locking out a hex-bar deadlift with chalk dust in the air, powerful form, fitted athletic tank top and leggings, dramatic backlight on a platform" },
  { slug: "w-crossfit-21",     desc: "a beautiful athletic young woman with long dark hair, throwing a wall ball at the top of the movement, crossfit box with tires, fitted crossfit top and leggings, orange haze" },
  { slug: "w-calisthenics-30", desc: "a beautiful fit young woman with long dark hair, doing an assisted pull-up with a resistance band on an outdoor bar at sunset, toned arms, athletic tank top and leggings, street workout park" },
  { slug: "w-hiit-21",         desc: "a beautiful energetic young woman with long dark hair flying mid-motion, sprinting mountain climbers on a mat, glowing orange energy trails, dark studio, fitted sports top and leggings" },
  { slug: "w-functional-30",   desc: "a beautiful fit young woman with long dark hair, holding a kettlebell goblet squat with perfect form, sportswear with leggings, turf area with cones in warm tones" },
  { slug: "w-trx-21",          desc: "a beautiful athletic young woman with long dark hair, doing a TRX squat holding suspension straps, fitted sportswear, minimal studio with orange accent wall" },
  { slug: "w-pilates-21",      desc: "a beautiful graceful young woman with long dark hair, doing a pilates bridge on a mat holding a pilates ring, serene studio with wood floor and soft amber light, fitted pilates wear" },
  { slug: "w-balance-14",      desc: "a beautiful fit young woman with long dark hair, in a single-leg tree-pose-style balance holding a small ball, bright studio with amber circle backdrop, fitted sportswear" },
  { slug: "w-fresh-start-14",  desc: "a beautiful friendly young woman with long dark hair, smiling with confident thumbs-up after finishing squats in a cozy home workout corner, warm light, casual athletic wear" },
  { slug: "w-posture-14",      desc: "a beautiful fit young woman with long dark hair, doing a wall-angel posture exercise standing tall against a minimal wall with warm gradient, elegant posture, fitted sportswear" },
];

const HEROES = [
  { slug: "men/m-hero",   aspect: "16:9", extra: "Wide cinematic banner composition with empty dark space on the LEFT side for text overlay. Two strong Iranian male athletes — one doing an overhead press and one flexing after victory — black and charcoal athletic gear, dark gym with glowing orange (#F97316) neon accents and floating confetti particles." },
  { slug: "women/w-hero", aspect: "16:9", extra: "Wide cinematic banner composition with empty bright space on the LEFT side for text overlay. Two beautiful confident Iranian women athletes — one doing a dumbbell squat and one jumping rope — fitted modern sportswear, long dark hair, bright modern studio with warm orange and amber tones." },
];

function buildPrompt(desc, extra) {
  return `${desc}, ${extra ? extra + ", " : ""}${STYLE}`;
}

async function generateOne(item, aspect) {
  const prompt = buildPrompt(item.desc, item.extra);
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      generationConfig: { imageConfig: { aspectRatio: aspect, imageSize: "1K" } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AvalAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url || "";
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("no data-url image in response");
  return Buffer.from(m[2], "base64");
}

async function processItem(item, gender, aspect) {
  const outDir = path.join(OUT_ROOT, gender);
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = path.basename(item.slug); // heroها ممکن است «men/m-hero» باشند
  const jpgPath = path.join(outDir, `${baseName}.jpg`);
  if (fs.existsSync(jpgPath) && fs.statSync(jpgPath).size > 20_000) {
    console.log(`⏭  skip (exists): ${gender}/${item.slug}.jpg`);
    return { ok: true, skipped: true };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const t0 = Date.now();
      const png = await generateOne(item, aspect);
      await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(jpgPath);
      const kb = Math.round(fs.statSync(jpgPath).size / 1024);
      console.log(`✅ ${gender}/${item.slug}.jpg — ${kb}KB — ${Math.round((Date.now() - t0) / 1000)}s (attempt ${attempt})`);
      return { ok: true };
    } catch (e) {
      console.warn(`⚠️  ${gender}/${item.slug} attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return { ok: false, slug: item.slug };
}

async function main() {
  const jobs = [];
  for (const item of MEN) jobs.push(() => processItem(item, "men", "3:4"));
  for (const item of WOMEN) jobs.push(() => processItem(item, "women", "3:4"));
  for (const item of HEROES) jobs.push(() => processItem(item, item.slug.split("/")[0], "16:9"));

  // concurrency = 2 — لطیف با API
  const results = new Array(jobs.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++;
      results[i] = await jobs[i]();
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker));

  const failed = results.filter((r) => r && !r.ok);
  const skipped = results.filter((r) => r && r.skipped);
  console.log("────────────────────────────");
  console.log(`DONE — total: ${jobs.length}, ok: ${results.filter((r) => r?.ok).length} (skip: ${skipped.length}), FAILED: ${failed.length}`);
  if (failed.length) {
    console.log("FAILED slugs:", failed.map((f) => f.slug).join(", "));
    process.exitCode = 2;
  }
}

main();
