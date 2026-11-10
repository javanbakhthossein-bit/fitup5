/**
 * تست v241 — گارد «ارتقای منصفانه» (computeFairUpgradeEnd)
 * اجرا: bun scripts/tmp/test-fair-upgrade-v241.ts
 */
import { computeFairUpgradeEnd } from "@/lib/fitness/fair-upgrade";

const DAY = 86400000;
let pass = 0, fail = 0;
function check(name: string, got: Date, wantMs: number, cmp: ">" | "==" | ">=") {
  const g = got.getTime();
  const ok =
    cmp === "==" ? Math.abs(g - wantMs) < 2000 :
    cmp === ">" ? g > wantMs : g >= wantMs;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} → got=${new Date(g).toISOString()} want${cmp}=${new Date(wantMs).toISOString()}`); }
}

// ─── سناریوی دقیق سلمان مقصودی (تیکت ۱۴۰۵/۰۷/۲۴) ───
const salmanNow = new Date("2026-10-16T06:50:30Z");
const salmanOldEnd = new Date("2026-10-16T18:23:31Z"); // پایان basic (۱۱.۵ ساعت بعد)
const salmanFair = computeFairUpgradeEnd({
  now: salmanNow, oldEndDate: salmanOldEnd,
  paidAmount: 792222, referencePrice: 800000, durationDays: 45,
});
console.log("سناریوی سلمان (ارتقای basic→standard در ۱۱.۵ ساعت مانده به انقضا):");
check("۴۵ روز کامل از لحظهٔ پرداخت (نه ۱۱.۵ ساعت!)", salmanFair, salmanNow.getTime() + 45 * DAY, ">=");
check("بیشتر از پایان دورهٔ قبلی", salmanFair, salmanOldEnd.getTime(), ">");

// ─── ارتقای میان‌دوره‌ای با اعتبار واقعی (۳۰ روز باقی‌مانده) ───
const midNow = new Date("2026-10-17T10:00:00Z");
const midOldEnd = new Date(midNow.getTime() + 30 * DAY);
const midFair = computeFairUpgradeEnd({
  now: midNow, oldEndDate: midOldEnd,
  paidAmount: 800000 - 233333, referencePrice: 800000, durationDays: 45,
});
console.log("ارتقای میان‌دوره‌ای (۳۰ روز باقی، اعتبار ۲۳۳هزار):");
check("حداقل روزهایی که پول می‌خرد (۳۲ روز)", midFair, midNow.getTime() + 32 * DAY, ">=");

// ─── ارتقا با دورهٔ قبلی بلندتر از پول پرداختی (۴۰ روز باقی‌مانده) ───
const longOldEnd = new Date(midNow.getTime() + 40 * DAY);
const longFair = computeFairUpgradeEnd({
  now: midNow, oldEndDate: longOldEnd,
  paidAmount: 800000 - 311111, referencePrice: 800000, durationDays: 45,
});
console.log("ارتقا با ۴۰ روز باقی‌مانده (سیاست v231 باید بماند):");
check("پایان دورهٔ قبلی حفظ شد (۴۰ روز)", longFair, longOldEnd.getTime(), "==");

// ─── گاردهای لبه ───
const zeroFair = computeFairUpgradeEnd({ now: midNow, oldEndDate: midOldEnd, paidAmount: 0, referencePrice: 800000, durationDays: 45 });
console.log("گاردهای لبه:");
check("مبلغ صفر (کد ۱۰۰٪) → پایان دورهٔ قبلی", zeroFair, midOldEnd.getTime(), "==");
const noRef = computeFairUpgradeEnd({ now: midNow, oldEndDate: midOldEnd, paidAmount: 500000, referencePrice: 0, durationDays: 45 });
check("قیمت مرجع صفر → پایان دورهٔ قبلی (بی‌خطر)", noRef, midOldEnd.getTime(), "==");

console.log(`\nنتیجه: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
