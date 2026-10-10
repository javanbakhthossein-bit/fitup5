import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { absolutePathForUploadUrl } from "@/lib/fitness/private-media";
import { unlink } from "fs/promises";

/**
 * ─── v138 — جزئیات یک جلسهٔ پیاده‌روی/دویدن ───
 *
 * GET    /api/activity/sessions/[id] — مسیر کامل + همهٔ آمار (فقط مالک)
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const row = await db.activitySession.findFirst({
      where: { id, userId: user.id },
      select: { id: true, photoUrl: true },
    });
    if (!row) {
      return Response.json({ error: "جلسه یافت نشد." }, { status: 404 });
    }

    await db.activitySession.delete({ where: { id: row.id } });

    // پاک‌سازی عکس پیوست (best-effort)
    if (row.photoUrl && row.photoUrl.startsWith("/uploads/")) {
      try {
        await unlink(absolutePathForUploadUrl(row.photoUrl));
      } catch {
        // فایل شاید حذف شده باشد — بی‌اهمیت
      }
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
