import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { getTehranDayKey, tehranDayKeyToUtcMidnight } from "@/lib/fitness/day";

/**
 * ═══════════════════════════════════════════════════════════════
 *  /api/daily-status — Task 3-b: وضعیت «روز کامل» مشترک تمرین + تغذیه
 *
 *  بخش مشترکِ حالت باشگاه (گیم‌مود)، جلسه هدایت‌شده و کالری‌شمار:
 *  تکمیل تمرین در هر مسیر + تکمیل تغذیه → ردیف واحد DayCompletion
 *  برای (userId, تاریخ امروز تهران). وقتی هر دو true شدند، روز کامل است
 *  و مدال مشترک در همهٔ سکشن‌ها نمایش داده می‌شود.
 *
 *  GET  ?date=YYYY-MM-DD (اختیاری — پیش‌فرض امروز تهران)
 *       → { date, workoutDone, workoutSource, workoutAt, nutritionDone,
 *           nutritionAt, medalSeenAt, dayComplete,
 *           last7: [{date, workoutDone, nutritionDone, dayComplete}] }
 *       last7 = ۷ ردیف اخیر برای UIهای آیندهٔ زنجیره/استریک (ارزان و بی‌هزینه).
 *
 *  POST  body (همهٔ بخش‌ها اختیاری):
 *       { workout?:   { done: true, source: "gym_mode" | "guided_session" },
 *         nutrition?: { done: boolean, calories?: number, target?: number },
 *         medalSeen?: true }
 *       Upsert ردیف امروز. medalSeen فقط در اولین فراخوانیِ روز medalSeenAt
 *       را ست می‌کند (دفعات بعد no-op). calories/target پذیرفته می‌شوند ولی
 *       ذخیره نمی‌شوند (اسکیمای DayCompletion ثابت است — دادهٔ اضافه نگه
 *       نداشته نمی‌شود)؛ فقط امضای قرارداد برای آینده.
 *
 *  خروجی JSON کاملاً بدون لیبل فارسی — لیبل‌ها سمت کلاینت‌اند.
 * ═══════════════════════════════════════════════════════════════
 */

type DayCompletionRow = {
  date: string;
  workoutDone: boolean;
  workoutSource: string | null;
  workoutAt: Date | null;
  nutritionDone: boolean;
  nutritionAt: Date | null;
  medalSeenAt: Date | null;
};

function rowToJson(row: DayCompletionRow) {
  return {
    date: row.date,
    workoutDone: row.workoutDone,
    workoutSource: row.workoutSource,
    workoutAt: row.workoutAt ? row.workoutAt.toISOString() : null,
    nutritionDone: row.nutritionDone,
    nutritionAt: row.nutritionAt ? row.nutritionAt.toISOString() : null,
    medalSeenAt: row.medalSeenAt ? row.medalSeenAt.toISOString() : null,
    dayComplete: row.workoutDone && row.nutritionDone,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");

    let date = getTehranDayKey();
    if (dateParam) {
      if (!tehranDayKeyToUtcMidnight(dateParam)) {
        return Response.json({ error: "فرمت تاریخ نامعتبر است." }, { status: 400 });
      }
      date = dateParam.trim();
    }

    const [row, recent] = await Promise.all([
      db.dayCompletion.findUnique({
        where: { userId_date: { userId: user.id, date } },
      }),
      // ۷ روز اخیر (مرتب‌سازی لغوی YYYY-MM-DD = مرتب‌سازی تاریخ واقعی)
      db.dayCompletion.findMany({
        where: { userId: user.id },
        orderBy: { date: "desc" },
        take: 7,
      }),
    ]);

    return Response.json({
      ...(row
        ? rowToJson(row)
        : {
            date,
            workoutDone: false,
            workoutSource: null,
            workoutAt: null,
            nutritionDone: false,
            nutritionAt: null,
            medalSeenAt: null,
            dayComplete: false,
          }),
      last7: recent.map((r) => ({
        date: r.date,
        workoutDone: r.workoutDone,
        nutritionDone: r.nutritionDone,
        dayComplete: r.workoutDone && r.nutritionDone,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "بدنه‌ی درخواست نامعتبر است." }, { status: 400 });
    }

    const workout = (body as Record<string, unknown>).workout;
    const nutrition = (body as Record<string, unknown>).nutrition;
    const medalSeen = (body as Record<string, unknown>).medalSeen === true;

    const workoutValid =
      !!workout && typeof workout === "object" && (workout as { done?: unknown }).done === true;
    const workoutSource =
      workoutValid &&
      ((workout as { source?: unknown }).source === "gym_mode" ||
        (workout as { source?: unknown }).source === "guided_session")
        ? ((workout as { source: string }).source as string)
        : null;

    const nutritionValid = !!nutrition && typeof nutrition === "object";
    const nutritionDone = nutritionValid
      ? (nutrition as { done?: unknown }).done === true
      : false;

    if (!workoutValid && !nutritionValid && !medalSeen) {
      return Response.json({ error: "هیچ داده‌ای برای ثبت ارسال نشده است." }, { status: 400 });
    }

    const date = getTehranDayKey();
    const now = new Date();

    const existing = await db.dayCompletion.findUnique({
      where: { userId_date: { userId: user.id, date } },
    });

    // ─── ساخت دادهٔ نوشتن ───
    // نکته: workoutAt/nutritionAt اولین زمانِ تکمیل را نگه می‌دارند (تمرین
    // دومِ همان روز / POST تکراری، زمان اولین تکمیل را خراب نمی‌کند)؛
    // workoutSource فقط اگر از قبل ثبت نشده باشد می‌نشیند (اولین منبع می‌ماند).
    const data: Partial<{
      workoutDone: boolean;
      workoutSource: string | null;
      workoutAt: Date;
      nutritionDone: boolean;
      nutritionAt: Date;
      medalSeenAt: Date;
    }> = {};

    if (workoutValid) {
      data.workoutDone = true;
      data.workoutSource = existing?.workoutSource ?? workoutSource;
      data.workoutAt = existing?.workoutAt ?? now;
    }
    if (nutritionValid) {
      data.nutritionDone = nutritionDone;
      if (nutritionDone) {
        data.nutritionAt = existing?.nutritionAt ?? now;
      }
    }
    if (medalSeen && !existing?.medalSeenAt) {
      data.medalSeenAt = now;
    }

    let row: DayCompletionRow;
    if (!existing) {
      row = await db.dayCompletion.create({
        data: {
          userId: user.id,
          date,
          workoutDone: data.workoutDone ?? false,
          workoutSource: data.workoutSource ?? null,
          workoutAt: data.workoutAt ?? null,
          nutritionDone: data.nutritionDone ?? false,
          nutritionAt: data.nutritionAt ?? null,
          medalSeenAt: data.medalSeenAt ?? null,
        },
      });
    } else {
      row = await db.dayCompletion.update({ where: { id: existing.id }, data });
    }

    return Response.json(rowToJson(row));
  } catch (e) {
    return apiError(e);
  }
}
