/**
 * v60 — تست واقعی OTP با خط خدماتی sms.ir
 * درخواست مالک: «خط خدماتی خود sms.ir است +98500033003 — با این تست کن ببین
 * در وب OTP کد جاگذاری میشه و بگو در env این کد رو چی بذارم.»
 *
 * تست ۱ — مسیر قالب (وب): endpoint verify با قالب 829644 و پارامتر CODE
 *         → همین مسیری است که OTP وب سایت استفاده می‌کند (جاگذاری کد در قالب).
 * تست ۲ — مسیر bulk با خط خدماتی: فرمت‌های مختلف شماره خط (+98500033003 /
 *         98500033003 / 500033003) با متن WebOTP → اولین فرمت موفق همان چیزی
 *         است که باید در SMSIR_LINE گذاشته شود.
 *
 * ⚠️ هر تست موفق یک پیامک واقعی به موبایل ادمین (مالک) می‌فرستد.
 */
import "dotenv/config";

const API_KEY = process.env.SMSIR_API_KEY;
const ADMIN = (process.env.SMSIR_TICKET_ADMIN_MOBILE || "").trim();
const OTP_TEMPLATE = Number(process.env.SMSIR_TEMPLATE_ID || 829644);
const SERVICE_LINE = "+98500033003";

const VERIFY_URL = "https://api.sms.ir/v1/send/verify";
const BULK_URL = "https://api.sms.ir/v1/send/bulk";

function ts(): string {
  return new Date().toLocaleTimeString("fa-IR");
}

async function verifyTemplate(code: string): Promise<void> {
  console.log(`\n═══ تست ۱ — قالب OTP (${OTP_TEMPLATE}) با پارامتر CODE → ${ADMIN} ═══`);
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": API_KEY ?? "",
    },
    body: JSON.stringify({
      mobile: ADMIN,
      templateId: OTP_TEMPLATE,
      parameters: [{ name: "CODE", value: code }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {}
  console.log(`  HTTP ${res.status} | status=${(data as { status?: number })?.status} | message=${(data as { message?: string })?.message ?? "-"}`);
  console.log(`  raw=${JSON.stringify(data)}`);
  const ok =
    res.ok && (data as { status?: number })?.status === 1;
  console.log(ok ? "  ✅ کد در قالب جاگذاری شد (وب OTP مسیر قالبی سالم است)" : "  ❌ مسیر قالبی ناموفق");
}

async function bulkWithLine(line: string, code: string, appHash?: string): Promise<boolean> {
  const message = [
    `کد ورود فیتاپ: ${code}`,
    `@fittup.ir #${code}`,
    ...(appHash ? [`<#>${appHash}`] : []),
  ].join("\n");
  const res = await fetch(BULK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": API_KEY ?? "",
      "x-sms-otp": "true",
    },
    body: JSON.stringify({
      mobiles: [ADMIN],
      messageText: message,
      line,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {}
  const st = (data as { status?: number })?.status;
  const msg = (data as { message?: string })?.message ?? "";
  const ok = res.ok && st === 1;
  console.log(`  line="${line}" → HTTP ${res.status} | status=${st} | ${msg}`);
  if (!ok) console.log(`    raw=${JSON.stringify(data)}`);
  return ok;
}

async function main(): Promise<void> {
  if (!API_KEY || !ADMIN) {
    console.error("SMSIR_API_KEY یا SMSIR_TICKET_ADMIN_MOBILE در env نیست.");
    process.exit(1);
  }
  console.log(`تست زندهٔ OTP — ${ts()} — موبایل ادمین: ${ADMIN}`);
  const code = String(Math.floor(1000 + Math.random() * 9000));

  await verifyTemplate(code);

  console.log(`\n═══ تست ۲ — bulk با خط خدماتی ${SERVICE_LINE} (فرمت‌های مختلف) ═══`);
  const candidates = [SERVICE_LINE, "98500033003", "500033003", "098500033003"];
  let workingLine: string | null = null;
  for (const line of candidates) {
    const ok = await bulkWithLine(line, code, undefined);
    if (ok) {
      workingLine = line;
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log(
    workingLine
      ? `\n✅ فرمت صحیح خط برای SMSIR_LINE: "${workingLine}" (bulk/WebOTP کار می‌کند)`
      : `\n❌ هیچ فرمت از خط ${SERVICE_LINE} پذیرفته نشد — خط خدماتی شاید برای این حساب ثبت نشده باشد (پیامک‌های قالبی مستقل از این هستند و کار می‌کنند).`
  );
  console.log("\nتکمیلی: در وب (بدون line) مسیر قالبی همیشه کار می‌کند؛ SMSIR_LINE فقط برای WebOTP کروم و متن آزاد لازم است.");
}

main().catch((e) => {
  console.error("خطای تست:", e);
  process.exit(1);
});
