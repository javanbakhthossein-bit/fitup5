import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { persianContainsVariants, persianFuzzyIncludes } from "@/lib/fitness/persian-search";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/foods/search?q=<query>&limit=<n>&category=<cat>
 *
 * جستجوی سریع در بانک غذاها برای autocomplete.
 * - بدون نیاز به auth (بانک غذاها عمومی است)
 * - حداقل ۲ حرف برای جستجو
 * - حداکثر ۲۰ نتیجه (پیش‌فرض)
 * - جستجوی contains (حساس به حروف فارسی نبودن توسط SQLite COLLATE انجام نمی‌شود؛
 *   برای پشتیبانی بهتر، هر دو شکل contains معمولی و normalize ساده انجام می‌شود)
 *
 * ممیزی v244 — rate limit عمومی (الگوی بقیهٔ روت‌ها): فال‌بکِ فازیِ این
 * endpoint کل بانک (~۱۰۰۰ ردیف) را می‌کشد؛ سقف ۶۰ درخواست در دقیقه per-IP
 * اسپم/دوردست‌سازی را می‌بندد بدون آنکه تایپِ autocomplete کاربر واقعی کند شود.
 *
 * v253 — فیکس رتبه‌بندی («گردو پیدا نمی‌شود»): قبلاً take:limit + orderBy name
 * یعنی ۱۷+ غذای شامل «گردو» (آش دوغ با گردو، ماست و گردو، …) الفبایی جلوتر از
 * خودِ «گردو» می‌آمدند و با limit=15 غذای ساده هرگز برنمی‌گشت. حالا تا ۲۰۰
 * کاندید fetch و بعد از fetch رتبه‌بندی می‌شوند: ① تطابق کامل نرمال‌شده
 * ② شروع‌شونده با کوئری ③ فقط شامل — تساوی‌ها الفبایی. سپس برش به limit.
 * فیلدهای واحد چندگانه (units/servingGrams/source) هم در select برگشت داده می‌شوند.
 */

/** v253 — نرمال‌سازی سبک برای رتبه‌بندی (هم‌راستا با سیدرها): حذف ZWNJ/کنترل + ی/ک عربی + lowercase */
function norm(s: string): string {
  return String(s || "")
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .toLowerCase()
    .trim();
}

/** رتبهٔ ارتباط نام با کوئریِ نرمال‌شده: ۰=دقیقاً برابر، ۱=شروع‌شونده، ۲=فقط شامل */
function relevanceRank(name: string, nq: string): number {
  const n = norm(name);
  if (n === nq) return 0;
  if (n.startsWith(nq)) return 1;
  return 2;
}

export async function GET(req: NextRequest) {
  // ─── Rate limit (per-IP) — ضد اسپم/دوردست‌سازی بانک غذا ───
  const rl = rateLimit(`foods-search:${getClientIp(req)}`, 60, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || searchParams.get("search") || "").trim();
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50
    ? Math.floor(limitRaw)
    : 20;
  const category = searchParams.get("category") || "";

  // اگر کوئری خیلی کوتاه است → هیچ نتیجه برنگردان (UX بهتر)
  if (q.length < 1) {
    return Response.json({ foods: [] });
  }

  const where: any = {
    // جستجوی مقاوم به نیم‌فاصله/فاصله و ی/ک عربی
    OR: persianContainsVariants(q, "name"),
  };
  if (category && category !== "all") where.category = category;

  // v253 — رتبه‌بندی بعد از fetch: دقیق > پیشوند > شامل، تساوی الفبایی (مثل orderBy قبلی)
  const nq = norm(q);
  const rankAndSlice = <T extends { name: string }>(list: T[]): T[] =>
    [...list]
      .sort((a, b) => {
        const ra = relevanceRank(a.name, nq);
        const rb = relevanceRank(b.name, nq);
        if (ra !== rb) return ra - rb;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      })
      .slice(0, limit);

  try {
    let foods = await db.foodLibrary.findMany({
      where,
      orderBy: { name: "asc" },
      // v253 — تا ۲۰۰ کاندید (قبلاً take:limit بود و خودِ غذا را جا می‌انداخت)
      take: 200,
      select: {
        id: true,
        name: true,
        category: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        servingSize: true,
        imageUrl: true,
        isVegan: true,
        // v253 — واحدهای چندگانه + منبع داده برای UI ثبت غذا
        units: true,
        servingGrams: true,
        source: true,
      },
    });

    // ─── Fallback جستجوی فازی ───
    // اگر شکل literal نتیجه‌ای نداد (مثلاً کاربر «آبپز» چسبیده نوشته ولی
    // نام غذا «آب‌پز» با نیم‌فاصله است)، روی کل بانک (~۱۰۰۰ رکورد) با
    // نرمال‌سازی کامل (حذف فاصله/نیم‌فاصله + یکسان‌سازی ی/ک) فیلتر می‌کنیم.
    if (foods.length === 0) {
      const all = await db.foodLibrary.findMany({
        where: category && category !== "all" ? { category } : undefined,
        orderBy: { name: "asc" },
        take: 2000,
        select: {
          id: true,
          name: true,
          category: true,
          calories: true,
          protein: true,
          carbs: true,
          fat: true,
          servingSize: true,
          imageUrl: true,
          isVegan: true,
          // v253 — همان فیلدهای واحد چندگانه در مسیر فال‌بک
          units: true,
          servingGrams: true,
          source: true,
        },
      });
      // v253 — فال‌بک هم با همان رتبه‌بندی برش می‌خورد
      foods = rankAndSlice(all.filter((f) => persianFuzzyIncludes(f.name, q)));
    } else {
      foods = rankAndSlice(foods);
    }

    return Response.json({ foods });
  } catch (e) {
    console.error("[foods/search] error:", e);
    return Response.json({ foods: [], error: "خطا در جستجو" }, { status: 500 });
  }
}
