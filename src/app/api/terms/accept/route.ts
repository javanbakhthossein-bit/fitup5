import { db } from "@/lib/db";
import { apiError, requireAuth } from "@/lib/fitness/auth";

/**
 * POST /api/terms/accept — v32
 *
 * پذیرش نسخهٔ فعلی قوانین «درجا» و بدون لاگ‌اوت (درخواست مالک).
 * قبلاً قوانین جدید سشن کاربر را پاک می‌کرد و کاربر مجبور به ورود مجدد با
 * OTP می‌شد؛ حالا مودال پذیرش روی پنل باز می‌شود و با همین endpoint سشن
 * دست‌نخورده می‌ماند و فقط acceptedTermsVersion به‌روز می‌شود.
 *
 * نکته slug (تسک 32-A): از v32 هر سند حقوقی اسلاگ مستقل دارد و در هر لحظه
 * دو ردیف «فعال» (terms + privacy) وجود دارد؛ به همین دلیل نسخهٔ هدف صراحتاً
 * از بین ردیف‌های فعالِ slug="terms" خوانده می‌شود — helper getCurrentTermsVersion
 * در auth.ts فیلتر slug ندارد و ممکن است ردیف privacy را برگرداند.
 */
export async function POST() {
  try {
    const user = await requireAuth();
    const activeTerms = await db.termsVersion.findFirst({
      where: { isActive: true, slug: "terms" },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const currentVersion = activeTerms?.version ?? 0;
    if (currentVersion <= 0) {
      return Response.json({ ok: true, version: 0, termsUpdateRequired: false });
    }
    await db.user.update({
      where: { id: user.id },
      data: { acceptedTermsVersion: currentVersion },
    });
    return Response.json({ ok: true, version: currentVersion, termsUpdateRequired: false });
  } catch (e) {
    return apiError(e);
  }
}
