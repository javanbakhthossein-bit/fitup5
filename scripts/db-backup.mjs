#!/usr/bin/env node
/**
 * db-backup.mjs — بکاپ امن دیتابیس فیتاپ (روی سرور یا سندباکس)
 *
 * چرا؟ دیتابیس در حالت WAL است و کپی مستقیمِ فایل زنده ممکن است ناقص باشد.
 * VACUUM INTO یک عکسِ سازگار (consistent) و فشرده از کل دیتابیس می‌سازد —
 * حتی وقتی سایت در حال کار و ثبت چت/سفارش است.
 *
 * مصرف:      bun scripts/db-backup.mjs [نگهداری_N_نسخه]
 * خروجی:     backups/db-YYYY-MM-DD-HHMM.db  (به‌وقت تهران)
 * پیش‌فرض:   ۱۴ نسخهٔ آخر نگه داشته می‌شود، بقیه حذف می‌شوند.
 *
 * ⚠️ این اسکریپت فقط «دیتابیس» را بکاپ می‌گیرد. فایل‌های رسانهٔ کاربران
 * (عکس/ویدیو در uploads/) جداگانه بکاپ شوند:  tar -czf uploads-backup.tar.gz uploads/
 */
import { execSync } from "child_process";
import { createRequire } from "module";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const KEEP = parseInt(process.argv[2] || "14", 10);
const dbPath = join(ROOT, "db", "custom.db");
const outDir = join(ROOT, "backups");

// ─── تاریخ/ساعت تهران برای نام فایل ───
function tehranStamp() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}-${g("hour")}${g("minute")}`;
}

if (!existsSync(dbPath)) {
  console.error(`❌ دیتابیس پیدا نشد: ${dbPath}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `db-${tehranStamp()}.db`);

// ─── اسنپ‌شات سازگار با VACUUM INTO (اتصال فقط-خواندنی؛ به دادهٔ زنده دست نمی‌زند) ───
const { Database } = require("bun:sqlite");
const d = new Database(dbPath, { readonly: true });
d.exec(`VACUUM INTO '${outFile}'`);

// ─── کنترل سلامت: دیتابیس بکاپ باید باز شود و جدول‌های اصلی را داشته باشد ───
const v = new Database(outFile, { readonly: true });
const tables = v
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE '_prisma%'")
  .all()
  .map((r) => r.name);
let userCount = 0;
try { userCount = v.query('SELECT COUNT(*) c FROM "User"').get().c; } catch {}
v.close();
d.close();

// ─── نگهداری آخرین KEEP نسخه ───
const backups = readdirSync(outDir)
  .filter((f) => /^db-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
  .sort()
  .reverse();
for (const old of backups.slice(KEEP)) {
  unlinkSync(join(outDir, old));
  console.log(`🗑 نسخهٔ قدیمی حذف شد: ${old}`);
}

const mb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log("──────────────────────────────────────────────");
console.log(`✅ بکاپ گرفته شد: backups/${outFile.split("/").pop()}`);
console.log(`   حجم: ${mb}MB | جدول‌ها: ${tables.length} | کاربران: ${userCount}`);
console.log(`   نسخه‌های نگه‌داری‌شده: ${Math.min(backups.length, KEEP)} از ${KEEP}`);
console.log("   یادآوری: رسانه‌های کاربران (uploads/) جداگانه بکاپ شوند:");
console.log("     tar -czf uploads-$(date +%F).tar.gz uploads/");
