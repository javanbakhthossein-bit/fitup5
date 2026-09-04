/// <reference types="bun-types" />
/**
 * fix-database-url.ts — خودترمیمی DATABASE_URL در .env (v22)
 *
 * ─── چرا این اسکریپت وجود دارد؟ ───
 * باگ واقعی سرور مالک (دیپلوی v21): DATABASE_URL در .env سرور به مسیرِ
 * سندباکس (file:/home/z/my-project/db/custom.db) اشاره می‌کرد. نتیجه:
 *   • prisma db push دیتابیسِ خالیِ جدید در آن مسیر ساخت («already in sync»!)
 *   • repair-user-media روی دیتابیسِ خالی → «۰ رفرنس رسانه در DB»
 *   • دیتای واقعی (کاربران/مقالات/پرداخت‌ها) در /var/www/fitup/db/custom.db بود
 *
 * این اسکریپت (در deploy.sh قدم ۲-ب، قبل از prisma generate/push اجرا می‌شود):
 *   • مسیر فعلی DATABASE_URL و «مسیر استاندارد» (<پروژه>/db/custom.db) را مقایسه می‌کند
 *   • فقط وقتی .env را اصلاح می‌کند که دیتابیسِ فعلی «خالی/گمشده/خراب» باشد
 *     و دیتابیس استاندارد «کاربر واقعی» داشته باشد → قبل از تغییر از .env بکاپ می‌گیرد
 *   • اگر دیتابیس فعلی کاربر دارد → دست نمی‌زند (استقرارِ عمدی/سالم است؛ فقط هشدار)
 *   • اگر هیچ‌کدام دیتا ندارند → اولین دیپلوی است؛ کاری نمی‌کند
 *
 * ⚠️ عمداً از @prisma/client استفاده نمی‌کند — قبل از prisma generate اجرا می‌شود!
 * (فقط bun:sqlite داخلی + fs — بدون وابستگی)
 *
 * اجرا: bun run scripts/fix-database-url.ts
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const CANONICAL_DB = path.normalize(path.join(ROOT, "db", "custom.db"));

/** DATABASE_URL را از فایل .env بخوان (بدون dotenv — خودمان پارس می‌کنیم) */
function readEnvDatabaseUrl(): string | null {
  if (!existsSync(ENV_PATH)) return null;
  const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"#\s]+)"?\s*(?:#.*)?$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/** مسیر فایل SQLite را از URL پرایسما حل کن (file: / file:// / نسبی) */
function resolveSqliteFile(url: string): string | null {
  if (!/^file:/i.test(url)) return null; // mysql/postgres و غیره — دست نمی‌زنیم
  let p = url.slice(5);
  if (p.startsWith("//")) p = "/" + p.slice(1); // file:///abs/path
  if (!path.isAbsolute(p)) p = path.resolve(ROOT, p);
  return path.normalize(p);
}

/**
 * تعداد کاربرهای یک فایل SQLite.
 *  -1 = فایل وجود ندارد؛ عدد ≥ 0 = تعداد User (جدول نبود/خراب بود → 0)
 */
function countUsers(dbFile: string): number {
  if (!existsSync(dbFile)) return -1;
  try {
    const db = new Database(dbFile, { readonly: true });
    try {
      const row = db.query("SELECT COUNT(*) AS c FROM User").get() as { c: number | bigint } | null;
      return row ? Number(row.c) : 0;
    } finally {
      db.close();
    }
  } catch {
    return 0; // فایل خراب / جدول User ندارد = «خالی» تلقی می‌شود
  }
}

/** خط DATABASE_URL در .env را با مقدار جدید جایگزین کن (بقیه فایل دست‌نخورده) */
function rewriteEnv(newUrl: string): boolean {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    copyFileSync(ENV_PATH, `${ENV_PATH}.backup-${stamp}`);
    const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
    const replaced = lines.some((line, i) => {
      if (/^\s*DATABASE_URL\s*=/i.test(line)) {
        lines[i] = `DATABASE_URL=file:${newUrl}`;
        return true;
      }
      return false;
    });
    if (!replaced) lines.push(`DATABASE_URL=file:${newUrl}`);
    writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
    return true;
  } catch (err) {
    console.error("[fix-db-url] ✗ نوشتن .env ناموفق:", err);
    return false;
  }
}

function describe(dbFile: string): string {
  const n = countUsers(dbFile);
  if (n < 0) return "فایل وجود ندارد";
  return `${n} کاربر`;
}

function main(): void {
  console.log("[fix-db-url] 🔧 بررسی سلامت DATABASE_URL...");
  console.log(`  • پروژه: ${ROOT}`);

  if (!existsSync(ENV_PATH)) {
    if (existsSync(CANONICAL_DB)) {
      console.log(`  ⚠ .env وجود ندارد ولی دیتابیس استاندارد هست (${CANONICAL_DB}) — .env را بسازید:`);
      console.log(`      DATABASE_URL=file:${CANONICAL_DB}`);
    } else {
      console.log("  ℹ .env و دیتابیس استاندارد وجود ندارند — اولین دیپلوی است؛ کاری نمی‌کنیم");
    }
    return;
  }

  const raw = readEnvDatabaseUrl();
  if (!raw) {
    console.log("  ⚠ DATABASE_URL در .env تعریف نشده! prisma خطا می‌دهد. اضافه کنید:");
    console.log(`      DATABASE_URL=file:${CANONICAL_DB}`);
    return;
  }
  if (!/^file:/i.test(raw)) {
    console.log(`  ✓ DATABASE_URL غیر SQLite است (${raw.slice(0, 40)}…) — دست نمی‌خورد`);
    return;
  }

  const current = resolveSqliteFile(raw);
  if (!current) {
    console.log("  ⚠ فرمت DATABASE_URL قابل حل نبود — دستی بررسی کنید");
    return;
  }

  if (current === CANONICAL_DB) {
    console.log(`  ✓ DATABASE_URL درست است: ${current} (${describe(current)})`);
    return;
  }

  // مسیر غیراستاندارد — بررسی کدام دیتابیس واقعی است
  console.log(`  ⚠ مسیر غیراستاندارد: ${current} → ${describe(current)}`);
  console.log(`  • مسیر استاندارد:    ${CANONICAL_DB} → ${describe(CANONICAL_DB)}`);

  const currentUsers = countUsers(current);
  const canonicalUsers = countUsers(CANONICAL_DB);

  if (currentUsers > 0) {
    console.log("  ✓ دیتابیس فعلی کاربر واقعی دارد — احتمالاً استقرار عمدی؛ DATABASE_URL دست نمی‌خورد");
    return;
  }

  if (canonicalUsers > 0 || (currentUsers === -1 && existsSync(CANONICAL_DB))) {
    if (rewriteEnv(CANONICAL_DB)) {
      console.log(`  🔧 اصلاح شد: DATABASE_URL → file:${CANONICAL_DB} (بکاپ .env گرفته شد)`);
      console.log(`     دیتابیس قبلیِ خالی در ${current} دیگر استفاده نمی‌شود (می‌توانید حذفش کنید)`);
    }
    return;
  }

  if (currentUsers === -1 && canonicalUsers === -1) {
    console.log("  ℹ هیچ دیتابیسی هنوز وجود ندارد — اولین دیپلوی؛ db:push می‌سازد");
    return;
  }

  // هر دو خالی — ترجیح مسیر استاندارد برای آینده
  if (currentUsers === 0 && canonicalUsers === 0 && existsSync(CANONICAL_DB)) {
    console.log("  ℹ هر دو دیتابیس خالی‌اند — مسیر فعلی نگه داشته شد");
    return;
  }
  console.log("  ℹ وضعیت خاص — DATABASE_URL دست نخورد");
}

main();
