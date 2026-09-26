import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { GOAL_LABELS, type Goal } from "@/lib/fitness/types";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════
 *  v137 — GET /api/dashboard/journey — «مسیر پیشرفت تو»
 *
 *  دیرکتیو مالک: نمودار پیشرفت گیمیفایکشن داشبورد باید از اولین روز
 *  ثبت‌نام تا امروز باشد و با چکاپ‌ها، تمرین‌ها و پیشرفت پلن‌ها تغذیه شود.
 *
 *  یک endpoint، همهٔ داده‌ها (بدون هزینهٔ AI):
 *   • روز ثبت‌نام + روزهای همراهی با فیتاپ
 *   • سری وزن: وزن ثبت‌نام (پروفایل) + همهٔ WeightLogها (تلخیص‌شده)
 *   • وزن هدف + پیشرفت نسبی تا هدف
 *   • روزهای تمرین (DayCompletion.workoutDone) + روزهای کامل (تمرین+تغذیه)
 *   • استریک فعلی/بهترین (تمرین+تغذیهٔ کامل) — همان منطق sports-profile-context
 *   • چکاپ‌های تکمیل‌شده + پلن‌های خریداری‌شده
 *   • امتیاز/سطح گیمیفایکشن (XP) با درس‌پیشرفت تا سطح بعد
 *
 *  فقط requireAuth — رایگان برای همهٔ کاربران لاگین (با/بدون پلن).
 *  ارزان: فقط SELECT — هیچ write ای انجام نمی‌شود.
 * ═══════════════════════════════════════════════════════════════
 */

const DAY_MS = 86_400_000;

/** سطوح گیمیفایکشن فیتاپ — آستانهٔ XP + نام دوستانه */
const LEVELS: Array<{ min: number; name: string; emoji: string }> = [
  { min: 0, name: "تازه‌کار پرانرژی", emoji: "🌱" },
  { min: 80, name: "ورزشکار در مسیر", emoji: "🌿" },
  { min: 220, name: "پیگیر حرفه‌ای", emoji: "🔥" },
  { min: 480, name: "سخت‌کوش فیتاپ", emoji: "⚡" },
  { min: 900, name: "جنگجوی فیتاپ", emoji: "🛡️" },
  { min: 1500, name: "قهرمان فیتاپ", emoji: "👑" },
];

