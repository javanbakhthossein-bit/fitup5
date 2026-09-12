/**
 * تست رفتاری v45 — ارسال OTP تک‌مسیره قطعی (رفع ریشه‌ای خطای ۱۰۱ «شماره خط
 * نامعتبر میباشد» + تأخیر ارسال + failed to fetch)
 *
 * fetch سراسری با یک mock sms.ir جایگزین می‌شود تا سناریوها بدون هزینه تست شود:
 *   سناریو ۱: حالت دقیق production مالک (RAW_SEND=true، بدون SMSIR_LINE)
 *             → فقط یک تماس verify، هیچ تماس bulk، موفق ✅ (ریشه ۱۰۱ بسته شد)
 *   سناریو ۲: همان حالت + خطای قالب → شکست صریح، بدون هیچ fallback bulk
 *   سناریو ۳: SMSIR_LINE تنظیم + raw فعال → bulk اول با line در بدنه (WebOTP)
 *   سناریو ۴: SMSIR_LINE تنظیم + bulk خطای ۱۰۱ → یک fallback قالب → موفق
 *   سناریو ۵: بدون API key → شکست فوری بدون هیچ تماس شبکه
 *   سناریو ۶: raw فعال + بدون line + بدون TEMPLATE_ID → خطای واضح، بدون bulk
 *   سناریو ۷: نرمال‌سازی انواع شماره (+98 / 0098 / 0 / خام ۱۰ رقمی)
 *   سناریو ۸: خطای ۱۰۱ روی خودِ verify → status=101 در نتیجه (لاگ‌پذیر)
 *
 * اجرا: bun run scripts/test-otp-fallback.ts
 */
// ماژول مستقل (جلوگیری از تصادم global-scope بین اسکریپت‌ها)
export {};

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}
const calls: CapturedCall[] = [];
/** پاسخ bulk: "ok" | "fail" (HTTP-200/status≠1) | "owner101" (HTTP-400/101/خط نامعتبر) */
let bulkBehavior: "ok" | "fail" | "owner101" = "ok";
let templateBehavior: "ok" | "fail" | "owner101" = "ok";

(globalThis as any).fetch = (async (url: any, init: any) => {
  const body = JSON.parse(init?.body || "{}");
  calls.push({ url: String(url), body });
  const isBulk = String(url).includes("/send/bulk");
  const behavior = isBulk ? bulkBehavior : templateBehavior;
  if (behavior === "owner101") {
    // بازتولید دقیق گزارش مالک از پنل sms.ir:
    // کد وضعیت ۱۰۱ — «شماره خط نامعتبر میباشد» — HTTP 400
    return new Response(
      JSON.stringify({ status: 101, message: "شماره خط نامعتبر میباشد" }),
      { status: 400 }
    );
  }
  const ok = behavior === "ok";
  return ok
    ? new Response(
        JSON.stringify({
          status: 1,
          message: "موفق",
          data: isBulk ? { packId: 1 } : { messageId: 1 },
        }),
        { status: 200 }
      )
    : new Response(JSON.stringify({ status: 1234, message: "خطای شبیه‌سازی‌شده" }), {
        status: 200,
      });
}) as any;

let ok = true;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) ok = false;
}

