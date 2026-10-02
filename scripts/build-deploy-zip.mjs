#!/usr/bin/env node
/**
 * build-deploy-zip.mjs — بستهٔ دیپلوی خودکار فیتاپ (v55)
 *
 * ⚠️ چرا این اسکریپت ساخته شد؟
 * زیپ‌های قبلی با «لیست دستی فایل‌ها» ساخته می‌شدند و در v54 دو فایل
 * (src/lib/fitness/video-thumbnail.ts و use-quota-summary.ts) جا افتادند →
 * بیلد سرور با «Module not found» شکست خورد و دیپلوی به build قبلی برگشت.
 *
 * این اسکریپت همه‌چیز را «خودکار» بسته‌بندی می‌کند (هیچ لیست دستی‌ای در کار
 * نیست) و در پایان، فایل‌های داخل زیپ را با دیسک تطبیق می‌دهد — اگر حتی یک
 * فایل src/public/prisma/scripts جا افتاده باشد، با کد خروج ۱ شکست می‌خورد.
 *
 * مصرف:  bun scripts/build-deploy-zip.mjs [version]
 * خروجی: download/fitup-deploy-YYYY-MM-DD-v<version>.zip
 *
 * v82 — گندزدایی tsconfig.json پیش از بسته‌بندی (درس فیل TypeScript دیپلوی v81):
 * Next.js در هر dev/build سندباکس، مسیر تایپ‌های تولیدی خودش را به includeِ
 * tsconfig.json اضافه می‌کند و هرگز حذفشان نمی‌کند (.next/types، .next.buildtest،
 * .next-prod-test، …). این includeها اگر داخل زیپ بروند، روی سرور tsc به فایل
 * تایپِ یتیمِ بیلدِ زندهٔ قبلی چنگ می‌زند که به سورسِ حذف‌شدهٔ stale-cleanup
 * import دارد → «Cannot find module» → شکست کل بیلد. پس هر بار قبل از پک،
 * tsconfig گندزدایی می‌شود (فقط .next.new — distDir فعلی سرور — مجاز می‌ماند).
 */
import { execSync } from "child_process";
import { readdirSync, statSync, existsSync, writeFileSync, unlinkSync, rmSync, readFileSync } from "fs";
import { join, relative, dirname } from "path";

const ROOT = process.cwd();
const version =
  process.argv[2] ||
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version.split(".")[0];
const date = new Date().toISOString().slice(0, 10);
const outName = `fitup-deploy-${date}-v${version}.zip`;
const outPath = join(ROOT, "download", outName);
const manifestPath = join(ROOT, "download", ".deploy-manifest.txt");

// ─── فایل‌های ریشه (همهٔ کانفیگ‌های پروژه) ───
// v94 — دیرکتیو مالک: «ورک‌لاگ کامل رو همیشه از این به بعد در فایل زیپ دیپلوی بذار»
// + راهنمای تست مرجع (TESTING.md) هم همراه هر دیپلوی باشد.
const ROOT_FILES = [
  ".env.example",
  ".gitignore",
  "Caddyfile",
  "README.md",
  "TESTING.md",
  "worklog.md",
  "bun.lock",
  "components.json",
  "deploy.sh",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "tsconfig.scripts.json",
];

// ─── پوشه‌های کامل (هر فایلی که الان روی دیسک است، داخل زیپ می‌رود) ───
// v141 — «db-rescue» اضافه شد: نسخهٔ تمیز دیتابیس نجات (بحران malformed DB).
//   ⚠️ عمداً «db/» نیست (که exclude می‌شود) تا unzip هرگز روی دیتابیس زندهٔ
//   سرور نمی‌نویسد؛ فقط scripts/rescue-db.ts در صورت خرابی نصبش می‌کند.
const FULL_DIRS = ["src", "public", "prisma", "scripts", "mini-services", "fitup-app", "fitup-bazaar", "db-rescue"];

