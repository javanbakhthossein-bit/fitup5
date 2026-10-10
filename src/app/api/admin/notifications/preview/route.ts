import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { parseSegment, countSegment, sampleSegmentUsers } from "@/lib/fitness/notification-campaigns";

/**
 * ─── v178 — پیش‌نمایش گیرندگان یک گروه اعلان ───
 *
 * POST /api/admin/notifications/preview
 * Body: { segment: JSON }
 * → { ok, count, sample: [{name, mobile}] }
 *
 * مدیر قبل از ارسال می‌بیند «دقیقاً چند نفر» این اعلان را می‌گیرند و
 * ۵ نمونهٔ آخر برای اطمینان.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");

    const body = await req.json().catch(() => ({}));
    const seg = parseSegment(body?.segment);
    if (!seg) {
      return Response.json({ error: "گروه گیرندگان نامعتبر است." }, { status: 400 });
    }

    const count = await countSegment(seg);
    const sample = await sampleSegmentUsers(seg, 5);

    return Response.json({
      ok: true,
      count,
      sample: sample.map((u) => ({ name: u.name || "", mobile: u.mobile })),
    });
  } catch (e) {
    return apiError(e);
  }
}
