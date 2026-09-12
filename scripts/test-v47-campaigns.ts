/**
 * v47 — تست منطقی کمپین‌های جدید + تخفیف اختصاصی روی کارت‌ها
 * اجرا: bun run scripts/test-v47-campaigns.ts
 *
 * سناریوها:
 *  A) welcome_offer (612964): کاربر ۸.۵ روز پیش ثبت‌شده + آنبوردینگ ناتمام → کد HI30-… + پیامک + NAME=«ورزشکار»
 *  B) welcome_offer با نام: کاربر آنبوردینگ‌کامل با نام → NAME = نام خودش
 *  C) renewal_boost (883325): کاربر با پلن منقضی ۸.۵ روز پیش → همان کد تمدید (۳۰٪) + پیامک با LINK=go/renew
 *  D) گیت «فقط خرید اول»: کاربر با اشتراک قبلی → کد welcome اعمال نمی‌شود
 *  E) API /api/user-discount-code + /api/payment/discount با سشن جعلی
 *  F) کرون واقعی HTTP → summary شمارش سناریوهای جدید
 * در پایان همهٔ رکوردهای تستی پاک می‌شوند.
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync } from "crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const results: { name: string; pass: boolean; detail?: string }[] = [];

function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function forgeSession(userId: string): string {
  const secret = process.env.SESSION_SECRET || process.env.CRON_SECRET || "";
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

async function api(path: string, cookie: string, method = "GET", body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: `sc_session=${cookie}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

/** موبایل نرمال‌شدهٔ sms.ir (بدون صفر ابتدا) — کلید SmsLog با همین فرمت است */
function norm(m: string) {
  return m.startsWith("0") ? m.slice(1) : m;
}

let cleanupIds: string[] = [];

