import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { avalaiClient, VISION_MODEL } from "@/lib/fitness/ai";

/**
 * POST /api/coach/analyze-body-progress
 * تحلیل هوشمند پیشرفت بدن از روی عکس‌های پیشرفت کاربر.
 * نیازمند پلن پیشرفته (Advanced) یا حرفه‌ای (Ultimate).
 * حداقل ۲ عکس نیاز است.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const planName = user.planName as string | null;
    if (planName !== "advanced" && planName !== "ultimate") {
      return NextResponse.json(
        { error: "تحلیل پیشرفت بدن نیازمند پلن پیشرفته یا حرفه‌ای است." },
        { status: 403 }
      );
    }

    const { photos } = await req.json();
    if (!Array.isArray(photos) || photos.length < 2) {
      return NextResponse.json(
        { error: "برای تحلیل پیشرفت حداقل ۲ عکس نیاز است." },
        { status: 400 }
      );
    }

    // بررسی اینکه عکس‌ها متعلق به کاربر هستند
    const userPhotos = await db.progressPhoto.findMany({
      where: { userId: user.id },
      select: { imageUrl: true, type: true, takenAt: true },
    });
    const userPhotoUrls = new Set(userPhotos.map((p) => p.imageUrl));
    const validPhotos = photos.filter((p: any) => userPhotoUrls.has(p.imageUrl));
    if (validPhotos.length < 2) {
      return NextResponse.json(
        { error: "عکس‌های معتبر کافی نیست." },
        { status: 400 }
      );
    }

    // مرتب‌سازی بر اساس تاریخ (قدیمی به جدید)
    validPhotos.sort((a: any, b: any) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());

    const photoDescriptions = validPhotos.map((p: any, i: number) => {
      const date = new Date(p.takenAt).toLocaleDateString("fa-IR");
      const typeLabel = p.type === "front" ? "جلو" : p.type === "side" ? "بغل" : "پشت";
      return `عکس ${i + 1} (${typeLabel}) - تاریخ: ${date}`;
    }).join("\n");

    // ارسال عکس‌ها به VLM (حداکثر ۶ عکس)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    const imagesToSend = validPhotos.slice(0, 6).map((p: any) => ({
      type: "image_url" as const,
      image_url: { url: p.imageUrl.startsWith("http") ? p.imageUrl : `${siteUrl}${p.imageUrl}` },
    }));

    const prompt = `این عکس‌های پیشرفت بدن یک ورزشکار را تحلیل کن. عکس‌ها به ترتیب زمانی از قدیمی به جدید هستند:

${photoDescriptions}

لطفاً یک تحلیل کامل از پیشرفت بدن این ورزشکار ارائه بده:
۱. تغییرات ظاهری بین عکس‌ها (عضلات، چربی بدن، فرم بدن)
۲. نقاط قوت و پیشرفت‌های مشاهده‌شده
۳. نواحی که نیاز به بهبود دارند
۴. توصیه‌های تمرینی برای پیشرفت بیشتر

فقط به زبان فارسی و با لحن حرفه‌ای و انگیزشی پاسخ بده. حداکثر ۳۰۰ کلمه.`;

    const completion = await avalaiClient.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content: "تو یک مربی حرفه‌ای بدنسازی و متخصص تحلیل پیشرفت بدن هستی. عکس‌های پیشرفت ورزشکار را مقایسه کن و تحلیل دقیق ارائه بده.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...imagesToSend,
          ],
        },
      ],
    } as any);

    const analysis = completion.choices[0]?.message?.content || "تحلیلی دریافت نشد.";

    // ذخیره تحلیل
    await db.analysisResult.create({
      data: {
        userId: user.id,
        type: "body_progress",
        result: JSON.stringify({ analysis, photoCount: validPhotos.length, analyzedAt: new Date().toISOString() }),
        mediaUrl: null,
      },
    });

    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("[analyze-body-progress] error:", e);
    return apiError(e);
  }
}
