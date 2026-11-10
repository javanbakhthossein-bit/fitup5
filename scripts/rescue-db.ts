/// <reference types="bun-types" />
/**
 * rescue-db.ts — نگهبان/نجات دیتابیس فیتاپ (v141)
 *
 * ─── چرا این اسکریپت ساخته شد؟ ───
 * بحران واقعی سرور مالک (۲۰۲۶-۰۹-۲۶): دیتابیس db/custom.db با خطای
 * «database disk image is malformed» (SQLITE_CORRUPT — کد ۱۱) کاملاً خراب شد.
 * اسکریپت ترمیم سه‌لایه‌ای فقط ۱ رکورد نجات داد و دیتابیسِ «ترمیم‌شده» عملاً
 * خالی بود (بدون جداول User/ExerciseLibrary/...) → سایت بعد از pm2 restart
 * بالا نمی‌آمد چون هر کوئری پرایسما روی جداول غایب می‌سوخت.
 *
 * راه‌حل: نسخهٔ تمیز و راستی‌آزمایی‌شدهٔ دیتابیس (۵۸۱ حرکت + ۱۵۲۵ غذا +
 * ۵۴ جدول کامل) داخل زیپ دیپلوی در مسیر «db-rescue/custom.db» سفر می‌کند
 * (عمداً خارج از پوشهٔ db/ تا unzip هیچ‌وقت به‌صورت خودکار روی دیتابیس زندهٔ
 * سرور نمی‌نویسد) و این اسکریپت در deploy.sh (قدم ۱-الف) آن را نصب می‌کند:
 *
 *   • دیتابیس فعلی سالم است (integrity ok + همهٔ جداول کلیدی موجود) →
 *     ✋ هیچ کاری نمی‌کند (دیتای واقعی کاربران مقدس است)
 *   • دیتابیس خراب/جدول‌های کلیدی غایب/فایل غایب است →
 *     ۱) pm2 stop fitup (فقط اگر pm2 در دسترس باشد)
 *     ۲) بکاپ کامل فایل خراب (+wal/shm) در db/corrupt-backup-<زمان>/
 *     ۳) کپی نسخهٔ تمیز → db/custom.db
 *     ۴) journal_mode=WAL + راستی‌آزمایی نهایی (integrity + شمارش)
 *
 * حالت «--force»: حتی دیتابیس سالم را هم (بعد از بکاپ) با نسخهٔ تمیز
 * جایگزین می‌کند — فقط برای نجاتِ دستیِ فوری (rescue-now.sh زیپ DB).
 *
 * ⚠️ عمداً از @prisma/client استفاده نمی‌کند (قبل از prisma generate اجرا
 * می‌شود) — فقط bun:sqlite داخلی + fs، بدون هیچ وابستگی.
 *
 * اجرا:      bun run scripts/rescue-db.ts
 * اجرای زوری: bun run scripts/rescue-db.ts --force
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const FORCE = process.argv.includes("--force");
const RESCUE_SRC = path.join(ROOT, "db-rescue", "custom.db");
const TARGET = path.join(ROOT, "db", "custom.db");

/** جداولی که اگر هرکدام غایب باشند یعنی دیتابیس «کامل» نیست و سایت بالا نمی‌آید */
const KEY_TABLES = [
  "User",
  "Subscription",
  "OnboardingProfile",
  "WorkoutPlan",
  "MealPlan",
  "ExerciseLibrary",
  "FoodLibrary",
  "HeadCode",
  "SiteSetting",
  "Article",
  "Checkup",
  "ProgramRequest",
  "Notification",
];

interface Health {
  exists: boolean;
  integrity: string; // "ok" یا متن خطا
  tableCount: number;
  missingKey: string[];
  healthy: boolean;
}

/** سلامت یک فایل SQLite را بررسی کن (فقط-خواندنی؛ هیچ تغییری نمی‌دهد) */
function inspect(dbFile: string): Health {
  const h: Health = { exists: false, integrity: "فایل وجود ندارد", tableCount: 0, missingKey: [], healthy: false };
  if (!existsSync(dbFile)) return h;
  h.exists = true;
  let db: Database;
  try {
    db = new Database(dbFile, { readonly: true });
  } catch (e) {
    h.integrity = `باز شدن ناموفق: ${(e as Error).message}`;
    return h;
  }
  try {
    try {
      const row = db.query("PRAGMA integrity_check;").get() as { integrity_check?: string } | null;
      h.integrity = row?.integrity_check ?? "بدون پاسخ";
    } catch (e) {
      h.integrity = `خطا: ${(e as Error).message}`;
    }
    let tables: string[] = [];
    try {
      tables = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
        (r) => r.name
      );
    } catch {
      tables = [];
    }
    h.tableCount = tables.length;
    h.missingKey = KEY_TABLES.filter((t) => !tables.includes(t));
  } finally {
    db.close();
  }
  h.healthy = h.integrity === "ok" && h.missingKey.length === 0;
  return h;
}

