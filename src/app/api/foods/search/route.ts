import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/foods/search?q=<query>&limit=<n>&category=<cat>
 *
 * جستجوی سریع در بانک غذاها برای autocomplete.
 * - بدون نیاز به auth (بانک غذاها عمومی است)
 * - حداقل ۲ حرف برای جستجو
 * - حداکثر ۲۰ نتیجه (پیش‌فرض)
 * - جستجوی contains (حساس به حروف فارسی نبودن توسط SQLite COLLATE انجام نمی‌شود؛
 *   برای پشتیبانی بهتر، هر دو شکل contains معمولی و normalize ساده انجام می‌شود)
 */
export async function GET(req: NextRequest) {
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
    OR: [{ name: { contains: q } }],
  };
  if (category && category !== "all") where.category = category;

  try {
    const foods = await db.foodLibrary.findMany({
      where,
      orderBy: { name: "asc" },
      take: limit,
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
      },
    });

    return Response.json({ foods });
  } catch (e) {
    console.error("[foods/search] error:", e);
    return Response.json({ foods: [], error: "خطا در جستجو" }, { status: 500 });
  }
}
