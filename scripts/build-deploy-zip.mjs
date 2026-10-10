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
 * v197 — دیرکتیو مالک: «دیگه داخل زیپ دیپلوی لازم نیستش که عکس‌ها و ویدیوهای
 * چالش‌ها و بانک‌ها رو بذاریم فقط سورس کد باشه اونا رو روی سرورم دارم دیگه»:
 *   • ویدیوها: public/videos/ (چالش‌ها + Muscle Wiki بانک حرکات) — از v190 حذف بود
 *   • عکس‌های چالش‌ها: public/images/challenges/ — از v197 حذف
 *   • عکس‌های بانک (دیتابیس‌محور /videos و /uploads) هرگز از دیسک سندباکس
 *     داخل زیپ نمی‌رفتند (فقط مسیر در دیتابیس است) — تغییری لازم نبود
 *   • آرتیفکت‌های توسعه: public/shots-temp و public/research-preview حذف
 *   • نگهداشت: fonts/animations/splash/icons/hero (UI سایت به آن‌ها نیاز دارد)
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
  // v190 — دیرکتیو مالک: «زیپ دیپلوی‌های بعدی دیگه ویدیوها نباید باشن» —
  // ویدیوهای Muscle Wiki (~۳۵۰MB) هرگز داخل زیپ نمی‌روند؛ روی سرور با rsync/آپلود
  // جداگانه منتقل می‌شوند و در سندباکس باقی می‌مانند.
  // v197 — این exclude حالا ویدیوهای چالش‌ها (/videos/challenges) را هم می‌پوشاند.
  /^public\/videos\//,
  // v197 — دیرکتیو مالک: «فقط سورس کد» — عکس‌های چالش‌ها روی سرور موجودند
  /^public\/images\/challenges\//,
  // v197 — آرتیفکت‌های توسعه (اسکرین‌شات موقت + خروجی تحقیق) به زیپ نمی‌روند
  /^public\/shots-temp\//,
  /^public\/research-preview\//,
  // v199 — دیرکتیو مالک: «سورس کدها به صورت کامل بدون عکس‌ها و بدون گیف‌ها» —
  // هیچ تصویری از public داخل زیپ نمی‌رود؛ همگی روی سرور موجودند و unzip هرگز
  // فایلِ موجود را حذف نمی‌کند ⇒ دیپلوی بدون تصویر ۱۰۰٪ امن است.
  // (فونت‌ها، مانیفست، فایل‌های متنی/HTML حفظ می‌شوند؛ دارایی‌های داخل سورس
  // اپ‌های اندروید fitup-app/fitup-bazaar جزو سورس کامپایل‌پذیرند و مثل v197 می‌مانند.)
  /^public\/.+\.(png|jpe?g|gif|webp|ico|avif|svg)$/i,
];

// ─── v204 — استثنای مجازِ تصاویر (allowlist) ───
// دیرکتیو مالک در v204: «زیپ دیپلوی باید همهٔ کد + تغییرات مثل عکس‌ها را داشته باشد».
// عکس هیروی جدید لندینگ (PNG آپلودکُن → AVIF/WebP با ۸ واریانت responsive) فایلِ
// جدیدی است که روی سرور وجود ندارد — اگر داخل زیپ نرود، <picture> هیرو روی سرور
// عکس خراب نشان می‌دهد. unzip هرگز فایلِ موجود را حذف/بازنویسی‌بی‌دلیل نمی‌کند،
// پس افزودن این ۸ فایل به زیپ ۱۰۰٪ امن است و قانون v199 را نمی‌شکند
// (فقط همین allowlist؛ بقیهٔ تصاویر مثل قبل خارج می‌مانند).
const PUBLIC_IMAGE_ALLOWLIST = [
  "public/hero-fitup.avif",
  "public/hero-fitup.webp",
  "public/hero-fitup-680.avif",
  "public/hero-fitup-680.webp",
  "public/hero-fitup-desktop.avif",
  "public/hero-fitup-desktop.webp",
  "public/hero-fitup-mobile.avif",
  "public/hero-fitup-mobile.webp",
  // v211 — لوگوی عمومی سایت (og:image و fallbackهای img): روی سندباکس ۴۰۴ می‌داد
  // (فایل در public نبود) — با همین الگوی v204 داخل زیپ می‌رود تا سرورِ فاقد آن هم سالم شود
  "public/fitup-logo.png",
  // v218 — تصویر OG اختصاصی ۱۲۰۰×۶۳۰ (اشتراک‌گذاری تلگرام/واتساپ/فیسبوک) +
  // favicon.ico در ریشه (قبلاً 404 می‌داد) — فایل‌های جدید روی سرور نیستند ⇒
  // طبق الگوی v204 به allowlist اضافه شدند
  "public/og/og-default.png",
  "public/favicon.ico",
];

