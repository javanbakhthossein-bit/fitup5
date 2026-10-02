#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FitUp — ابزار ترمیم اضطراری دیتابیس پروداکشن (بدون دیپلوی) — v141
 * ─────────────────────────────────────────────────────────────────────────────
 * مشکل: «database disk image is malformed» (SQLite extended code 11)
 *       → سایت بالا نمی‌آید و همهٔ کوئری‌ها شکست می‌خورند.
 *
 * کار: تشخیص → بکاپ امن → ریکاوری چندلایه → راستی‌آزمایی → تعویض اتمی فایل
 *
 * اجرا (روی سرور، کنار package.json):
 *   node prod-db-repair-v141.mjs            # ترمیم کامل
 *   node prod-db-repair-v141.mjs --dry-run  # فقط تشخیص، بدون هیچ تغییری
 *   node prod-db-repair-v141.mjs --force    # حتی اگر سرور روشن باشد (توصیه نمی‌شود)
 *
 * نیازمندی: node یا bun + python3 (روی هر سرور استاندارد موجود است)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const DB_PATH = fs.existsSync("db/custom.db") ? "db/custom.db" : "prisma/dev.db";
const DIR = path.dirname(DB_PATH);
const BASE = path.basename(DB_PATH);
const WAL = `${DB_PATH}-wal`;
const SHM = `${DB_PATH}-shm`;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const P = (s) => process.stdout.write(s + "\n");
const ok = (s) => P(`  ✅ ${s}`);
const warn = (s) => P(`  ⚠️  ${s}`);
const fail = (s) => P(`  ❌ ${s}`);
const step = (s) => P(`\n━━━ ${s} ━━━`);

P(`\n🛠️  فیتاپ — ترمیم دیتابیس (${DRY ? "حالت تشخیص dry-run" : "حالت ترمیم کامل"})`);
P(`   فایل: ${DB_PATH}  (${fs.existsSync(DB_PATH) ? (fs.statSync(DB_PATH).size / 1048576).toFixed(1) + "MB" : "موجود نیست!"})`);

if (!fs.existsSync(DB_PATH)) {
  fail("فایل دیتابیس پیدا نشد — این اسکریپت را در ریشهٔ پروژه (کنار package.json) اجرا کنید.");
  process.exit(1);
}

// ─── گام ۰: سرور روشن نباشد ────────────────────────────────────────────────
step("گام ۰ — بررسی سرور");
let serverPids = "";
try {
  serverPids = execFileSync("pgrep", ["-f", "next-server|server\\.js|next start"], { encoding: "utf8" }).trim();
} catch {}
if (serverPids) {
  warn(`پروسهٔ سرور روشن است (pid: ${serverPids.split("\n").join(", ")})`);
  if (!FORCE && !DRY) {
    fail("اول سرور را خاموش کنید (pm2 stop fitup یا معادلش) و دوباره اجرا کنید — یا با --force ریسک را بپذیرید.");
    process.exit(1);
  }
  warn("--force فعال — ادامه می‌دهیم ولی بستن سرور به‌شدت توصیه می‌شود.");
} else {
  ok("سرور خاموش است — امن.");
}

// ─── گام ۱: تشخیص میزان خرابی ──────────────────────────────────────────────
step("گام ۱ — تشخیص (PRAGMA integrity_check)");
const py = (code) => {
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};

const diag = py(`
import sqlite3, json
p = ${JSON.stringify(DB_PATH)}
res = {"ic_error": None, "integrity": [], "quick": [], "tables": {}}
try:
    con = sqlite3.connect(p)
    try: res["integrity"] = [r[0] for r in con.execute("PRAGMA integrity_check").fetchall()][:5]
    except Exception as e: res["ic_error"] = str(e)[:80]
    try: res["quick"] = [r[0] for r in con.execute("PRAGMA quick_check").fetchall()][:3]
    except Exception: pass
    try:
        names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for t in names:
            try: tables = con.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0]; res["tables"][t] = tables
            except Exception as e: res["tables"][t] = "ERR:" + str(e)[:40]
    except Exception as e:
        res["tables"]["__schema__"] = "ERR:" + str(e)[:60]
except Exception as e:
    res["ic_error"] = "open-failed: " + str(e)[:60]
print(json.dumps(res))
`);
if (diag.status !== 0) {
  warn("حتی باز کردن دیتابیس با integrity_check شکست خورد:");
  P("      " + diag.err.split("\n").slice(-3).join("\n      "));
}
let info = { integrity: ["?"], quick: ["?"], tables: {} };
try { info = JSON.parse(diag.out); } catch {}
P(`   integrity_check: ${JSON.stringify(info.integrity)}`);
const HEALTHY = info.integrity.length === 1 && info.integrity[0] === "ok";
if (HEALTHY) {
  ok("دیتابیس سالم است! خرابی جای دیگری است (به README بخش «اگر دیتابیس سالم بود» بروید).");
  P("\n   شمارش جداول:");
  for (const [t, c] of Object.entries(info.tables)) P(`     • ${t}: ${c}`);
  process.exit(0);
}
fail(`دیتابیس خراب است: ${JSON.stringify(info.integrity)}`);
P(`   جداول خواندنی فعلی: ${Object.keys(info.tables).length} جدول`);

