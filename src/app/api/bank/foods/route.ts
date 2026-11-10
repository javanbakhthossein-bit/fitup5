import { NextResponse } from "next/server";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { db } from "@/lib/db";

/**
 * ─── v139 — بانک غذاها داخل پنل (دیرکتیو مالک) ───
 *
 * لیست فشردهٔ غذاهای کتابخانه برای تب ایزولهٔ «بانک غذاها» در پنل ورزشکار.
 * ۱۵۲۵ غذا با payload کم‌حجم (بدون imageUrl) + کش حافظهٔ سرور (۶۰ ثانیه)
 * + کش سشن کلاینت → ورود مجدد به تب لحظه‌ای است.
 *
 * فقط requireAuth — رایگان برای همهٔ کاربران لاگین (با/بدون پلن).
 *
 * v253 — فیلدهای سیستم واحدهای چندگانه هم برگشت داده می‌شوند:
 * units (JSON آرایه‌ای از {label,grams}) + servingGrams (وزن واحد مبنا)
 * + source (منبع ماکروها برای بجِ شفافیت مثل USDA).
 */

export const dynamic = "force-dynamic";

let CACHE: { at: number; data: BankFoodRow[] } | null = null;
const TTL_MS = 60_000;

export interface BankFoodRow {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
  // v253 — واحدهای چندگانه + وزن مبنا + منبع داده
  units: string;
  servingGrams: number | null;
  source: string;
}

export async function GET() {
  try {
    await requireAuth();

    if (CACHE && Date.now() - CACHE.at < TTL_MS) {
      return NextResponse.json(
        { foods: CACHE.data },
        { headers: { "Cache-Control": "private, max-age=30" } }
      );
    }

    const rows = await db.foodLibrary.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        servingSize: true,
        // v253 — سیستم واحدهای چندگانه + منبع
        units: true,
        servingGrams: true,
        source: true,
      },
    });

    const data: BankFoodRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category || "snack",
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      servingSize: r.servingSize || "۱ وعده",
      // v253 — واحدهای چندگانه (رشتهٔ خالی = فقط واحد مبنا/گرم) + منبع
      units: r.units || "",
      servingGrams: r.servingGrams ?? null,
      source: r.source || "",
    }));

    CACHE = { at: Date.now(), data };

    return NextResponse.json(
      { foods: data },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (e) {
    return apiError(e);
  }
}