async function cleanup() {
  const ids = cleanupIds;
  await db.smsLog.deleteMany({ where: { userId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.userDiscountCode.deleteMany({ where: { userId: { in: ids } } });
  await db.subscription.deleteMany({ where: { userId: { in: ids } } });
  await db.payment.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  console.log("cleanup done");
}

async function main() {
  const now = Date.now();
  const d = (n: number) => new Date(now - n * 86400000);
  const T = "0990000000";

  // پاک‌سازی بقایای احتمالی اجرای قبلی
  const stale = await db.user.findMany({ where: { mobile: { startsWith: T } }, select: { id: true } });
  cleanupIds = stale.map((u) => u.id);
  if (cleanupIds.length) await cleanup();

  // ─── ساخت کاربران تستی ───
  const userA = await db.user.create({ // آنبوردینگ ناتمام
    data: { mobile: `${T}1`, onboardingDone: false, createdAt: d(8.5), updatedAt: d(8.5) },
  });
  const userB = await db.user.create({ // آنبوردینگ کامل با نام
    data: { mobile: `${T}2`, onboardingDone: true, name: "حسین محمدی", createdAt: d(8.4), updatedAt: d(8.4) },
  });
  const userC = await db.user.create({ // پلن منقضی ۸.۵ روز پیش
    data: { mobile: `${T}3`, onboardingDone: true, name: "سارا", createdAt: d(40), updatedAt: d(40), planName: "basic", planExpiresAt: d(8.5), planStartedAt: d(53.5) },
  });
  const subC = await db.subscription.create({
    data: { userId: userC.id, plan: "basic", status: "expired", endDate: d(8.5), durationDays: 45, pricePaid: 350000 },
  });
  const userD = await db.user.create({ // خریدار قبلی → گیت خرید اول
    data: { mobile: `${T}4`, onboardingDone: true, name: "رضا", createdAt: d(9), updatedAt: d(9) },
  });
  await db.subscription.create({
    data: { userId: userD.id, plan: "basic", status: "expired", endDate: d(2), durationDays: 45, pricePaid: 350000 },
  });
  cleanupIds = [userA.id, userB.id, userC.id, userD.id];
  console.log("test users created:", cleanupIds.join(" "));

  try {
    // ─── F) کرون واقعی (HTTP) — سناریوهای welcome_offer + renewal_boost ───
    const secret = process.env.CRON_SECRET || "";
    const cronRes = await fetch(`${BASE}/api/cron/behavioral?secret=${secret}`);
    const cronJson = await cronRes.json();
    console.log("cron summary:", JSON.stringify(cronJson));
    check("F: cron welcomeOffer counted (=2)", cronJson.welcomeOffer === 2, `welcomeOffer=${cronJson.welcomeOffer}`);
    check("F: cron renewalBoost counted (=1)", cronJson.renewalBoost === 1, `renewalBoost=${cronJson.renewalBoost}`);

    // ─── A/B) کد welcome_offer ساخته شده؟ ───
    const codeA = await db.userDiscountCode.findFirst({ where: { userId: userA.id, reason: "welcome_offer" } });
    const codeB = await db.userDiscountCode.findFirst({ where: { userId: userB.id, reason: "welcome_offer" } });
    check("A: welcome code created 30% HI30-", !!codeA && codeA?.value === 30 && codeA.code.startsWith("HI30-"), codeA?.code);
    check("B: welcome code created (named user)", !!codeB && codeB?.value === 30, codeB?.code);

    // درصد از تنظیمات پنل مدیر = ۳۰
    const setting = await db.siteSetting.findUnique({ where: { key: "welcome_offer_discount_percent" } });
    check("A: percent from settings = 30", setting?.value === "30", setting?.value);

    // پیامک — ارسال واقعی (SmsLog با موبایل نرمال‌شده)
    const smsA = await db.smsLog.findUnique({ where: { mobile_key: { mobile: norm(`${T}1`), key: "welcome_offer" } } });
    check("A: SmsLog welcome_offer sent", smsA?.status === "sent", `status=${smsA?.status} template=${smsA?.templateId}`);
    const smsB = await db.smsLog.findUnique({ where: { mobile_key: { mobile: norm(`${T}2`), key: "welcome_offer" } } });
    check("B: SmsLog welcome_offer sent", smsB?.status === "sent", `status=${smsB?.status}`);

    // نوتیف هم‌خانواده — فقط وقتی پیامک رفت
    const notifA = await db.notification.findFirst({ where: { userId: userA.id, meta: { contains: "welcome_offer_8d" } } });
    check("A: welcome notif created", !!notifA, `title=${notifA?.title ?? "-"}`);

    // ─── C) renewal_boost ───
    const renewCode = await db.userDiscountCode.findFirst({ where: { userId: userC.id, reason: "renewal_loyalty" } });
    check("C: renewal code ensured at 30%", !!renewCode && renewCode?.value === 30, `${renewCode?.code} value=${renewCode?.value}`);
    const smsC = await db.smsLog.findUnique({ where: { mobile_key: { mobile: norm(`${T}3`), key: `renewal_boost_${subC.id}` } } });
    check("C: SmsLog renewal_boost sent", smsC?.status === "sent", `status=${smsC?.status} template=${smsC?.templateId}`);
    const notifC = await db.notification.findFirst({ where: { userId: userC.id, type: "renewal_boost" } });
    check("C: renewal_boost notif created", !!notifC, `title=${notifC?.title ?? "-"}`);

    // دداپ: اجرای دوباره کرون نباید پیامک دوباره بفرستد
    const cron2 = await fetch(`${BASE}/api/cron/behavioral?secret=${secret}`);
    const cron2Json = await cron2.json();
    check("F: rerun cron → no duplicate SMS", cron2Json.welcomeOffer === 0 && (cron2Json.renewalBoost ?? 0) === 0, `welcomeOffer=${cron2Json.welcomeOffer} renewalBoost=${cron2Json.renewalBoost}`);

    // ─── E) API با سشن جعلی: کاربر B (خرید اول، کد welcome) ───
    const sessB = forgeSession(userB.id);
    const udc = await api("/api/user-discount-code", sessB);
    check("E: /api/user-discount-code returns welcome code", udc.json?.code === codeB?.code && udc.json?.reason === "welcome_offer" && udc.json?.value === 30, JSON.stringify({ code: udc.json?.code, reason: udc.json?.reason, value: udc.json?.value }));

    const disc = await api("/api/payment/discount", sessB, "POST", { code: codeB?.code, planId: "basic" });
    const planPrice = 350000;
    const expectedFinal = planPrice - Math.round((planPrice * 30) / 100);
    check("E: /api/payment/discount applies 30%", disc.json?.valid === true && disc.json?.finalAmount === expectedFinal, `final=${disc.json?.finalAmount} expected=${expectedFinal}`);

    // ─── D) گیت «فقط خرید اول»: کاربر D با اشتراک قبلی ───
    await db.userDiscountCode.create({
      data: { userId: userD.id, code: `HI30-DTEST1`, type: "percent", value: 30, reason: "welcome_offer", isUsed: false, validUntil: new Date(now + 30 * 86400000) },
    });
    const sessD = forgeSession(userD.id);
    const discD = await api("/api/payment/discount", sessD, "POST", { code: "HI30-DTEST1", planId: "basic" });
    check("D: first-purchase gate blocks used-customer", discD.json?.valid === false && String(discD.json?.error || "").includes("اولین خرید"), JSON.stringify(discD.json));

    // گیت آنبوردینگ در checkout — کاربر A آنبوردینگ ناتمام
    const sessA = forgeSession(userA.id);
    const coA = await api("/api/payment/checkout", sessA, "POST", { planId: "basic", paymentMethod: "gateway" });
    check("A: onboarding gate blocks purchase (403)", coA.status === 403 && coA.json?.code === "ONBOARDING_REQUIRED", `status=${coA.status} code=${coA.json?.code}`);
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n════════ ${results.length - failed}/${results.length} PASS ════════`);
  await db.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