async function main() {
  const { sendOtpSms } = await import("../src/lib/fitness/smsir");

  // ─── سناریو ۱: دقیقاً حالت production مالک ───
  // SMSIR_USE_RAW_SEND=true و SMSIR_LINE تعریف‌نشده → OTP فقط از قالب،
  // هیچ تماس bulk (ریشهٔ خطای ۱۰۱ و تأخیر بسته شد)
  process.env.SMSIR_API_KEY = "test-key";
  process.env.SMSIR_USE_RAW_SEND = "true";
  process.env.SMSIR_TEMPLATE_ID = "829644";
  delete process.env.SMSIR_LINE;
  bulkBehavior = "owner101"; // اگر اشتباهاً bulk صدا شود در شمارش/نتیجه دیده می‌شود
  templateBehavior = "ok";
  calls.length = 0;
  const r1 = await sendOtpSms("09900291939", "3243");
  check(
    "۱) RAW_SEND=true بدون SMSIR_LINE → فقط یک تماس verify، بدون bulk، موفق",
    r1.success === true &&
      calls.length === 1 &&
      calls[0].url.includes("/send/verify") &&
      calls[0].body.templateId === 829644 &&
      calls[0].body.parameters?.[0]?.name === "CODE" &&
      calls[0].body.mobile === "9900291939",
    `calls=${calls.length}`
  );

  // ─── سناریو ۲: همان حالت + خطای قالب → شکست صریح بدون fallback bulk ───
  templateBehavior = "fail";
  calls.length = 0;
  const r2 = await sendOtpSms("09900291939", "3243");
  check(
    "۲) خطای قالب → success:false، فقط ۱ تماس، بدون هیچ bulk",
    r2.success === false && calls.length === 1 && !calls[0].url.includes("/send/bulk"),
    `calls=${calls.length} err=${r2.error?.slice(0, 60)}`
  );

  // ─── سناریو ۳: SMSIR_LINE تنظیم + raw فعال → bulk اول با line (WebOTP) ───
  templateBehavior = "ok";
  bulkBehavior = "ok";
  process.env.SMSIR_LINE = "3000505";
  calls.length = 0;
  const r3 = await sendOtpSms("09120000000", "1234");
  check(
    "۳) SMSIR_LINE تنظیم‌شده → bulk اول با line در بدنه (WebOTP زنده)",
    r3.success === true && calls.length === 1 && calls[0].url.includes("/send/bulk") && calls[0].body.line === "3000505",
    `calls=${calls.length}`
  );

  // ─── سناریو ۴: SMSIR_LINE تنظیم + bulk خطای ۱۰۱ → یک fallback قالب ───
  bulkBehavior = "owner101";
  calls.length = 0;
  const r4 = await sendOtpSms("09120000000", "1234");
  check(
    "۴) با line، bulk شکست → یک fallback قالب → موفق (بدون مدارشکن لازم)",
    r4.success === true &&
      calls.length === 2 &&
      calls[0].url.includes("/send/bulk") &&
      calls[1].url.includes("/send/verify"),
    `calls=${calls.length}`
  );

  // ─── سناریو ۵: بدون API key → شکست فوری بدون هیچ تماس ───
  delete process.env.SMSIR_API_KEY;
  calls.length = 0;
  const r5 = await sendOtpSms("09120000000", "1234");
  check(
    "۵) بدون کلید API → شکست بدون هیچ تماس شبکه",
    r5.success === false && calls.length === 0,
    `calls=${calls.length}`
  );

  // ─── سناریو ۶: raw فعال + بدون line + بدون TEMPLATE_ID → خطای واضح، بدون bulk ───
  process.env.SMSIR_API_KEY = "test-key";
  process.env.SMSIR_USE_RAW_SEND = "true";
  delete process.env.SMSIR_LINE;
  delete process.env.SMSIR_TEMPLATE_ID;
  bulkBehavior = "ok";
  calls.length = 0;
  const r6 = await sendOtpSms("09120000000", "1234");
  check(
    "۶) بدون TEMPLATE_ID → خطای واضح، بدون هیچ تماس bulk",
    r6.success === false && calls.length === 0 && (r6.error || "").includes("SMSIR_TEMPLATE_ID"),
    `calls=${calls.length}`
  );

  // ─── سناریو ۷: نرمال‌سازی انواع فرمت شماره ───
  process.env.SMSIR_TEMPLATE_ID = "829644";
  templateBehavior = "ok";
  const cases: Array<[string, string]> = [
    ["09123456789", "9123456789"],
    ["+989123456789", "9123456789"],
    ["00989123456789", "9123456789"],
    ["989123456789", "9123456789"],
    ["9123456789", "9123456789"],
  ];
  let normOk = true;
  for (const [input, expected] of cases) {
    calls.length = 0;
    await sendOtpSms(input, "1234");
    if (calls[0]?.body.mobile !== expected) normOk = false;
  }
  check("۷) نرمال‌سازی +98/0098/0/خام → همه به 9XXXXXXXXX", normOk);

  // ─── سناریو ۸: خطای ۱۰۱ روی خود verify → status=101 در نتیجه ───
  templateBehavior = "owner101";
  calls.length = 0;
  const r8 = await sendOtpSms("09120000000", "1234");
  check(
    "۸) خطای ۱۰۱ روی verify → success:false + status=101 (قابل لاگ)",
    r8.success === false && r8.status === 101 && calls.length === 1,
    `status=${r8.status}`
  );
  templateBehavior = "ok";
}

main()
  .then(() => {
    console.log(ok ? "\n✅ همهٔ سناریوهای OTP v45 PASS شدند" : "\n❌ FAIL");
    process.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
