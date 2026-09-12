import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, requireAdmin } from "@/lib/fitness/auth";

// ─── اسلاگ‌های مجاز سند حقوقی ───
// «terms»: شرایط و قوانین — «privacy»: سیاست حفظ حریم خصوصی (سند مستقل v32)
// شماره نسخه هر اسلاگ مستقل است (max نسخهٔ همان اسلاگ + ۱)
const DEFAULT_TITLES = {
  terms: "شرایط و قوانین فیتاپ",
  privacy: "حریم خصوصی فیتاپ",
} as const;

type TermsSlug = keyof typeof DEFAULT_TITLES;

// هر مقدار نامعتبر → «terms» (پیش‌فرض) — با رفتار GET /api/terms?slug= یکسان
function parseSlug(raw: unknown): TermsSlug {
  return raw === "privacy" ? "privacy" : "terms";
}

// GET: list all TermsVersions (admin only)
// ⚠️ نکته UI: تب «قوانین» پنل مدیر (admin-overlay.tsx — تسک 32-C) انتظار دارد
// آیتم‌های این لیست فیلد `slug` داشته باشند تا نسخه‌ها را بر اساس سند
// (قوانین/حریم خصوصی) فیلتر و نمایش دهد. فیلد slug را حذف نکنید.
export async function GET() {
  try {
    await requireAdmin();
    const versions = await db.termsVersion.findMany({
      // گروه‌بندی طبیعی بر اساس سند؛ داخل هر اسلاگ نسخهٔ جدیدتر اول
      orderBy: [{ slug: "asc" }, { version: "desc" }],
    });
    return Response.json({
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        slug: v.slug,
        title: v.title,
        content: v.content,
        isActive: v.isActive,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// POST: create a new TermsVersion (admin only)
// - slug اختیاری: "terms" (پیش‌فرض) | "privacy"
// - شماره نسخه برای هر اسلاگ جداگانه افزایش می‌یابد (max همان اسلاگ + ۱)
// - اگر نسخه جدید فعال باشد، فقط نسخه‌های فعالِ «همان اسلاگ» غیرفعال می‌شوند
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const slug = parseSlug(body.slug);
    const title = String(body.title || DEFAULT_TITLES[slug]).trim();
    const content = String(body.content || "").trim();
    const isActive = body.isActive !== false; // default true

    if (!title || title.length < 3) {
      return Response.json(
        { error: "عنوان باید حداقل ۳ کاراکتر باشد." },
        { status: 400 }
      );
    }
    if (!content || content.length < 10) {
      return Response.json(
        { error: "محتوای قوانین را کامل کنید." },
        { status: 400 }
      );
    }

    // شماره نسخه بعدی — فقط درون همان اسلاگ (نسخه‌های privacy و terms مستقل‌اند)
    const latest = await db.termsVersion.findFirst({
      where: { slug },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const newVersion = (latest?.version ?? 0) + 1;

    // غیرفعال‌کردن نسخه‌های فعال قبلی — فقط در همان اسلاگ تا سند دیگر دست‌نخورده بماند
    if (isActive) {
      await db.termsVersion.updateMany({
        where: { isActive: true, slug },
        data: { isActive: false },
      });
    }

    const created = await db.termsVersion.create({
      data: {
        version: newVersion,
        slug,
        title,
        content,
        isActive,
      },
    });

    return Response.json({
      terms: {
        id: created.id,
        version: created.version,
        slug: created.slug,
        title: created.title,
        content: created.content,
        isActive: created.isActive,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