// ─── download/: فقط مستندات + APKها + keystore + version.txt ───
const DOWNLOAD_ALLOWED_RE = /\.(md|txt|sh|apk|keystore)$|\.deploy-manifest\.txt$/;

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
  // v204 — عکس‌های هیروی جدید (allowlist بالا) — فایل‌های جدیدی که روی سرور نیستند
  for (const rel of PUBLIC_IMAGE_ALLOWLIST) {
    if (existsSync(join(ROOT, rel))) files.push(rel);
  }
  // download/ — فقط مجازهای مشخص (مستندات/APK/keystore)
  if (existsSync(join(ROOT, "download"))) {
    for (const rel of walk(join(ROOT, "download"))) {
      if (DOWNLOAD_ALLOWED_RE.test(rel) && !/(^|\/)worklog\.md$/.test(rel)) files.push(rel);
    }
  }
  // v199 — دیرکتیو مالک: «فقط نسخه‌های آخر اپ‌ها فقط باشه» — از همهٔ APKهای
  // download/ و public/downloads/ فقط آخرین نسخهٔ هر اپ (fitup-own +
  // fitup-bazaar) بسته می‌شود؛ نسخه‌های قدیمی حذف.
  const latestApks = collectLatestApkNames();
  const filtered = files.filter((rel) => {
    const m = /^(?:download|public\/downloads)\/fitup-(own|bazaar)-v\d+\.\d+\.\d+\.apk$/i.exec(rel);
    if (m && !latestApks.has(rel.split("/").pop() ?? "")) return false;
    return true;
  });
  return [...new Set(filtered)].sort();
}

