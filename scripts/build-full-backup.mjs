#!/usr/bin/env node
/**
 * build-full-backup.mjs — بستهٔ «بازیابی فاجعه» فیتاپ (Disaster Recovery v1)
 *
 * ❓ چرا این اسکریپت ساخته شد؟
 * زیپ دیپلوی (build-deploy-zip.mjs) عمداً فقط «کد» را بسته‌بندی می‌کند:
 *   - db/ را نمی‌برد (روی سرور حفظ می‌شود تا دیپلوی روتین، دادهٔ زنده را نپوشاند)
 *   - uploads/ را نمی‌برد (رسانهٔ خصوصی کاربران)
 *   - .env واقعی را نمی‌برد (فقط .env.example)
 * نتیجه: با زیپ دیپلویِ خالی، کد ۱۰۰٪ برمی‌گردد اما «داده‌ها» نه — کاربران،
 * خریدها، چت‌ها، عکس‌ها و ویدیوها برای همیشه از دست می‌روند.
 *
 * ✅ این اسکریپت بستهٔ «صفر تا صد» می‌سازد:
 *   - همهٔ کد و کانفیگ‌ها (مثل زیپ دیپلوی)
 *   - اسنپ‌شات سازگار دیتابیس با VACUUM INTO (حتی وقتی سرور زنده در حال نوشتن است)
 *   - .env آمادهٔ سرور (مسیر /var/www/fitup)
 *   - کل پوشهٔ uploads (رسانهٔ کاربران)
 *   - RESTORE-FA.md — راهنمای بازیابی گام‌به‌گام فارسی
 *   - فایل sha256 برای اثبات سلامت فایل
 *
 * مصرف:  bun scripts/build-full-backup.mjs [version]
 * خروجی: download/fitup-full-backup-YYYY-MM-DD-v<version>.zip (+ .sha256)
 *
 * ⚠️ این بسته محرمانه است: حاوی دیتابیس واقعی کاربران است — هرگز درکان عمومی نگذارید.
 */
import { execSync } from "child_process";
import {
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { join, relative } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url); // برای bun:sqlite داخل ESM
const ROOT = process.cwd();
const version = process.argv[2] || "1";
const date = ISODateTehran();
const outName = `fitup-full-backup-${date}-v${version}.zip`;
const outPath = join(ROOT, "download", outName);
const STAGE = join(ROOT, ".dr-stage");
const SERVER_DIR = "/var/www/fitup";

// ─── تاریخ به‌وقت تهران (نه UTC) ───
function ISODateTehran() {
  const s = new Date().toLocaleString("en-CA", { timeZone: "Asia/Tehran" });
  return s.slice(0, 10); // YYYY-MM-DD
}

// ─── همان کالکشنِ زیپ دیپلوی + داده‌ها ───
const ROOT_FILES = [
  ".env",
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
const FULL_DIRS = ["src", "public", "prisma", "scripts", "mini-services", "fitup-app", "fitup-bazaar"];
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.next/,
  /(^|\/)build\//,
  /(^|\/)\.gradle\//,
  /local\.properties$/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)db\//, // دیتابیس فقط از مسیر اسنپ‌شات VACUUM INTO وارد زیپ می‌شود (نه فایل زندهٔ بین WAL)
  /dev\.log$/,
  /tool-results\//,
  /agent-ctx\//,
  /worklog\.md$/,
  /(^|\/)\.dr-stage\//,
];
// download/: فقط مستندات + APK + keystore (خودِ زیپ‌ها هرگز داخل زیپ نمی‌روند)
const DOWNLOAD_ALLOWED_RE = /\.(md|txt|apk|keystore)$|\.deploy-manifest\.txt$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (EXCLUDE_PATTERNS.some((re) => re.test(rel))) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(rel);
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const f of ROOT_FILES) if (existsSync(join(ROOT, f))) files.push(f);
  for (const d of FULL_DIRS) if (existsSync(join(ROOT, d))) files.push(...walk(join(ROOT, d)));
  if (existsSync(join(ROOT, "uploads"))) files.push(...walk(join(ROOT, "uploads")));
  if (existsSync(join(ROOT, "download"))) {
    for (const rel of walk(join(ROOT, "download"))) {
      if (DOWNLOAD_ALLOWED_RE.test(rel) && !rel.endsWith("worklog.md")) files.push(rel);
    }
  }
  return [...new Set(files)].sort();
}

