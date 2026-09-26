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
const FULL_DIRS = ["src", "public", "prisma", "scripts", "mini-services", "fitup-app", "fitup-bazaar"];

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

function main() {
  if (existsSync(outPath)) unlinkSync(outPath);

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
