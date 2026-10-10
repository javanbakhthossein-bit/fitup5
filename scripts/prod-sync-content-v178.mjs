#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────
 *  فیتاپ — سینک محتوای v178 روی دیتابیس پروداکشن (بدون دیپلوی)
 * ─────────────────────────────────────────────────────────────────────────
 *  مصرف:
 *      node prod-sync-content-v178.mjs
 *      node prod-sync-content-v178.mjs --dry-run   (فقط گزارش، بدون تغییر)
 *      bun prod-sync-content-v178.mjs              (هم کار می‌کند)
 *
 *  محل اجرا: پوشهٔ اصلی پروژه روی سرور (همان‌جا که package.json و .env هستند)
 *
 *  این اسکریپت چه می‌کند؟ (دیرکتیو مالک ۲۰۲۶-۱۰-۰۱)
 *
 *  ۱) ادغام دسته‌بندی‌های تکراری مجله:
 *     در مجله دو دستهٔ «تمرین» وجود داشت — یکی فارسی (۲۰+ مقاله) و یکی
 *     انگلیسیِ legacy با مقدار "training" که در پنل مدیر هم با همان برچسب
 *     «تمرین» نشان داده می‌شد. همهٔ مقالات با مقادیر انگلیسی legacy به
 *     دستهٔ فارسی معادل منتقل و دستهٔ تکراری عملاً حذف می‌شود:
 *        training → تمرین        supplement → مکمل
 *        general → عمومی         nutrition → تغذیه
 *        motivation → انگیزشی    news → اخبار
 *        recovery → بازیابی      exercises → حرکات
 *        روش‌های-تمرینی → تمرین
 *
 *  ۲) backfill «منبع ثبت‌نام» کاربران قدیمی (برای داشبورد «منبع کاربران و
 *     فروش»): فقط ردیف‌هایی که signupSource ندارند، بر اساس سیگنال‌های موجود:
 *        appInstallSource=bazaar  → cafebazaar (کافه‌بازار)
 *        appInstallSource=panel   → app_panel (اپ اختصاصی)
 *        entrySource=instagram    → instagram
 *     بقیه «نامشخص» می‌مانند (دست نمی‌خوریم — حدس بی‌مدرک نمی‌زنیم).
 *     کاربران تازه از این پس هنگام ثبت‌نام خودکار ثبت می‌شوند.
 *
 *  ۳) هیچ‌چیز حذف نمی‌کند. هیچ ویدیو، متن یا محتوایی از حرکات تغییر
 *     نمی‌کند (ویدیوهای اختصاصی مدیر ۱۰۰٪ دست‌نخورده می‌مانند).
 *
 *  ۴) قبل از هر تغییری یک بکاپ کامل (VACUUM INTO) در db/backups می‌گیرد؛
 *     اگر بکاپ ممکن نشود بدون اجازهٔ صریح (SYNC_FORCE=1) متوقف می‌شود.
 *
 *  Idempotent است — اجرای مکرر بی‌ضرر و بی‌اثر است.
 * ─────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DRY = process.argv.includes("--dry-run");

const fa = (n) => Number(n ?? 0).toLocaleString("fa-IR");

/** نگاشت دسته‌های قدیمی → دستهٔ فارسی واحد */
const CATEGORY_MERGE = [
  { from: "training", to: "تمرین" },
  { from: "روش‌های-تمرینی", to: "تمرین" },
  { from: "supplement", to: "مکمل" },
  { from: "general", to: "عمومی" },
  { from: "nutrition", to: "تغذیه" },
  { from: "motivation", to: "انگیزشی" },
  { from: "news", to: "اخبار" },
  { from: "recovery", to: "بازیابی" },
  { from: "exercises", to: "حرکات" },
];

/** نگاشت backfill منبع ثبت‌نام (فقط برای signupSource خالی) */
const SOURCE_BACKFILL = [
  { field: "appInstallSource", value: "bazaar", source: "cafebazaar", detail: "backfill:appInstallSource" },
  { field: "appInstallSource", value: "panel", source: "app_panel", detail: "backfill:appInstallSource" },
  { field: "entrySource", value: "instagram", source: "instagram", detail: "backfill:entrySource" },
];

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m && !process.env.DATABASE_URL) {
      let v = m[1].replace(/^["']|["']$/g, "");
      if (!v.startsWith("file:")) v = "file:" + v;
      process.env.DATABASE_URL = v;
    }
  }
}

function resolveDbPath() {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) return null;
  let p = url.slice(5);
  if (!path.isAbsolute(p)) p = path.join(process.cwd(), p);
  return p;
}