// ─── گندزدایی tsconfig (همان درس v82 — includeهای تایپ بیلدهای قدیمی سم‌اند) ───
function sanitizeTsconfigForZip() {
  const p = join(ROOT, "tsconfig.json");
  if (!existsSync(p)) return;
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
  let changed = 0;
  if (Array.isArray(j.include)) {
    const kept = [];
    for (const entry of j.include) {
      if (
        typeof entry === "string" &&
        /^\.next($|[./-])/.test(entry) &&
        !/^\.next\.new\//.test(entry)
      ) { changed++; continue; }
      kept.push(entry);
    }
    j.include = kept;
  }
  if (!Array.isArray(j.exclude)) j.exclude = ["node_modules"];
  for (const dir of [".next", ".next.old"]) {
    if (!j.exclude.includes(dir)) { j.exclude.push(dir); changed++; }
  }
  if (changed > 0) {
    writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    console.log(`🧹 tsconfig.json گندزدایی شد (${changed} اصلاح)`);
  }
}

// ─── راهنمای بازیابی (داخل زیپ + کپی در download/) ───
function restoreGuide(dbBytes, uploadsBytes) {
  const mb = (b) => (b / 1024 / 1024).toFixed(1);
  return `# 🚑 راهنمای بازیابی کامل فیتاپ — صفر تا صد (Disaster Recovery)

این بسته یک «کلون کامل» لحظهٔ ساخت است: کد + دیتابیس واقعی + رسانهٔ کاربران.
با همین یک فایل، سایت روی هر سرور لینوکسی تازه از صفر بالا می‌آید — همان کاربران،
همان خریدها، همان چت‌ها، همان عکس‌ها و ویدیوها.

## 📦 محتویات بسته
| بخش | توضیح |
|---|---|
| src/ prisma/ scripts/ mini-services/ | کل سورس‌کد اپلیکیشن |
| fitup-app/ fitup-bazaar/ | سورس اپ‌های اندروید |
| db/custom.db | اسنپ‌شات سازگار دیتابیس (~${mb(dbBytes)}MB) — همهٔ کاربران/خریدها/چت‌ها/تغذیه/برنامه‌ها |
| uploads/ | رسانهٔ خصوصی کاربران (~${mb(uploadsBytes)}MB) — عکس/ویدیو/چت |
| .env | آمادهٔ مسیر ${SERVER_DIR} |
| deploy.sh + Caddyfile + کانفیگ‌ها | همان ابزار دیپلوی روتین |

⚠️ این فایل محرمانه است — حاوی دیتابیس واقعی کاربران. فقط در محل امن نگه دارید.

## ✅ پیش‌نیازهای سرور تازه
- اوبونتو/دبیان + دسترسی sudo
- unzip
- [bun](https://bun.sh) و pm2

\`\`\`bash
# ۱) نصب bun و pm2
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
bun add -g pm2 || npm i -g pm2

# ۲) آپلود و باز کردن بسته (فرض: فایل در /root)
sudo mkdir -p ${SERVER_DIR}
sudo unzip -o /root/${outName} -d ${SERVER_DIR}
cd ${SERVER_DIR}
unzip -t ${outName}   # فقط برای اطمینان — داخل بسته نمی‌رود

# ۳) مسیر دیتابیس را با مسیر واقعی سرور هم‌تراز کن
#    (.env داخل بسته از قبل برای ${SERVER_DIR} تنظیم شده؛ اگر مسیر دیگری ساختی، اصلاحش کن)
cat .env
#    باید این باشد: DATABASE_URL=file:${SERVER_DIR}/db/custom.db

# ۴) نصب وابستگی‌ها و ساخت کلاینت پرisma
bun install
bunx prisma generate

# ۵) بیلد پروداکشن
bun run build

# ۶) اجرا با pm2
pm2 start --name fitup bash -- -c 'cd ${SERVER_DIR} && bun run start'
pm2 save
pm2 startup   # دستور چاپ‌شده را اجرا کن تا بعد از ریبوت هم بالا بیاید

# ۷) وب‌سرور (Caddy)
sudo cp Caddyfile /etc/caddy/Caddyfile   # نام دامنه را در فایل چک کن
sudo systemctl reload caddy || (sudo apt install -y caddy && sudo systemctl enable --now caddy)

# ۸) تست سلامت
curl -I http://localhost:3000        # باید HTTP/1.1 200 بدهد
pm2 logs fitup --lines 20 --nostream
\`\`\`

## 🧪 تست‌های عملیاتی بعد از بازیابی
1. ورود ادمین با شماره و رمز موجود در دیتابیس (همان قبلی).
2. ورود یک کاربر نمونه → داشبورد → برنامهٔ فعال دیده شود.
3. آپلود یک عکس پیشرفت → در \`uploads/progress\` ثبت شود.
4. صفحهٔ چت → پیام ارسال و ذخیره شود.

## 🔄 دو سناریوی متفاوت — اشتباه نگیرید!
| سناریو | ابزار درست | توضیح |
|---|---|---|
| دیپلوی روتین (آپدیت کد روی سرور زنده) | \`fitup-deploy-*.zip\` | دیتابیس سرور را **دست نمی‌زند** |
| فاجعه (سرور/سندباکس کاملاً از بین رفت) | همین \`fitup-full-backup-*.zip\` | کد **و** داده را با هم برمی‌گرداند |

⚠️ اگر سرور قدیمی فقط «کدش» خراب شده ولی دیتابیس سالم است، این بسته را کامل باز نکنید —
فقط کد را از زیپ دیپلوی بگیرید تا داده‌های بین‌backup از دست نروند.

## 🕐 عمر داده
این بسته «عکس لحظه‌ای» است: هر چیزی که بعد از ساختش ثبت شود (ثبت‌نام جدید، خرید،
چت، عکس) در آن نیست. پس بعد از هر تغییر مهم، نسخهٔ جدید بسازید:
\`\`\`bash
bun scripts/build-full-backup.mjs   # نسخهٔ بعدی را به‌صورت دستی بده: bun scripts/build-full-backup.mjs 2
\`\`\`
و فایل جدید را خارج از سرور (لپ‌تاپ/گوشی/فضای ابری) ذخیره کنید.
`;
}

