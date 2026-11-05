#!/usr/bin/env node
/**
 * repair-pending-upgrades.mjs — v231 ترمیم قربانیان باگ race ارتقا (تیکت حسین نوربخش)
 * v233 — بازنویسی ضد-segfault: گزارش مالک از سرور تولیدی
 *   «node scripts/repair-pending-upgrades.mjs  →  Segmentation fault (core dumped)»
 * ریشه: بارگذاری ماژول native بهتر-sqlite3 روی nodeِ سرور (نا‌سازگاری ABI/باینری
 * پیش‌ساخته) که به‌جای خطای تمیز، کل پروسه را segfault می‌کند.
 * راه‌حل: ترتیب جدید درایورها —
 *   ۱) node:sqlite (داخلی node ≥ ۲۲.۱۳ — صفر وابستگی native، هرگز segfault نمی‌دهد)
 *   ۲) better-sqlite3 (فقط اگر node:sqlite در دسترس نبود)
 * + تشخیص و پیام خطای شفاف با دستور ترمیم (npm rebuild / ارتقای node).
 * منطقِ ترمیم/کوئری‌ها نسبت به v231 «حتی یک حرف تغییر نکرده» — فقط لایهٔ درایور.
 *
 * باگ: قبل از فیکس v231، تشخیص «ارتقا» شرط داشت WorkoutPlan و MealPlan «هر دو»
 * فعال باشند. اگر کاربر بلافاصله بعد از خرید اول ارتقا می‌داد و MealPlan هنوز
 * در حال تولید بود، ارتقا به «خرید تازه» misdetect می‌شد:
 *   • اشتراک جدید: status=pending، startDate=null، endDate=+۷ روز (پنجرهٔ پیش‌نیاز)
 *   • User: planName=پلن جدید ولی planStartedAt/planExpiresAt=null
 *   • ProgramRequest: pending_body_photo
 *   • اشتراک قبلی (تمام‌نشده): expired
 *
 * این اسکریپت این حالت‌ها را پیدا و ترمیم می‌کند (دیرکتیو مالک v231):
 *   • اشتراک pending → active با endDate = endDate اشتراک قبلی (مدت تغییر نمی‌کند)
 *   • User: planStartedAt = startDate اشتراک قبلی، planExpiresAt = endDate قبلی
 *   • ProgramRequest pending_body_photo دست‌نخورده می‌ماند (پیش‌نیاز پلن پیشرفته/حرفه‌ای
 *     طبق دیرکتیو مالک؛ به‌محض آپلود عکس بدن، برنامهٔ جدید ساخته می‌شود)
 *   • نوتیف به کاربر
 *
 * مصرف روی سرور (بعد از دیپلوی):
 *   node scripts/repair-pending-upgrades.mjs           ← فقط گزارش (dry-run)
 *   node scripts/repair-pending-upgrades.mjs --apply   ← اجرای واقعی ترمیم
 *
 * Idempotent: رکوردهای ترمیم‌شده active می‌شوند و دوباره match نمی‌شوند.
 */
import { existsSync } from "fs";

const APPLY = process.argv.includes("--apply");
const DB_PATH =
  process.env.DB_PATH ||
  (existsSync("db/custom.db") ? "db/custom.db" : "/var/www/fitup/db/custom.db");

if (!existsSync(DB_PATH)) {
  console.error(`DB پیدا نشد: ${DB_PATH} — با DB_PATH=/path/to/custom.db هم می‌توانی بدهی.`);
  process.exit(1);
}

console.log(`node ${process.version} | DB: ${DB_PATH} | حالت: ${APPLY ? "APPLY (ترمیم واقعی)" : "dry-run (فقط گزارش)"}`);

// ─── انتخاب درایور SQLite — ضد segfault (v233) ─────────────────────────────
// هر دو درایور زیر همین چهار متد را دارند: prepare().get/.all/.run + exec
// (node:sqlite از node 22.13 به بعد بدون فلگ در دسترس است).
let conn = null;
let driverName = "";

async function openDriver() {
  // ۱) node:sqlite — داخلی node؛ هیچ باینری native‌ای بارگذاری نمی‌شود
  try {
    const { DatabaseSync } = await import("node:sqlite");
    conn = new DatabaseSync(DB_PATH);
    driverName = "node:sqlite (داخلی node — بدون ماژول native)";
    return;
  } catch {
    // node قدیمی‌تر از 22.13 یا فلگ لازم — به درایور بعدی می‌رویم
  }
  // ۲) better-sqlite3 — native؛ اگر باینری‌اش با nodeِ سرور ناسازگار باشد
  //    ممکن است segfault بدهد (ریشهٔ گزارش مالک) — به‌همین دلیل اولویتش پایین‌تر است
  try {
    conn = (await import("better-sqlite3")).default(DB_PATH);
    driverName = "better-sqlite3 (native)";
    return;
  } catch (e) {
    console.error("هیچ درایور SQLite در دسترس نیست:");
    console.error("  • node:sqlite → nodeِ سرور قدیمی‌تر از 22.13 است");
    console.error(`  • better-sqlite3 → ${e?.message ?? e}`);
    console.error("ترمیم پیشنهادی روی سرور:  npm rebuild better-sqlite3   (یا ارتقای node به 22+)");
    process.exit(1);
  }
}

await openDriver();
console.log(`درایور: ${driverName}`);

