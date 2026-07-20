import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * POST /api/pwa/installed
 * ثبت نصب برنامه PWA روی دستگاه کاربر.
 * این endpoint باید از frontend هنگام appinstalled event صدا زده شود.
 * پس از این، نوتیف‌های نصب اپ به این کاربر ارسال نمی‌شود.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    // فقط اگر قبلاً ثبت نشده بود، ثبت کن
    if (!user.pwaInstalledAt) {
      await db.user.update({
        where: { id: user.id },
        data: { pwaInstalledAt: new Date() },
      });
    }

    return NextResponse.json({ ok: true, installed: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/pwa/installed
 * بررسی اینکه آیا کاربر برنامه را نصب کرده یا نه.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json({ installed: !!user.pwaInstalledAt });
  } catch (e) {
    return apiError(e);
  }
}
