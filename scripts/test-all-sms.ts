/**
 * تست زندهٔ همهٔ قالب‌های پیامک sms.ir — دقیقاً با همان پارامترهایی که اپ می‌فرستد
 * همه به شمارهٔ ادمین (SMSIR_TICKET_ADMIN_MOBILE) می‌روند — بدون نوشتن در دیتابیس.
 * اجرا: bun run scripts/test-all-sms.ts
 */

const API_KEY = process.env.SMSIR_API_KEY || "PPWHlVFJWV7guKm2Rga2FPhfVTWpcLdlFJGz7wBigDQeozOs";
const ADMIN = process.env.SMSIR_TICKET_ADMIN_MOBILE || "09300083803";
const URL = "https://api.sms.ir/v1/send/verify";

function norm(m: string): string {
  let s = m.replace(/\s/g, "").replace(/[+\-()]/g, "");
  if (s.startsWith("0098")) s = s.slice(4);
  else if (s.startsWith("98")) s = s.slice(2);
  if (s.startsWith("0")) s = s.slice(1);
  return s;
}

async function send(
  label: string,
  templateId: number,
  params: Array<{ name: string; value: string }>
): Promise<boolean> {
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        // v58 — هم‌تراز با فیکس postVerify: endpoint verify موبایل را با صفر
        // ابتدا می‌خواهد (فرمت رسمی مستندات sms.ir) — قالب 248945 با بدنهٔ
        // بدون-صفر خطای 400/101 می‌داد (گزارش مالک).
        mobile: `0${norm(ADMIN)}`,
        templateId,
        parameters: params,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    let data: unknown = null;
    try { data = await res.json(); } catch {}
    const ok =
      res.ok &&
      (!data || typeof data !== "object" || !("status" in data) || (data as { status: unknown }).status === 1);
    const brief = JSON.stringify(data).slice(0, 160);
    console.log(`${ok ? "✅" : "❌"} ${label} (قالب ${templateId}) params=[${params.map(p => p.name).join(",")}] → ${ok ? "SENT" : `HTTP ${res.status} | ${brief}`}`);
    return ok;
  } catch (e) {
    console.log(`❌ ${label} (قالب ${templateId}) → EXC ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const NAME = "حسین";
const CODE = "FT20";
const LINK = "r/AbCdEf1234";
const AMOUNT = "۵۰۰٫۰۰۰ تومان";
const PLANBASE = "اقتصادی";
const PLANUPDATE = "استاندارد";

const tests: Array<{ label: string; id: number; attempts: Array<Array<{ name: string; value: string }>> }> = [
  { label: "OTP ورود", id: 829644, attempts: [[{ name: "CODE", value: "1234" }]] },
  { label: "ترک درگاه پرداخت", id: 248945, attempts: [
      [{ name: "NAME", value: NAME }, { name: "LINK", value: LINK }],
      [{ name: "NAME", value: NAME }, { name: "LINK", value: LINK }, { name: "PERCENT", value: "10" }],
      [{ name: "NAME", value: NAME }],
      [],
    ] },
  { label: "برنامه آماده شد", id: 663678, attempts: [[{ name: "NAME", value: NAME }], []] },
  { label: "خرید اقتصادی/استاندارد", id: 565185, attempts: [[{ name: "NAME", value: NAME }], []] },
  { label: "خرید پلن پیشرفته", id: 423726, attempts: [[{ name: "NAME", value: NAME }], []] },
  { label: "خرید پلن حرفه‌ای", id: 612405, attempts: [[{ name: "NAME", value: NAME }], []] },
  { label: "پیشنهاد خوش‌آمدگویی", id: 612964, attempts: [[{ name: "NAME", value: NAME }, { name: "CODE", value: CODE }]] },
  { label: "شارژ کیف پول", id: 556023, attempts: [[{ name: "NAME", value: NAME }, { name: "AMOUNT", value: AMOUNT }]] },
  { label: "تیکت پشتیبانی", id: 942763, attempts: [[{ name: "NAME", value: NAME }]] },
  { label: "یادآوری آنبوردینگ", id: 669068, attempts: [[{ name: "NAME", value: NAME }]] },
  { label: "بازگشت آنبوردینگ", id: 461291, attempts: [[{ name: "NAME", value: NAME }, { name: "CODE", value: CODE }]] },
  { label: "چکاپ فرا رسیده", id: 761137, attempts: [[{ name: "NAME", value: NAME }]] },
  { label: "پلن منقضی شد", id: 322780, attempts: [[{ name: "NAME", value: NAME }, { name: "LINK", value: LINK }]] },
  { label: "پلن رو به انقضا", id: 184777, attempts: [[{ name: "NAME", value: NAME }, { name: "LINK", value: LINK }]] },
  { label: "دعوت دوست", id: 852193, attempts: [[{ name: "NAME", value: NAME }, { name: "LINK", value: LINK }]] },
  { label: "وین‌بک انقضا", id: 604678, attempts: [[{ name: "NAME", value: NAME }, { name: "CODE", value: CODE }, { name: "LINK", value: LINK }]] },
  { label: "ارتقا به پیشرفته/حرفه‌ای", id: 275042, attempts: [[{ name: "NAME", value: NAME }, { name: "PLANBASE", value: PLANBASE }, { name: "PLANUPDATE", value: PLANUPDATE }]] },
  { label: "ارتقا اقتصادی→استاندارد", id: 324322, attempts: [[{ name: "NAME", value: NAME }, { name: "PLANBASE", value: PLANBASE }, { name: "PLANUPDATE", value: PLANUPDATE }]] },
  { label: "تقویت تمدید", id: 883325, attempts: [[{ name: "NAME", value: NAME }, { name: "CODE", value: CODE }, { name: "LINK", value: LINK }]] },
];

let pass = 0, fail = 0;
const failedList: string[] = [];
for (const t of tests) {
  let ok = false;
  for (const params of t.attempts) {
    // فقط در صورت شکست تلاشِ بعدی — اولین ترکیبِ موفق کافی است
    ok = await send(t.label, t.id, params);
    if (ok) break;
  }
  if (ok) pass++; else { fail++; failedList.push(t.label); }
  await new Promise(r => setTimeout(r, 800)); // مکث کوتاه بین ارسال‌ها
}

console.log("\n══════════════ نتیجه ══════════════");
console.log(`موفق: ${pass} | ناموفق: ${fail}`);
if (failedList.length) console.log("ناموفق‌ها:", failedList.join(" | "));
