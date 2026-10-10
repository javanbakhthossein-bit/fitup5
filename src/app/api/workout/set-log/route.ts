/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  v215 — POST /api/workout/set-log — سینک ماندگار ست‌های تمرینی
 * ═══════════════════════════════════════════════════════════════════════════
 *  دیرکتیو مالک: «تمام تمرینات و وزنه‌هایی که کاربر ثبت می‌کنه در برنامه‌های
 *  بعدی خیلی ریز وارد بشه تا هوش مصنوعی فیتاپ دقیق بدونه چیکار باید بکنه».
 *
 *  تا v215 وزنهٔ هر ست فقط در localStorage (با نگه‌داری فقط ۳ روز) می‌ماند و
 *  «پیشرفت قدرتی هر حرکت» برای AI پرونده‌ساز غیرقابل‌محاسبه بود. حالا store
 *  مشترک تمرین‌امروز/حالت‌باشگاه پس از هر ثبت، همین‌جا batch-upsert بی‌صدای
 *  می‌زند (idempotent — کلید یکتای userId+dateKey+exerciseId+setNumber).
 *
 *  نام نمایشی حرکت سمت سرور از برنامهٔ فعالِ کاربر resolve می‌شود تا پروندهٔ
 *  ورزشی (buildSportsProfileContext) «اسکوات: ۶۰kg → ۸۰kg» ببیند نه شناسهٔ خام.
 *  گاردها: requireAuth، سقف ۱۲۰ ردیف/درخواست، فیلد whitelist، بدون هیچ throw
 *  به کلاینت (سینک کمکی است — شکستش هرگز تجربهٔ کاربر را نمی‌شکند).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

const MAX_ROWS = 120;
const MAX_STR = 120;

interface SetLogEntry {
  exerciseId?: unknown;
  setNumber?: unknown;
  done?: unknown;
  weight?: unknown;
  reps?: unknown;
}

interface SetLogBody {
  dayKey?: unknown;
  entries?: unknown;
}

/** پارس امن عدد اعشاری وزنه ("80" یا "80.5" یا "80,5") */
function parseWeightKg(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 500) return Math.round(v * 100) / 100;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").trim());
    if (Number.isFinite(n) && n >= 0 && n <= 500) return Math.round(n * 100) / 100;
  }
  return null;
}

function parseReps(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 200) return Math.round(v);
  if (typeof v === "string") {
    // "10-12" → 12 (بالای بازه به‌عنوان بهترین رکورد ثبت می‌شود)
    const range = v.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const hi = Number(range[2]);
      if (hi >= 0 && hi <= 200) return hi;
    }
    const n = Number(v.trim());
    if (Number.isFinite(n) && n >= 0 && n <= 200) return Math.round(n);
  }
  return null;
}

/** map شناسهٔ حرکت → نام نمایشی، از آخرین برنامهٔ فعال کاربر (فال‌بک: آخرین برنامه) */
async function buildExerciseNameMap(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const plan = (await db.workoutPlan.findFirst({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    })) ?? (await db.workoutPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }));
    if (!plan?.content) return map;
    const parsed = JSON.parse(plan.content) as {
      days?: Array<{ exercises?: Array<{ id?: string; name?: string }> }>;
    };
    for (const day of parsed.days ?? []) {
      for (const ex of day.exercises ?? []) {
        if (ex?.id && ex?.name && typeof ex.name === "string") {
          map.set(ex.id, ex.name.slice(0, MAX_STR));
        }
      }
    }
  } catch (e) {
    console.warn("[set-log] exercise name map resolve failed (non-fatal):", e);
  }
  return map;
}

export async function POST(req: NextRequest) {
  try {
    let userId: string;
    try {
      const user = await requireAuth();
      userId = user.id;
    } catch {
      return Response.json({ error: "ابتدا وارد حساب خود شوید." }, { status: 401 });
    }

    let body: SetLogBody;
    try {
      body = (await req.json()) as SetLogBody;
    } catch {
      return Response.json({ error: "بدنهٔ درخواست نامعتبر است." }, { status: 400 });
    }

    // dayKey شکل "YYYY-MM-DD|شنبه" (کلید مشترک دو نما — dayLogKey در set-log-store)
    const dayKey = typeof body.dayKey === "string" ? body.dayKey.trim() : "";
    const [dateKey, dayName = ""] = dayKey.split("|");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? "")) {
      return Response.json({ error: "کلید روز نامعتبر است." }, { status: 400 });
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return Response.json({ error: "هیچ ردیفی ارسال نشده است." }, { status: 400 });
    }
    if (body.entries.length > MAX_ROWS) {
      return Response.json({ error: "تعداد ردیف‌ها بیش از حد مجاز است." }, { status: 413 });
    }

    const nameMap = await buildExerciseNameMap(userId);
    const now = new Date();

    const rows: Array<{
      userId: string;
      dateKey: string;
      dayName: string;
      exerciseId: string;
      exerciseName: string | null;
      setNumber: number;
      done: boolean;
      weightKg: number | null;
      reps: number | null;
      source: string;
      updatedAt: Date;
    }> = [];
    for (const raw of body.entries as SetLogEntry[]) {
      if (!raw || typeof raw !== "object") continue;
      const exerciseId = typeof raw.exerciseId === "string" ? raw.exerciseId.trim().slice(0, MAX_STR) : "";
      const setNumber = typeof raw.setNumber === "number" && Number.isFinite(raw.setNumber)
        ? Math.min(20, Math.max(1, Math.round(raw.setNumber)))
        : 0;
      if (!exerciseId || setNumber < 1) continue;
      rows.push({
        userId,
        dateKey,
        dayName: dayName.slice(0, MAX_STR),
        exerciseId,
        exerciseName: nameMap.get(exerciseId) ?? null,
        setNumber,
        done: raw.done === true,
        weightKg: parseWeightKg(raw.weight),
        reps: parseReps(raw.reps),
        source: "sync",
        updatedAt: now,
      });
    }
    if (rows.length === 0) {
      return Response.json({ error: "ردیف معتبری یافت نشد." }, { status: 400 });
    }

    // upsert دسته‌ای — یک تراکنش، بدون شکست وسط راه
    await db.$transaction(
      rows.map((r) =>
        db.workoutSetLog.upsert({
          where: {
            userId_dateKey_exerciseId_setNumber: {
              userId: r.userId,
              dateKey: r.dateKey,
              exerciseId: r.exerciseId,
              setNumber: r.setNumber,
            },
          },
          create: r,
          update: {
            dayName: r.dayName,
            exerciseName: r.exerciseName,
            done: r.done,
            weightKg: r.weightKg,
            reps: r.reps,
            updatedAt: r.updatedAt,
          },
        })
      )
    );

    return Response.json({ ok: true, saved: rows.length });
  } catch (e) {
    console.error("[set-log] sync failed:", e);
    // سینک کمکی است — شکستش بی‌صدا اما لاگ‌شده؛ کلاینت خودش تکرار می‌کند
    return apiError(e);
  }
}

/** GET — شمارش برای دیباگ/تست */
export async function GET() {
  try {
    let userId: string;
    try {
      const user = await requireAuth();
      userId = user.id;
    } catch {
      return Response.json({ error: "ابتدا وارد حساب خود شوید." }, { status: 401 });
    }
    const count = await db.workoutSetLog.count({ where: { userId } });
    return Response.json({ ok: true, total: count });
  } catch (e) {
    return apiError(e);
  }
}
