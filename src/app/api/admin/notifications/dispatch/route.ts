import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { dispatchDueCampaigns } from "@/lib/fitness/notification-campaigns";

/**
 * ─── v178 — جاروی کمپین‌های سررسیده (محرک دستی/پنلی) ───
 *
 * POST /api/admin/notifications/dispatch
 * → کمپین‌های scheduled با scheduledAt <= now را ارسال می‌کند.
 *
 * در تولید، جاروی داخلی instrumentation هر ۶۰ ثانیه همین کار را می‌کند
 * (startNotificationDispatchSweep)؛ این endpoint پوشش dev/دستی + اطمینان
 * وقتی پنل ادمین باز است (poll هر ۶۰ ثانیه) را دارد.
 */
export async function POST() {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const result = await dispatchDueCampaigns();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
