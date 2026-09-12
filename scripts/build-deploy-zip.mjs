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
 */
import { execSync } from "child_process";
import { readdirSync, statSync, existsSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join, relative, dirname } from "path";

const ROOT = process.cwd();
const version = process.argv[2] || "55";
const date = new Date().toISOString().slice(0, 10);
const outName = `fitup-deploy-${date}-v${version}.zip`;
const outPath = join(ROOT, "download", outName);
const manifestPath = join(ROOT, "download", ".deploy-manifest.txt");

// ─── فایل‌های ریشه (همهٔ کانفیگ‌های پروژه) ───
const ROOT_FILES = [
  ".env.example",
  ".gitignore",
  "Caddyfile",
  "README.md",
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
  /worklog\.md$/,
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
      if (DOWNLOAD_ALLOWED_RE.test(rel) && !rel.endsWith("worklog.md")) files.push(rel);
    }
  }
  return [...new Set(files)].sort();
}

function main() {
  if (existsSync(outPath)) unlinkSync(outPath);

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
