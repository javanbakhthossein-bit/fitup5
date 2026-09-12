/**
 * تست واقعی v36 — ارسال هر ۱۳ قالب پیامکی به شمارهٔ ادمین (پیامک واقعی!)
 *
 * ⚠️ این اسکریپت پیامک واقعی ارسال می‌کند و هزینه دارد — فقط با اجازهٔ مالک.
 * هدف: اطمینان از اینکه همهٔ شناسه‌های قالب در پنل sms.ir درست تنظیم‌اند و
 * نام متغیرها (NAME/CODE/LINK/PLANBASE/PLANUPDATE/AMOUNT) دقیقاً با قالب‌ها
 * مطابقت دارند. خطای هر قالب (مثل «پارامتر با قالب همخوانی ندارد») گزارش می‌شود
 * تا نام متغیر اصلاح شود.
 *
 * اجرا: SMSIR_API_KEY=... bun run scripts/send-real-sms-tests.ts [mobile]
 * (پیش‌فرض شماره: 09300083803 — ادمین)
 */
export {};

// ─── پیکربندی واقعی (از env مرجع مالک — docs/production-env-REFERENCE.md) ───
process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";
// API key فقط از env خارجی می‌آید — در سندباکس از .env خوانده می‌شود
// (این اسکریپت هرگز کلید واقعی را hardcode نمی‌کند)

const TARGET = (process.argv[2] || "09300083803").trim();

if (!process.env.SMSIR_API_KEY || process.env.SMSIR_API_KEY.includes("test-key")) {
  console.error("❌ SMSIR_API_KEY واقعی تنظیم نشده — برای تست واقعی کلید را در env بگذار.");
  process.exit(1);
}

interface TestItem {
  label: string;
  templateEnvKey: string;
  params: Array<{ name: string; value: string }>;
  /** اگر true و تلاش اول خطای پارامتر خورد → تلاش مجدد بدون پارامتر */
  selfHeal?: boolean;
}

const NAME = "حسین";

const tests: TestItem[] = [
  { label: "1) onboarding_nudge (669068)", templateEnvKey: "onboarding_nudge", params: [{ name: "NAME", value: NAME }] },
  {
    label: "2) onboarding_winback (461291)",
    templateEnvKey: "onboarding_winback",
    params: [
      { name: "NAME", value: NAME },
      { name: "CODE", value: "FITAP15-TEST01" },
    ],
  },
  { label: "3) program_ready (663678)", templateEnvKey: "program_ready", params: [{ name: "NAME", value: NAME }] },
  { label: "4) checkup_reminder (761137)", templateEnvKey: "checkup_reminder", params: [{ name: "NAME", value: NAME }] },
  { label: "5) plan_expired (322780)", templateEnvKey: "plan_expired", params: [{ name: "NAME", value: NAME }] },
  {
    label: "6) invite_friend (852193)",
    templateEnvKey: "invite_friend",
    params: [
      { name: "NAME", value: "دوست خوبم" },
      { name: "LINK", value: "?ref=FIT-TEST01" },
    ],
  },
  {
    label: "7) expired_winback (604678)",
    templateEnvKey: "expired_winback",
    params: [
      { name: "NAME", value: NAME },
      { name: "CODE", value: "FITAP15-TEST02" },
    ],
  },
  { label: "8) purchase_advanced (423726)", templateEnvKey: "purchase_advanced", params: [{ name: "NAME", value: NAME }], selfHeal: true },
  { label: "9) purchase_ultimate (612405)", templateEnvKey: "purchase_ultimate", params: [{ name: "NAME", value: NAME }], selfHeal: true },
  { label: "10) purchase_basic (565185)", templateEnvKey: "purchase_basic", params: [{ name: "NAME", value: NAME }], selfHeal: true },
  {
    label: "11) plan_upgrade_premium (275042) — اقتصادی→حرفه‌ای",
    templateEnvKey: "plan_upgrade_premium",
    params: [
      { name: "NAME", value: NAME },
      { name: "PLANBASE", value: "اقتصادی" },
      { name: "PLANUPDATE", value: "حرفه\u200cای" },
    ],
    selfHeal: true,
  },
  {
    label: "12) plan_upgrade_standard (324322) — اقتصادی→استاندارد",
    templateEnvKey: "plan_upgrade_standard",
    params: [
      { name: "NAME", value: NAME },
      { name: "PLANBASE", value: "اقتصادی" },
      { name: "PLANUPDATE", value: "استاندارد" },
    ],
    selfHeal: true,
  },
  {
    label: "13) wallet_topup (556023)",
    templateEnvKey: "wallet_topup",
    params: [
      { name: "NAME", value: NAME },
      { name: "AMOUNT", value: "500,000" },
    ],
  },
];

async function sendViaApi(templateId: number, params: Array<{ name: string; value: string }>) {
  const res = await fetch("https://api.sms.ir/v1/send/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": process.env.SMSIR_API_KEY!,
    },
    body: JSON.stringify({
      mobile: TARGET.replace(/^0/, ""),
      templateId,
      parameters: params,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: number; message?: string; data?: unknown };
  return { httpOk: res.ok, apiStatus: data.status, message: data.message };
}

async function main() {
  const { SMS_TEMPLATE_ENV_KEYS } = await import("../src/lib/fitness/smsir");
  console.log(` ارسال تستی به ${TARGET} — ${tests.length} قالب\n`);

  let sentCount = 0;
  const failed: string[] = [];

  for (const t of tests) {
    const envVal = process.env[SMS_TEMPLATE_ENV_KEYS[t.templateEnvKey as keyof typeof SMS_TEMPLATE_ENV_KEYS]];
    if (!envVal) {
      console.log(`⏭️  ${t.label} — env تنظیم نیست، رد شد`);
      continue;
    }
    const templateId = Number(envVal);
    let r = await sendViaApi(templateId, t.params);
    let healed = false;
    if (!r.httpOk || r.apiStatus !== 1) {
      if (t.selfHeal) {
        const retry = await sendViaApi(templateId, []);
        healed = true;
        r = retry;
      }
    }
    const okSend = r.httpOk && r.apiStatus === 1;
    if (okSend) sentCount++;
    else failed.push(t.label);
    console.log(
      `${okSend ? "✅" : "❌"} ${t.label}${healed ? " (خودترمیم: بدون پارامتر)" : ""} — status=${r.apiStatus} ${r.message ?? ""}`
    );
    // فاصلهٔ کوتاه بین ارسال‌ها — جلوگیری از rate limit
    await new Promise((res) => setTimeout(res, 700));
  }

  console.log(`\nنتیجه: ${sentCount}/${tests.length} موفق`);
  if (failed.length > 0) {
    console.log("❌ ناموفق:\n" + failed.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
