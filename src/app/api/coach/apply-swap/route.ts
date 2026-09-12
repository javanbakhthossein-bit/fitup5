import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

// ═══════════════════════════════════════════════════════════════
//  POST /api/coach/apply-swap — v73.4 (دیریکتیو مالک)
//
//  اعمال واقعی جایگزینی حرکت/غذا که کاربر در گفت‌وگو با «فیتاپ هوشمند»
//  پیشنهاد گرفته و با دکمهٔ «✓ اعمال این جایگزینی در برنامهٔ من» تأیید کرده.
//
//  پروتکل هم‌ادغام با smart-coach-chat-view (پارس [APPLY_SWAP …]):
//    body: { type: "exercise" | "food", from: string, to: string, day?: string }
//    خروجی: { applied: n } (n = تعداد موارد عوض‌شده) یا ۴۰۴ دوستانه
//    «برنامهٔ فعلی یافت نشد».
//
//  قواعد مالک:
//   - بدون سقف تعداد (کاربر هر چند بار بخواهد می‌تواند جایگزین کند)
//   - فقط ردیف برنامهٔ «فعال» کاربر تغییر می‌کند — ساخت پلن/زمان دست‌نخورده
//   - اگر همکار دیگری فیلدی به types اضافه کرد، این route به آن دست نمی‌زند
//     (فیلدهای نامعلوم content JSON عیناً حفظ می‌شوند — فقط name/tips عوض می‌شود)
// ═══════════════════════════════════════════════════════════════

/** سقف طول هر مقدار ورودی (دیریکتیو مالک: سقف ۱۲۰ کاراکتر) */
const SWAP_MAX_CHARS = 120;
/** حداقل طول from — جلوگیری از تطبیق includes با رشتهٔ ۱ حرفی روی کل برنامه */
const SWAP_MIN_FROM_CHARS = 2;

/** پیام خطای ۴۰۴ دوستانه (دیریکتیو مالک: «برنامهٔ فعلی یافت نشد») */
const PLAN_NOT_FOUND_MESSAGE = "برنامهٔ فعلی یافت نشد. اول از صفحهٔ برنامه‌ها یک برنامه بساز.";
/** پیام ۲۰۰ با applied=0 — مورد در برنامه پیدا نشد (شاید قبلاً جایگزین شده) */
const NO_MATCH_MESSAGE = "این مورد در برنامهٔ فعلیت پیدا نشد — شاید قبلاً جایگزین شده باشد.";
/** یادداشتی که روی حرکت جایگزین‌شده ثبت می‌شود */
const SWAP_NOTE_FA = "🔁 جایگزین‌شده با تأیید شما";

/**
 * پاک‌سازی ورودی (دیریکتیو مالک: trim، سقف ۱۲۰ کاراکتر، حذف کاراکترهای خطرناک).
 * مقصد نهایی مقدار، فیلد name داخل JSON برنامه است — کاراکترهای کنترلی/ساختاری
 * (quotation/braces/brackets/backslash و …) حذف می‌شوند تا JSON سالم بماند.
 */
function sanitizeSwapText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFC").trim();
  // کنترل‌کاراکترها (شامل newline/tab — نام حرکت/غذا تک‌خطی است)
  s = s.replace(/[\u0000-\u001F\u007F]/g, "");
  // کاراکترهای خطرناک برای JSON/HTML/regex
  s = s.replace(/[<>"'`\\{}[\]]/g, "");
  // فاصله‌های تودرتو → تک‌فاصله
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > SWAP_MAX_CHARS) {
    s = s.slice(0, SWAP_MAX_CHARS).trimEnd();
  }
  return s;
}

/**
 * پارس امن JSON محتوای برنامه از DB (هم‌الگوی بقیهٔ routeها) —
 * ردیف خراب نباید کل مسیر را با ۵۰۰ بکشد.
 */
