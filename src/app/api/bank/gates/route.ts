import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  GLOBAL_MUSCLEWIKI_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  globalMuscleWikiEnabledFromValue,
} from "@/lib/fitness/exercise-video";

/**
 * ─── v190 — کلیدهای سراسری نمایش ویدیوی بانک/چالش ───
 *
 * پاسخ سبک و کش‌شدنی برای مصرف‌کننده‌هایی که فقط گیت‌ها را می‌خواهند
 * (مثلاً جلسهٔ چالش: خاموشی Muscle Wiki → انیمیشن دوفریمی).
 *
 * GET /api/bank/gates → { youtubeEnabled, muscleWikiEnabled }
 * قانون: پیش‌فرض/نامشخص = روشن (هم‌جهت با global*EnabledFromValue).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  let youtubeEnabled = true;
  let muscleWikiEnabled = true;
  try {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [GLOBAL_YOUTUBE_SETTING_KEY, GLOBAL_MUSCLEWIKI_SETTING_KEY] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    youtubeEnabled = globalYoutubeEnabledFromValue(map.get(GLOBAL_YOUTUBE_SETTING_KEY));
    muscleWikiEnabled = globalMuscleWikiEnabledFromValue(map.get(GLOBAL_MUSCLEWIKI_SETTING_KEY));
  } catch {
    // خطای دیتابیس → پیش‌فرض روشن (رفتار محافظه‌کارانهٔ همیشه‌هم‌ساز)
  }
  return NextResponse.json(
    { youtubeEnabled, muscleWikiEnabled },
    { headers: { "Cache-Control": "no-store" } }
  );
}