// v199 — نام فایلِ آخرین نسخهٔ هر اپ از download/ و public/downloads/
function collectLatestApkNames() {
  const best = new Map(); // family(own|bazaar) → { v:[a,b,c], name }
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const m = /^fitup-(own|bazaar)-v(\d+)\.(\d+)\.(\d+)\.apk$/i.exec(name);
      if (!m) continue;
      const fam = m[1].toLowerCase();
      const v = [Number(m[2]), Number(m[3]), Number(m[4])];
      const cur = best.get(fam);
      const gt =
        !cur ? true :
        v[0] !== cur.v[0] ? v[0] > cur.v[0] :
        v[1] !== cur.v[1] ? v[1] > cur.v[1] :
        v[2] > cur.v[2];
      if (gt) best.set(fam, { v, name });
    }
  };
  scan(join(ROOT, "download"));
  scan(join(ROOT, "public", "downloads"));
  return new Set([...best.values()].map((x) => x.name));
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
  "1.3.3": 16, "1.3.4": 18, "1.5.0": 19, "1.6.0": 20, "1.7.0": 21, "1.8.0": 22, "1.17.3": 34, "1.17.0": 31, "1.16.0": 30, "1.15.0": 29, "1.9.0": 23,
  // v172 — بیلد واقعی سندباکس: fitup-app 1.10.0=24 (سند v171) و 1.11.0=25 (سند v172)
  "1.10.0": 24, "1.11.0": 25, "1.12.0": 26,
  // v175 — بیلد واقعی سندباکس: fitup-app 1.13.0=27 (سند v175 — پل native شارژ کیف پول)
  "1.13.0": 27,
  // v176 — بیلد واقعی سندباکس: fitup-app 1.14.0=28 (سند v176 — پل native با کد تخفیف)
  "1.14.0": 28,
  // v194 — بیلد واقعی سندباکس: fitup-app 1.17.1=32 (فیکس باگ صدا + بهینه‌سازی پروفایل/انیمیشن + seed گسترش‌یافته)
  "1.17.1": 32,
  // v194 — بیلد واقعی سندباکس: bazaar 1.15.1=28 (همسان با fitup-app)
  "1.15.1": 28,
  // v202 — بیلد واقعی سندباکس: چرخش امنیتی کلید bridge OTP (H1)
  "1.17.2": 33,
  "1.15.2": 29,
  "1.15.3": 30,
  // v206 — بیلد واقعی سندباکس: LoopbackProxy (درمان ریشه‌ای سناریوی FakeDNS VPNها)
  "1.17.4": 35,
  "1.15.4": 31,
  // v207 — بیلد واقعی سندباکس: درمان ریشه‌ای «تخفیف‌ها در درگاه اپ بازار» (تغییرات سمت سرور/وب؛ bump نسخه هر دو اپ)
  "1.17.5": 36,
  "1.15.5": 32,
  // v211 — بیلد واقعی سندباکس: درمان «اطلاعات ارسالی برنامه برای پرداخت نامعتبر است»
  // (پل getSkuDetails/getBazaarVersion بازار؛ own اپ تغییری ندارد)
  "1.15.6": 33,
  // v222 — بیلد واقعی سندباکس: اتصال خودکار بدون صفحهٔ خطا (own + bazaar)
  "1.17.6": 37,
  "1.15.7": 34,
  // v223 — بیلد واقعی سندباکس: FCM واقعی فعال (کلیدهای Firebase مالک — پروژه fittup-71d6d)
  "1.18.0": 38,
  "1.16.0": 35,
  // v224 — بیلد واقعی سندباکس: حذف بنیادی صفحهٔ «اتصال برقرار نیست» (اسپلش برند + اتصال خودکار)
  // + حذف صفحهٔ مشکی قبل از ویدیو (زمینهٔ نارنجی فریم اول + پوستر) + seed تازهٔ سایت
  "1.19.0": 39,
  "1.17.0": 36,
  // v225 — بیلد واقعی سندباکس: ریشهٔ نهایی «اتصال برقرار نیست» — گارد onReceivedHttpError
  // (۵xx فریم اصلی = اسپلش برند + اتصال خودکار؛ فال‌بک سرویس‌ورکر = اسپلش بدون خطا)
  "1.19.1": 40,
  "1.17.1": 37,
  // v226 — بیلد واقعی سندباکس: زنجیرهٔ بک مالک — بک در حالت باشگاه/چت با فیتاپ/تمرین امروز
  // (برگشت از چت به تمرین، تأیید خروج، هرگز پرش مستقیم به داشبورد) + seed تازهٔ سایت
  "1.19.2": 41,
  "1.17.2": 38,
  // v227 — تشخیص پوش (پل وضعیت مجوز اعلان در هر دو اپ) + seed تازه با فیکس بک مودال برنامه‌ها
  "1.19.3": 42,
  "1.17.3": 39,
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

