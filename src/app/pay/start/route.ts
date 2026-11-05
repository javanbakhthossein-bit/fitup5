import { NextRequest } from "next/server";
import { handleGatewayStart } from "@/lib/fitness/payment-start-route";

/**
 * v171 — GET /pay/start?order=…&from=app_android&t=… — لینک میانی پرداخت (سند بخش ۴)
 *
 * فقط برای منابع instagram و app_android استفاده می‌شود (وب مسیر مستقیم خودش را دارد):
 *  • اپ اختصاصی: Custom Tabs با پل app_bridge باز می‌کند (کروم سشن ندارد)
 *  • بررسی سشن/توکن → استعلام/تازه‌سازی authority → ریدایرکت به زرین‌پال
 * کال‌بک برای app_android با ret=app_android&oid=… برمی‌گردد تا بعد از verify،
 * دیپ‌لینک fitup://payment/success اجرا شود.
 */
export async function GET(req: NextRequest) {
  return handleGatewayStart(req);
}