// dry-run = هیچ نوشتنی حتی اتفاقی — سخت‌گیری در سطح خود اتصال
if (!APPLY) {
  try {
    conn.exec("PRAGMA query_only = 1;");
  } catch {
    // نسخه‌های خیلی قدیمی node:sqlite — query_only پشتیبانی نمی‌شود؛
    // در dry-run هیچ UPDATE/INSERT اجرا نمی‌شود به‌هرحال
  }
} else {
  conn.exec("PRAGMA journal_mode = WAL;");
}

const now = Date.now();

// نامزدها: اشتراک pending پلن پیشرفته/حرفه‌ای + بدون تاریخ شروع + پرداخت موفق
// + کاربر قبلاً اشتراک دیگری داشته که «تاریخ پایانش هنوز آینده است» (دورهٔ واقعی او)
// و لحظهٔ منقضی‌شدنش نزدیک به تأیید پرداخت ارتقا بوده (اثر تحویل ارتقا).
const candidates = conn
  .prepare(
    `
    SELECT s.id AS subId, s.userId, s.plan, s.createdAt, s.pricePaid,
           p.id AS payId, p.verifiedAt, p.status AS payStatus
    FROM Subscription s
    JOIN Payment p ON p.id = s.paymentId
    WHERE s.status = 'pending'
      AND s.startDate IS NULL
      AND s.plan IN ('advanced','ultimate')
      AND p.status = 'success'
    ORDER BY s.createdAt DESC
  `
  )
  .all();

const rows = [];
for (const c of candidates) {
  // امضای دقیق باگ: اشتراک قبلی «expired» ولی endDate آن هنوز آینده است
  // (= توسط تحویل ارتقا سوپرسیeded شده) و پلن آن با پلن pending فرق دارد.
  const prior = conn
    .prepare(
      `
    SELECT id, plan, startDate, endDate, createdAt FROM Subscription
    WHERE userId = ? AND id != ?
      AND status = 'expired'
      AND endDate > ?
      AND plan != ?
    ORDER BY endDate DESC LIMIT 1
  `
    )
    .get(c.userId, c.subId, now, c.plan);
  if (!prior) continue;
  rows.push({ ...c, prior });
}

if (rows.length === 0) {
  console.log("هیچ موردی برای ترمیم پیدا نشد ✅ (همه‌چیز سالم است)");
  process.exit(0);
}

console.log(`⚠️  ${rows.length} مورد پیدا شد:`);
for (const r of rows) {
  const u = conn.prepare("SELECT name, mobile, planName, planExpiresAt FROM User WHERE id = ?").get(r.userId);
  console.log(
    ` - ${u?.name ?? "?"} (${u?.mobile ?? "?"}) — اشتراک ${r.plan} pending از ${new Date(r.createdAt).toISOString()} | دورهٔ واقعی تا ${new Date(r.prior.endDate).toISOString()} (${r.prior.plan})`
  );
}

if (!APPLY) {
  console.log("\n[dry-run] هیچ تغییری اعمال نشد — برای اجرا: node scripts/repair-pending-upgrades.mjs --apply");
  process.exit(0);
}

const fixSub = conn.prepare(
  "UPDATE Subscription SET status='active', startDate=?, endDate=? WHERE id=? AND status='pending'"
);
const fixUser = conn.prepare(
  "UPDATE User SET planStartedAt=?, planExpiresAt=?, updatedAt=? WHERE id=?"
);
const addNotif = conn.prepare(
  "INSERT INTO Notification (id, userId, type, title, body, read, createdAt) VALUES (?, ?, 'system', ?, ?, 0, ?)"
);
const uid = () =>
  "rp" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// تراکنش دستی (هر دو درایور با BEGIN/COMMIT یکی است)
function tx(fn) {
  conn.exec("BEGIN IMMEDIATE;");
  try {
    fn();
    conn.exec("COMMIT;");
  } catch (e) {
    try {
      conn.exec("ROLLBACK;");
    } catch {
      // rollback روی اتصالِ خراب — خطای اصلی مهم‌تر است
    }
    throw e;
  }
}

for (const r of rows) {
  try {
    tx(() => {
      const startDate = Math.max(r.prior.startDate ?? now, r.verifiedAt ?? now);
      const changed = fixSub.run(startDate, r.prior.endDate, r.subId);
      if (changed.changes !== 1) throw new Error(`اشتراک ${r.subId} ترمیم نشد (شاید موازی تغییر کرده)`);
      fixUser.run(r.prior.startDate ?? startDate, r.prior.endDate, now, r.userId);
      addNotif.run(
        uid(),
        r.userId,
        "پلن شما فعال شد! ✅",
        `پلن پیشرفتهٔ شما فعال شد و تا ${new Date(r.prior.endDate).toLocaleDateString("fa-IR")} معتبر است. برای ساخت برنامهٔ جدید با پلن جدید، عکس‌های بدن خود را از داشبورد بفرست. 📸`,
        now
      );
    });
    console.log(` ✅ ترمیم شد: اشتراک ${r.subId} → active تا ${new Date(r.prior.endDate).toISOString()}`);
  } catch (e) {
    console.error(` ❌ شکست ${r.subId}: ${e.message}`);
  }
}

console.log("\nتمام. ProgramRequestهای pending_body_photo دست‌نخورده‌اند — به‌محض آپلود عکس بدن، برنامهٔ جدید ساخته می‌شود.");
