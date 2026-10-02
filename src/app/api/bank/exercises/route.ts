import { NextResponse } from "next/server";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { db } from "@/lib/db";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  isYoutubeDisplayAllowed,
} from "@/lib/fitness/exercise-video";

/**
 * ─── v139 — بانک حرکات داخل پنل (دیرکتیو مالک) ───
 *
 * لیست فشردهٔ حرکات برای تب ایزولهٔ «بانک حرکات» در پنل ورزشکار.
 * طراحی ایزوله = دادهٔ سبک + کش حافظهٔ سرور (۶۰ ثانیه) + کش سشن کلاینت؛
 * ورود مجدد به تب بدون هیچ درخواست شبکه‌ای بالا می‌آید (سرعت لحظه‌ای).
 *
 * فقط requireAuth — رایگان برای همهٔ کاربران لاگین (با/بدون پلن)؛
 * همان دادهٔ صفحهٔ عمومی /exercises ولی payload کم‌حجم برای پنل.
 */

export const dynamic = "force-dynamic";

/** کش حافظهٔ سرور — TTL ۶۰ ثانیه (پنل عمومی است و تغییر ناگهانی ندارد) */
let CACHE: { at: number; data: BankExerciseRow[] } | null = null;
const TTL_MS = 60_000;

export interface BankExerciseRow {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  hasVideo: boolean;
}

export async function GET() {
  try {
    await requireAuth();

    if (CACHE && Date.now() - CACHE.at < TTL_MS) {
      return NextResponse.json(
        { exercises: CACHE.data },
        { headers: { "Cache-Control": "private, max-age=30" } }
      );
    }

    const [rows, setting] = await Promise.all([
      db.exerciseLibrary.findMany({
        where: { isActive: true },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          muscle: true,
          category: true,
          equipment: true,
          difficulty: true,
          youtubeUrl: true,
          videoUrl: true,
          youtubeEnabled: true,
        },
      }),
      db.siteSetting
        .findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } })
        .catch(() => null),
    ]);
    const globalYoutube = globalYoutubeEnabledFromValue(setting?.value);

    const data: BankExerciseRow[] = rows.map((r) => {
      const yt = isYoutubeDisplayAllowed(r, globalYoutube) ? r.youtubeUrl : "";
      return {
        id: r.id,
        name: r.name,
        muscle: r.muscle,
        category: r.category,
        equipment: r.equipment,
        difficulty: r.difficulty,
        hasVideo: Boolean((r.videoUrl && r.videoUrl.trim() !== "") || yt.trim() !== ""),
      };
    });

    CACHE = { at: Date.now(), data };

    return NextResponse.json(
      { exercises: data },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (e) {
    return apiError(e);
  }
}