function fmtSize(f: string): string {
  try {
    const b = statSync(f).size;
    return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`;
  } catch {
    return "؟";
  }
}

/** توقف pm2 فقط وقتی قرار است فایل جایگزین شود (best-effort) */
function stopPm2IfPossible(): void {
  try {
    const r = Bun.spawnSync(["pm2", "stop", "fitup"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode === 0) console.log("  ⏸ pm2 stop fitup — انجام شد");
    else console.log("  ℹ pm2 در دسترس نیست یا فرآیند fitup ثبت نشده — رد شد");
  } catch {
    console.log("  ℹ pm2 در دسترس نیست — رد شد");
  }
}

function main(): number {
  console.log("🩺 نگهبان دیتابیس فیتاپ (v141) — بررسی و نجات");
  console.log(`  • هدف: ${path.relative(ROOT, TARGET)}`);

  if (!existsSync(RESCUE_SRC)) {
    console.log("  ℹ این بسته، دیتابیس نجات (db-rescue/custom.db) را حمل نمی‌کند — بررسی رد شد");
    return 0;
  }
  console.log(`  • نسخهٔ تمیز همراه بسته: ${path.relative(ROOT, RESCUE_SRC)} (${fmtSize(RESCUE_SRC)})`);

  const health = inspect(TARGET);
  console.log(
    `  • وضعیت فعلی: ${health.exists ? `موجود (${fmtSize(TARGET)})` : "غایب"} | integrity: ${health.integrity} | جداول: ${health.tableCount}`
  );
  if (health.missingKey.length > 0) {
    console.log(`  • جداول کلیدی غایب (${health.missingKey.length}): ${health.missingKey.join("، ")}`);
  }

  if (health.healthy && !FORCE) {
    console.log("  ✅ دیتابیس فعلی سالم و کامل است — دست نمی‌زنیم (دیتای کاربران محفوظ ماند)");
    return 0;
  }

  if (health.healthy && FORCE) {
    console.log("  ⚠ حالت --force: دیتابیس سالم است ولی جایگزینی صریح خواسته شده — بکاپ گرفته می‌شود");
  }

  // ─── نجات ───
  console.log("  🚑 شروع نجات دیتابیس...");
  stopPm2IfPossible();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = path.join(ROOT, "db", `corrupt-backup-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${TARGET}${suffix}`;
    if (existsSync(f)) {
      try {
        copyFileSync(f, path.join(backupDir, `custom.db${suffix}`));
        console.log(`  📦 بکاپ: ${path.relative(ROOT, backupDir)}/custom.db${suffix}`);
      } catch (e) {
        console.log(`  ⚠ بکاپ ${path.basename(f)} ناموفق: ${(e as Error).message}`);
      }
    }
  }

  try {
    mkdirSync(path.dirname(TARGET), { recursive: true });
    // بقایای WAL/SHM قدیمی باید حتماً حذف شوند وگرنه SQLite فایل جدید را با
    // WAL ناهم‌خوانِ قبلی می‌آلایش («malformed» ساختگی!)
    rmSync(`${TARGET}-wal`, { force: true });
    rmSync(`${TARGET}-shm`, { force: true });
    copyFileSync(RESCUE_SRC, TARGET);
  } catch (e) {
    console.error(`  ✗ کپی نسخهٔ تمیز ناموفق: ${(e as Error).message}`);
    console.error(`     بکاپ فایل خراب اینجاست: ${path.relative(ROOT, backupDir)}`);
    return 1;
  }

  // فعال‌سازی WAL + راستی‌آزمایی نهایی
  let verifyOk = false;
  let post: Health;
  try {
    // ⚠️ بدون گزینه create:false — bun:sqlite در برخی نسخه‌ها با «bad parameter»
    // می‌میرد؛ فایل همین الان کپی شده و قطعاً موجود است.
    const db = new Database(TARGET);
    try {
      db.query("PRAGMA journal_mode=WAL;").get();
    } finally {
      db.close();
    }
    post = inspect(TARGET);
    verifyOk = post.healthy;
    console.log(`  • بعد از تعویض: integrity: ${post.integrity} | جداول: ${post.tableCount}`);
    if (post.missingKey.length > 0) {
      console.log(`  • جداول غایب بعد از تعویض (${post.missingKey.length}): ${post.missingKey.join("، ")}`);
    }
    if (verifyOk) {
      console.log(`     ExerciseLibrary/FoodLibrary/User و بقیهٔ جداول کلیدی همه موجودند ✓`);
    }
  } catch (e) {
    console.error(`  ⚠ مرحلهٔ WAL/راستی‌آزمایی خطا داد: ${(e as Error).message}`);
    post = inspect(TARGET);
    verifyOk = post.healthy;
    console.log(`  • بعد از تعویض: integrity: ${post.integrity} | جداول: ${post.tableCount} | سالم: ${verifyOk ? "بله" : "خیر"}`);
  }

  if (verifyOk) {
    console.log("  ✅ نجات موفق — دیتابیس تمیز و کامل نصب شد (journal_mode=WAL)");
    console.log(`     فایل قبلی (خراب) برای همیشه اینجاست: ${path.relative(ROOT, backupDir)}`);
    return 0;
  }

  console.error("  ✗ راستی‌آزمایی بعد از تعویض شکست خورد — بکاپ را نگه دارید و دستی بررسی کنید");
  return 1;
}

process.exit(main());