// ─── الگوهای حذف‌شدنی (build artifacts و امنیت) ───
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.next/,
  /(^|\/)build\//, // خروجی گریدل اندروید
  /(^|\/)\.gradle\//,
  /local\.properties$/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)db\//, // دیتابیس هرگز در زیپ دیپلوی نمی‌رود (روی سرور حفظ می‌شود)
  /^uploads\//, // رسانه‌های خصوصی کاربران (فولدر ریشهٔ uploads) نمی‌روند —
  // ⚠️ src/app/uploads/ (route سرویس رسانه) و public/uploads عمداً مجازند
  /dev\.log$/,
  /tool-results\//,
  /agent-ctx\//,
  // v94 — worklog.md دیگر حذف نمی‌شود: در ریشه داخل زیپ می‌رود (دیرکتیو مالک).
  // فقط worklogهای داخل download/ (نسخه‌های قدیمی) همچنان حذف می‌شوند.
  /^download\/.*worklog\.md$/,
  // v102 — زیپ‌های دیپلوی داخل public/downloads هرگز داخل زیپ دیپلوی نمی‌روند
  // (بازگشتی/حجیم — خودِ زیپ جدید داخل خودش می‌رفت؛ دانلود مرورگری بعد از pack کپی می‌شود)
  /public\/downloads\/fitup-deploy-.*\.zip$/,
];

// ─── download/: فقط مستندات + APKها + keystore + version.txt ───
const DOWNLOAD_ALLOWED_RE = /\.(md|txt|apk|keystore)$|\.deploy-manifest\.txt$/;

function walk(dir, baseDir = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (EXCLUDE_PATTERNS.some((re) => re.test(rel))) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, baseDir, out);
    else out.push(rel);
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const f of ROOT_FILES) {
    if (existsSync(join(ROOT, f))) files.push(f);
  }
  for (const d of FULL_DIRS) {
    if (existsSync(join(ROOT, d))) files.push(...walk(join(ROOT, d)));
  }
  // download/ — فقط مجازهای مشخص (مستندات/APK/keystore)
  if (existsSync(join(ROOT, "download"))) {
    for (const rel of walk(join(ROOT, "download"))) {
      if (DOWNLOAD_ALLOWED_RE.test(rel) && !/(^|\/)worklog\.md$/.test(rel)) files.push(rel);
    }
  }
  return [...new Set(files)].sort();
}

// ─── گندزدایی tsconfig.json (v82) — مستندات بالای فایل ───
function sanitizeTsconfigForZip() {
  const p = join(ROOT, "tsconfig.json");
  if (!existsSync(p)) return;
  let j;
  try {
    j = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    console.warn("⚠ tsconfig.json قابل تجزیه نیست — گندزدایی رد شد");
    return;
  }
  let changed = 0;
  if (Array.isArray(j.include)) {
    const kept = [];
    for (const entry of j.include) {
      // همهٔ .next* به‌جز .next.new (distDir فعلی سرور) سم‌اند
      if (
        typeof entry === "string" &&
        /^\.next($|[./-])/.test(entry) &&
        !/^\.next\.new\//.test(entry)
      ) {
        changed++;
        continue;
      }
      kept.push(entry);
    }
    j.include = kept;
  }
  if (!Array.isArray(j.exclude)) j.exclude = ["node_modules"];
  for (const dir of [".next", ".next.old"]) {
    if (!j.exclude.includes(dir)) {
      j.exclude.push(dir);
      changed++;
    }
  }
  if (changed > 0) {
    writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    console.log(`🧹 tsconfig.json گندزدایی شد (${changed} اصلاح — includeهای تایپِ بیلدهای قدیمی به zip نمی‌روند)`);
  }
}

// ─── v162 — همگام‌سازی خودکار version.txt اپ اختصاصی با جدیدترین APK بسته ───
// درس واقعی (گزارش مالک، دیپلوی v160/v161): APKهای جدید (1.5.0/code19) داخل
// بسته بودند ولی fitup-own-version.txt هنوز «1.3.4 18» بود → /api/app/own/latest
// به همه «آخرین نسخه = 1.3.4» می‌گفت → مودال «نسخه جدید» در اپ هرگز نمایش داده
// نمی‌شد. از این لحظه اسکریپتِ دیپلوی خودش version.txt را از نامِ جدیدترین
// fitup-own-v*.apk (هر دو پوشه download/ و public/downloads/) بازنویسی می‌کند —
// انسانی دیگر نمی‌تواند این فایل را فراموش کند. کد نسخه از نقشهٔ کدهای شناخته‌شده
// خوانده می‌شود؛ اگر ناشناخته بود، +۱ روی بالاترین کد شناخته‌شده.
const KNOWN_VERSION_CODES = {
  "1.1.0": 5, "1.2.0": 6, "1.2.1": 7, "1.2.2": 8, "1.2.3": 9, "1.2.4": 10,
  "1.2.8": 11, "1.2.9": 12, "1.3.0": 13, "1.3.1": 14, "1.3.2": 15,
  "1.3.3": 16, "1.3.4": 18, "1.5.0": 19, "1.6.0": 20, "1.7.0": 21, "1.8.0": 22, "1.9.0": 23,
  // v172 — بیلد واقعی سندباکس: fitup-app 1.10.0=24 (سند v171) و 1.11.0=25 (سند v172)
  "1.10.0": 24, "1.11.0": 25, "1.12.0": 26,
  // v175 — بیلد واقعی سندباکس: fitup-app 1.13.0=27 (سند v175 — پل native شارژ کیف پول)
  "1.13.0": 27,
  // v176 — بیلد واقعی سندباکس: fitup-app 1.14.0=28 (سند v176 — پل native با کد تخفیف)
  "1.14.0": 28,
};

