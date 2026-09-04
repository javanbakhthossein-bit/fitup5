/**
 * تست ارسال پیامک «تیکت جدید» فیتاپ — قالب sms.ir کد ۹۴۲۷۶۳ (متغیر #NAME#)
 *
 * اجرا:
 *   SMSIR_API_KEY=<کلید> bun scripts/test-ticket-sms.ts [موبایل] [نام]
 *
 * مثال:
 *   SMSIR_API_KEY=xxx bun scripts/test-ticket-sms.ts 09123456789 "حسین"
 *
 * نکته: تا زمان تأیید قالب توسط sms.ir، پاسخ خطای وضعیت (قالب فعال نیست)
 * برمی‌گردد — این رفتار طبیعی است و بعد از تأیید، همان دستور باید «sent ✓» بدهد.
 */
import { sendTicketSms, normalizeMobileForSmsIr } from "../src/lib/fitness/smsir";

async function main() {
  const mobile = process.argv[2] || "09300083803";
  const name = process.argv[3] || "تست فیتاپ";

  console.log("── تست پیامک تیکت جدید (قالب ۹۴۲۷۶۳ / #NAME#) ──");
  console.log("موبایل:", mobile, "→ نرمال‌شده:", normalizeMobileForSmsIr(mobile));
  console.log("NAME:", name);
  console.log("SMSIR_API_KEY:", process.env.SMSIR_API_KEY ? "ست‌شده ✓" : "❌ تنظیم نشده");
  console.log("SMSIR_TICKET_TEMPLATE_ID:", process.env.SMSIR_TICKET_TEMPLATE_ID || "942763 (پیش‌فرض)");
  console.log("");

  const r = await sendTicketSms(mobile, name);

  console.log("نتیجه:", JSON.stringify(r, null, 2));
  if (r.success) {
    console.log("✅ پیامک تیکت با موفقیت ارسال شد");
    process.exit(0);
  } else {
    console.log("❌ ارسال نشد:", r.error);
    process.exit(1);
  }
}

main();
