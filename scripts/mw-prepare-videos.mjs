/**
 * mw-prepare-videos.mjs — فاز رسانهٔ ویدیوهای Muscle Wiki (v189)
 *
 * ورودی: research/musclewiki/{challenge-mapping,bank-videos}.json + videos/{male,female}/*.mp4
 * خروجی:
 *   ۱) public/videos/challenges/{male,female}/<slug>.mp4       — ویدیوی هر حرکت چالش (مرد/زن)
 *   ۲) public/videos/exercises/<id>.mp4 و <id>-f.mp4           — ویدیوی هر حرکت بانک (مرد/زن)
 *   ۳) research/musclewiki/prepared.json                       — گزارش نهایی مسیرها
 *   ۴) src/lib/fitness/challenge-videos.ts                     — نقشهٔ TS چالش‌ها (کلید = نام انگلیسی)
 *
 * قواعد فشرده‌سازی (دیرکتیو مالک: زیر ۱ مگابایت، هرچه کمتر، بدون داغون‌شدن کیفیت):
 *   - H.264 720p, CRF 27, preset veryfast, تک‌نمونه (threads=1) + faststart + بدون صدا
 *   - اگر خروجی > 950KB → پاس دوم (CRF 31 + maxrate 1000k) و در صورت لزوم 540p
 *   - انتخاب بهترین زاویه: side > front > هر چیز
 *   - فایل خروجی سالم = ffprobe duration > 0 (ffmpeg گاهی هنگام خروج SIGKILL می‌خورد
 *     ولی فایل کامل است — اعتبار با ffprobe سنجیده می‌شود نه exit code)
 *
 * اجرا:  node scripts/mw-prepare-videos.mjs        (قابل اجرای مجدد — skip اگر خروجی سالم هست)
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = "/home/z/my-project";
const SRC_MALE = path.join(ROOT, "research/musclewiki/videos/male");
const SRC_FEMALE = path.join(ROOT, "research/musclewiki/videos/female");
const OUT_CHALLENGES = path.join(ROOT, "public/videos/challenges");
const OUT_BANK = path.join(ROOT, "public/videos/exercises");
const REPORT = path.join(ROOT, "research/musclewiki/prepared.json");
const TS_OUT = path.join(ROOT, "src/lib/fitness/challenge-videos.ts");

for (const d of [path.join(OUT_CHALLENGES, "male"), path.join(OUT_CHALLENGES, "female"), OUT_BANK]) {
  fs.mkdirSync(d, { recursive: true });
}

/* ── ابزار ── */

