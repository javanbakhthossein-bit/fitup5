import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { dispatchCampaign, segmentLabel } from "@/lib/fitness/notification-campaigns";

/**
 * ─── v178 — مدیریت یک کمپین اعلان ───
 *
 * POST   /api/admin/notifications/campaigns/[id]  ← { action: "send" | "cancel" }
 * DELETE /api/admin/notifications/campaigns/[id]  ← حذف کمپین
 *
 * action=send   → ارسال فوری کمپین draft (یا ادامهٔ کمپین failed)
 * action=cancel → لغو کمپین زمان‌بندی‌شده
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = (body?.action ?? "").toString().trim();

    const campaign = await db.notificationCampaign.findUnique({ where: { id } });
    if (!campaign) return Response.json({ error: "کمپین یافت نشد." }, { status: 404 });

    if (action === "send") {
      if (campaign.status === "sent") {
        return Response.json({ error: "این کمپین قبلاً ارسال شده است." }, { status: 400 });
      }
      if (campaign.status === "canceled") {
        return Response.json({ error: "این کمپین لغو شده است." }, { status: 400 });
      }
      const result = await dispatchCampaign(id);
      if (!result.ok) {
        return Response.json({ error: result.error || "خطا در ارسال." }, { status: 500 });
      }
      return Response.json({ campaignId: id, ...result, ok: true });
    }

    if (action === "cancel") {
      if (!["scheduled", "draft", "failed"].includes(campaign.status)) {
        return Response.json(
          { error: "فقط کمپین‌های زمان‌بندی‌شده/پیش‌نویس قابل لغو هستند." },
          { status: 400 }
        );
      }
      await db.notificationCampaign.update({
        where: { id },
        data: { status: "canceled" },
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "action نامعتبر است." }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const campaign = await db.notificationCampaign.findUnique({ where: { id } });
    if (!campaign) return Response.json({ error: "کمپین یافت نشد." }, { status: 404 });
    await db.notificationCampaign.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

// GET تک‌کمپین (برای completeness)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const c = await db.notificationCampaign.findUnique({ where: { id } });
    if (!c) return Response.json({ error: "کمپین یافت نشد." }, { status: 404 });
    return Response.json({
      ok: true,
      campaign: { ...c, segmentLabel: segmentLabel(c.segment) },
    });
  } catch (e) {
    return apiError(e);
  }
}
