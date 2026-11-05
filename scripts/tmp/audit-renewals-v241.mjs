/**
 * ممیزی v241 — «تمدید و پرداخت بدون باگ» (دیرکتیو مالک بعد از تیکت سلمان مقصودی)
 *
 * روی کپی دیتابیس تولیدی (db/custom.db = دامپ 2026-10-17-1125) اجرا می‌شود — فقط-خواندنی.
 * چک‌ها:
 *  A) هر Subscription با Payment موفق: پنجرهٔ تحویل‌شده در برابر durationDays
 *  B) امضای «بلعیده‌شدن تمدید در ارتقا» (endDate == endDate اشتراک قبلی همان کاربر)
 *  C) پرداخت موفق که الان کاربر پوشش فعال ندارد (planExpiresAt < now ولی خرید معتبر بوده)
 *  D) اشتراک pending قدیمی (status=pending و endDate گذشته) — پول داده، هرگز فعال نشده
 *  E) Payment موفق بدون هیچ Subscription متصل (تحویل گمشده)
 *  F) ناسازگاری User.planExpiresAt/planName با آخرین Subscription کاربر
 */
import { DatabaseSync } from "node:sqlite";

const DB = process.argv[2] || "/home/z/my-project/db/custom.db";
const db = new DatabaseSync(DB, { readOnly: true });
const DAY = 86400000;
const fmt = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z" : "-");
const fa = (ms) => {
  if (!ms) return "-";
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms));
};

const now = Date.now();
console.log("DB:", DB);
console.log("NOW:", fmt(now), "(تهران:", fa(now) + ")\n");

// ── A + B: پنجرهٔ تحویل هر اشتراکِ متصل به پرداخت موفق ──
const subs = db.prepare(`
  SELECT s.*, p.status AS payStatus, p.amount AS payAmount, p.originalAmount AS payOriginal,
         p.verifiedAt AS payVerifiedAt, p.plan AS payPlan, p.paymentMethod AS payMethod
  FROM Subscription s LEFT JOIN Payment p ON p.id = s.paymentId
  ORDER BY s.userId, s.createdAt
`).all();
console.log("کل اشتراک‌ها:", subs.length);

const byUser = new Map();
for (const s of subs) {
  if (!byUser.has(s.userId)) byUser.set(s.userId, []);
  byUser.get(s.userId).push(s);
}

const findingsA = [];
const findingsB = [];
const findingsF = [];
for (const [uid, list] of byUser) {
  list.sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    if (s.payStatus === "success" && s.startDate && s.endDate) {
      const delivered = (s.endDate - s.startDate) / DAY;
      if (delivered < s.durationDays - 1) {
        findingsA.push({
          user: uid, sub: s.id, plan: s.plan, status: s.status,
          start: s.startDate, end: s.endDate, dur: s.durationDays,
          delivered: Math.round(delivered * 10) / 10, paid: s.payAmount,
          method: s.payMethod, verified: s.payVerifiedAt,
        });
      }
      // B: امضای بلعیدگی — پایان اشتراک جدید == پایان اشتراک قبلی (همان کاربر)
      if (prev && prev.endDate && s.endDate === prev.endDate && s.startDate < prev.endDate) {
        findingsB.push({
          user: uid, newSub: s.id, oldSub: prev.id, newPlan: s.plan, oldPlan: prev.plan,
          start: s.startDate, end: s.endDate, dur: s.durationDays, paid: s.payAmount,
          verified: s.payVerifiedAt, method: s.payMethod,
        });
      }
    }
  }
  // F: آخرین اشتراک فعال/منقضی در برابر فیلدهای User
  const last = list[list.length - 1];
  const u = db.prepare("SELECT planName, planStartedAt, planExpiresAt FROM User WHERE id = ?").get(uid);
  if (!u) continue;
  if (last && last.status !== "pending" && last.status !== "cancelled" && last.endDate) {
    if (u.planExpiresAt && Math.abs(u.planExpiresAt - last.endDate) > 120000) {
      findingsF.push({ user: uid, userPlan: u.planName, userExp: u.planExpiresAt, subPlan: last.plan, subEnd: last.endDate, subStatus: last.status });
    }
  }
}

console.log("\n═══ A) تحویل کمتر از مدت خرید (با پرداخت موفق) ═══");
console.log(findingsA.length === 0 ? "  ✓ هیچ" : "");
for (const f of findingsA) {
  console.log(`  • ${f.user} | ${f.plan} | وضعیت=${f.status} | ${fmt(f.start)} → ${fmt(f.end)} | خرید=${f.dur} روز | تحویل=${f.delivered} روز | ${f.paid} تومان | ${f.method}`);
}

