import { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/fitness/cron-auth";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { runBackupIfDue, runBackup } from "@/lib/fitness/db-backup";

/**
 * GET /api/cron/db-backup?secret=CRON_SECRET            (v66)
 *
 * بکاپ دوره‌ای دیتابیس — دیریکتیو مالک:
 * «دیتابیس هر ۲ ساعت بکاپ گرفته بشه، بره تو گوگل درایو من، فقط ۴۸ ساعت
 *  نگه داشته بشه، بازهٔ بکاپ و لینک از پنل مدیر قابل تغییر باشه.»
 *
 * منطق: هر فراخوانی «سررسید» را چک می‌کند (آخرین بکاپ موفق + بازهٔ
 * SiteSetting.db_backup_interval_hours) و فقط در صورت سررسید بکاپ می‌گیرد.
 * جاروی داخلی instrumentation هر ۱۰ دقیقه این route را loopback صدا می‌زند —
 * تغییر بازه از پنل ادمین بدون ری‌استارت اعمال می‌شود.
 *
 * اجرای دستی فوری: ?force=1 (بکاپ کامل، مستقل از سررسید — برای تست ادمین)
 *
 * محافظت: CRON_SECRET یا اتصال loopback خود سرور (هم‌الگوی auto-close-tickets).
 * crontab خارجی (اختیاری):
 *   curl -s "https://fittup.ir/api/cron/db-backup?secret=$CRON_SECRET"
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`cron-db-backup:${getClientIp(req)}`, 60, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const url = new URL(req.url);

  // 🔒 ممیزی امنیتی F5 — fail-secure: فقط راز رسمی یا توکن درون‌پردازه‌ای بوت
  if (!isAuthorizedCronRequest(req, url)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const force = url.searchParams.get("force") === "1";
    if (force) {
      const result = await runBackup("manual");
      return Response.json({ ...result, forced: true });
    }
    const out = await runBackupIfDue("sweep");
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return Response.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 }
    );
  }
}