// ─── گام ۲: بکاپ کامل فایل خراب (همیشه، حتی قبل از هرلمس) ──────────────────
step("گام ۲ — بکاپ امن فایل خراب");
const bkDir = path.join(DIR, `corrupt-backup-${STAMP}`);
if (!DRY) {
  fs.mkdirSync(bkDir, { recursive: true });
  for (const f of [DB_PATH, WAL, SHM]) {
    if (fs.existsSync(f)) {
      fs.copyFileSync(f, path.join(bkDir, path.basename(f)));
      ok(`بکاپ: ${path.join(bkDir, path.basename(f))}`);
    }
  }
} else ok("(dry-run) بکاپ انجام نمی‌شود");

// ─── گام ۳: ریکاوری چندلایه ────────────────────────────────────────────────
step("گام ۳ — ریکاوری (۳ لایه)");
const REC = path.join(DIR, `${BASE}.recovered`);
if (fs.existsSync(REC)) fs.rmSync(REC);

// لایه ۱: python3 — بکاپ API (اگر صفحات کلیدی سالم باشند سریع‌ترین راه)
P("   لایه ۱/۳ — کپی ساختاری python (sqlite3 backup API)…");
const l1 = py(`
import sqlite3
src = sqlite3.connect(${JSON.stringify(DB_PATH)})
dst = sqlite3.connect(${JSON.stringify(REC)})
try:
    src.backup(dst)
    print("OK")
except Exception as e:
    print("FAIL:" + str(e)[:80])
`);
if (l1.out === "OK") {
  // v141.2 — لایهٔ ۱ فقط وقتی قبول است که فایل خروجی واقعاً سالم باشد
  // (backup API صفحات خراب را هم کپی می‌کند و بدون راستی‌آزمایی فریب می‌دهد)
  const chk1 = py(`
import sqlite3
con = sqlite3.connect(${JSON.stringify(REC)})
try: print(con.execute("PRAGMA integrity_check").fetchone()[0])
except Exception as e: print("FAIL")
`);
  if (chk1.out.trim() === "ok") ok("لایهٔ ۱ موفق شد (راستی‌آزمایی شد).");
  else {
    P("      → خروجی لایهٔ ۱ سالم نبود — به لایهٔ ۲ می‌رویم");
    if (fs.existsSync(REC)) fs.rmSync(REC);
  }
}
if (!fs.existsSync(REC)) {

  // لایه ۲: python3 — نجات دستی رکوردبه‌رکورد (از صفحات خراب عبور می‌کند)
  P("   لایه ۲/۳ — نجات رکوردبه‌رکورد (iterdump با عبور از صفحات خراب)…");
  const l2 = py(`
import sqlite3
src = sqlite3.connect(${JSON.stringify(DB_PATH)})
dst = sqlite3.connect(${JSON.stringify(REC)})
salvaged = skipped = 0
try:
    for line in src.iterdump():
        try:
            dst.execute(line); salvaged += 1
        except Exception:
            skipped += 1
    dst.commit()
    print(f"OK salvaged={salvaged} skipped={skipped}")
except Exception as e:
    dst.commit()
    print(f"PARTIAL salvaged={salvaged} skipped={skipped} stop={str(e)[:60]}")
`);
  P("      → " + (l2.out || l2.err).slice(0, 120));
  // v141.2 — پذیرش لایهٔ ۲: فقط اگر حداقل یک رکورد نجات یافته باشد
  // (PARTIAL هم قابل‌قبول است؛ راستی‌آزمایی گام ۴ قضاوت نهایی را می‌کند)
  const m2 = /salvaged=(\d+)/.exec(l2.out || "");
  const salvagedN = m2 ? Number(m2[1]) : 0;
  const l2Accept = !!l2.out && (l2.out.includes("OK") || l2.out.includes("PARTIAL")) && salvagedN > 0;
  if (!l2Accept) {
    if (fs.existsSync(REC)) fs.rmSync(REC);
    // لایه ۳: sqlite3 CLI (اگر نصب باشد) — .recover رسمی SQLite
    P("   لایه ۳/۳ — sqlite3 CLI (.recover)…");
    const l3 = spawnSync("bash", ["-c", `command -v sqlite3 >/dev/null && sqlite3 ${DB_PATH} ".recover" | sqlite3 ${REC} && echo CLI_OK || echo NO_CLI`], { encoding: "utf8", timeout: 300_000 });
    P("      → " + ((l3.stdout || "").trim().slice(0, 120) || l3.err));
    if (!(l3.stdout || "").includes("CLI_OK")) {
      fail("همهٔ لایه‌های ریکاوری شکست خوردند.");
      P("\n   🚑 راه نهایی: دیتابیس از صفر بازسازی می‌شود (کاربران/پرداخت‌ها از دست می‌روند):");
      P("      1) rm -f db/custom.db*   2) bun run db:push   3) bun run scripts/seed.ts");
      P("      4) zip سینک حرکات و غذاها (fitup-exercise-sync / fitup-food-sync) را اجرا کنید");
      P("      بکاپ کامل خراب در: " + bkDir + "  (برای بررسی دستی نگه دارید)");
      process.exit(2);
    }
  }
}

