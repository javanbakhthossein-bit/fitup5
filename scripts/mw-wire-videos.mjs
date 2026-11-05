/**
 * mw-wire-videos.mjs — اتصال ویدیوهای Muscle Wiki سرور به بانک حرکات (v192)
 *
 * مشکل: فایل‌های ویدیو روی سرور آپلود شده‌اند (public/videos/exercises/<id>.mp4 و
 * <id>-f.mp4) ولی ستون‌های mwVideoUrl/mwVideoUrlFemale دیتابیس خالی‌اند → بانک
 * حرکات ویدیوی MW نشان نمی‌دهد.
 *
 * این اسکریپت هر فایل موجود را پیدا می‌کند و دقیقاً همان ردیفِ هم‌شناسه را در DB
 * به‌روزرسانی می‌کند — بدون دست‌زدن به چیز دیگر.
 *
 * قواعد (مطابق v189/v190):
 *   - ردیف‌های دارای ویدیوی اختصاصی آدمین (videoUrl) دست‌نخورده می‌مانند
 *   - male موجود → mwVideoUrl = /videos/exercises/<id>.mp4
 *   - female موجود → mwVideoUrlFemale = /videos/exercises/<id>-f.mp4
 *   - male نبود ولی female بود → mwVideoUrl = مسیر female (fallback جنسیتی)
 *   - کلید سراسری exercise_musclewiki_enabled در صورت نبود = «1» ساخته می‌شود
 *   - فایلی که نیست → دست نمی‌خورد (یوتیوب قبلی می‌ماند)
 *
 * ✅ v192-fix — سازگار با سرور: ROOT از «محل خودِ این فایل» کشف می‌شود
 * (نه مسیر هاردکد سندباکس)؛ پس هم در /var/www/fitup و هم در سندباکس درست کار
 * می‌کند. قبل از هر نوشتن، بکاپ خودکار DB ساخته می‌شود.
 *
 * اجرا روی سرور تولید (روش پیشنهادی — بدون تعویض دیتابیس، بدون از دست رفتن دیتا):
 *   cd /var/www/fitup
 *   pm2 stop fitup
 *   node scripts/mw-wire-videos.mjs --scan --dry     # ۱) فقط گزارش — هیچ تغییری نمی‌کند
 *   node scripts/mw-wire-videos.mjs --scan           # ۲) اعمال واقعی (+ بکاپ خودکار)
 *   pm2 restart fitup
 *
 * حالت‌های دیگر:
 *   node scripts/mw-wire-videos.mjs --scan --dry --dir /path/to/exercises   # مسیر دلخواه ویدیوها
 *   node scripts/mw-wire-videos.mjs --probe https://fittup.ir               # پروب HTTP (وقتی فایل‌ها محلی نیستند)
 *   node scripts/mw-wire-videos.mjs --scan --db /path/to/custom.db          # مسیر دلخواه DB
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── ۰) کشف ریشهٔ پروژه از محل خود اسکریپت (سازگار با سرور و سندباکس) ── */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const scanMode = args.includes("--scan");
const probeIdx = args.indexOf("--probe");
const probeBase = probeIdx >= 0 ? args[probeIdx + 1]?.replace(/\/+$/, "") : null;
const dbIdx = args.indexOf("--db");
const DB_PATH = dbIdx >= 0 ? path.resolve(args[dbIdx + 1]) : path.join(ROOT, "db/custom.db");
const dirIdx = args.indexOf("--dir");
const EX_DIR = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : path.join(ROOT, "public/videos/exercises");

console.log(`📍 ریشهٔ پروژه: ${ROOT}`);
console.log(`📍 دیتابیس: ${DB_PATH} ${fs.existsSync(DB_PATH) ? "✅" : "❌ (پیدا نشد!)"}`);
console.log(`📍 پوشهٔ ویدیو: ${EX_DIR} ${fs.existsSync(EX_DIR) ? "✅" : "❌"}`);

