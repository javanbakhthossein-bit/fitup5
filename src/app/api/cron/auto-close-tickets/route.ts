import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { createNotification } from "@/lib/fitness/notifications";

/**
 * GET /api/cron/auto-close-tickets?secret=CRON_SECRET   (v52)
 *
 * بستن خودکار تیکت‌ها — درخواست مالک:
 * «تیکت‌ها باید به‌صورت اتومات بعد از یک هفته از آخرین پیامک ما به کاربر و
 *  عدم پاسخ کاربر بسته بشه. یعنی وقتی ما پاسخ یک کاربر رو می‌دیم از زمان
 *  پاسخ ما یک هفته محاسبه کن؛ اگر تا این یک هفته کاربر پاسخ نداد تیکت بسته بشه.»
 *
 * منطق: تیکت‌هایی که وضعیتشان «answered» است و repliedAt آن‌ها بیش از ۷ روز
 * قبل است بسته می‌شوند (status → closed). چون هر پاسخ کاربر تیکت را دوباره
 * به «open» برمی‌گرداند (api/support/tickets/[id])، هر تیکت answered با
 * repliedAt کهنه تضمینی «بدون واکنش کاربر بعد از پاسخ ما» است — یعنی
 * محمولهٔ ما: پاسخ ادمین داده شده + یک هفته سکوت کاربر = بستن خودکار.
 *
 * پس از بستن، اعلان زیبا به کاربر ارسال می‌شود (هم‌الگوی بستن دستی ادمین).
 * اجرا idempotent است — تیکت بسته‌شده دیگر در فیلتر answered نمی‌آید.
 *
 * زمان‌بندی: instrumentation (بوت + هر ۶ ساعت، TICKET_AUTOCLOSE_INTERVAL_MIN
 * برای تغییر / 0 برای خاموشی) یا crontab خارجی:
 *   curl -s "https://fittup.ir/api/cron/auto-close-tickets?secret=$CRON_SECRET"
 *
 * محافظت: CRON_SECRET یا اتصال loopback خود سرور (هم‌الگوی recover-payments).
 */

const BATCH_LIMIT = 100;
const AUTO_CLOSE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // یک هفته از آخرین پاسخ ادمین

export async function GET(req: NextRequest) {
  const rl = rateLimit(`cron-autoclose-tickets:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  // ─── اجازهٔ فراخوانی محلی (loopback بدون هدر پروکسی) — هم‌الگوی recover-payments ───
  const _h = req.headers;
  const _hasProxyHeaders =
    Boolean(_h.get("x-forwarded-for")) ||
    Boolean(_h.get("cf-connecting-ip")) ||
    Boolean(_h.get("x-real-ip"));
  const _clientIp = getClientIp(req);
  const _isLoopbackIp =
    _clientIp === "127.0.0.1" ||
    _clientIp === "::1" ||
    _clientIp === "::ffff:127.0.0.1" ||
    _clientIp.startsWith("::ffff:127.");
  const isLocal = !_hasProxyHeaders || _isLoopbackIp;

  if ((!expected || secret !== expected) && !isLocal) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_MS);

  try {
    const stale = await db.supportTicket.findMany({
      where: {
        status: "answered",
        repliedAt: { lt: cutoff },
      },
      select: { id: true, userId: true, subject: true, repliedAt: true },
      orderBy: { repliedAt: "asc" },
      take: BATCH_LIMIT,
    });

    let closed = 0;
    const closedTickets: Array<{ id: string; subject: string }> = [];

    for (const ticket of stale) {
      try {
        // updateMany شرطی → اگر همزمان کاربر همان لحظه پاسخ داده باشد
        // (status دوباره open شده)، بسته نمی‌شود.
        const res = await db.supportTicket.updateMany({
          where: { id: ticket.id, status: "answered" },
          data: { status: "closed" },
        });
        if (res.count !== 1) continue;

        closed++;
        closedTickets.push({ id: ticket.id, subject: ticket.subject });

        // اعلان به کاربر — هم‌الگوی بستن دستی ادمین (TicketsTab PATCH)
        try {
          await createNotification(
            ticket.userId,
            "system",
            "تیکت شما بسته شد",
            "چون بیش از یک هفته از آخرین پاسخ پشتیبانی گذشته بود و پاسخی ثبت نشده بود، تیکت شما به‌صورت خودکار بسته شد. اگر هنوز مشکل دارید، با ارسال پاسخ در همان تیکت دوباره باز می‌شود. 💪",
            "?tab=support"
          );
        } catch {}
      } catch (e) {
        console.error("[cron/auto-close-tickets] close error:", ticket.id, e);
      }
    }

    if (closed > 0) {
      console.log(
        `[cron/auto-close-tickets] ✅ ${closed} تیکت بی‌پاسخ (۷ روز از پاسخ ادمین) بسته شد`
      );
    }

    return Response.json({
      ok: true,
      scanned: stale.length,
      closed,
      tickets: closedTickets,
      cutoff: cutoff.toISOString(),
      ranAt: now.toISOString(),
    });
  } catch (e) {
    console.error("[cron/auto-close-tickets] fatal:", e);
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
