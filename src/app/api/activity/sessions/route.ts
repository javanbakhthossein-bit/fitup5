import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { resolveWeightFromInputs } from "@/lib/fitness/active-weight";

/**
 * ─── v138 — مسیریاب فیتاپ (پیاده‌روی و دویدن) ───
 *
 * POST /api/activity/sessions — ثبت یک جلسهٔ کامل (مسیر + آمار)
 * GET  /api/activity/sessions?limit=&cursor= — تاریخچهٔ جلسه‌های کاربر
 *
 * قانون دسترسی (دیرکتیو مالک): «ثبت» برای همهٔ کاربران لاگین‌شده رایگان است
 * (حتی بدون پلن). فقط تزریق در پروفایل ورزشی/هوش مصنوعی مخصوص پلن‌های فعال
 * است که سمت مصرف‌کننده‌های buildSportsProfileContext ذاتاً پلن‌دارند.
 *
 * سمت سرور اعتبارسنجی و «بازمحاسبهٔ» می‌شود:
 *  • مسیر GPS حداکثر ۴۰۰۰ نقطه (با گرد کردن ۵ رقم اعشار ≈ ۱ متر) — ضد سوءاستفاده حجمی
 *  • تشخیص نوع فعالیت (walk/jog/run) از میانگین سرعت متحرک — مقدار کلاینت فقط پیشنهاد
 *  • کالری با MET بر اساس سرعت + وزن واقعی کاربر (WeightLog/OnboardingProfile) بازمحاسبه می‌شود
 *  • گام‌ها از مسافت و نوع فعالیت تخمین زده می‌شود
 */

// ── سقف‌های سخت (ضد سوءاستفاده) ──
const MAX_POINTS = 4000;
const MAX_DURATION_SEC = 24 * 3600; // حداکثر یک روز
const MAX_SPEED_KMH = 45; // بالاتر از این = نویز GPS
const MAX_NOTE = 500;

