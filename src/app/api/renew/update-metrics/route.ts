import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/fitness/auth";
import { verifyRenewToken } from "@/lib/fitness/renew-token";
import { startProgramGenerationInBackground } from "@/lib/fitness/program-generation";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

// ═══════════════════════════════════════════════════════════════
//  POST /api/renew/update-metrics — v159 (دستور مالک)
//
//  «بعد از خرید تمدید توسط کاربر در همه پلن‌ها یک مدال برای وارد کردن
//   اطلاعات جدید الزامی بیار مثل وزن و اندازه‌های بدنی و هر چیزی که
//   لازمه که کاربر بتونه پر کنه و یک دکمه استفاده از آخرین اطلاعات هم
//   بزار ... و بعد از تعیین تکلیف این موضوع برای پلن اقتصادی و
//   استاندارد بره برای ساخت برنامه و برای پلن‌های پیشرفته حرفه‌ای بره
//   برای پر کردن پیش‌نیازها.»
//
//  احراز هویت دوگانه:
//    • توکن تمدید (body.t) — صفحهٔ /renew?t=... بدون سشن
//    • یا سشن عادی (کاربر داخل پنل — مسیر پرداخت عادی)
//
//  بدنه: { t?, fields: {...} } — هر فیلد اختیاری است (whitelist سخت‌گیرانه)
//  بعد از ذخیره:
//    • اقتصادی/استاندارد (پلن فعال + برنامهٔ قبلی) → تولید مجدد برنامه با
//      داده‌های تازه (source: renewal_update) — مثل بازنویسی مدیر، تولیدِ
//      نیمه‌کارهٔ قبلی لغو و از نو با اطلاعات جدید ساخته می‌شود.
//    • پیشرفته/حرفه‌ای → هیچ تولیدی اینجا شروع نمی‌شود؛ جریان pending_body_photo
//      (پیش‌نیازها) همان‌طور که قبلاً هست ادامه می‌یابد — برنامه بعد از تکمیل
//      پیش‌نیازها با همین اطلاعات تازه ساخته می‌شود.
//  خروجی: { ok, updated, generationStarted, next? }
// ═══════════════════════════════════════════════════════════════

/** فیلدهای مجاز + اعتبارسنجی هر کدام (هیچ چیز آزادی نیست) */
function pickFields(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const out: Record<string, string | number> = {};

  const num = (v: unknown, min: number, max: number): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n * 10) / 10;
  };
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim().slice(0, max);
    return s.length > 0 ? s : null;
  };

  const weight = num(f.weight, 30, 300);
  if (weight != null) out.weight = weight;
  const targetWeight = num(f.targetWeight, 30, 300);
  if (targetWeight != null) out.targetWeight = targetWeight;

  const ACTIVITY = ["sedentary", "light", "moderate", "active", "very_active"];
  const activityLevel = str(f.activityLevel, 20);
  if (activityLevel && ACTIVITY.includes(activityLevel)) out.activityLevel = activityLevel;

  const workoutDays = num(f.workoutDays, 1, 7);
  if (workoutDays != null) out.workoutDays = Math.round(workoutDays);

  const sleepHours = num(f.sleepHours, 4, 12);
  if (sleepHours != null) out.sleepHours = Math.round(sleepHours);

  const stressLevel = num(f.stressLevel, 1, 5);
  if (stressLevel != null) out.stressLevel = Math.round(stressLevel);

  // اندازه‌های بدنی (cm)
  const MEASURES: Array<readonly [string, number, number]> = [
    ["waistMeasurement", 40, 200],
    ["hipMeasurement", 40, 200],
    ["chestMeasurement", 50, 200],
    ["armMeasurement", 15, 80],
    ["thighMeasurement", 25, 120],
    ["neckMeasurement", 20, 70],
    ["shoulderMeasurement", 60, 200],
    ["calfMeasurement", 15, 80],
  ];
  for (const [key, min, max] of MEASURES) {
    const v = num(f[key], min, max);
    if (v != null) out[key] = v;
  }

  // متن‌های آزاد کوتاه
  const injuries = str(f.injuries, 500);
  if (injuries != null) out.injuries = injuries;
  const diseases = str(f.diseases, 500);
  if (diseases != null) out.diseases = diseases;
  const allergies = str(f.allergies, 300);
  if (allergies != null) out.allergies = allergies;
  const specialConditions = str(f.specialConditions, 1500);
  if (specialConditions != null) out.specialConditions = specialConditions;
  const dislikedFoods = str(f.dislikedFoods, 500);
  if (dislikedFoods != null) out.dislikedFoods = dislikedFoods;

  return Object.keys(out).length > 0 ? out : null;
}

