/**
 * Task 4 — دانلود و تبدیل انیمیشن‌های دوفریمی حرکات چالش‌ها
 * منبع: yuhonas/free-exercise-db (Unlicense — آزاد و رایگان برای هر استفاده)
 * خروجی: public/animations/challenges/<key>-0.webp و <key>-1.webp (480px)
 *
 * اجرا: bun scripts/build-challenge-anims.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DB_JSON = "/home/z/my-project/research/anim-samples/free-exercise-db/exercises.json";
const OUT_DIR = "/home/z/my-project/public/animations/challenges";
const RAW_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
const MEN_SRC = "/home/z/my-project/src/lib/fitness/challenges-data-men.ts";
const WOMEN_SRC = "/home/z/my-project/src/lib/fitness/challenges-data-women.ts";

function sanitize(key) {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── استخراج animKeyها از دیتای چالش‌ها ───
function extractAnimKeys(file) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/animKey:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const db = JSON.parse(fs.readFileSync(DB_JSON, "utf8"));
console.log(`DB: ${db.length} exercises`);

// ─── نگاشت دستی دقیق (animKey → نام دقیق بانک) — تطبیق بصری حرکت ───
const OVERRIDES = {
  "Crunch": "Crunches",
  "Lying Leg Raise": "Flat Bench Lying Leg Raise",
  "Bicycle Crunch": "Cross-Body Crunch",
  "Plank": "Plank",
  "Russian Twist": "Russian Twist",
  "Jumping Jacks": "Star Jump",
  "Mountain Climbers": "Mountain Climbers",
  "Cross-Body Crunch": "Cross-Body Crunch",
  "Burpee": "Frog Hops",
  "Scissor Kicks": "Scissor Kick",
  "Side Plank": "Push Up to Side Plank",
  "Dead Bug": "Dead Bug",
  "Plank Shoulder Tap": "Plank",
  "Superman": "Superman",
  "Ab Wheel Rollout": "Ab Roller",
  "Hanging Leg Raise": "Hanging Leg Raise",
  "Glute Bridge": "Barbell Glute Bridge",
  "Plank Up Down": "Plank",
  "Dumbbell Shoulder Press": "Dumbbell Shoulder Press",
  "Dumbbell Lateral Raise": "Side Lateral Raise",
  "Dumbbell Front Raise": "Front Dumbbell Raise",
  "Face Pull": "Face Pull",
  "Dumbbell Shrug": "Dumbbell Shrug",
  "Pull-Up": "Wide-Grip Rear Pull-Up",
  "Lat Pulldown": "Wide-Grip Lat Pulldown",
  "Single Arm Dumbbell Row": "One-Arm Dumbbell Row",
  "Reverse Fly": "Reverse Flyes",
  "Dumbbell Bench Press": "Dumbbell Bench Press",
  "Wide Push-Up": "Incline Push-Up Wide",
  "Barbell Bench Press": "Barbell Bench Press - Medium Grip",
  "Diamond Push-Up": "Close-Grip Push-Up off of a Dumbbell",
  "Triceps Pushdown": "Triceps Pushdown",
  "Overhead Triceps Extension": "Cable Rope Overhead Triceps Extension",
  "Barbell Deadlift": "Barbell Deadlift",
  "Bent Over Barbell Row": "Bent Over Barbell Row",
  "Barbell Bicep Curl": "Barbell Curl",
  "Hammer Curl": "Alternate Hammer Curl",
  "Barbell Back Squat": "Barbell Squat",
  "Romanian Deadlift": "Romanian Deadlift",
  "Bulgarian Split Squat": "Smith Single-Leg Split Squat",
  "Standing Calf Raise": "Standing Calf Raises",
  "Barbell Shoulder Press": "Barbell Shoulder Press",
  "Dumbbell Bicep Curl": "Dumbbell Bicep Curl",
  "Dips": "Dips - Chest Version",
  "Dumbbell Pullover": "Bent-Arm Dumbbell Pullover",
  "Lunge": "Bodyweight Walking Lunge",
  "Push-Up": "Clock Push-Up",
  "Incline Push-Up": "Incline Push-Up",
  "Archer Push-Up": "Incline Push-Up Wide",
  "Clap Push-Up": "Plyo Push-up",
  "Goblet Squat": "Goblet Squat",
  "Jump Squat": "Hurdle Hops",
  "Skater Jumps": "Lateral Cone Hops",
  "Plyo Lunge": "Stride Jump Crossover",
  "Star Jump Squat": "Star Jump",
  "Plank Jack": "Plank",
  "High Knees": "Fast Skipping",
  "Inverted Row": "Inverted Row",
  "Band Assisted Pull-Up": "Band Assisted Pull-Up",
  "Bodyweight Squat": "Bodyweight Squat",
  "Fast Feet": "Fast Skipping",
  "Farmer March": "Farmer's Walk",
  "Bird Dog": "Dead Bug",
  "Single Leg Balance": "Single-Leg Hop Progression",
  "Cat Cow": "Cat Stretch",
  "TRX Row": "Inverted Row with Straps",
  "TRX Chest Press": "Cable Chest Press",
  "TRX Plank": "Plank",
  "TRX Squat": "Bodyweight Squat",
  "TRX Lunge": "Bodyweight Walking Lunge",
  "Child Pose": "Child's Pose",
  "Pilates Hundred": "Tuck Crunch",
  "Pilates Roll Up": "Sit-Up",
  "Pilates Bridge": "Physioball Hip Bridge",
  "Single Leg Stretch": "Flat Bench Lying Leg Raise",
  "Seated Twist": "Seated Barbell Twist",
  "Reverse Lunge": "Crossover Reverse Lunge",
  "Knee Push-Up": "Incline Push-Up",
  "Dumbbell RDL": "Romanian Deadlift",
  "Single Leg Glute Bridge": "Single Leg Glute Bridge",
  "Side Lunge": "Barbell Side Split Squat",
  "Glute Kickback": "Glute Kickback",
  "Calf Stretch": "Calf Stretch Elbows Against Wall",
  "Clamshell": "Side Leg Raises",
  "Side Hip Abduction": "Side Leg Raises",
  "Hip Thrust": "Barbell Hip Thrust",
  "Wall Angel": "One Arm Against Wall",
  "Wall Chest Stretch": "Behind Head Chest Stretch",
  "Cobra Stretch": "Cat Stretch",
};

// فهرست نرمال‌شدهٔ نام‌های بانک برای تطبیق
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byNorm = new Map();
for (const ex of db) {
  const n = norm(ex.name);
  if (!byNorm.has(n)) byNorm.set(n, ex);
}
const dbNames = [...byNorm.keys()];

function findMatch(animKey) {
  // 0) نگاشت دستی دقیق — اولویت مطلق
  if (OVERRIDES[animKey]) {
    const ex = byNorm.get(norm(OVERRIDES[animKey]));
    if (ex) return ex;
  }
  const n = norm(animKey);
  // 1) تطبیق کامل
  if (byNorm.has(n)) return byNorm.get(n);
  // 2) شروع با
  for (const d of dbNames) if (d.startsWith(n) || n.startsWith(d)) return byNorm.get(d);
  // 3) بیشترین اشتراک کلمات
  const kw = n.split(" ");
  let best = null, bestScore = 0;
  for (const d of dbNames) {
    const dw = d.split(" ");
    let score = 0;
    for (const w of kw) if (dw.some((x) => x === w || (w.length > 3 && x.includes(w)))) score++;
    // جریمهٔ کلمات اضافه
    score -= Math.abs(dw.length - kw.length) * 0.3;
    if (score > bestScore) { bestScore = score; best = byNorm.get(d); }
  }
  return bestScore >= 1 ? best : null;
}

const keys = [...new Set([...extractAnimKeys(MEN_SRC), ...extractAnimKeys(WOMEN_SRC)])];
console.log(`animKeyهای یکتا: ${keys.length}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const report = [];
const missed = [];

for (const key of keys) {
  const match = findMatch(key);
  if (!match || !match.images || match.images.length < 2) {
    missed.push(key);
    report.push({ key, status: "MISS" });
    console.warn(`❌ MISS: ${key}`);
    continue;
  }
  const out0 = path.join(OUT_DIR, `${sanitize(key)}-0.webp`);
  const out1 = path.join(OUT_DIR, `${sanitize(key)}-1.webp`);
  if (fs.existsSync(out0) && fs.existsSync(out1)) {
    report.push({ key, status: "SKIP", db: match.name });
    continue;
  }
  try {
    for (let f = 0; f < 2; f++) {
      const url = RAW_BASE + match.images[f];
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const out = f === 0 ? out0 : out1;
      await sharp(buf).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
    }
    const kb0 = Math.round(fs.statSync(out0).size / 1024);
    const kb1 = Math.round(fs.statSync(out1).size / 1024);
    report.push({ key, status: "OK", db: match.name, kb: [kb0, kb1] });
    console.log(`✅ ${key} → ${match.name} (${kb0}+${kb1}KB)`);
  } catch (e) {
    missed.push(key);
    report.push({ key, status: "FAIL", error: e.message });
    console.error(`❌ FAIL: ${key} — ${e.message}`);
  }
}

fs.writeFileSync("/home/z/my-project/research/anim-samples/challenge-anims-report.json", JSON.stringify(report, null, 2));
console.log("────────────────────");
console.log(`OK/SKIP: ${report.filter((r) => r.status !== "MISS" && r.status !== "FAIL").length}, MISS/FAIL: ${missed.length}`);
if (missed.length) {
  console.log("MISSED keys:", JSON.stringify(missed));
}