interface SessionPoint {
  lat: number;
  lng: number;
  t: number; // ثانیه از شروع جلسه
  acc: number; // متر
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** MET بر اساس سرعت (km/h) — ترکیب ACSM walking/running */
function metFromSpeed(kmh: number): number {
  if (kmh < 3.2) return 2.0; // قدم آرام/ایستاده با حرکت
  if (kmh <= 6.5) return Math.max(2.5, 0.75 + 0.62 * kmh); // پیاده‌روی (~5 → 3.85)
  return Math.max(5.0, 0.9 * kmh); // دویدن (ACSM: ~1.0× سرعت؛ کمی محافظه‌کار)
}

/** تشخیص نوع فعالیت از میانگین سرعت متحرک */
function detectActivityType(avgMovingKmh: number): "walk" | "jog" | "run" {
  if (avgMovingKmh < 6.5) return "walk";
  if (avgMovingKmh < 8.5) return "jog";
  return "run";
}

/** طول گام تخمینی بر حسب نوع فعالیت */
function strideMeters(type: "walk" | "jog" | "run"): number {
  if (type === "walk") return 0.72;
  if (type === "jog") return 0.95;
  return 1.1;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    let body: {
      startedAt?: string;
      endedAt?: string;
      distanceM?: number;
      avgSpeedKmh?: number;
      maxSpeedKmh?: number;
      calories?: number;
      steps?: number;
      suggestedType?: string;
      points?: number[][]; // [lat, lng, tSec, acc][]
      photoUrl?: string;
      note?: string;
    };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "بدنهٔ درخواست نامعتبر است." }, { status: 400 });
    }

    const startedAtMs = Date.parse(String(body.startedAt || ""));
    const endedAtMs = Date.parse(String(body.endedAt || ""));
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
      return Response.json({ error: "زمان شروع/پایان نامعتبر است." }, { status: 400 });
    }
    let durationSec = Math.floor((endedAtMs - startedAtMs) / 1000);
    if (durationSec < 10) {
      return Response.json(
        { error: "جلسه خیلی کوتاه بود (حداقل ۱۰ ثانیه)." },
        { status: 400 }
      );
    }
    if (durationSec > MAX_DURATION_SEC) {
      durationSec = MAX_DURATION_SEC;
    }

    // ── مسیر GPS: پاک‌سازی سمت سرور (هرگز به دادهٔ خام کلاینت اعتماد نمی‌کنیم) ──
    const rawPoints = Array.isArray(body.points) ? body.points : [];
    if (rawPoints.length > MAX_POINTS * 2) {
      return Response.json({ error: "حجم مسیر بیش از حد مجاز است." }, { status: 413 });
    }
    const points: SessionPoint[] = [];
    for (const p of rawPoints.slice(0, MAX_POINTS)) {
      if (!Array.isArray(p) || p.length < 3) continue;
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      const tSec = Math.round(Number(p[2]));
      const acc = Math.max(0, Math.min(500, Math.round(Number(p[3]) || 25)));
      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;
      points.push({
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        t: Math.max(0, Math.min(durationSec, tSec)),
        acc,
      });
    }
    points.sort((a, b) => a.t - b.t);

    // مسافت و سرعت‌ها را خودمان از نقاط حساب می‌کنیم (نه اعتماد به کلاینت)
    let distanceM = 0;
    let maxSpeedKmh = 0;
    let movingSec = 0;
    const MAX_JUMP_M = 120; // پرش بزرگ‌تر از این در <۱۵ث = نویز → قطع مسیر
    const MAX_GAP_SEC = 15;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const dt = cur.t - prev.t;
      if (dt <= 0 || dt > 120) continue; // شکاف بزرگ → بی‌اثر
      const d = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
      if (d > MAX_JUMP_M && dt < MAX_GAP_SEC) continue; // نویز GPS
      const kmh = (d / dt) * 3.6;
      if (kmh > MAX_SPEED_KMH) continue; // وسیله نقلیه/نویز
      distanceM += d;
      if (d > 2.5) {
        // فقط حرکت واقعی در زمانِ متحرک می‌آید
        movingSec += Math.min(dt, 60);
        if (kmh > maxSpeedKmh && dt >= 2) maxSpeedKmh = kmh;
      }
    }
    distanceM = Math.round(distanceM);
    maxSpeedKmh = Math.round(maxSpeedKmh * 10) / 10;
    if (movingSec > durationSec) movingSec = durationSec;

    if (distanceM < 20) {
      return Response.json(
        { error: "مسافت قابل‌قبولی ثبت نشد — با GPS بازتر (آسمان باز) دوباره تلاش کن." },
        { status: 400 }
      );
    }

    const avgMovingKmh = movingSec > 0 ? (distanceM / movingSec) * 3.6 : 0;
    const activityType = detectActivityType(avgMovingKmh);
    const paceSecPerKm =
      avgMovingKmh > 0.5 ? Math.round((movingSec / (distanceM / 1000)) / 5) * 5 : 0;

    // ── کالری با وزن واقعی کاربر ──
    let weightKg = 70;
    try {
      const [lastWeight, profile] = await Promise.all([
        db.weightLog.findFirst({
          where: { userId: user.id },
          orderBy: { loggedAt: "desc" },
          select: { weight: true, loggedAt: true },
        }),
        db.onboardingProfile.findUnique({
          where: { userId: user.id },
          select: { weight: true, weightUpdatedAt: true },
        }),
      ]);
      const resolved = resolveWeightFromInputs({
        profileWeight: profile?.weight,
        profileWeightUpdatedAt: profile?.weightUpdatedAt
          ? new Date(profile.weightUpdatedAt)
          : null,
        lastLogWeight: lastWeight?.weight ?? null,
        lastLogLoggedAt: lastWeight?.loggedAt ? new Date(lastWeight.loggedAt) : null,
      });
      const resolvedW = resolved?.weight;
      if (resolvedW != null && Number.isFinite(resolvedW) && resolvedW >= 25 && resolvedW <= 300) {
        weightKg = resolvedW;
      }
    } catch {
      // وزن ناموجود → پیش‌فرض ۷۰ کیلوگرم
    }
    const avgOverallKmh = (distanceM / Math.max(1, durationSec)) * 3.6;
    const met = metFromSpeed(Math.max(avgOverallKmh, avgMovingKmh * 0.9));
    const calories = Math.max(1, Math.round(met * weightKg * (durationSec / 3600)));

    const steps = Math.round(distanceM / strideMeters(activityType));
    const note = String(body.note || "").slice(0, MAX_NOTE) || null;

    // عکس یادبود — فقط URL معتبرِ همان دستهٔ activity (نام فایل حاوی uid کاربر است)
    let photoUrl: string | null = null;
    const rawPhoto = String(body.photoUrl || "");
    if (rawPhoto.startsWith(`/uploads/activity/activity-${user.id}-`)) {
      photoUrl = rawPhoto;
    }

    const row = await db.activitySession.create({
      data: {
        userId: user.id,
        activityType,
        source: "gps",
        startedAt: new Date(startedAtMs),
        endedAt: new Date(endedAtMs),
        durationSec,
        movingSec,
        distanceM,
        avgSpeedKmh: Math.round(avgMovingKmh * 10) / 10,
        maxSpeedKmh,
        paceSecPerKm,
        calories,
        steps,
        routeJson: JSON.stringify(
          // v138-fix — فرمت فشردهٔ آرایه‌ای [[lat,lng,tSec,acc],…] (نه آبجکت) —
          // کلاینت و GET detail همان فرمت را مصرف می‌کنند
          points.map((p) => [p.lat, p.lng, p.t, p.acc])
        ),
        pointsCount: points.length,
        photoUrl,
        note,
      },
      select: { id: true },
    });

    return Response.json({
      ok: true,
      id: row.id,
      activityType,
      distanceM,
      calories,
      steps,
      avgSpeedKmh: Math.round(avgMovingKmh * 10) / 10,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const cursor = url.searchParams.get("cursor") || null;

    const rows = await db.activitySession.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        activityType: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        movingSec: true,
        distanceM: true,
        avgSpeedKmh: true,
        maxSpeedKmh: true,
        paceSecPerKm: true,
        calories: true,
        steps: true,
        elevationGainM: true,
        pointsCount: true,
        photoUrl: true,
        note: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return Response.json({
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
