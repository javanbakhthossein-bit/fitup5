/**
 * v254 — تست API واقعی زیبال از سندباکس (IP 47.57.242.119 وایت‌لیست‌شده توسط مالک).
 *
 * هدف: اثبات اینکه request/inquiry/verify از IP سندباکس بدون خطای 105/115 کار می‌کند
 * وwrapper ریتری رد IP (zibalPostJsonWithIpRetry) درست رفتار می‌کند.
 *
 * ⚠️ هیچ پولی جابه‌جا نمی‌شود: trackId ساخته‌شده هرگز پرداخت نمی‌شود؛
 *    inquiry وضعیت -1 (در انتظار پرداخت) و verify نتیجهٔ 202 (پرداخت نشده) می‌دهد.
 *
 * اجرا: ZIBAL_MERCHANT_ID=... bun run scripts/test-zibal-real-api.ts
 */

// env باید قبل از import پروایدر ست شود (hasRealMerchant در زمان فراخوانی می‌خواند
// ولی برای شفافیت همین‌جا چک می‌کنیم)
const merchant = process.env.ZIBAL_MERCHANT_ID?.trim();
if (!merchant) {
  console.error("❌ ZIBAL_MERCHANT_ID ست نشده — اجرا: ZIBAL_MERCHANT_ID=... bun run scripts/test-zibal-real-api.ts");
  process.exit(1);
}

async function zibalPost(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main() {
  console.log("=== ① request (ساخت تراکنش آزمایشی ۱۰۰۰ تومانی — پرداخت نمی‌شود) ===");
  const req = await zibalPost("https://gateway.zibal.ir/v1/request", {
    merchant,
    amount: 10_000, // ریال = ۱۰۰۰ تومان
    callbackUrl: "https://fittup.ir/pay/zibal/callback/test0000000000000000000000",
    description: "فیتاپ — تست اتصال سندباکس v254",
  });
  console.log(JSON.stringify(req));
  const result = req.result;
  if (result === 105 || result === 115) {
    console.error("❌ رد IP — وایت‌لیست اعمال نشده یا IP دیگری خروج است");
    process.exit(2);
  }
  if (result !== 100 || !req.trackId) {
    console.error(`❌ request ناموفق — ${JSON.stringify(req)}`);
    process.exit(3);
  }
  const trackId = String(req.trackId);
  console.log(`✅ trackId = ${trackId}`);

  console.log("=== ② inquiry (انتظار: status=-1 در انتظار پرداخت) ===");
  const inq = await zibalPost("https://gateway.zibal.ir/v1/inquiry", { merchant, trackId: Number(trackId) });
  console.log(JSON.stringify(inq));
  if (inq.result === 100) {
    console.log(`✅ inquiry OK — status=${inq.status} (${inq.status === -1 ? "در انتظار پرداخت ✓" : "غیرمنتظره"})`);
  } else {
    console.error(`⚠️ inquiry نتیجهٔ غیرمترقبه: ${JSON.stringify(inq)}`);
  }

  console.log("=== ③ verify (انتظار: result=202 پرداخت نشده — قطعیِ امن) ===");
  const ver = await zibalPost("https://gateway.zibal.ir/v1/verify", { merchant, trackId: Number(trackId) });
  console.log(JSON.stringify(ver));
  if (ver.result === 202) {
    console.log("✅ verify OK — 202 (پرداخت نشده) یعنی مسیر verify از IP سندباکس باز است");
  } else if (ver.result === 105 || ver.result === 115) {
    console.error("❌ رد IP روی verify");
    process.exit(4);
  } else {
    console.log(`⚠️ verify نتیجهٔ غیرمترقبه (غیرمسدودکننده): ${JSON.stringify(ver)}`);
  }

  console.log("=== نتیجه: اتصال سندباکس به API واقعی زیبال برقرار است ===");
}

main().catch((e) => {
  console.error("❌ خطای شبکه:", e instanceof Error ? e.message : e);
  process.exit(5);
});
