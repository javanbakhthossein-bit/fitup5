// snapshot-v257.ts — اسنپ‌شات تمیز DB با VACUUM INTO (بدون دست‌زدن به سرور)
import { Database } from "bun:sqlite";

const SRC = "/home/z/my-project/db/custom.db";
const OUT = "/tmp/fitup-db-snapshot-v257-2026-11-04.db";

// حذف خروجی قبلی احتمالی
try { await Bun.remove(OUT); } catch {}

const db = new Database(SRC); // باز شدن پیش‌فرض — VACUUM INTO به سورس فقط می‌خواند
const t0 = Date.now();
db.run(`VACUUM INTO '${OUT}'`);
db.close();
console.log(`VACUUM INTO done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// راستی‌آزمایی اسنپ‌شات
const snap = new Database(OUT, { readonly: true });
const ic = snap.query("PRAGMA integrity_check").get() as { integrity_check: string };
console.log("integrity_check:", ic.integrity_check);
const count = (t: string) =>
  (snap.query(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
console.log("User:", count("User"));
console.log("Food:", count("Food"));
console.log("WorkoutProgram:", count("WorkoutProgram"));
console.log("Payment:", count("Payment"));
const pm = snap.query("PRAGMA page_count * page_size AS s").get() as { s: number };
console.log("size:", (pm.s / 1024 / 1024).toFixed(1), "MB");
snap.close();
