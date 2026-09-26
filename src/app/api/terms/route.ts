import { db } from "@/lib/db";
import { apiError } from "@/lib/fitness/auth";

/**
 * Public endpoint — نسخهٔ فعال سند حقوقی را برمی‌گرداند.
 *
 * ?slug=terms   (پیش‌فرض) شرایط و قوانین
 * ?slug=privacy سند مستقل «حفظ حریم خصوصی» (v32)
 *
 * هر slug شماره نسخهٔ مستقل خودش را دارد؛ نسخهٔ فعالِ هرکدام جداگانه
 * از پنل مدیر (تب قوانین) مدیریت می‌شود.
 */
export async function GET(req: Request) {
  try {
    const slug = new URL(req.url).searchParams.get("slug") === "privacy" ? "privacy" : "terms";
    const terms = await db.termsVersion.findFirst({
      where: { isActive: true, slug },
      orderBy: { version: "desc" },
    });
    if (!terms) {
      return Response.json(
        {
          error:
            slug === "privacy"
              ? "سند حریم خصوصی هنوز منتشر نشده است."
              : "نسخه فعلی قوانین یافت نشد.",
          terms: null,
        },
        { status: 404 }
      );
    }
    return Response.json({
      terms: {
        id: terms.id,
        version: terms.version,
        slug: terms.slug,
        title: terms.title,
        content: terms.content,
        isActive: terms.isActive,
        createdAt: terms.createdAt,
        updatedAt: terms.updatedAt,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
