import { NextRequest } from "next/server";

/**
 * GET /api/payment/test
 * تست مستقیم اتصال به زرین‌پال (بدون نیاز به auth)
 */
export async function GET() {
  const merchantId = process.env.ZARINPAL_MERCHANT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
  const callbackUrl = `${siteUrl.replace(/\/$/, "")}/?payment_verify=1`;

  if (!merchantId) {
    return Response.json({ error: "ZARINPAL_MERCHANT_ID not set" }, { status: 500 });
  }

  const body = {
    merchant_id: merchantId,
    amount: 1000,
    currency: "IRT",
    description: "تست اتصال فیتاپ",
    callback_url: callbackUrl,
    metadata: { mobile: "09120000000" },
  };

  try {
    const res = await fetch("https://payment.zarinpal.com/pg/v4/payment/request.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json({
      ok: res.ok,
      status: res.status,
      merchantId: merchantId?.substring(0, 8) + "...",
      callbackUrl,
      requestBody: body,
      response: data,
      success: data?.data?.code === 100,
      authority: data?.data?.authority || null,
    });
  } catch (e: any) {
    return Response.json({
      ok: false,
      error: e.message,
      merchantId: merchantId?.substring(0, 8) + "...",
      callbackUrl,
    }, { status: 500 });
  }
}