// ─── v228 — گیت ضد lookbehind (خطای Clarity: «Invalid regular expression:
//     invalid group specifier name» روی Safari < 16.4 / WebKit قدیمی) ──
// ریشه‌یابی v228: کد فیتاپ صفر lookbehind محافظت‌نشده دارد (۲۸ چانک زندهٔ سه صفحه
// + HTML inline + SDK خود Clarity راستی‌آزمایی شد). این گیت جلوی رگرسیون آینده
// را در سطح آرتیفکت می‌گیرد — چانکِ حاوی lookbehind روی WebKit قدیمی در زمانِ
// parse می‌میرد و کل صفحه را می‌شکند. lookbehind = خطا (exit 1)؛ named group
// = فقط هشدار (فقط Safari < 11.1 سال ۲۰۱۸ را می‌شکند).
// اسکن: distDir فعال بیلد محلی (.next.new یا .next) + بذرِ هر دو APK (آینهٔ
// چانک‌های زندهٔ production) + sw.js. امضای مجاز: feature-detection محافظت‌شدهٔ
// core-js («(?<a>b)» داخل try/catch خودش — هرگز uncaught نمی‌شود).
function collectJsFiles(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collectJsFiles(p, out);
    else if (e.isFile() && e.name.endsWith(".js")) out.push(p);
  }
}

function checkLegacyRegex() {
  const targets = [];
  // خروجی production (distDir سرور) — سخت‌گیرانه (fail)
  for (const base of [".next.new", ".next.prod-test"]) {
    const dir = join(ROOT, base, "static");
    if (existsSync(dir)) collectJsFiles(dir, targets);
  }
  // بذرِ هر دو APK = آینهٔ چانک‌های زندهٔ production — سخت‌گیرانه (fail)
  for (const seed of [
    "fitup-app/app/src/main/assets/seed/nx",
    "fitup-bazaar/app/src/main/assets/seed/nx",
  ]) {
    const dir = join(ROOT, seed);
    if (existsSync(dir)) collectJsFiles(dir, targets);
  }
  const sw = join(ROOT, "public", "sw.js");
  if (existsSync(sw)) targets.push(sw);
  // خروجی dev محلی — فقط هشدار (چانک‌های ابزار dev ممکن است false-positive بدهند
  // و هرگز سرو نمی‌شوند)
  const devDir = join(ROOT, ".next", "static");
  const devTargets = [];
  if (existsSync(devDir) && !existsSync(join(ROOT, ".next.new"))) collectJsFiles(devDir, devTargets);

  let failed = false;
  let scanned = 0;
  const scan = (file, strict) => {
    let content;
    try { content = readFileSync(file, "utf8"); } catch { return; }
    scanned++;
    // امضای مجاز core-js حذف می‌شود تا false-positive ندهد
    const cleaned = content.split('"(?<a>b)"').join("").split("'(?<a>b)'").join("");
    if (/\(\?<[=!]/.test(cleaned)) {
      if (strict) {
        console.error(`❌ [legacy-regex] lookbehind در ${relative(ROOT, file)} — Safari < 16.4 / WebKit قدیمی می‌شکند`);
        failed = true;
      } else {
        console.warn(`⚠ [legacy-regex] lookbehind در خروجی dev (${relative(ROOT, file)}) — سرو نمی‌شود، صرف‌نظر شد`);
      }
    } else if (strict && /\(\?<[a-zA-Z_][a-zA-Z0-9_]*>/.test(cleaned)) {
      console.warn(`⚠ [legacy-regex] named group در ${relative(ROOT, file)} — فقط Safari < 11.1 (۲۰۱۸) می‌شکند — هشدار`);
    }
  };
  for (const f of targets) scan(f, true);
  for (const f of devTargets) scan(f, false);
  if (failed) {
    console.error("❌ بسته‌بندی متوقف شد — lookbehind را حذف کن (الگوی v199: گروه گیرندهٔ (?:…) + استخراج گروه ۱)");
    process.exit(1);
  }
  console.log(`✅ [legacy-regex] ${scanned} فایل جاوااسکریپتِ سرو‌شده تمیز — صفر lookbehind`);
}

function main() {
  if (existsSync(outPath)) unlinkSync(outPath);

  checkLegacyRegex();
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