// ─── گام ۴: راستی‌آزمایی فایل بازیابی‌شده ────────────────────────────────────
step("گام ۴ — راستی‌آزمایی");
const ver = py(`
import sqlite3, json
con = sqlite3.connect(${JSON.stringify(REC)})
ic = [r[0] for r in con.execute("PRAGMA integrity_check").fetchall()][:3]
tables = {}
for t in [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]:
    try: tables[t] = con.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0]
    except Exception: tables[t] = "ERR"
print(json.dumps({"ic": ic, "tables": tables}))
`);
let verInfo = { ic: ["?"], tables: {} };
try { verInfo = JSON.parse(ver.out); } catch {}
P(`   integrity_check بازیابی‌شده: ${JSON.stringify(verInfo.ic)}`);
if (verInfo.ic.length !== 1 || verInfo.ic[0] !== "ok") {
  fail("فایل بازیابی‌شده هم سالم نشد — دستی بررسی کنید: " + bkDir);
  process.exit(3);
}
ok("فایل بازیابی‌شده ۱۰۰٪ سالم است.");
const KEY = ["User", "User".toLowerCase(), "users", "users".toString()].slice(0, 1);
const show = ["User", "users", "ExerciseLibrary", "exercises", "FoodLibrary", "foods", "Subscription", "subscriptions", "Payment", "payments", "HeadCode", "OtpCode"];
P("   شمارش جداول کلیدی (بازیابی‌شده):");
let userCount = null;
for (const t of Object.keys(verInfo.tables)) {
  if (show.includes(t)) {
    P(`     • ${t}: ${verInfo.tables[t]}`);
    if (t.toLowerCase() === "user" || t === "users") userCount = Number(verInfo.tables[t]) || 0;
  }
}

// ─── گام ۵: تعویض اتمی ─────────────────────────────────────────────────────
step("گام ۵ — تعویض فایل");
if (DRY) {
  ok("(dry-run) تعویض انجام نشد — فایل سالم اینجاست: " + REC);
  P("\n   برای اعمال واقعی بدون --dry-run اجرا کنید.");
  process.exit(0);
}
const corruptName = path.join(bkDir, BASE);
fs.renameSync(DB_PATH, corruptName);
for (const f of [WAL, SHM]) if (fs.existsSync(f)) fs.renameSync(f, path.join(bkDir, path.basename(f)));
fs.renameSync(REC, DB_PATH);
ok(`فایل خراب → ${corruptName}`);
ok("فایل سالم → " + DB_PATH);

// WAL را دوباره فعال و چک‌پوینت کن
const w = py(`
import sqlite3
con = sqlite3.connect(${JSON.stringify(DB_PATH)})
con.execute("PRAGMA journal_mode=WAL")
con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
con.close()
print("WAL_OK")
`);
if (w.out === "WAL_OK") ok("journal_mode=WAL فعال شد.");

// ─── گزارش نهایی ───────────────────────────────────────────────────────────
P("\n━━━ نتیجه ━━━");
ok("دیتابیس ترمیم و جایگزین شد.");
if (userCount === 0) {
  warn("جدول کاربران خالی است — اگر پروداکشن کاربر واقعی داشته، یعنی ریکاوری کامل نبود:");
  P("      → بکاپ‌های قدیمی سرور (اگر pm2/هستینگ بکاپ دارد) را بررسی کنید یا");
  P("      → از اسکریپت‌های سینک (حرکات v136 + غذاهای v137) برای بازگردانی بانک‌ها استفاده کنید و");
  P("      → کاربران دوباره ثبت‌نام می‌کنند (داده‌های پرداخت را از درگاه/Zarinpal تطبیق دهید).");
}
P("\n   قدم بعدی — راه‌اندازی مجدد سرور:");
P("      pm2 restart fitup     (یا همان روش همیشگی شما)");
P("      سپس: curl -I http://localhost:3000  → باید 200 بدهد.");
P(`\n   بکاپ فایل خراب برای همیشه اینجاست: ${bkDir}`);
P("   💡 توصیهٔ ضدتکرار: کرون روزانه بکاپ بگیرید — sqlite3 db/custom.db \".backup db/backups/daily.db\"");
P("");