function syncOwnAppVersionTxt() {
  try {
    const apks = readdirSync(join(ROOT, "download"))
      .filter((f) => /^fitup-own-v(\d+\.\d+\.\d+)\.apk$/i.test(f))
      .sort((a, b) => {
        const va = /fitup-own-v(\d+)\.(\d+)\.(\d+)/.exec(a).slice(1).map(Number);
        const vb = /fitup-own-v(\d+)\.(\d+)\.(\d+)/.exec(b).slice(1).map(Number);
        for (let i = 0; i < 3; i++) if (vb[i] !== va[i]) return vb[i] - va[i];
        return 0;
      });
    if (apks.length === 0) return;
    const m = /fitup-own-v(\d+\.\d+\.\d+)\.apk/i.exec(apks[0]);
    if (!m) return;
    const versionName = m[1];
    let code = KNOWN_VERSION_CODES[versionName];
    if (!code) {
      code = Math.max(0, ...Object.values(KNOWN_VERSION_CODES)) + 1;
      console.warn(`⚠ کد نسخهٔ ${versionName} ناشناخته است — ${code} فرض شد (KNOWN_VERSION_CODES را در build-deploy-zip.mjs به‌روز کنید)`);
    }
    const payload = `${versionName} ${code}`;
    for (const rel of ["download/fitup-own-version.txt", "public/downloads/fitup-own-version.txt"]) {
      const p = join(ROOT, rel);
      try {
        if (readFileSync(p, "utf8").trim() !== payload) {
          writeFileSync(p, payload);
          console.log(`🔁 ${rel} → «${payload}» (همگام با ${apks[0]})`);
        }
      } catch {}
    }
  } catch (e) {
    console.warn("⚠ همگام‌سازی version.txt رد شد:", e?.message || e);
  }
}

function main() {
  if (existsSync(outPath)) unlinkSync(outPath);

  syncOwnAppVersionTxt();
  sanitizeTsconfigForZip();
  const files = collectFiles();
  // manifest = لیست کامل فایل‌های بسته (روی سرور برای بررسی استفاده می‌شود)
  writeFileSync(manifestPath, files.join("\n") + "\n");

  const listFile = "/tmp/fitup-deploy-list.txt";
  writeFileSync(listFile, [...files, "download/.deploy-manifest.txt"].join("\n") + "\n");

  console.log(`📦 packing ${files.length + 1} files → ${outName}`);
  execSync(`cd "${ROOT}" && zip -q -X "${outPath}" -@ < "${listFile}"`, { stdio: "inherit" });

  // ─── گارد نهایی: تطبیق محتوای زیپ با دیسک (درس v54) ───
  const zipList = execSync(`unzip -Z1 "${outPath}"`).toString().split("\n").filter(Boolean);
  const zipSet = new Set(zipList);
  const missing = files.filter((f) => !zipSet.has(f));
  if (missing.length > 0) {
    console.error("❌ FILES MISSING FROM ZIP:");
    for (const m of missing) console.error("   " + m);
    process.exit(1);
  }
  // همهٔ فایل‌های src باید داخل زیپ باشند — بدون استثنا
  const srcDisk = walk(join(ROOT, "src"));
  const srcMissing = srcDisk.filter((f) => !zipSet.has(f));
  if (srcMissing.length > 0) {
    console.error("❌ src FILES MISSING FROM ZIP:");
    for (const m of srcMissing) console.error("   " + m);
    process.exit(1);
  }
  const size = statSync(outPath).size;
  console.log(`✅ ${outName} — ${files.length + 1} entries, ${(size / 1024 / 1024).toFixed(1)}MB — all src files verified inside`);
}

main();
