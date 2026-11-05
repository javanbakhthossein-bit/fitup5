import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { absolutePathForUploadUrl } from "@/lib/fitness/private-media";
import { unlink } from "fs/promises";

/**
 * ─── v138 — جزئیات یک جلسهٔ پیاده‌روی/دویدن ───
 *
 * GET    /api/activity/sessions/[id] — مسیر کامل + همهٔ آمار (فقط مالک)
 * PATCH  /api/activity/sessions/[id] — v241: ثبت اسنپ‌شات «عکس زیبای مسیر»
 *        (بک‌فیل جلسات قدیمی: کلاینت پوستر را رندر و آپلود می‌کند، URL همین‌جا ماندگار می‌شود)
 * DELETE /api/activity/sessions/[id] — حذف جلسه (و عکس پیوست)
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const row = await db.activitySession.findFirst({
      where: { id, userId: user.id },
    });
    if (!row) {
      return Response.json({ error: "جلسه یافت نشد." }, { status: 404 });
    }

    let points: number[][] = [];
    try {
      const parsed = JSON.parse(row.routeJson);
      if (Array.isArray(parsed)) {
        // v138-fix — نرمال‌سازی: هر نقطه حتماً آرایهٔ [lat, lng, t, acc] باشد
        // (داده‌های قدیمی ممکن است به‌صورت آبجکت {lat,lng,…} ذخیره شده باشند)
        points = parsed
          .map((p: number[] | { lat: number; lng: number; t?: number; acc?: number }) =>
            Array.isArray(p)
              ? [Number(p[0]), Number(p[1]), Number(p[2]) || 0, Number(p[3]) || 0]
              : [Number(p.lat), Number(p.lng), Number(p.t) || 0, Number(p.acc) || 0]
          )
          .filter(
            (p: number[]) =>
              Number.isFinite(p[0]) &&
              Number.isFinite(p[1]) &&
              Math.abs(p[0]) <= 90 &&
              Math.abs(p[1]) <= 180
          );
      }
    } catch {
      // مسیر خراب → خالی
    }

    return Response.json({
      ...row,
      routeJson: undefined,
      points,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      routeSnapshotUrl?: string;
    } | null;
    const url = String(body?.routeSnapshotUrl || "");
    // فقط URL امنِ همان دستهٔ activityِ همین کاربر (مثل POST)
    if (!url.startsWith(`/uploads/activity/activity-${user.id}-`)) {
      return Response.json({ error: "URL اسنپ‌شات نامعتبر است." }, { status: 400 });
    }
    const row = await db.activitySession.findFirst({
      where: { id, userId: user.id },
      select: { id: true, pointsCount: true, routeSnapshotUrl: true },
    });
    if (!row) {
      return Response.json({ error: "جلسه یافت نشد." }, { status: 404 });
    }
    // جلسهٔ بدون مسیر GPS اسنپ‌شات معنایی ندارد
    if (row.pointsCount < 2) {
      return Response.json({ error: "این جلسه مسیر GPS ندارد." }, { status: 400 });
    }
    // idempotent — اگر قبلاً ثبت شده همان بماند (فایل تکراری ساخته نشود)
    if (row.routeSnapshotUrl) {
      return Response.json({ ok: true, routeSnapshotUrl: row.routeSnapshotUrl, alreadySet: true });
    }
    await db.activitySession.update({
      where: { id: row.id },
      data: { routeSnapshotUrl: url },
    });
    return Response.json({ ok: true, routeSnapshotUrl: url });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const row = await db.activitySession.findFirst({
      where: { id, userId: user.id },
      select: { id: true, photoUrl: true, routeSnapshotUrl: true },
    });
    if (!row) {
      return Response.json({ error: "جلسه یافت نشد." }, { status: 404 });
    }

    await db.activitySession.delete({ where: { id: row.id } });

    // پاک‌سازی عکس پیوست + اسنپ‌شات مسیر (best-effort)
    for (const u of [row.photoUrl, row.routeSnapshotUrl]) {
      if (u && u.startsWith("/uploads/")) {
        try {
          await unlink(absolutePathForUploadUrl(u));
        } catch {
          // فایل شاید حذف شده باشد — بی‌اهمیت
        }
      }
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
