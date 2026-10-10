import { NextResponse } from "next/server";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { db } from "@/lib/db";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  GLOBAL_MUSCLEWIKI_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  globalMuscleWikiEnabledFromValue,
  isYoutubeDisplayAllowed,
  isMuscleWikiDisplayAllowed,
  sortExercisesByVideoPriority, // v191 — مرتب‌سازی اولویت ویدیو
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
let CACHE: { at: number; data: BankExerciseRow[]; yt: boolean; mw: boolean } | null = null;
const TTL_MS = 60_000;

export interface BankExerciseRow {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  hasVideo: boolean;
  /** v191 — لایهٔ ویدیو برای مرتب‌سازی: ۰=اختصاصی، ۱=ماسل‌ویکی، ۲=یوتیوب، ۳=بدون */
  videoTier: 0 | 1 | 2 | 3;
}

export async function GET() {
  try {
    await requireAuth();

    if (CACHE && Date.now() - CACHE.at < TTL_MS) {
      return NextResponse.json(
        { exercises: CACHE.data, globalYoutubeEnabled: CACHE.yt, globalMuscleWikiEnabled: CACHE.mw },
        { headers: { "Cache-Control": "private, max-age=30" } }
      );
    }

    const [rows, ytSetting, mwSetting] = await Promise.all([
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
          // v189 — Muscle Wiki (بین اختصاصی و یوتیوب)
          mwVideoUrl: true,
          mwVideoUrlFemale: true,
          // v190 — کلید تک‌حرکتی Muscle Wiki
          mwEnabled: true,
          youtubeEnabled: true,
        },
      }),
      db.siteSetting
        .findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } })
        .catch(() => null),
      db.siteSetting
        .findUnique({ where: { key: GLOBAL_MUSCLEWIKI_SETTING_KEY }, select: { value: true } })
        .catch(() => null),
    ]);
    const globalYoutube = globalYoutubeEnabledFromValue(ytSetting?.value);
    const globalMuscleWiki = globalMuscleWikiEnabledFromValue(mwSetting?.value);

    const data: BankExerciseRow[] = sortExercisesByVideoPriority(rows).map((r) => {
      const yt = (isYoutubeDisplayAllowed(r, globalYoutube) ? r.youtubeUrl : "") ?? "";
      const mwAllowed = isMuscleWikiDisplayAllowed(r, globalMuscleWiki);
      const hasCustom = (r.videoUrl ?? "").trim() !== "";
      const hasMw = mwAllowed && ((r.mwVideoUrl ?? "").trim() !== "" || (r.mwVideoUrlFemale ?? "").trim() !== "");
      return {
        id: r.id,
        name: r.name,
        muscle: r.muscle,
        category: r.category,
        equipment: r.equipment,
        difficulty: r.difficulty,
        // v189 — Muscle Wiki هم «ویدیو» است — v190: تابع کلیدهای سراسری/تک‌حرکتی
        hasVideo: Boolean(hasCustom || hasMw || yt.trim() !== ""),
        // v191 — لایهٔ ویدیو (مرتب‌سازی اولویت‌دار)
        videoTier: (hasCustom ? 0 : hasMw ? 1 : yt.trim() !== "" ? 2 : 3) as 0 | 1 | 2 | 3,
      };
    });

    CACHE = { at: Date.now(), data, yt: globalYoutube, mw: globalMuscleWiki };

    return NextResponse.json(
      { exercises: data, globalYoutubeEnabled: globalYoutube, globalMuscleWikiEnabled: globalMuscleWiki },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (e) {
    return apiError(e);
  }
}