async function makeBackup(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = path.join(process.cwd(), "db", "backups");
  const out = path.join(backupDir, `pre-content-sync-v178-${stamp}-${Math.random().toString(36).slice(2, 6)}.db`);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.rmSync(out, { force: true });
    await db.$executeRawUnsafe(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    return out;
  } catch {
    /* روش دوم: checkpoint + کپی فایل */
  }
  try {
    const dbPath = resolveDbPath();
    if (!dbPath) return null;
    try { await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(dbPath, out);
    for (const ext of ["-wal", "-shm"]) {
      if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, out + ext);
    }
    return out;
  } catch {
    return null;
  }
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  فیتاپ — سینک محتوای v178 (ادغام دسته‌های مجله + منبع ثبت‌نام)");
  if (DRY) console.log("  (حالت DRY-RUN — هیچ تغییری نوشته نمی‌شود)");
  console.log("════════════════════════════════════════════════════════════");

  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL پیدا نشد. این اسکریپت را در پوشهٔ اصلی پروژه (کنار package.json و .env) اجرا کنید.");
    process.exit(1);
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require("@prisma/client"));
  } catch {
    console.error("❌ @prisma/client در node_modules پیدا نشد.");
    process.exit(1);
  }
  const db = new PrismaClient();

  try {
    console.log(`\n📂 دیتابیس: ${process.env.DATABASE_URL.replace(/^file:/, "")}`);

    if (!DRY) {
      console.log("\n💾 در حال تهیهٔ بکاپ کامل…");
      const backupPath = await makeBackup(db);
      if (!backupPath) {
        if (process.env.SYNC_FORCE === "1") {
          console.warn("⚠️  بکاپ انجام نشد — چون SYNC_FORCE=1 است ادامه می‌دهیم.");
        } else {
          console.error("❌ بکاپ خودکار انجام نشد — برای امنیت هیچ تغییری اعمال نشد. (اجبار: SYNC_FORCE=1)");
          process.exit(1);
        }
      } else {
        console.log(`✅ بکاپ کامل: ${backupPath}`);
      }
    }

    // ─── ۱) ادغام دسته‌بندی‌های مقالات ─────────────────────────────────
    console.log("\n📰 مرحلهٔ ۱ از ۲ — ادغام دسته‌بندی‌های تکراری مجله…");
    let mergedTotal = 0;
    for (const { from, to } of CATEGORY_MERGE) {
      const count = await db.article.count({ where: { category: from } });
      if (count === 0) continue;
      console.log(`   «${from}» → «${to}»: ${fa(count)} مقاله`);
      if (!DRY) {
        await db.article.updateMany({ where: { category: from }, data: { category: to } });
      }
      mergedTotal += count;
    }
    if (mergedTotal === 0) console.log("   (چیزی برای ادغام نبود — قبلاً انجام شده)");

    // ─── ۲) backfill منبع ثبت‌نام کاربران قدیمی ────────────────────────
    console.log("\n🧭 مرحلهٔ ۲ از ۲ — backfill منبع ثبت‌نام (فقط ردیف‌های بدون منبع)…");
    const sourceReport = {};
    for (const { field, value, source, detail } of SOURCE_BACKFILL) {
      const count = await db.user.count({
        where: { signupSource: null, [field]: value },
      });
      if (count === 0) continue;
      console.log(`   ${fa(count)} کاربر → ${source}`);
      if (!DRY) {
        await db.user.updateMany({
          where: { signupSource: null, [field]: value },
          data: { signupSource: source, signupSourceDetail: detail },
        });
      }
      sourceReport[source] = (sourceReport[source] || 0) + count;
    }
    if (Object.keys(sourceReport).length === 0) {
      console.log("   (چیزی برای backfill نبود — قبلاً انجام شده یا سیگنالی موجود نیست)");
    }

    // ─── گزارش نهایی ──────────────────────────────────────────────────
    console.log("\n📊 وضعیت نهایی دسته‌های مجله:");
    const cats = await db.article.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { _count: { category: "desc" } } });
    for (const c of cats) console.log(`   ${c.category}: ${fa(c._count._all)} مقاله`);

    console.log("\n📊 وضعیت نهایی منبع ثبت‌نام:");
    const sources = await db.user.groupBy({ by: ["signupSource"], _count: { _all: true } });
    const label = { instagram: "اینستاگرام", google: "گوگل", cafebazaar: "کافه‌بازار", app_panel: "اپ اختصاصی", web: "وب", other: "سایر" };
    for (const s of sources) {
      console.log(`   ${s.signupSource ? (label[s.signupSource] || s.signupSource) : "نامشخص (قبل از v178)"}: ${fa(s._count._all)} کاربر`);
    }

    console.log("\n✅ تمام شد." + (DRY ? " (DRY-RUN — هیچ تغییری نوشته نشد)" : ""));
    console.log("   نکته: ویدیوها/محتوای بانک حرکات هرگز توسط این اسکریپت تغییر نمی‌کنند.");
  } catch (e) {
    console.error("❌ خطا:", e);
    process.exitCode = 1;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

main();
