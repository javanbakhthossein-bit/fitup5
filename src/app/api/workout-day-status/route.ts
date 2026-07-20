import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { PERSIAN_WEEKDAYS } from "@/lib/fitness/types";

/**
 * محاسبه تاریخ شروع هفته (شنبه) بر اساس تاریخ فعلی
 * در تقویم ایرانی، هفته از شنبه شروع می‌شود
 */
function getWeekStart(date: Date = new Date()): Date {
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  // ما می‌خواهیم شنبه = شروع هفته
  // اگر امروز شنبه است (6)، شروع هفته = امروز
  // اگر امروز یکشنبه است (0)، شروع هفته = دیروز (شنبه)
  // و الی آخر
  const dayOfWeek = date.getDay(); // 0=Sunday
  // تبدیل به سیستم ایرانی: شنبه=0, یکشنبه=1, ..., جمعه=6
  // در JS: Sunday=0, Monday=1, ..., Saturday=6
  // شنبه در JS = 6, یکشنبه = 0, دوشنبه = 1, ...
  // daysSinceSaturday: شنبه=0, یکشنبه=1, ..., جمعه=6
  const daysSinceSaturday = (dayOfWeek + 1) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysSinceSaturday);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// GET — وضعیت روزهای هفته جاری
export async function GET() {
  try {
    const user = await requireAuth();
    const weekStart = getWeekStart();

    const statuses = await db.workoutDayStatus.findMany({
      where: {
        userId: user.id,
        weekStart,
      },
    });

    return Response.json({
      weekStart: weekStart.toISOString(),
      statuses: statuses.map((s) => ({
        id: s.id,
        dayName: s.dayName,
        status: s.status,
        movedTo: s.movedTo,
        swappedFrom: s.swappedFrom,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// POST — ثبت یا به‌روزرسانی وضعیت یک روز
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { dayName, status, movedTo, swappedFrom } = body || {};

    if (!dayName || !PERSIAN_WEEKDAYS.includes(dayName)) {
      return Response.json({ error: "نام روز نامعتبر است." }, { status: 400 });
    }

    if (!["completed", "skipped", "rest_as_planned"].includes(status)) {
      return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
    }

    const weekStart = getWeekStart();

    const result = await db.workoutDayStatus.upsert({
      where: {
        userId_dayName_weekStart: {
          userId: user.id,
          dayName,
          weekStart,
        },
      },
      create: {
        userId: user.id,
        dayName,
        weekStart,
        status,
        movedTo: movedTo || null,
        swappedFrom: swappedFrom || null,
      },
      update: {
        status,
        movedTo: movedTo || null,
        swappedFrom: swappedFrom || null,
      },
    });

    return Response.json({
      ok: true,
      status: {
        id: result.id,
        dayName: result.dayName,
        status: result.status,
        movedTo: result.movedTo,
        swappedFrom: result.swappedFrom,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
