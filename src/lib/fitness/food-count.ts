import "server-only";
import { db } from "@/lib/db";

/**
 * ─── getFoodCount — منبع واحد «تعداد غذاهای بانک غذا» (Task 8-a) ───
 *
 * دیرکتیو مالک: «تعداد غذاها در همه‌جای سایت باید پویا باشد، حتی در متا تگ‌ها
 * و توضیحات متا». بانک غذا (~۲۲۰۰ ردیف) مدام رشد می‌کند — هیچ عدد ثابتی
 * (۱۵۸۰/۱۵۲۵/۱۰۰۰+ و…) حق نمایش در UI/متا/JSON-LD ندارد.
 *
 * مصرف‌کنندگان: generateMetadata (صفحه اصلی، /foods، /bmi، /macro، /1rm)،
 * JSON-LD لندینگ (home-jsonld.tsx)، بلوک فکت‌های سئو (seo-site-facts.ts)،
 * آمار عمومی (public-stats-server.ts مسیر مستقل خودش را دارد).
 *
 * کش درون‌حافظه‌ای ۶۰ ثانیه‌ای — count() سبک است ولی هر رندر متا نباید به DB بخورد.
 * فال‌بک ۱۵۸۰ فقط وقتی DB در دسترس نیست (مثلاً زمان build) — جایی رندر نمی‌شود
 * مگر اینکه منبع‌های دیگر هم فال‌بک باشند.
 */

export const FALLBACK_FOOD_COUNT = 1580;

const FOOD_COUNT_TTL_MS = 60_000;
let foodCountCache: { at: number; count: number } | null = null;

/** تعداد زندهٔ غذاهای FoodLibrary — هرگز throw نمی‌کند (فال‌بک امن) */
export async function getFoodCount(): Promise<number> {
  const now = Date.now();
  if (foodCountCache && now - foodCountCache.at < FOOD_COUNT_TTL_MS) {
    return foodCountCache.count;
  }
  try {
    const count = await db.foodLibrary.count();
    foodCountCache = { at: now, count: count > 0 ? count : FALLBACK_FOOD_COUNT };
  } catch {
    // DB در دسترس نیست — کش قدیمی (اگر هست) معتبر بماند، وگرنه فال‌بک
    if (!foodCountCache) foodCountCache = { at: now, count: FALLBACK_FOOD_COUNT };
  }
  return foodCountCache.count;
}

/** رقم فارسی با جداکنندهٔ هزارگان «٬» — ۲۱۸۷ → «۲٬۱۸۷» */
export function formatFaNumber(n: number): string {
  return n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** «۲٬۱۸۷» — آمادهٔ درج در متن متا/JSON-LD/عنوان */
export async function getFoodCountFa(): Promise<string> {
  return formatFaNumber(await getFoodCount());
}
