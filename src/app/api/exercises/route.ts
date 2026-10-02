import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { exerciseMatchesSearch } from "@/lib/fitness/exercise-search";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  isYoutubeDisplayAllowed,
} from "@/lib/fitness/exercise-video";

// Public exercises list (no auth)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const muscle = searchParams.get("muscle") || "";
  const equipment = searchParams.get("equipment") || "";
  const category = searchParams.get("category") || "";
  // v94 — دریافت با لیست id (برای نمایش حرکات اختصاصی هر رشته در صفحهٔ رشته)
  const idsParam = searchParams.get("ids") || "";
  // v115 — دریافت با لیست «نام» حرکات (ارجاع رشته‌ها به نام تغییر کرد تا با
  // پاکسازی بانک حرکات سازگار بماند؛ نام‌ها بین سندباکس و سرور یکسان‌اند)
  const namesParam = searchParams.get("names") || "";

  const where: any = { isActive: true }; // v135 — غیرفعال‌ها از لیست عمومی حذف
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (ids.length) where.id = { in: ids };
  }
  if (namesParam && !idsParam) {
    const names = namesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (names.length) where.name = { in: names };
  }
  if (search) {
    // v114 — جستجوی مترادف‌محور (درخواست مالک): «پرس زیر سینه» ← «پرس سینه با شیب
    // منفی»، «بایسپس» ← جلو بازو، «اینکلاین» ← بالاسینه، «اسکات» ← اسکوات و…
    // فیلتر در JS با همان موتور بانک عمومی/ادمین انجام می‌شود — جدول کوچک است
    // (≤۵۰۰ ردیف) و تطبیق عبارتی/مترادفی در SQLite contains ممکن نیست.
  }
  if (muscle && muscle !== "all") where.muscle = muscle;
  if (category && category !== "all") where.category = category;
  if (equipment && equipment !== "all") {
    where.equipment = { contains: equipment };
  }

  // v113 — کلید سراسری یوتیوب (پنل ادمین): وقتی خاموش است، youtubeUrl در پاسخ
  // عمومی «خنثی» می‌شود تا هر مصرف‌کننده‌ای (اورلی پنل، programs-view، ویجت‌ها)
  // خودکار بدون یوتیوب رندر کند — بدون تغییر در کد مصرف‌کننده.
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

  const rows = await db.exerciseLibrary.findMany({
    where,
    orderBy: { name: "asc" },
    take: 500,
  });

  // v114 — اعمال موتور جستجوی مترادف‌محور روی نتیجه (فیلتر سمت JS)
  // v116 — فالبک نام‌های بلند برنامه‌ها: اگر کوئری «… با …» صفر نتیجه داد،
  // پسوند «با X» (مثلاً «با هالتر») حذف و دوباره جستجو می‌شود — این‌طوری
  // هر تمرینی که در برنامهٔ کاربر آمده ویدیو/توضیحاتش پیدا می‌شود.
  let filtered = search ? rows.filter((ex) => exerciseMatchesSearch(ex, search)) : rows;
  if (search && filtered.length === 0) {
    const stripped = search.replace(/\s+با\s+\S+\s*$/u, "").trim();
    if (stripped && stripped !== search) {
      const retry = rows.filter((ex) => exerciseMatchesSearch(ex, stripped));
      if (retry.length > 0) filtered = retry;
    }
  }
  const exercises = filtered;

  // v113 — اعمال قانون ترکیبی یوتیوب (سراسری ∧ تک‌حرکتی) روی پاسخ عمومی
  const sanitized = exercises.map((ex) =>
    isYoutubeDisplayAllowed(ex, globalYoutube)
      ? ex
      : { ...ex, youtubeUrl: "" }
  );

  return Response.json({ exercises: sanitized, globalYoutubeEnabled: globalYoutube });
}
