import { NextRequest } from "next/server";
import { handleGatewayStart } from "@/lib/fitness/payment-start-route";

/**
 * v171 — GET /wallet/topup/start?order=…&from=app_android&t=… — شارژ کیف پول اپ
 * (سند بخش ۱۱) — فقط اپ اختصاصی (app_android). برای اینستاگرام هیچ جریان شارژ
 * کیف پولی وجود ندارد و در UI هم نشان داده نمی‌شود؛ وب همان مسیر مستقیم قبلی.
 *
 * مبلغ همیشه از رکورد Payment (سرور) خوانده می‌شود؛ پارامتر amount فقط برای
 * سازگاری با نمونه URL سند پذیرفته می‌شود و با مبلغ رکورد تطبیق داده می‌شود.
 * بعد از verify موفق: موجودی + WalletTransaction (مسیر استاندارد verify) و
 * دیپ‌لینک fitup://wallet/success?amount=…&tx=… برای اپ.
 */
export async function GET(req: NextRequest) {
  return handleGatewayStart(req, { walletOnly: true });
}
