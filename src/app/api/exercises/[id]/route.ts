import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  isYoutubeDisplayAllowed,
} from "@/lib/fitness/exercise-video";

// Public single-exercise endpoint (no auth)
// GET /api/exercises/[id] → returns full exercise record + related (same muscle, max 4)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const exercise = await db.exerciseLibrary.findUnique({
    where: { id },
  });

  // v135 — ناموجود یا غیرفعال = ۴۰۴ (صفحهٔ عمومی مسیر لطیف خودش را دارد)
  if (!exercise || !exercise.isActive) {
    return NextResponse.json(
      { error: "حرکت موردنظر یافت نشد" },
      { status: 404 }
    );
  }

  // v113 — کلید سراسری یوتیوب (پنل ادمین)
  let globalYoutube = true;
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: GLOBAL_YOUTUBE_SETTING_KEY },
      select: { value: true },
    });
    globalYoutube = globalYoutubeEnabledFromValue(row?.value);
  } catch {
    globalYoutube = true;
  }

  // Related exercises — same muscle group, excluding current, max 4
  let related: any[] = [];
  try {
    const rows = await db.exerciseLibrary.findMany({
      where: {
        muscle: exercise.muscle,
        id: { not: exercise.id },
        isActive: true, // v135 — فقط حرکات فعال
      },
      orderBy: { name: "asc" },
      take: 4,
      select: {
        id: true,
        name: true,
        muscle: true,
        category: true,
        equipment: true,
        difficulty: true,
        youtubeUrl: true,
        // v112 — ویدیوی اختصاصی (اولویت نمایش بالاتر از یوتیوب) + فریم شاخص
        videoUrl: true,
        videoPosterUrl: true,
        // v113 — کلید تک‌حرکتی یوتیوب
        youtubeEnabled: true,
      },
    });
    // v113 — قانون ترکیبی یوتیوب روی حرکات مشابه
    related = rows.map((r) =>
      isYoutubeDisplayAllowed(r, globalYoutube) ? r : { ...r, youtubeUrl: "" }
    );
  } catch {
    // ignore related fetch errors
  }

  // v113 — قانون ترکیبی یوتیوب روی خود حرکت
  const sanitizedExercise = isYoutubeDisplayAllowed(exercise, globalYoutube)
    ? exercise
    : { ...exercise, youtubeUrl: "" };

  return NextResponse.json({
    exercise: sanitizedExercise,
    related,
    globalYoutubeEnabled: globalYoutube,
  });
}