/** کلید روز تهران YYYY-MM-DD از یک Date */
function tehranKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth();

    const [u, profile, weightLogs, dayRows, checkups, subs] = await Promise.all([
      db.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, onboardingCompletedAt: true, onboardingDone: true },
      }),
      db.onboardingProfile.findUnique({
        where: { userId: user.id },
        select: { goal: true, weight: true, targetWeight: true, height: true, gender: true, age: true },
      }),
      db.weightLog.findMany({
        where: { userId: user.id },
        orderBy: { loggedAt: "asc" },
        select: { weight: true, loggedAt: true },
      }),
      db.dayCompletion.findMany({
        where: { userId: user.id },
        orderBy: { date: "desc" },
        take: 400, // ~۱۳ ماه — برای استریک و شمارنده‌ها کافی است
        select: { date: true, workoutDone: true, nutritionDone: true },
      }),
      db.checkup.findMany({
        where: { userId: user.id, status: "completed" },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      db.subscription.findMany({
        where: { userId: user.id, status: { in: ["active", "expired", "cancelled"] } },
        select: { id: true },
      }),
    ]);

    const registeredAt = (u?.createdAt ?? new Date()).toISOString();
    const registeredMs = new Date(registeredAt).getTime();
    const daysWithFitup = Math.max(1, Math.floor((Date.now() - registeredMs) / DAY_MS) + 1);

    // ─── سری وزن: نقطهٔ اول = وزن ثبت‌نام، بقیه = WeightLogها ───
    const startWeight = profile?.weight ?? weightLogs[0]?.weight ?? null;
    const series: Array<{ d: string; w: number }> = [];
    if (startWeight != null) {
      series.push({ d: registeredAt.slice(0, 10), w: Math.round(startWeight * 10) / 10 });
    }
    for (const w of weightLogs) {
      const d = w.loggedAt.toISOString().slice(0, 10);
      const weight = Math.round(w.weight * 10) / 10;
      const last = series[series.length - 1];
      if (last && last.d === d) {
        last.w = weight; // چند ثبت در یک روز → فقط آخرین
      } else {
        series.push({ d, w: weight });
      }
    }
    // تلخیص — حداکثر ~۹۰ نقطه برای نمودار سبک (حفظ نقطهٔ اول و آخر)
    let weightSeries = series;
    if (series.length > 90) {
      const step = Math.ceil(series.length / 88);
      weightSeries = series.filter((_, i) => i % step === 0 || i === series.length - 1);
    }
    const currentWeight = series.length > 0 ? series[series.length - 1].w : (startWeight ?? null);
    const targetWeight = profile?.targetWeight ?? null;

    // ─── شمارنده‌های فعالیت + استریک (تمرین+تغذیهٔ کامل) ───
    const workoutDays = dayRows.filter((r) => r.workoutDone).length;
    const fullDays = dayRows.filter((r) => r.workoutDone && r.nutritionDone).length;
    const completeSet = new Set(
      dayRows.filter((r) => r.workoutDone && r.nutritionDone).map((r) => r.date)
    );
    const todayKey = tehranKey(new Date());
    const todayMidnight = new Date(`${todayKey}T00:00:00+03:30`).getTime();
    let currentStreak = 0;
    let cursor = completeSet.has(todayKey) ? todayMidnight : todayMidnight - DAY_MS;
    while (completeSet.has(tehranKey(new Date(cursor))) && currentStreak < 365) {
      currentStreak++;
      cursor -= DAY_MS;
    }
    // بهترین استریک داخل پنجرهٔ fetched (مرتب صعودی روی کلیدها)
    const sortedKeys = [...completeSet].sort();
    let bestStreak = 0;
    let run = 0;
    let prevMs: number | null = null;
    for (const key of sortedKeys) {
      const ms = new Date(`${key}T00:00:00+03:30`).getTime();
      run = prevMs != null && ms - prevMs === DAY_MS ? run + 1 : 1;
      prevMs = ms;
      if (run > bestStreak) bestStreak = run;
    }

    const checkupCount = checkups.length;
    const plansPurchased = subs.length;

    // ─── XP گیمیفایکشن — ترکیب وزنی فعالیت‌های واقعی ───
    const xp =
      10 + // ثبت‌نام در فیتاپ
      (u?.onboardingDone ? 50 : 0) + // تکمیل آنبوردینگ
      workoutDays * 8 +
      fullDays * 12 +
      weightLogs.length * 4 +
      checkupCount * 60 +
      plansPurchased * 150;

    let levelIndex = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (xp >= LEVELS[i].min) levelIndex = i;
    }
    const level = LEVELS[levelIndex];
    const next = LEVELS[levelIndex + 1] ?? null;
    const levelProgress =
      next != null
        ? Math.min(1, Math.max(0.02, (xp - level.min) / (next.min - level.min)))
        : 1; // آخرین سطح — کامل

    const last7 = dayRows.slice(0, 7).map((r) => ({
      date: r.date,
      workoutDone: r.workoutDone,
      nutritionDone: r.nutritionDone,
      dayComplete: r.workoutDone && r.nutritionDone,
    }));

    return Response.json({
      ok: true,
      registeredAt,
      daysWithFitup,
      goal: profile?.goal
        ? { key: profile.goal, label: GOAL_LABELS[profile.goal as Goal] ?? profile.goal }
        : null,
      height: profile?.height ?? null,
      startWeight,
      currentWeight,
      targetWeight,
      weightSeries,
      workoutDays,
      fullDays,
      checkupCount,
      weightLogCount: weightLogs.length,
      plansPurchased,
      currentStreak,
      bestStreak,
      last7,
      xp,
      level: {
        index: levelIndex,
        name: level.name,
        emoji: level.emoji,
        min: level.min,
        next: next ? { name: next.name, min: next.min } : null,
        progress: levelProgress,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
