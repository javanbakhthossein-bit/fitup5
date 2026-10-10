import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  GLOBAL_MUSCLEWIKI_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  globalMuscleWikiEnabledFromValue,
  isYoutubeDisplayAllowed,
  isMuscleWikiDisplayAllowed,
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

  // v113 — کلید سراسری یوتیوب (پنل ادمین) — v190: + کلید سراسری Muscle Wiki
  let globalYoutube = true;
  let globalMuscleWiki = true;
  try {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [GLOBAL_YOUTUBE_SETTING_KEY, GLOBAL_MUSCLEWIKI_SETTING_KEY] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    globalYoutube = globalYoutubeEnabledFromValue(map.get(GLOBAL_YOUTUBE_SETTING_KEY));
    globalMuscleWiki = globalMuscleWikiEnabledFromValue(map.get(GLOBAL_MUSCLEWIKI_SETTING_KEY));
  } catch {
    globalYoutube = true;
    globalMuscleWiki = true;
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
        // v189/v190 — Muscle Wiki + کلید تک‌حرکتی آن
        mwVideoUrl: true,
        mwVideoUrlFemale: true,
        mwEnabled: true,
      },
    });
    // v113 — قانون ترکیبی یوتیوب روی حرکات مشابه — v190: + قانون Muscle Wiki
    related = rows
      .map((r) => {
        let row: any = isYoutubeDisplayAllowed(r, globalYoutube) ? r : { ...r, youtubeUrl: "" };
        if (!isMuscleWikiDisplayAllowed(row, globalMuscleWiki)) {
          row = { ...row, mwVideoUrl: "", mwVideoUrlFemale: "" };
        }
        return row;
      });
  } catch {
    // ignore related fetch errors
  }

  // v113 — قانون ترکیبی یوتیوب روی خود حرکت — v190: + قانون Muscle Wiki
  let sanitizedExercise: any = isYoutubeDisplayAllowed(exercise, globalYoutube)
    ? exercise
    : { ...exercise, youtubeUrl: "" };
  if (!isMuscleWikiDisplayAllowed(sanitizedExercise, globalMuscleWiki)) {
    sanitizedExercise = { ...sanitizedExercise, mwVideoUrl: "", mwVideoUrlFemale: "" };
  }

  return NextResponse.json({
    exercise: sanitizedExercise,
    related,
    globalYoutubeEnabled: globalYoutube,
    globalMuscleWikiEnabled: globalMuscleWiki,
  });
}
