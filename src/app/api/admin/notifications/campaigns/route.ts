import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import {
  CAMPAIGN_TYPES,
  parseSegment,
  segmentLabel,
  countSegment,
  dispatchCampaign,
  type CampaignSegment,
} from "@/lib/fitness/notification-campaigns";

/**
 * ─── v178 — مرکز اعلان‌های مدیر (کمپین‌ها) ───
 *
 * GET  /api/admin/notifications/campaigns           ← لیست ۱۰۰ کمپین آخر
 * POST /api/admin/notifications/campaigns           ← ساخت کمپین (فوری/زمان‌بندی‌شده)
 *
 * Body (POST):
 *   title, body الزامی؛ type اختیاری (پیش‌فرض system)؛ link اختیاری؛
 *   segment: JSON هدف‌گیری (kind: all/active_plan/expired_plan/no_plan/plan/
 *            source/app/registered/purchased/never_purchased/expiring/users)؛
 *   mode: "now" (ارسال فوری) | "schedule" (زمان‌بندی) | "draft" (پیش‌نویس)
 *   scheduledAt: ISO — فقط برای mode=schedule
 */

const MAX_TITLE = 200;
const MAX_BODY = 2000;

export async function GET() {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");

    const campaigns = await db.notificationCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return Response.json({
      ok: true,
      campaigns: campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        type: c.type,
        link: c.link,
        segment: c.segment,
        segmentLabel: segmentLabel(c.segment),
        status: c.status,
        scheduledAt: c.scheduledAt?.toISOString() || null,
        sentAt: c.sentAt?.toISOString() || null,
        totalTargets: c.totalTargets,
        sentCount: c.sentCount,
        pushCount: c.pushCount,
        error: c.error,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManageUsers");

    const body = await req.json().catch(() => ({}));
    const title = (body?.title ?? "").toString().trim();
    const notifBody = (body?.body ?? "").toString().trim();
    const type = (body?.type ?? "system").toString().trim();
    const link = body?.link ? String(body.link).trim() : null;
    const mode = (body?.mode ?? "now").toString().trim(); // now | schedule | draft

    if (!title) return Response.json({ error: "عنوان اعلان الزامی است." }, { status: 400 });
    if (!notifBody) return Response.json({ error: "متن اعلان الزامی است." }, { status: 400 });
    if (!CAMPAIGN_TYPES.includes(type as any)) {
      return Response.json({ error: "نوع اعلان نامعتبر است." }, { status: 400 });
    }

    const seg = parseSegment(body?.segment);
    if (!seg) {
      return Response.json(
        { error: "گروه گیرندگان انتخاب نشده یا نامعتبر است." },
        { status: 400 }
      );
    }
    const segmentJson = JSON.stringify(seg as CampaignSegment);

    // اعتبارسنجی زمان‌بندی
    let scheduledAt: Date | null = null;
    if (mode === "schedule") {
      scheduledAt = body?.scheduledAt ? new Date(String(body.scheduledAt)) : null;
      if (!scheduledAt || isNaN(scheduledAt.getTime())) {
        return Response.json({ error: "زمان ارسال نامعتبر است." }, { status: 400 });
      }
      if (scheduledAt.getTime() < Date.now() - 60_000) {
        return Response.json(
          { error: "زمان ارسال باید در آینده باشد." },
          { status: 400 }
        );
      }
    }

    const campaign = await db.notificationCampaign.create({
      data: {
        title: title.slice(0, MAX_TITLE),
        body: notifBody.slice(0, MAX_BODY),
        type,
        link: link ? link.slice(0, 500) : null,
        segment: segmentJson,
        status: mode === "schedule" ? "scheduled" : "draft",
        scheduledAt,
        createdBy: admin?.id ?? null,
      },
    });

    // ارسال فوری
    if (mode === "now") {
      const result = await dispatchCampaign(campaign.id);
      if (!result.ok) {
        return Response.json(
          { error: result.error || "خطا در ارسال کمپین.", campaignId: campaign.id },
          { status: 500 }
        );
      }
      return Response.json({ campaignId: campaign.id, ...result, ok: true });
    }

    // زمان‌بندی/پیش‌نویس — تخمین گیرندگان را برگردان
    const estimated = await countSegment(seg);
    return Response.json({
      ok: true,
      campaignId: campaign.id,
      status: campaign.status,
      estimated,
    });
  } catch (e) {
    return apiError(e);
  }
}
