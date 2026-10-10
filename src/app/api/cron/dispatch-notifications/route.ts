import { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/fitness/cron-auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { dispatchDueCampaigns } from "@/lib/fitness/notification-campaigns";

/**
 * GET /api/cron/dispatch-notifications?secret=CRON_SECRET
 *
 * v178 — ارسال کمپین‌های اعلان زمان‌بندی‌شدهٔ سررسیده.
 * جاروی داخلی instrumentation (هر ۶۰ ثانیه) خودش این route را صدا می‌زند؛
 * crontab اختیاری سرور هم می‌تواند آن را هر دقیقه صدا بزند (پوشش دوبل):
 *
 *   * * * * * curl -s "http://localhost:3000/api/cron/dispatch-notifications?secret=$CRON_SECRET" > /dev/null
 *
 * Idempotent: کمپین ارسال‌شده دوباره ارسال نمی‌شود (status guard +
 * checkpoint meta.campaignId برای ادامهٔ کمپین نیمه‌کاره).
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`cron-dispatch:${getClientIp(req)}`, 120, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const url = new URL(req.url);
  if (!isAuthorizedCronRequest(req, url)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchDueCampaigns();
    const sent = result.results.reduce((a, r) => a + r.sent, 0);
    if (result.dispatched > 0) {
      console.log(`[cron/dispatch-notifications] ${result.dispatched} کمپین ارسال شد (${sent} نوتیف)`);
    }
    return Response.json({ ok: true, dispatched: result.dispatched, sent });
  } catch (e: any) {
    console.error("[cron/dispatch-notifications] failed:", e);
    return Response.json(
      { ok: false, error: String(e?.message || e).slice(0, 300) },
      { status: 500 }
    );
  }
}
