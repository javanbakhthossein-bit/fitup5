/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * v147 — آماده‌سازی E2E: اشتراک تستی + دورکردن قفل ۲۴ساعته + ساخت کوکی سشن
 * اجرا: node scripts/tests/v147-e2e-prepare.cjs
 */
const Database = require("better-sqlite3");
const { scryptSync } = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
// خواندن SESSION_SECRET از .env
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf-8");
const SECRET = (env.match(/^SESSION_SECRET=(.+)$/m) || [])[1].trim();
if (!SECRET) throw new Error("SESSION_SECRET not found");

const db = new Database(path.join(ROOT, "db/custom.db"));
const user = db.prepare("SELECT id, mobile FROM User WHERE mobile = ?").get("09128912690");
if (!user) throw new Error("test user not found");

// ① اشتراک تستی استاندارد (پیش‌نیاز عکس بدن ندارد)
const exp = new Date(Date.now() + 45 * 24 * 3600 * 1000);
db.prepare("UPDATE User SET planName='standard', planExpiresAt=? WHERE id=?").run(exp.toISOString(), user.id);

// ② دورزدن قفل ۲۴ ساعت «برنامهٔ تازه» — برنامهٔ قبلی به ۳ روز قبل عقب می‌رود
db.prepare("UPDATE WorkoutPlan SET createdAt = createdAt - 259200000 WHERE userId=?").run(user.id);
db.prepare("UPDATE MealPlan SET createdAt = createdAt - 259200000 WHERE userId=?").run(user.id);

// ③ ساخت کوکی سشن (همان الگوریتم auth.ts)
function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, SECRET, 32).toString("hex");
  return `${payload}.${sig}`;
}
const cookie = `sc_session=${createSessionToken(user.id)}`;
fs.writeFileSync("/tmp/v147-cookie.txt", cookie, "utf-8");
fs.writeFileSync("/tmp/v147-userid.txt", user.id, "utf-8");

console.log("✅ prepared:", JSON.stringify({ userId: user.id, planName: "standard", expires: exp.toISOString() }));
console.log("✅ cookie saved to /tmp/v147-cookie.txt");
db.close();