function main() {
  if (existsSync(outPath)) unlinkSync(outPath);
  rmSync(STAGE, { recursive: true, force: true });

  // ─── گاردهای محیط: روی سندباکس و روی سرور واقعی باید کار کند ───
  for (const tool of ["zip", "unzip", "sha256sum"]) {
    try { execSync(`which ${tool}`, { stdio: "pipe" }); } catch {
      console.error(`❌ ابزار «${tool}» نصب نیست — نصبش کن: sudo apt install -y zip unzip coreutils`);
      process.exit(1);
    }
  }
  if (ROOT !== SERVER_DIR && existsSync(SERVER_DIR)) {
    console.warn(`⚠ هشدار: این ماشین ${SERVER_DIR} دارد ولی از «${ROOT}» اجرا شد — برای بکاپ دادهٔ واقعیِ تولید، روی سرور از داخل همان پوشه اجرا کن: cd ${SERVER_DIR} && bun scripts/build-full-backup.mjs`);
  }

  // ─── ۰) گاردها ───
  const dbPath = join(ROOT, "db", "custom.db");
  if (!existsSync(dbPath)) {
    console.error("❌ db/custom.db پیدا نشد — بستهٔ بازیابی بدون دیتابیس بی‌معنی است");
    process.exit(1);
  }
  const hasUploads = existsSync(join(ROOT, "uploads"));
  if (!hasUploads) console.warn("⚠ پوشهٔ uploads/ نیست — بسته بدون رسانهٔ کاربران ساخته می‌شود");

  sanitizeTsconfigForZip();

  // ─── ۱) اسنپ‌شات سازگار دیتابیس با VACUUM INTO (حتی حین نوشتنِ سرور زنده سالم است) ───
  mkdirSync(join(STAGE, "db"), { recursive: true });
  const snapPath = join(STAGE, "db", "custom.db");
  try {
    const { Database } = require("bun:sqlite");
    const d = new Database(dbPath, { readonly: true });
    d.exec(`VACUUM INTO '${snapPath}'`);
    d.close();
    console.log("📸 اسنپ‌شات دیتابیس با VACUUM INTO گرفته شد (سازگار با WAL)");
  } catch (e) {
    // فالبک: کپی مستقیم db + wal + shm (کمی ریسک تراکنش نیمه‌کاره، اما عملی)
    copyFileSync(dbPath, snapPath);
    for (const ext of ["-wal", "-shm"]) {
      if (existsSync(dbPath + ext)) copyFileSync(dbPath + ext, snapPath + ext);
    }
    console.warn("⚠ VACUUM INTO شکست خورد — کپی مستقیم db+wal+shm انجام شد:", e.message);
  }

  // ─── ۲) .env آمادهٔ سرور ───
  const envServer = `# فیتاپ — تولیدشده توسط build-full-backup.mjs (بستهٔ بازیابی فاجعه)
# اگر مسیر نصب روی سرور تازه چیز دیگری است، همین‌جا اصلاحش کن.
DATABASE_URL=file:${SERVER_DIR}/db/custom.db
`;
  writeFileSync(join(STAGE, ".env"), envServer);

  // ─── ۳) راهنمای بازیابی ───
  const dbBytes = statSync(snapPath).size;
  const uploadsBytes = hasUploads
    ? execSync(`du -sb "${join(ROOT, "uploads")}" | cut -f1`).toString().trim() * 1
    : 0;
  const guide = restoreGuide(dbBytes, uploadsBytes);
  writeFileSync(join(STAGE, "RESTORE-FA.md"), guide);

  // ─── ۴) پکِ اصلی (کد + کانفیگ + uploads + download مجازها) ───
  const files = collectFiles();
  const listFile = "/tmp/fitup-dr-list.txt";
  writeFileSync(listFile, files.join("\n") + "\n");
  console.log(`📦 packing ${files.length} files (کد+کانفیگ+رسانه) → ${outName}`);
  execSync(`cd "${ROOT}" && zip -q -X "${outPath}" -@ < "${listFile}"`, { stdio: "inherit" });

  // ─── ۵) افزودن/جایگزینی: .env سرور، db/custom.db اسنپ‌شات، RESTORE-FA.md در ریشه ───
  execSync(`cd "${STAGE}" && zip -q "${outPath}" .env db/custom.db`);
  execSync(`cd "${STAGE}" && zip -q -j "${outPath}" RESTORE-FA.md`);

  // ─── ۶) گارد نهایی: تطبیق محتوای زیپ با لیست ───
  const zipList = execSync(`unzip -Z1 "${outPath}"`).toString().split("\n").filter(Boolean);
  const zipSet = new Set(zipList);
  const missing = files.filter((f) => !zipSet.has(f));
  if (missing.length > 0) {
    console.error("❌ FILES MISSING FROM ZIP:");
    for (const m of missing) console.error("   " + m);
    process.exit(1);
  }
  for (const must of [".env", "db/custom.db", "RESTORE-FA.md"]) {
    if (!zipSet.has(must)) {
      console.error(`❌ فایل حیاتی «${must}» داخل زیپ نیست`);
      process.exit(1);
    }
  }
  // کل src باید داخل باشد
  const srcDisk = walk(join(ROOT, "src"));
  const srcMissing = srcDisk.filter((f) => !zipSet.has(f));
  if (srcMissing.length > 0) {
    console.error("❌ src FILES MISSING FROM ZIP:");
    for (const m of srcMissing) console.error("   " + m);
    process.exit(1);
  }
  // کنترل سلامت اسنپ‌شات داخل زیپ: unzip و شمارش کاربران
  const userCount = execSync(
    `cd "${STAGE}/db" && unzip -oq "${outPath}" db/custom.db -d /tmp/dr-verify 2>/dev/null; ` +
    `bun -e 'import{Database}from"bun:sqlite";const d=new Database("/tmp/dr-verify/db/custom.db",{readonly:true});console.log(d.query("SELECT COUNT(*) c FROM User").get().c);d.close()'`
  ).toString().trim();
  rmSync("/tmp/dr-verify", { recursive: true, force: true });

  // ─── ۷) sha256 برای اثبات سلامت فایل ───
  const sha = execSync(`sha256sum "${outPath}"`).toString().split(" ")[0];
  writeFileSync(join(ROOT, "download", outName + ".sha256"), `${sha}  ${outName}\n`);
  copyFileSync(join(STAGE, "RESTORE-FA.md"), join(ROOT, "download", "RESTORE-FA.md"));

  rmSync(STAGE, { recursive: true, force: true });

  const size = statSync(outPath).size;
  console.log("──────────────────────────────────────────────");
  console.log(`✅ ${outName}`);
  console.log(`   ${zipList.length} entries — ${(size / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   کاربران داخل دیتابیسِ بسته: ${userCount}`);
  console.log(`   sha256: ${sha.slice(0, 16)}… (فایل کامل: download/${outName}.sha256)`);
  console.log(`   راهنما: download/RESTORE-FA.md`);
}

main();