if (!scanMode && !probeBase) {
  console.error("❌ یکی از سوییچ‌های --scan (اسکن دیسک سرور) یا --probe <base-url> لازم است.");
  process.exit(1);
}

if (fs.existsSync(DB_PATH)) {
  try {
    fs.accessSync(DB_PATH, fs.constants.W_OK);
  } catch {
    console.error("❌ فایل دیتابیس قابل‌نوشتن نیست (اجازهٔ root؟). با همین کاربر root اجرا کن.");
    process.exit(1);
  }
} else {
  console.error("❌ دیتابیس پیدا نشد — با --db مسیر درست را بده. مثال: --db /var/www/fitup/db/custom.db");
  process.exit(1);
}

/* ── ۱) کشف فایل‌های موجود ── */

function scanDisk() {
  const out = new Map(); // id -> { male: bool, female: bool }
  if (!fs.existsSync(EX_DIR)) {
    console.error(`❌ پوشهٔ ${EX_DIR} وجود ندارد.`);
    console.error(`   اگر ویدیوها جای دیگری هستند: --dir /path/to/exercises`);
    console.error(`   یا حالت پروب: --probe https://fittup.ir`);
    process.exit(1);
  }
  let mp4 = 0;
  for (const f of fs.readdirSync(EX_DIR)) {
    if (!f.endsWith(".mp4")) continue;
    mp4++;
    let id = f.slice(0, -4);
    let female = false;
    if (id.endsWith("-f")) {
      id = id.slice(0, -2);
      female = true;
    }
    const rec = out.get(id) ?? { male: false, female: false };
    if (female) rec.female = true;
    else rec.male = true;
    out.set(id, rec);
  }
  if (mp4 === 0) {
    console.error(`⚠️ در ${EX_DIR} هیچ فایل mp4 پیدا نشد.`);
    console.error(`   اگر ویدیوها جای دیگری آپلود شده‌اند: --dir /path/to/exercises`);
    console.error(`   یا حالت پروب: --probe https://fittup.ir`);
  }
  return out;
}

/* ── ۲) اتصال به DB (با مسیر صریح — مستقل از .env سندباکس/سرور) ── */

process.env.DATABASE_URL = `file:${DB_PATH}`;
const { createRequire } = await import("node:module");
const req = createRequire(path.join(ROOT, "package.json"));
const { PrismaClient } = req("@prisma/client");
const db = new PrismaClient();

const HEADERS = { "User-Agent": "Mozilla/5.0 (fitup-mw-wire)" };

async function httpExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: HEADERS, signal: AbortSignal.timeout(12000) });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

/** بکاپ خودکار DB قبل از هر نوشتن (طبق عادت همیشگی — حتی اگر کاربر خودش بکاپ گرفته باشد) */
function autoBackupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = DB_PATH.replace(/\.db$/, "") + `-backup-${stamp}-mw.db`;
  try {
    fs.copyFileSync(DB_PATH, dest);
    console.log(`💾 بکاپ خودکار دیتابیس: ${dest}`);
  } catch (e) {
    console.log(`⚠️ بکاپ خودکار ناموفق بود (${e.message}) — ادامه می‌دهم (بکاپ دستی داری)…`);
  }
}