function kebab(en) {
  return en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** مسیر مبدأ برای (فایل پایه، جنسیت) — فایل‌های زن ری‌نیم شده‌اند (male- → female-) */
function resolveSource(basename, gender) {
  const candidates =
    gender === "female"
      ? [
          path.join(SRC_FEMALE, basename.replace(/^male-/, "female-")),
          path.join(SRC_FEMALE, basename),
        ]
      : [path.join(SRC_MALE, basename)];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

/** انتخاب بهترین ویدیو برای یک جنسیت: side > front > هر چیز؛ سپس کوچک‌ترین حجم */
function pickBest(videos, gender) {
  const g = videos.filter((v) => v.gender === gender);
  if (g.length === 0) return null;
  const rank = (v) => {
    const b = path.basename(v.local);
    if (b.endsWith("-side.mp4")) return 0;
    if (b.endsWith("-front.mp4")) return 1;
    return 2;
  };
  g.sort((a, b) => rank(a) - rank(b) || (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
  return g[0];
}

async function probeDuration(file) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { timeout: 20000 }
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

/**
 * فشرده‌سازی یک ویدیو — پاس اول 720p CRF27؛ اگر > 950KB پاس دوم سبک‌تر.
 * خروجی: { ok, bytes, pass } یا { ok: false, error }
 */
async function compress(src, dst, label) {
  const base = [
    "-y", "-nostats", "-loglevel", "error", "-threads", "1", "-i", src,
    "-vf", "scale=-2:720",
    "-sws_flags", "fast_bilinear",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
    "-x264-params", "threads=1",
    "-movflags", "+faststart",
    "-an",
  ];
  const light = [
    "-y", "-nostats", "-loglevel", "error", "-threads", "1", "-i", src,
    "-vf", "scale=-2:540",
    "-sws_flags", "fast_bilinear",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "31",
    "-maxrate", "900k", "-bufsize", "1800k",
    "-x264-params", "threads=1",
    "-movflags", "+faststart",
    "-an",
  ];

  async function run(args) {
    try {
      await execFileAsync("ffmpeg", args, { timeout: 120000, maxBuffer: 8 << 20 });
    } catch (e) {
      // ffmpeg گاهی هنگام خروج SIGKILL می‌خورد ولی فایل کامل است — با ffprobe می‌سنجیم
      const killed = e.killed || e.signal === "SIGKILL" || e.code === -9 || e.code === 137;
      if (!killed) throw e;
    }
  }

  try {
    await run([...base, dst]);
    let st = fs.existsSync(dst) ? fs.statSync(dst).size : 0;
    let dur = st > 0 ? await probeDuration(dst) : 0;
    if (st > 0 && dur > 0 && st <= 950_000) return { ok: true, bytes: st, pass: 1 };

    // پاس دوم — سبک‌تر
    await run([...light, dst]);
    st = fs.existsSync(dst) ? fs.statSync(dst).size : 0;
    dur = st > 0 ? await probeDuration(dst) : 0;
    if (st > 0 && dur > 0) return { ok: true, bytes: st, pass: 2 };
    return { ok: false, error: `${label}: خروجی نامعتبر (size=${st}, dur=${dur})` };
  } catch (e) {
    return { ok: false, error: `${label}: ${e.message?.slice(0, 200) ?? "unknown"}` };
  }
}

/* ── بارگذاری نقشه‌ها ── */

const challengeMap = JSON.parse(fs.readFileSync(path.join(ROOT, "research/musclewiki/challenge-mapping.json"), "utf8"));
const bankMap = JSON.parse(fs.readFileSync(path.join(ROOT, "research/musclewiki/bank-videos.json"), "utf8"));

/* ── ساخت لیست کارها ── */

const jobs = [];
const challengeOut = {}; // fitupEn -> { slug, male?, female? }
const bankOut = {}; // id -> { male?, female? }
const failures = [];
let skipped = 0;

for (const entry of challengeMap) {
  const slug = kebab(entry.fitupEn);
  const rec = { slug };
  for (const gender of ["male", "female"]) {
    const best = pickBest(entry.videos ?? [], gender);
    if (!best) continue;
    const src = resolveSource(path.basename(best.local), gender);
    if (!src) continue;
    const dst = path.join(OUT_CHALLENGES, gender, `${slug}.mp4`);
    const webPath = `/videos/challenges/${gender}/${slug}.mp4`;
    rec[gender] = webPath;
    jobs.push({ src, dst, webPath, key: `challenge:${entry.fitupEn}:${gender}` });
  }
  challengeOut[entry.fitupEn] = rec;
}

for (const entry of bankMap) {
  const rec = {};
  for (const gender of ["male", "female"]) {
    const best = pickBest(entry.videos ?? [], gender);
    if (!best) continue;
    const src = resolveSource(path.basename(best.local), gender);
    if (!src) continue;
    const fname = gender === "male" ? `${entry.id}.mp4` : `${entry.id}-f.mp4`;
    const dst = path.join(OUT_BANK, fname);
    rec[gender] = `/videos/exercises/${fname}`;
    jobs.push({ src, dst, webPath: rec[gender], key: `bank:${entry.id}:${gender}` });
  }
  bankOut[entry.id] = rec;
}

/* ── اجرا (۲ کارگر موازی — قابل resume) ── */

async function main() {
  // skip فایل‌های سالم قبلی
  const pending = [];
  for (const j of jobs) {
    if (fs.existsSync(j.dst)) {
      const dur = await probeDuration(j.dst);
      if (dur > 0) {
        skipped++;
        continue;
      }
    }
    pending.push(j);
  }
  console.log(`📋 کل کارها: ${jobs.length} — مانده: ${pending.length} — skip سالم: ${skipped}`);

  let done = 0;
  let t0 = Date.now();
  async function worker(queue) {
    while (queue.length > 0) {
      const j = queue.shift();
      if (!j) break;
      const r = await compress(j.src, j.dst, j.key);
      done++;
      if (r.ok) {
        if (done % 25 === 0 || done === pending.length) {
          const el = ((Date.now() - t0) / 1000).toFixed(0);
          console.log(`  ✅ ${done}/${pending.length} (${el}s) — آخرین: ${j.key} ${(r.bytes / 1024).toFixed(0)}KB pass${r.pass}`);
        }
      } else {
        failures.push({ key: j.key, error: r.error });
        console.error(`  ❌ ${j.key}: ${r.error}`);
      }
    }
  }
  const q = [...pending];
  await Promise.all([worker(q), worker(q)]);

  /* ── گزارش نهایی ── */
  // فقط چالش‌هایی که دست‌کم یک ویدیوی واقعی دارند در TS می‌روند
  const prepared = {
    generatedAt: new Date().toISOString(),
    stats: {
      jobs: jobs.length,
      skippedExisting: skipped,
      produced: jobs.length - skipped - failures.length,
      failures: failures.length,
    },
    challenges: challengeOut,
    bank: bankOut,
    failures,
  };
  fs.writeFileSync(REPORT, JSON.stringify(prepared, null, 2));

  /* ── فایل TS چالش‌ها ── */
  const usable = Object.entries(challengeOut).filter(([, r]) => r.male || r.female);
  const lines = [
    "/**",
    " * challenge-videos.ts — نقشهٔ ویدیوهای Muscle Wiki چالش‌ها (تولید خودکار — v189)",
    " *",
    " * منبع: research/musclewiki/prepared.json ← scripts/mw-prepare-videos.mjs",
    " * کلید = نام انگلیسی دقیق حرکت (همان که داخل پرانتز نام فارسی چالش‌هاست)",
    " * مقدار = مسیر وب ویدیوی فشرده‌شدهٔ ۷۲۰p (زیر ۱ مگابایت) برای هر جنسیت",
    " * حرکاتِ بدون ورودی = ویدیوی مناسب ندارند → جلسه به انیمیشن دوفریمی برمی‌گردد.",
    " */",
    "",
    "export interface ChallengeVideoEntry {",
    "  m?: string; // مسیر ویدیوی مرد",
    "  f?: string; // مسیر ویدیوی زن",
    "}",
    "",
    "export const CHALLENGE_VIDEOS: Record<string, ChallengeVideoEntry> = {",
    ...usable.map(([en, r]) => {
      const parts = [];
      if (r.male) parts.push(`m: "${r.male}"`);
      if (r.female) parts.push(`f: "${r.female}"`);
      return `  "${en}": { ${parts.join(", ")} },`;
    }),
    "};",
    "",
    `// ${usable.length} حرکت با ویدیو از ${Object.keys(challengeOut).length} حرکت چالش`,
  ];
  fs.writeFileSync(TS_OUT, lines.join("\n") + "\n");

  console.log(`\n🏁 تمام — تولید: ${prepared.stats.produced} | خطا: ${failures.length} | skip: ${skipped}`);
  console.log(`📄 گزارش: ${REPORT}`);
  console.log(`🧩 TS: ${TS_OUT} (${usable.length} حرکت)`);
  const noFemale = Object.entries(challengeOut).filter(([k, r]) => r.male && !r.female);
  const noMale = Object.entries(challengeOut).filter(([k, r]) => !r.male && r.female);
  const none = Object.entries(challengeOut).filter(([k, r]) => !r.male && !r.female);
  console.log(`⚠️ چالش بدون زن: ${noFemale.map(([k]) => k).join(", ") || "—"}`);
  console.log(`⚠️ چالش بدون مرد: ${noMale.map(([k]) => k).join(", ") || "—"}`);
  console.log(`⚠️ چالش بدون هیچ ویدیو (انیمیشن دوفریمی): ${none.map(([k]) => k).join(", ") || "—"}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
