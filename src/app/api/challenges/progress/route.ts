/**
 * v183 — POST /api/challenges/progress — ثبت پیشرفت چالش
 *
 * اکشن‌ها:
 *  • start          → شروع چالش (upsert ردیف؛ idempotent)
 *  • complete-day   → تکمیل روز N (idempotent — روز تکراری دوباره اضافه نمی‌شود)
 *  • reset          → صفر کردن پیشرفت یک چالش
 *
 * امنیت: slug فقط از دیتای استاتیک جنسیتِ خود کاربر پذیرفته می‌شود
 * (چالش‌های جنسیت مقابل هرگز قابل ثبت نیستند)؛ N در بازهٔ ۱..durationDays.
 */
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { CHALLENGES_MEN } from "@/lib/fitness/challenges-data-men";
import { CHALLENGES_WOMEN } from "@/lib/fitness/challenges-data-women";

export const dynamic = "force-dynamic";

function durationOf(slug: string): number {
  const all = [...CHALLENGES_MEN, ...CHALLENGES_WOMEN];
  return all.find((c) => c.slug === slug)?.durationDays ?? 0;
}

function genderOf(slug: string): "men" | "women" | null {
  if (CHALLENGES_MEN.some((c) => c.slug === slug)) return "men";
  if (CHALLENGES_WOMEN.some((c) => c.slug === slug)) return "women";
  return null;
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => null);
    const slug = typeof body?.slug === "string" ? body.slug : "";
    const action = typeof body?.action === "string" ? body.action : "";
    const day = Number(body?.day);

    const dur = durationOf(slug);
    if (!dur) {
      return Response.json({ error: "چالش یافت نشد." }, { status: 400 });
    }
    // تفکیک جنسیتی سفت — چالش جنسیت مقابل اصلاً قابل ثبت نیست
    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
      select: { gender: true },
    });
    const userGender = profile?.gender === "female" ? "women" : "men";
    if (genderOf(slug) !== userGender) {
      return Response.json({ error: "این چالش برای جنسیت شما فعال نیست." }, { status: 403 });
    }

    const existing = await db.challengeProgress.findUnique({
      where: { userId_challengeSlug: { userId: user.id, challengeSlug: slug } },
    });

    if (action === "start") {
      const row = await db.challengeProgress.upsert({
        where: { userId_challengeSlug: { userId: user.id, challengeSlug: slug } },
        create: { userId: user.id, challengeSlug: slug, currentDay: 1 },
        update: {},
      });
      return Response.json({ ok: true, progress: serialize(row) });
    }

    if (action === "complete-day") {
      if (!Number.isInteger(day) || day < 1 || day > dur) {
        return Response.json({ error: "شمارهٔ روز نامعتبر است." }, { status: 400 });
      }
      const prev = existing
        ? safeDays(existing.completedDays)
        : [];
      const days = prev.includes(day) ? prev : [...prev, day].sort((a, b) => a - b);
      const completed = days.length >= dur;
      const row = await db.challengeProgress.upsert({
        where: { userId_challengeSlug: { userId: user.id, challengeSlug: slug } },
        create: {
          userId: user.id,
          challengeSlug: slug,
          completedDays: JSON.stringify(days),
          currentDay: Math.min(dur, day + 1),
          lastCompletedAt: new Date(),
          completedAt: completed ? new Date() : null,
        },
        update: {
          completedDays: JSON.stringify(days),
          currentDay: completed ? dur : Math.max(existing?.currentDay ?? 1, Math.min(dur, day + 1)),
          lastCompletedAt: new Date(),
          completedAt: completed ? (existing?.completedAt ?? new Date()) : existing?.completedAt ?? null,
        },
      });
      return Response.json({ ok: true, progress: serialize(row), justCompleted: completed && !existing?.completedAt });
    }

    if (action === "reset") {
      const row = await db.challengeProgress.upsert({
        where: { userId_challengeSlug: { userId: user.id, challengeSlug: slug } },
        create: { userId: user.id, challengeSlug: slug, currentDay: 1 },
        update: { completedDays: "[]", currentDay: 1, lastCompletedAt: null, completedAt: null },
      });
      return Response.json({ ok: true, progress: serialize(row) });
    }

    return Response.json({ error: "اکشن نامعتبر است." }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}

function safeDays(raw: string): number[] {
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
  } catch {
    return [];
  }
}

function serialize(row: {
  challengeSlug: string;
  completedDays: string;
  currentDay: number;
  startedAt: Date;
  lastCompletedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    slug: row.challengeSlug,
    completedDays: safeDays(row.completedDays),
    currentDay: row.currentDay,
    startedAt: row.startedAt.toISOString(),
    lastCompletedAt: row.lastCompletedAt ? row.lastCompletedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
