import { NextRequest } from "next/server";
import { handleSmsLinkEnter } from "@/lib/fitness/payment-start-route";

/**
 * v171 — GET /enter?token=… — لندینگ لینک پیامکی پرداخت (سند بخش ۲، فلوی اینستاگرام)
 *
 * کاربر روی لینک پیامک («https://fittup.ir/r/XXXXXXXX» → اینجا) می‌زند:
 *   ۱. توکن validate می‌شود (۲۰ دقیقه، چندکلیکی تا پرداخت موفق — ضد VPN)
 *   ۲. سشن در مرورگر پیش‌فرض ساخته می‌شود (کوکی)
 *   ۳. ریدایرکت مستقیم به درگاه زرین‌پال
 * بعد از پرداخت، کال‌بک استاندارد (?payment_verify=1) verify + داشبورد را انجام می‌دهد.
 */
export async function GET(req: NextRequest) {
  return handleSmsLinkEnter(req);
}
