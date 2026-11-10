/**
 * v188 — بازسازی تصاویر چالش‌ها با «تصویرساز داخلی فیتاپ» (avalai-image.ts)
 *
 * دیرکتیو مالک:
 *  • همهٔ تصاویر باید با همان پایپ‌لاینی ساخته شوند که تصاویر مقالات می‌سازد
 *    (AvalAI / gemini-3.1-flash-lite-image — Nano Banana 2 Lite) — نه CLI بیرونی
 *  • یک‌دست‌سازی: همهٔ کارت‌ها افقی 16:9 (هم‌نسبت کارت‌های خانم‌ها)
 *  • فوتورئالیستیک (نه کارتونی)، زن‌ها بدون هیچ حجاب/مقنعه/روسری
 *  • بنرها: شخصیت سمت چپ، سمت راست کاملاً خالی برای متن
 *
 * اجرا:  bun scripts/gen-challenge-images-avalai.mjs [--only slug1,slug2] [--force]
 */
import { generateImage } from "../src/lib/fitness/avalai-image.ts";
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const MEN_DIR = join(ROOT, "public/images/challenges/men");
const WOMEN_DIR = join(ROOT, "public/images/challenges/women");
mkdirSync(MEN_DIR, { recursive: true });
mkdirSync(WOMEN_DIR, { recursive: true });

// ─── پرامت پایه — مرد (فوتورئالیستیک، هم‌سبک کارت‌های تأییدشدهٔ خانم‌ها) ───
const BASE_M = `Photorealistic professional fitness photography, wide 16:9 horizontal frame, high-end editorial sports advertising campaign look. SUBJECT: one handsome Iranian man, mid-30s, athletic muscular physique, short dark hair, neatly groomed short beard, warm olive skin, confident focused expression. OUTFIT: black performance sportswear (sleeveless tank top and shorts) with the brand wordmark "FitUp" printed in bold orange (#F97316) capital letters across the chest, plus subtle orange accent stripes on the clothing. SETTING: modern premium dark gym at night, dark charcoal background, warm orange-amber LED rim lighting, soft orange neon glow accents, blurred gym equipment silhouettes far in the background, cinematic shallow depth of field. LIGHTING: dramatic warm cinematic lighting with strong orange rim light outlining the muscles, realistic skin texture with a light sweat sheen, razor-sharp focus on the subject, visible muscle definition. STRICT: the ONLY text anywhere in the image is the small orange "FitUp" wordmark on the clothing — no other text, no captions, no watermarks, no logos. Photorealistic, not cartoon, not illustration.`;

// ─── پرامت پایه — زن (بدون هیچ حجاب، فوتورئالیستیک، جذاب) ───
const BASE_W = `Photorealistic professional fitness photography, wide 16:9 horizontal frame, high-end editorial sports advertising campaign look. SUBJECT: one beautiful attractive Iranian woman, mid-20s, fit toned feminine physique, long flowing dark hair worn completely open and down — absolutely NO headscarf, NO hijab, NO head covering, natural elegant makeup, graceful confident expression. OUTFIT: black sports crop top and matching leggings with the brand wordmark "FitUp" printed in bold orange (#F97316) capital letters, plus subtle orange accent stripes. SETTING: modern premium dark gym at night, dark charcoal background, warm orange-amber LED rim lighting, soft orange neon glow accents, blurred gym equipment far in the background, cinematic shallow depth of field. LIGHTING: dramatic warm cinematic lighting with orange rim light, realistic skin texture with a light sweat sheen, razor-sharp focus on the subject. STRICT: the ONLY text anywhere in the image is the small orange "FitUp" wordmark on the clothing — no other text, no captions, no watermarks, no logos. Photorealistic, not cartoon, not illustration.`;

// ─── پرامت بنر (21:9): شخصیت چپ، راست کاملاً خالی برای متن ───
const BANNER_RULES = `CRITICAL BANNER COMPOSITION: ultra-wide horizontal banner (21:9). The people are placed ONLY in the LEFT third of the frame. The RIGHT two-thirds of the banner MUST be completely clean, empty, dark charcoal-to-black gradient background with a subtle warm orange glow — absolutely NO people, NO objects, NO text in that right area; it is intentional negative copy-space for a headline. `;