async function main() {
  const rows = await db.exerciseLibrary.findMany({
    select: { id: true, videoUrl: true, mwVideoUrl: true, mwVideoUrlFemale: true },
  });
  console.log(`📋 ردیف‌های بانک حرکات: ${rows.length}`);
  const exclusive = new Set(rows.filter((r) => (r.videoUrl ?? "").trim() !== "").map((r) => r.id));
  console.log(`   دارای ویدیوی اختصاصی (دست‌نخورده): ${exclusive.size}`);

  // کشف فایل‌ها
  let found = new Map();
  if (scanMode) {
    found = scanDisk();
    let m = 0, f = 0;
    for (const rec of found.values()) { if (rec.male) m++; if (rec.female) f++; }
    console.log(`📁 اسکن دیسک: ${found.size} شناسه — ${m} مرد، ${f} زن`);
  }

  let wired = 0, maleWired = 0, femaleWired = 0, fallback = 0, skippedCustom = 0, untouched = 0, noFile = 0;
  const updates = [];

  for (const r of rows) {
    let male = false, female = false;
    if (scanMode) {
      const rec = found.get(r.id);
      if (!rec) { noFile++; untouched++; continue; }
      male = rec.male; female = rec.female;
    } else {
      male = await httpExists(`${probeBase}/videos/exercises/${r.id}.mp4`);
      female = await httpExists(`${probeBase}/videos/exercises/${r.id}-f.mp4`);
      if (!male && !female) { noFile++; untouched++; continue; }
    }
    if (exclusive.has(r.id)) { skippedCustom++; continue; }

    const mwUrl = male ? `/videos/exercises/${r.id}.mp4` : female ? `/videos/exercises/${r.id}-f.mp4` : "";
    const mwFUrl = female ? `/videos/exercises/${r.id}-f.mp4` : "";
    if (!male && female) fallback++;

    const changed = r.mwVideoUrl !== mwUrl || r.mwVideoUrlFemale !== mwFUrl;
    if (changed) {
      updates.push({ id: r.id, mwVideoUrl: mwUrl, mwVideoUrlFemale: mwFUrl });
      wired++;
      if (mwUrl) maleWired++;
      if (mwFUrl) femaleWired++;
    } else {
      untouched++;
    }
  }

  console.log(`\n🔗 نتیجهٔ نگاشت:`);
  console.log(`   به‌روزرسانی می‌شوند: ${wired} (mwVideoUrl: ${maleWired}، mwVideoUrlFemale: ${femaleWired}، فال‌بک زن→مرد: ${fallback})`);
  console.log(`   رد شده (اختصاصی): ${skippedCustom} — بدون فایل: ${noFile}\n`);

  if (dry) {
    console.log("🔍 حالت dry — هیچ تغییری اعمال نشد. نمونهٔ ۵ مورد:");
    for (const u of updates.slice(0, 5)) console.log(`   ${u.id} → ${u.mwVideoUrl || "-"} | ${u.mwVideoUrlFemale || "-"}`);
    await db.$disconnect();
    return;
  }

  if (updates.length === 0) {
    console.log("ℹ️ هیچ تغییری لازم نبود — همهٔ ردیف‌ها هم‌حالت‌اند.");
    await db.$disconnect();
    return;
  }

  // بکاپ خودکار + به‌روزرسانی دسته‌ای در یک تراکنش
  autoBackupDb();
  await db.$transaction(
    updates.map((u) =>
      db.exerciseLibrary.update({
        where: { id: u.id },
        data: { mwVideoUrl: u.mwVideoUrl, mwVideoUrlFemale: u.mwVideoUrlFemale },
      })
    )
  );

  // کلید سراسری MW — فقط در صورت نبود ساخته می‌شود (هیچ‌وقت خاموش نمی‌کند)
  const existing = await db.siteSetting.findUnique({ where: { key: "exercise_musclewiki_enabled" } });
  if (!existing) {
    await db.siteSetting.create({ data: { key: "exercise_musclewiki_enabled", value: "1" } });
    console.log("⚙️ کلید سراسری exercise_musclewiki_enabled = 1 ساخته شد");
  } else {
    console.log(`⚙️ کلید سراسری MW از قبل هست: ${existing.value}`);
  }

  // گزارش نهایی (NULL-ایمن — از حافظه حساب می‌شود)
  const updateMap = new Map(updates.map((u) => [u.id, u]));
  const mwAfter = rows.filter((r) => {
    const u = updateMap.get(r.id);
    const v = u ? u.mwVideoUrl : r.mwVideoUrl;
    return (v ?? "").trim() !== "";
  }).length;
  console.log(`\n✅ تمام شد — ردیف‌های دارای mwVideoUrl: ${mwAfter}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ خطا:", e.message);
  process.exit(1);
});