/** GET — مقادیر فعلی پروفایل برای پیش‌پرکردن مدال (توکن تمدید یا سشن) */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`renew-metrics-g:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
  try {
    const url = new URL(req.url);
    let userId: string | null = null;
    const t = url.searchParams.get("t");
    if (t) {
      const parsed = verifyRenewToken(t);
      if (parsed) userId = parsed.uid;
    }
    if (!userId) {
      const user = await getCurrentUser();
      if (user) userId = user.id;
    }
    if (!userId) return Response.json({ ok: false, error: "احراز هویت نامعتبر است." }, { status: 401 });

    const p = await db.onboardingProfile.findUnique({
      where: { userId },
      select: {
        weight: true, targetWeight: true, activityLevel: true, workoutDays: true,
        sleepHours: true, stressLevel: true, injuries: true, diseases: true,
        allergies: true, specialConditions: true, dislikedFoods: true,
        waistMeasurement: true, hipMeasurement: true, chestMeasurement: true,
        armMeasurement: true, thighMeasurement: true, neckMeasurement: true,
        shoulderMeasurement: true, calfMeasurement: true, height: true,
      },
    });
    if (!p) return Response.json({ ok: true, profile: null });
    return Response.json({ ok: true, profile: p });
  } catch (e) {
    console.error("[renew/update-metrics][GET] failed:", e);
    return Response.json({ ok: false, error: "خطا در دریافت اطلاعات" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // ریت‌لیمیت — با و بدون توکن
  const rl = rateLimit(`renew-metrics:${getClientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const body = (await req.json().catch(() => ({}))) as { t?: string; fields?: unknown };
    const fields = pickFields(body.fields);
    if (!fields) {
      return Response.json(
        { ok: false, error: "هیچ اطلاعات معتبری برای ذخیره ارسال نشده است." },
        { status: 400 }
      );
    }

    // ─── احراز هویت: توکن تمدید یا سشن ───
    let userId: string | null = null;
    if (body.t) {
      const parsed = verifyRenewToken(body.t);
      if (parsed) userId = parsed.uid;
    }
    if (!userId) {
      const user = await getCurrentUser();
      if (user) userId = user.id;
    }
    if (!userId) {
      return Response.json({ ok: false, error: "احراز هویت نامعتبر است." }, { status: 401 });
    }

    const profile = await db.onboardingProfile.findUnique({
      where: { userId },
      select: { id: true, weight: true },
    });
    if (!profile) {
      // بدون پروفایل آنبوردینگ چیزی برای به‌روزرسانی نیست — بی‌خطر رد شو
      return Response.json({ ok: true, updated: false, generationStarted: false, reason: "no_profile" });
    }

    const data: Record<string, string | number> = { ...fields };
    await db.onboardingProfile.update({ where: { userId }, data });

    // ─── مسیر ادامه: ساخت برنامه (اقتصادی/استاندارد) یا پیش‌نیازها (پیشرفته/حرفه‌ای) ───
    const activeSub = await db.subscription.findFirst({
      where: { userId, OR: [{ status: "active" }, { status: "pending" }] },
      orderBy: { endDate: "desc" },
      select: { plan: true, status: true },
    });
    const planId = activeSub?.plan ?? "";
    const isAdvanced = planId === "advanced" || planId === "ultimate";

    if (isAdvanced) {
      // پلن پیشرفته/حرفه‌ای → مرحلهٔ پیش‌نیازها (عکس بدن) خودش جریان را می‌برد
      return Response.json({ ok: true, updated: true, generationStarted: false, next: "prerequisites" });
    }

    // اقتصادی/استاندارد — تولید مجدد با اطلاعات تازه فقط وقتی برنامه‌ای در جریان یا آماده است
    const inFlight = await db.programRequest.findFirst({
      where: { userId, status: { in: ["generating", "ready"] } },
      select: { id: true },
    });
    let generationStarted = false;
    if (inFlight) {
      // آزادسازی تولید نیمه‌کاره (مثل بازنویسی مدیر) و شروع تازه با پروفایل به‌روز
      await db.programRequest.updateMany({
        where: { userId, status: "generating" },
        data: {
          status: "failed",
          lastError: "به‌روزرسانی اطلاعات پس از تمدید — تولید قبلی لغو و از نو شروع شد",
        },
      });
      const result = await startProgramGenerationInBackground(userId, {
        source: "renewal_update",
        changeSummary: "به‌روزرسانی اطلاعات پس از تمدید پلن — برنامه با آخرین وزن و اندازه‌های بدنی بازسازی شد",
      });
      generationStarted = result.started;
    }

    return Response.json({ ok: true, updated: true, generationStarted, next: "generation" });
  } catch (e) {
    console.error("[renew/update-metrics] failed:", e);
    return Response.json(
      { ok: false, error: "خطا در ذخیره اطلاعات. لطفاً دوباره تلاش کنید." },
      { status: 500 }
    );
  }
}
