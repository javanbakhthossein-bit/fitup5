import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

export async function GET() {
  try {
    const user = await requireAuth();
    // ─── بهینه‌سازی (تسک 4-a): سقف ردیف + select فقط ستون‌های مصرفی UI ───
    // وزن‌ها: UI فقط آخرین ردیف را می‌خواند → ۲۰۰ ردیفِ جدیدترین (نزولی + برگشت به
    // صعودی — شکل پاسخ دست‌نخورده). note/loggedAt در تایپ UI هست → محافظه‌کارانه ارسال می‌شود.
    const [weights, photos, profile, checkups] = await Promise.all([
      db.weightLog.findMany({
        where: { userId: user.id },
        orderBy: { loggedAt: "desc" },
        take: 200,
        select: { id: true, weight: true, note: true, loggedAt: true },
      }),
      // عکس‌ها: گالری پیشرفت همه را رندر می‌کند — سقف ۱۰۰ عکس آخر (نزولی = جدیدترین‌ها)
      // + checkupId که تب «چکاپ» می‌خواند.
      db.progressPhoto.findMany({
        where: { userId: user.id },
        orderBy: { takenAt: "desc" },
        take: 100,
        select: { id: true, imageUrl: true, type: true, note: true, takenAt: true, checkupId: true },
      }),
      // فقط وزن شروع/هدف + فیلدهای «اندازه‌های بدنی» خوانده می‌شود —
      // aiAnalysis (متن بلند AI) اصلاً ship نمی‌شود
      db.onboardingProfile.findUnique({
        where: { userId: user.id },
        select: {
          weight: true,
          targetWeight: true,
          waistMeasurement: true,
          neckMeasurement: true,
          chestMeasurement: true,
          armMeasurement: true,
          hipMeasurement: true,
          thighMeasurement: true,
          shoulderMeasurement: true,
          calfMeasurement: true,
        },
      }),
      // چکاپ‌ها: فقط ستون‌های نمودار ترکیب بدن + فلگ اندازه‌ها (aiAnalysis بلندِ چکاپ اینجا رندر نمی‌شود)
      db.checkup.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          weight: true,
          bodyFatPercent: true,
          leanBodyMass: true,
          waistMeasurement: true,
          armMeasurement: true,
          chestMeasurement: true,
          hipMeasurement: true,
          thighMeasurement: true,
          neckMeasurement: true,
        },
      }),
    ]);

    // بازیابی ترتیب صعودی وزن‌ها (take نزولی جدیدترین‌ها را می‌گیرد — UI انتظار صعودی دارد)
    weights.reverse();

    // ─── Body composition history (from checkups with bodyFatPercent) ───
    // شامل چکاپ phase 0 (baseline) + همه چکاپ‌های بعدی که bodyFatPercent دارند.
    const bodyCompHistory = checkups
      .filter((c) => c.bodyFatPercent != null)
      .map((c) => ({
        date: c.createdAt.toISOString().slice(0, 10),
        weight: Math.round(c.weight * 10) / 10,
        bodyFatPercent: c.bodyFatPercent!,
        leanBodyMass: c.leanBodyMass ?? null,
      }));

    // ─── v160 (T3/T4) — فلگ «اندازه‌های بدنی ثبت شده» ───
    // دستور مالک: کارت «اندازه‌های بدنی خود را وارد کنید» برای کاربری که
    // اندازه‌ها را وارد کرده باید برداشته شود + مشاهدهٔ ٪چربی/٪عضله منوط
    // به ثبت اندازه‌ها است. منبع: فیلدهای اندازهٔ OnboardingProfile یا هر چکاپ.
    const hasBodyMeasurements =
      [
        profile?.waistMeasurement,
        profile?.neckMeasurement,
        profile?.chestMeasurement,
        profile?.armMeasurement,
        profile?.hipMeasurement,
        profile?.thighMeasurement,
        profile?.shoulderMeasurement,
        profile?.calfMeasurement,
      ].some((v) => v != null) ||
      checkups.some(
        (c) =>
          c.waistMeasurement != null ||
          c.neckMeasurement != null ||
          c.chestMeasurement != null ||
          c.armMeasurement != null ||
          c.hipMeasurement != null ||
          c.thighMeasurement != null
      );

    return Response.json({
      weights: weights.map((w) => ({
        id: w.id,
        weight: w.weight,
        note: w.note,
        loggedAt: w.loggedAt.toISOString(),
      })),
      photos: photos.map((p) => ({
        id: p.id,
        imageUrl: p.imageUrl,
        type: p.type,
        note: p.note,
        takenAt: p.takenAt.toISOString(),
        // v159 (T5) — شناسهٔ چکاپِ مرتبط (فقط type=checkup) — تب «چکاپ» گالری
        checkupId: p.checkupId ?? null,
      })),
      startWeight: profile?.weight ?? null,
      targetWeight: profile?.targetWeight ?? null,
      // ─── NEW (BODY-COMPOSITION-PRO): body composition history from checkups ───
      bodyCompositionHistory: bodyCompHistory,
      // ─── v160 (T3/T4) — فلگ ثبت اندازه‌های بدنی ───
      hasBodyMeasurements,
      // ─── Latest body composition (for quick display) ───
      latestBodyComposition: (() => {
        if (bodyCompHistory.length === 0) return null;
        const last = bodyCompHistory[bodyCompHistory.length - 1];
        return last;
      })(),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    // ─── v202 ممیزی (M9) — rate limit ثبت وزن: ۳۰ درخواست در دقیقه per-user
    // (مسیر POST تا حالا بی‌سقف بود و هر ثبت یک ردیف WeightLog + چک نوتیف می‌ساخت)
    const rl = rateLimit(`progress:${user.id}`, 30, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }
    const { weight, note } = await req.json();
    if (!weight || weight < 30 || weight > 250) {
      return Response.json({ error: "وزن نامعتبر است." }, { status: 400 });
    }
    const log = await db.weightLog.create({
      // v202 ممیزی (M9) — سقف نرم note: ۲۰۰۰ نویسه (برش بی‌صدا)
      data: { userId: user.id, weight: Number(weight), note: String(note || "").slice(0, 2000) },
    });

    // Check achievement
    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
    });
    if (profile?.targetWeight && Number(weight) <= profile.targetWeight) {
      // ─── Dedup: یک نوتیف «رسیدن به وزن هدف» برای هر کاربر کافی است ───
      // قبلاً هر ثبت وزنِ زیرِ هدف یک نوتیف جدید می‌ساخت — کاربری که روزانه وزن
      // ثبت می‌کرد به‌ازای هر ثبت یک اعلان تبریک تکراری می‌گرفت (spam نوتیف).
      const alreadyCelebrated = await db.notification.findFirst({
        where: {
          userId: user.id,
          type: "achievement",
          title: "تبریک! به وزن هدف رسیدید! 🏆",
        },
        select: { id: true },
      });
      if (!alreadyCelebrated) {
        await db.notification.create({
          data: {
            userId: user.id,
            type: "achievement",
            title: "تبریک! به وزن هدف رسیدید! 🏆",
            body: `شما به وزن هدف خود (${profile.targetWeight} کیلوگرم) رسیدید. عالی بود!`,
            link: "?tab=progress",
            read: false,
          },
        });
      }
    }

    return Response.json({
      id: log.id,
      weight: log.weight,
      note: log.note,
      loggedAt: log.loggedAt.toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "ID نیاز است." }, { status: 400 });
    await db.weightLog.deleteMany({ where: { id, userId: user.id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