function safeParsePlanContent(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** تطبیق نام: برابر (بدون حساسیت به حروف بزرگ/کوچک) یا شامل‌بودن */
function nameMatches(name: string, normalizedFrom: string): boolean {
  const n = name.trim().toLowerCase();
  return n === normalizedFrom || n.includes(normalizedFrom);
}

export async function POST(req: NextRequest) {
  try {
    // گیت پلن (requireAuth داخل همان انجام می‌شود) — برنامه تمرین+تغذیه
    // برای همهٔ پلن‌ها باز است؛ بدون سقف تعداد (دستور صریح مالک)
    const { userId } = await requirePlanCapability("workoutAndNutritionPlan");

    // محدودیت نرخ ملایم — محافظت ضد سوءاستفاده، بدون سقف کل
    const rl = rateLimit(`apply-swap:${userId}`, 30, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
    }

    const type: "exercise" | "food" | null =
      body.type === "exercise" || body.type === "food" ? body.type : null;
    const from = sanitizeSwapText(body.from);
    const to = sanitizeSwapText(body.to);
    const day = sanitizeSwapText(body.day);

    if (!type) {
      return Response.json(
        { error: "نوع جایگزینی نامعتبر است (exercise یا food)." },
        { status: 400 }
      );
    }
    if (from.length < SWAP_MIN_FROM_CHARS) {
      return Response.json(
        { error: "نام حرکت/غذای فعلی خیلی کوتاه یا نامعتبر است." },
        { status: 400 }
      );
    }
    if (!to) {
      return Response.json(
        { error: "نام جایگزین خالی است." },
        { status: 400 }
      );
    }

    const normalizedFrom = from.toLowerCase();
    // day اختیاری است — فقط وقتی واقعاً با روزی در برنامه تطبیق داشته باشد
    // فیلتر می‌شود (وگرنه جایگزینی روی «کل برنامه» اعمال می‌شود تا هرگز
    // به‌خاطر نوشتار متفاوتِ روز، بی‌اثر نماند — دیریکتیو: اعمال در کل برنامه)
    const normalizedDay = day ? day.toLowerCase() : null;

    // ═══════════════════════════════════════════════════════
    //  حرکت — WorkoutPlan فعال → days[].exercises[] که name شامل/برابر from
    // ═══════════════════════════════════════════════════════
    if (type === "exercise") {
      const plan = await db.workoutPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
      });
      if (!plan) {
        return Response.json({ error: PLAN_NOT_FOUND_MESSAGE }, { status: 404 });
      }
      const content = safeParsePlanContent(plan.content);
      if (!content || !Array.isArray(content.days)) {
        return Response.json({ error: PLAN_NOT_FOUND_MESSAGE }, { status: 404 });
      }

      const days = content.days as Record<string, unknown>[];
      const dayFilterApplies = normalizedDay
        ? days.some(
            (d) =>
              d &&
              typeof d === "object" &&
              typeof (d as Record<string, unknown>).day === "string" &&
              String((d as Record<string, unknown>).day).trim().toLowerCase() === normalizedDay
          )
        : false;

      let applied = 0;
      for (const d of days) {
        if (!d || typeof d !== "object") continue;
        const dayObj = d as Record<string, unknown>;
        if (
          dayFilterApplies &&
          (typeof dayObj.day !== "string" ||
            dayObj.day.trim().toLowerCase() !== normalizedDay)
        ) {
          continue;
        }
        if (!Array.isArray(dayObj.exercises)) continue;
        for (const ex of dayObj.exercises) {
          if (!ex || typeof ex !== "object") continue;
          const exercise = ex as Record<string, unknown>;
          if (typeof exercise.name !== "string") continue;
          if (!nameMatches(exercise.name, normalizedFrom)) continue;
          // name=to — sets/reps/restSec/description و بقیهٔ فیلدها حفظ می‌شوند
          exercise.name = to;
          // یادداشت «جایگزین‌شده با تأیید شما» — در tips (در UI تمرین رندر می‌شود)
          exercise.tips =
            typeof exercise.tips === "string" && exercise.tips.trim()
              ? `${exercise.tips.trim()} — ${SWAP_NOTE_FA}`
              : SWAP_NOTE_FA;
          applied++;
        }
      }

      if (applied > 0) {
        // فقط همان ردیف فعال آپدیت می‌شود (ردیف‌های دیگر/غیرفعال دست‌نخورده)
        await db.workoutPlan.update({
          where: { id: plan.id },
          data: { content: JSON.stringify(content) },
        });
      }
      return Response.json({
        applied,
        ...(applied === 0 ? { message: NO_MATCH_MESSAGE } : {}),
      });
    }

    // ═══════════════════════════════════════════════════════
    //  غذا — MealPlan فعال → meals[].items[] که name مطابق from
    // ═══════════════════════════════════════════════════════
    const mealPlanRow = await db.mealPlan.findFirst({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!mealPlanRow) {
      return Response.json({ error: PLAN_NOT_FOUND_MESSAGE }, { status: 404 });
    }
    const mealContent = safeParsePlanContent(mealPlanRow.content);
    if (!mealContent || !Array.isArray(mealContent.meals)) {
      return Response.json({ error: PLAN_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const meals = mealContent.meals as Record<string, unknown>[];
    let applied = 0;
    for (const mealObj of meals) {
      if (!mealObj || typeof mealObj !== "object") continue;
      const meal = mealObj as Record<string, unknown>;
      if (!Array.isArray(meal.items)) continue;
      for (const itemObj of meal.items) {
        if (!itemObj || typeof itemObj !== "object") continue;
        const item = itemObj as Record<string, unknown>;
        if (typeof item.name !== "string") continue;
        if (!nameMatches(item.name, normalizedFrom)) continue;
        // name=to — servingSize و بقیهٔ فیلدها (کالری/درشت‌مغذی/…) حفظ می‌شوند
        item.name = to;
        applied++;
      }
    }

    if (applied > 0) {
      await db.mealPlan.update({
        where: { id: mealPlanRow.id },
        data: { content: JSON.stringify(mealContent) },
      });
    }
    return Response.json({
      applied,
      ...(applied === 0 ? { message: NO_MATCH_MESSAGE } : {}),
    });
  } catch (e) {
    return apiError(e);
  }
}