const M_BANNER = `Photorealistic professional fitness photography banner, ultra-wide 21:9 horizontal format, high-end editorial sports campaign. ${BANNER_RULES}SUBJECTS (left third only): two handsome Iranian men, mid-30s, athletic muscular physiques, short dark hair, groomed short beards, wearing black sportswear (tank tops and shorts) with the orange "FitUp" wordmark printed in bold orange (#F97316) capital letters on the chest — one holding a dumbbell overhead in a triumphant pose, the other standing confident with arms crossed and a smile. SETTING (left third): modern premium dark gym at night, warm orange-amber LED rim lighting, cinematic realistic lighting, visible muscle definition, realistic skin texture. The right two-thirds: pure clean dark gradient with soft orange glow only. STRICT: the only text is the small orange "FitUp" wordmark on the clothing; no other text or watermarks. Photorealistic, not cartoon.`;

const W_BANNER = `Photorealistic professional fitness photography banner, ultra-wide 21:9 horizontal format, high-end editorial sports campaign. ${BANNER_RULES}SUBJECTS (left third only): two beautiful attractive Iranian women, mid-20s, fit toned physiques, long flowing dark hair worn completely open — absolutely NO headscarf, NO hijab, NO head covering — wearing black athletic crop tops and leggings with the orange "FitUp" wordmark printed in bold orange (#F97316) capital letters — one holding a dumbbell squat, one jumping rope with energetic motion, both smiling. SETTING (left third): modern premium dark gym at night, warm orange-amber LED rim lighting, cinematic realistic lighting. The right two-thirds: pure clean dark gradient with soft orange glow only. STRICT: the only text is the small orange "FitUp" wordmark on the clothing; no other text or watermarks. Photorealistic, not cartoon.`;

/** ۱۷ کارت آقایان — صحنهٔ اختصاصی هر چالش */
const MEN_CARDS = {
  "m-sixpack-45": "He is performing a V-sit abdominal crunch on a dark gym floor mat, abs fully engaged and sculpted, body balanced on his sit bones, arms extended forward beside his knees (never covering the chest), shot straight-on from the front at chest height so the orange FitUp wordmark on his tank top stays fully visible and readable.",
  "m-shoulders-60": "He is at the top of a standing dumbbell shoulder press, both heavy dumbbells locked out overhead, shoulders and traps fully flexed, strong V-taper silhouette under the orange rim light.",
  "m-mass-60": "He is mid-set on a heavy flat barbell bench press, the barbell right above his chest, chest and arms loaded, chalk dust in the air, dramatic side angle close to the bench.",
  "m-classic-45": "He is holding a classic old-school bodybuilding side-chest pose under a single warm spotlight, golden aesthetic proportions like a classic physique champion, dark stage-like atmosphere.",
  "m-arms-30": "Close-up dynamic shot of him doing a standing barbell biceps curl, biceps fully contracted with visible vascularity, forearms detailed, camera slightly below eye level.",
  "m-chest-30": "He is doing incline dumbbell presses on an incline bench, dumbbells at the bottom position with chest fully stretched and loaded, dramatic orange backlight separating him from the dark background.",
  "m-power-30": "He is gripping a heavily loaded barbell at the start of a deadlift, back flat and powerful, legs bent, huge plates on the bar, dramatic low-angle shot, atmosphere of raw strength, gym floor reflections.",
  "m-crossfit-21": "He is mid-air in an explosive box jump above a wooden plyo box, arms swinging, sweat droplets flying, intense functional-training zone with kettlebells around, dynamic frozen motion.",
  "m-calisthenics-30": "He is holding strict dips on parallel bars with legs raised in front, lean sculpted physique under full tension, minimal urban-style calisthenics corner of the gym.",
  "m-pullup-30": "He is hanging from an overhead pull-up bar: both hands gripping the bar firmly far above his head, his entire body clearly suspended in mid-air with feet well off the ground, mid pull-up with chin rising toward the bar, lats and back fully flexed, shot from slightly below against the dark gym ceiling with warm orange glow.",
  "m-hiit-21": "He is slamming heavy battle ropes creating powerful orange-lit waves with both arms, athletic sprinter stance, explosive HIIT energy, motion in the ropes with sharp focus on his intense face.",
  "m-functional-30": "He is performing a farmer's walk carrying two heavy kettlebells across the gym floor, full-body tension, walking toward the camera through the functional training zone.",
  "m-trx-21": "He is performing a TRX suspended row, body held in a perfectly straight incline line, suspension straps taut, core braced, straps visible in warm orange light.",
  "m-pilates-21": "He is performing a controlled Pilates teaser on a dark mat, balancing on his sit bones with legs and torso forming a V, calm focused expression, precise core control.",
  "m-balance-14": "He is balancing on one leg on a soft balance pad, other knee raised, arms crossed over his chest, core engaged, eyes focused forward, stability training corner.",
  "m-fresh-start-14": "He is doing perfect full push-ups on a mat in a warm home living room at golden hour, sunlight through the window, house plants around, hopeful fresh-start mood, home workout setting.",
  "m-legs-30": "He is at the bottom of a heavy barbell back squat inside a squat rack, quads fully loaded and defined, powerful stance, dramatic orange rim light emphasizing the leg muscles.",
};

