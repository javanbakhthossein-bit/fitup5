import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { calculateBodyComposition } from "@/lib/fitness/body-composition";
import { analyzeBaselineMeasurements } from "@/lib/fitness/ai";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";

/**
 * POST /api/checkup/baseline-measurements
 * ذخیره اندازه‌های بدنی که کاربر بعد از خرید وارد می‌کند.
 * این اندازه‌ها در چکاپ phase 0 (baseline) ذخیره می‌شوند.
 * همچنین bodyFatPercent و leanBodyMass را با فرمول US Navy محاسبه و ذخیره می‌کند.
 *
 * v15 (درخواست مالک): با ورود اندازه‌ها، «فاز صفر» تکمیل می‌شود و تحلیل
 * کوتاه هوش مصنوعی (۲-۳ خط) تولید و در همان چکاپ فاز صفر ذخیره می‌شود.
 *
 * این endpoint برای کاربرانی استفاده می‌شود که در فرآیند submit-body-analysis
 * (پلن Advanced/Ultimate) اندازه‌های بدنی را وارد می‌کنند اما هنوز چکاپ ایجاد نکرده‌اند.
 *
 * Body (JSON):
 *   - weight?: number (وزن فعلی — اختیاری، پیش‌فرض پروفایل)
 *   - waistMeasurement?: number
 *   - neckMeasurement?: number
 *   - hipMeasurement?: number
 *   - chestMeasurement?: number
 *   - armMeasurement?: number
 *   - thighMeasurement?: number
 *   - shoulderMeasurement?: number  (only on OnboardingProfile)
 *   - calfMeasurement?: number      (only on OnboardingProfile)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json()) as Record<string, number | undefined>;

    const numOrUndef = (v: unknown): number | undefined => {
      const n = Number(v);
      if (!isFinite(n) || n <= 0) return undefined;
      return n;
    };

    const waist = numOrUndef(body.waistMeasurement);
    const neck = numOrUndef(body.neckMeasurement);
    const hip = numOrUndef(body.hipMeasurement);
    const chest = numOrUndef(body.chestMeasurement);
    const arm = numOrUndef(body.armMeasurement);
    const thigh = numOrUndef(body.thighMeasurement);
    const shoulder = numOrUndef(body.shoulderMeasurement);
    const calf = numOrUndef(body.calfMeasurement);
    // v15: وزن فعلی (اختیاری) — فاز صفر باید وزن واقعی روز اول را ثبت کند
    const currentWeight = numOrUndef(body.weight);

    // ─── ذخیره shoulder/calf در OnboardingProfile (فقط آنجا این فیلدها وجود دارند) ───
    const profileUpdate: Record<string, number | null> = {};
    if (shoulder != null) profileUpdate.shoulderMeasurement = shoulder;
    if (calf != null) profileUpdate.calfMeasurement = calf;
    if (Object.keys(profileUpdate).length > 0) {
      await db.onboardingProfile.updateMany({
        where: { userId: user.id },
        data: profileUpdate,
      });
    }

    // ─── محاسبه body composition با فرمول US Navy ───
    const profile = await db.onboardingProfile.findUnique({ where: { userId: user.id } });
    const weightForCalc = currentWeight ?? profile?.weight ?? null;
    let bodyFatPercent: number | null = null;
    let leanBodyMass: number | null = null;
    if (profile) {
      const bc = calculateBodyComposition({
        gender: profile.gender as "male" | "female",
        height: profile.height,
        weight: weightForCalc ?? profile.weight ?? 70,
        waist: waist ?? null,
        neck: neck ?? null,
        hip: hip ?? null,
      });
      if (bc) {
        bodyFatPercent = bc.bodyFatPercent;
        leanBodyMass = bc.leanBodyMass;
      }
    }

    // ─── به‌روزرسانی چکاپ phase 0 (baseline) ───
    const existing = await db.checkup.findFirst({
      where: { userId: user.id, phaseNumber: 0 },
      orderBy: { createdAt: "desc" },
    });

    // v15: آیا حداقل یک اندازه واقعاً وارد شد؟ (وزن یا هر اندازه‌ای)
    const hasAnyMeasurement =
      currentWeight != null ||
      [waist, neck, hip, chest, arm, thigh, shoulder, calf].some((v) => v != null);

    // v15: اگر وزن جدید آمده، پروفایل آنبوردینگ را هم sync کن تا محاسبات
    // بعدی (کالری/برنامه) با وزن واقعی روز اول کار کنند
    if (currentWeight != null && profile) {
      await db.onboardingProfile.updateMany({
        where: { userId: user.id },
        data: { weight: currentWeight },
      });
    }

    if (existing) {
      await db.checkup.update({
        where: { id: existing.id },
        data: {
          weight: currentWeight ?? existing.weight,
          waistMeasurement: waist ?? existing.waistMeasurement,
          neckMeasurement: neck ?? existing.neckMeasurement,
          hipMeasurement: hip ?? existing.hipMeasurement,
          chestMeasurement: chest ?? existing.chestMeasurement,
          armMeasurement: arm ?? existing.armMeasurement,
          thighMeasurement: thigh ?? existing.thighMeasurement,
          bodyFatPercent: bodyFatPercent ?? existing.bodyFatPercent,
          leanBodyMass: leanBodyMass ?? existing.leanBodyMass,
          // v15: با ورود اندازه‌ها، فاز صفر «تکمیل» می‌شود (نه «در انتظار اندازه»)
          phaseCompleted: hasAnyMeasurement ? true : existing.phaseCompleted,
        },
      });
    } else {
      // اگر چکاپ phase 0 وجود ندارد (نباید پیش بیاید چون onboarding آن را می‌سازد)
      // یک چکاپ baseline جدید ایجاد می‌کنیم
      await db.checkup.create({
        data: {
          userId: user.id,
          phaseNumber: 0,
          isFinalCheckup: false,
          status: "approved",
          weight: weightForCalc ?? 70,
          waistMeasurement: waist ?? null,
          neckMeasurement: neck ?? null,
          hipMeasurement: hip ?? null,
          chestMeasurement: chest ?? null,
          armMeasurement: arm ?? null,
          thighMeasurement: thigh ?? null,
          bodyFatPercent,
          leanBodyMass,
          fatigueLevel: 3,
          sleepQuality: 3,
          dietAdherence: 3,
          workoutAdherence: 3,
          phaseCompleted: hasAnyMeasurement,
          notes: "چکاپ اولیه — اندازه‌های بدنی پس از خرید وارد شد",
          aiAnalysis: null,
          coachNotes: null,
        },
      });
    }

    // ─── v15: تحلیل کوتاه هوش مصنوعی برای فاز صفر (۲-۳ خط — درخواست مالک) ───
    // با ورود اندازه‌ها، AI یک تحلیل اولیه می‌نویسد که در کارت فاز صفر نمایش
    // داده می‌شود. اگر AI خطا داد، ذخیره اندازه‌ها همچنان موفق است (تحلیل null
    // می‌ماند و UI پیام مناسب نشان می‌دهد).
    let aiAnalysisResult: { analysis: string; recommendations: string[] } | null = null;
    if (hasAnyMeasurement) {
      try {
        const raw = await analyzeBaselineMeasurements({
          gender: (profile?.gender as "male" | "female") ?? "male",
          age: profile?.age ?? null,
          height: profile?.height ?? null,
          weight: weightForCalc,
          targetWeight: profile?.targetWeight ?? null,
          goal: profile?.goal ?? null,
          waist: waist ?? null,
          neck: neck ?? null,
          hip: hip ?? null,
          chest: chest ?? null,
          arm: arm ?? null,
          thigh: thigh ?? null,
          bodyFatPercent,
        });
        // اصلاح نگارش فارسی (کلمات چسبیده و فاصله‌ها)
        aiAnalysisResult = {
          analysis: fixPersianTypography(raw.analysis || ""),
          recommendations: (raw.recommendations || []).map((r) => fixPersianTypography(r)),
        };
        const target = await db.checkup.findFirst({
          where: { userId: user.id, phaseNumber: 0 },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (target) {
          await db.checkup.update({
            where: { id: target.id },
            data: { aiAnalysis: JSON.stringify(aiAnalysisResult) },
          });
        }
      } catch (aiErr) {
        console.error("[baseline-measurements] AI analysis failed (saved anyway):", aiErr);
      }
    }

    return Response.json({
      ok: true,
      bodyFatPercent,
      leanBodyMass,
      aiAnalysis: aiAnalysisResult,
      message: "اندازه‌های بدنی ذخیره شد.",
    });
  } catch (e) {
    return apiError(e);
  }
}