console.log("\n═══ B) امضای بلعیدگی ارتقا (end جدید == end قبلی) ═══");
console.log(findingsB.length === 0 ? "  ✓ هیچ" : "");
for (const f of findingsB) {
  console.log(`  • ${f.user} | ${f.oldPlan} → ${f.newPlan} | ${fmt(f.start)} → ${fmt(f.end)} | خرید=${f.dur} روز | ${f.paid} تومان | ${f.method} | verify=${fmt(f.verified)}`);
}

// ── C: پرداخت موفق اخیر بدون پوشش فعال ──
const usersPaid = db.prepare(`
  SELECT userId, MAX(verifiedAt) AS lastVerified, COUNT(*) AS n, SUM(amount) AS total
  FROM Payment WHERE status = 'success' AND verifiedAt IS NOT NULL
  GROUP BY userId
`).all();
console.log("\n═══ C) کاربران با پرداخت موفق که الان پوشش فعال ندارند ═══");
let cCount = 0;
for (const r of usersPaid) {
  const u = db.prepare("SELECT id, name, mobile, planName, planExpiresAt, planStartedAt FROM User WHERE id = ?").get(r.userId);
  if (!u) continue;
  const covered = u.planExpiresAt && u.planExpiresAt > now;
  if (!covered && u.planName) {
    // خرید موفق داشته ولی planName دارد و پوشش گذشته → قربانی بالقوه (تمدید بلعیده‌شده)
    const lastSub = db.prepare("SELECT plan, status, startDate, endDate, durationDays, pricePaid, paymentId FROM Subscription WHERE userId = ? ORDER BY createdAt DESC LIMIT 1").get(r.userId);
    console.log(`  • ${u.name} (${u.mobile}) ${u.id} | plan=${u.planName} | انقضا=${fa(u.planExpiresAt)} | آخرین خرید=${fa(r.lastVerified)} (${r.total} تومان در ${r.n} خرید) | آخرین اشتراک: ${lastSub ? lastSub.plan + "/" + lastSub.status + " " + fmt(lastSub.startDate) + "→" + fmt(lastSub.endDate) + " (" + lastSub.durationDays + " روز)" : "ندارد"}`);
    cCount++;
  }
}
if (cCount === 0) console.log("  ✓ هیچ");

// ── D: pending قدیمی ──
const stalePending = db.prepare(`
  SELECT s.*, p.amount AS payAmount, p.verifiedAt AS payVerifiedAt
  FROM Subscription s LEFT JOIN Payment p ON p.id = s.paymentId
  WHERE s.status = 'pending' AND s.endDate IS NOT NULL AND s.endDate < ?
`).all(now);
console.log("\n═══ D) اشتراک‌های pending منقضی‌شده (پول داده، هرگز فعال نشده) ═══");
if (stalePending.length === 0) console.log("  ✓ هیچ");
for (const s of stalePending) {
  const u = db.prepare("SELECT name, mobile FROM User WHERE id = ?").get(s.userId);
  console.log(`  • ${u?.name ?? "?"} (${u?.mobile ?? "?"}) ${s.userId} | ${s.plan} | پایان پنجره=${fa(s.endDate)} | پرداخت=${s.payAmount ?? "-"} تومان | verify=${s.payVerifiedAt ? fa(s.payVerifiedAt) : "-"}`);
}

// ── E: پرداخت موفق بدون اشتراک ──
const orphanPays = db.prepare(`
  SELECT p.* FROM Payment p
  WHERE p.status = 'success' AND p.plan != 'wallet_topup'
    AND NOT EXISTS (SELECT 1 FROM Subscription s WHERE s.paymentId = p.id)
`).all();
console.log("\n═══ E) پرداخت موفق بدون هیچ اشتراک متصل ═══");
if (orphanPays.length === 0) console.log("  ✓ هیچ");
for (const p of orphanPays) {
  const u = db.prepare("SELECT name, mobile FROM User WHERE id = ?").get(p.userId);
  console.log(`  • ${u?.name ?? "?"} (${u?.mobile ?? "?"}) | ${p.plan} | ${p.amount} تومان | verify=${p.verifiedAt ? fa(p.verifiedAt) : "-"} | pay=${p.id}`);
}

console.log("\n═══ F) ناسازگاری فیلدهای User با آخرین اشتراک ═══");
console.log(findingsF.length === 0 ? "  ✓ هیچ" : "");
for (const f of findingsF) {
  console.log(`  • ${f.user} | User: ${f.userPlan} تا ${fa(f.userExp)} | Sub(${f.subStatus}): ${f.subPlan} تا ${fa(f.subEnd)}`);
}
console.log("\n— پایان ممیزی —");