/** کارت پیلاتس خانم‌ها — بازسازی (تکیه‌گاه واقعی، نه معلق در هوا) */
const W_PILATES = "She is performing a precise Pilates side-lying leg lift on a grey yoga mat on the warm wooden floor of an elegant boutique Pilates studio: lying fully on her side, body completely supported by the mat and floor, one hand gently propping her head, top leg lifting in a slow controlled arc, reformer machines softly blurred in the background, bright airy daylight studio with warm wooden tones. Her body must be fully in contact with the mat — anatomically correct, nothing floating in the air.";

const TARGETS = [];
for (const [slug, scene] of Object.entries(MEN_CARDS)) {
  TARGETS.push({ slug, dir: MEN_DIR, prompt: `${BASE_M} ACTION: ${scene}`, ratio: "16:9" });
}
TARGETS.push({ slug: "w-pilates-21", dir: WOMEN_DIR, prompt: `${BASE_W} ACTION: ${W_PILATES}`, ratio: "16:9" });
TARGETS.push({ slug: "m-hero", dir: MEN_DIR, prompt: M_BANNER, ratio: "21:9" });
TARGETS.push({ slug: "w-hero", dir: WOMEN_DIR, prompt: W_BANNER, ratio: "21:9" });

// ─── فیلتر CLI ───
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(",").map((s) => s.trim()) : null;
const force = args.includes("--force");

let ok = 0, fail = 0, skipped = 0;
const failures = [];

async function runOne(t) {
  const out = join(t.dir, `${t.slug}.jpg`);
  if (!force && existsSync(out)) { skipped++; console.log(`⏭  ${t.slug} (موجود)`); return; }
  const started = Date.now();
  try {
    const img = await generateImage({ prompt: t.prompt, aspectRatio: t.ratio, timeoutMs: 120000 });
    await sharp(img.buffer).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
    const kb = Math.round((await import("node:fs")).statSync(out).size / 1024);
    ok++;
    console.log(`✅ ${t.slug} — ${t.ratio} — ${kb}KB — ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    fail++;
    failures.push(t.slug);
    console.error(`❌ ${t.slug}: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const list = only ? TARGETS.filter((t) => only.includes(t.slug)) : TARGETS;
  console.log(`🖼  تولید ${list.length} تصویر با تصویرساز داخلی فیتاپ (AvalAI / Nano Banana 2 Lite)…`);
  const CONC = 2;
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const t = list[cursor++];
      await runOne(t);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, () => worker()));
  console.log(`\n🏁 تمام شد — موفق: ${ok} | ناموفق: ${fail} | ردشده: ${skipped}`);
  if (failures.length) { console.error(`بازتولید لازم: ${failures.join(", ")}`); process.exitCode = 1; }
}

main();
