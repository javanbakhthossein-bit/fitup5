/**
 * ─── گروه‌بندی حرکات (سوپرست / تری‌ست / جاینت‌ست) — ماژول مشترک ───
 *
 * قبلاً این توابع داخل workouts-view.tsx (کامپوننت React) زندگی می‌کردند و
 * بقیه‌ی مصرف‌کننده‌ها (gym-mode / programs-view / پلیر تمرین) مجبور بودند
 * از یک فایل view سنگین import کنند. حالا منطق خالص (بدون React) اینجاست:
 *
 *  - workouts-view.tsx فقط re-export می‌کند (سازگاری importهای قبلی)
 *  - active-workout-session.tsx (پلیر) و هر مصرف‌کننده‌ی جدید از همین‌جا
 *
 * قواعد داده (types.ts): حرکت‌های عضو گروه `supersetGroup` (مثلاً "A") و
 * `supersetType` دارند؛ اعضا معمولاً restSec=0 دارند به‌جز عضو آخر که
 * استراحت گروه را حمل می‌کند. برای جاینت‌ست (سیرکویت) `circuitRounds` و
 * `restBetweenRounds` هم ممکن است ست شده باشند.
 */
import type { PlanExercise } from "./types";

export type GroupedExercise =
  | { type: "single"; exercise: PlanExercise }
  | {
      type: "group";
      group: string;
      groupType: "superset" | "triset" | "giant";
      circuitRounds?: number;
      restBetweenRounds?: number;
      exercises: PlanExercise[];
    };

export function groupExercises(exercises: PlanExercise[]): GroupedExercise[] {
  const result: GroupedExercise[] = [];
  const seen = new Set<string>();
  for (const ex of exercises) {
    if (ex.supersetGroup && ex.supersetType) {
      if (seen.has(ex.supersetGroup)) continue; // قبلاً به‌عنوان گروه اضافه شده
      seen.add(ex.supersetGroup);
      const members = exercises.filter((e) => e.supersetGroup === ex.supersetGroup);
      // ─── Fix: اگر گروه فقط ۱ عضو دارد، آن را به‌عنوان تک‌حرکت نمایش بده ───
      // این باگ «سوپرست با ۱ حرکت» را در روز آخر حل می‌کند.
      if (members.length <= 1) {
        result.push({ type: "single", exercise: ex });
        continue;
      }
      const withRounds = members.find((e) => typeof e.circuitRounds === "number");
      const withRest = members.find((e) => typeof e.restBetweenRounds === "number");
      result.push({
        type: "group",
        group: ex.supersetGroup,
        groupType: ex.supersetType,
        circuitRounds: withRounds?.circuitRounds,
        restBetweenRounds: withRest?.restBetweenRounds,
        exercises: members,
      });
    } else {
      result.push({ type: "single", exercise: ex });
    }
  }
  return result;
}

/** برچسب فارسی نوع گروه */
export function groupTypeLabel(t: "superset" | "triset" | "giant"): string {
  if (t === "giant") return "جاینت‌ست";
  if (t === "triset") return "تری‌ست";
  return "سوپرست";
}

/**
 * برچسب عضو گروه برای پلیر: حرف گروه + جایگاه عضو (A1 / A2 / A3 …).
 * خروجی لاتین است — در UI داخل dir="ltr" رندر شود تا «A1» برعکس دیده نشود.
 */
export function groupMemberLabel(group: string, memberIndex: number): string {
  return `${group}${memberIndex + 1}`;
}

/* ═════════════════════════════════════════════════════════════════════
 * v168 — منطق «دور گروه» (درخواست مالک: سوپرست/تری‌ست به‌صورت ست‌جفتی)
 *
 * قبلاً هر عضو گروه کارت کامل خودش را داشت و تیک هر ست جدا بود — مالک:
 * «در حرکات سوپرست و تریست باید اینجوری نوشته بشه: ست اول، پایینش
 * بالاسینه هالتر محل قرار دادن وزنه/تکرار، پایینش پرس سینه دمبل — با پر
 * کردن جفتشون یک تیک زده بشه و بره برای استراحت.»
 * یعنی واحدِ نمایش/تیک در گروه = «دور» (ست N همهٔ اعضا با هم).
 * ═════════════════════════════════════════════════════════════════════ */

type GroupStep = Extract<GroupedExercise, { type: "group" }>;

/** تعداد دورهای یک گام گروهی = بیشینهٔ تعداد ست بین اعضا */
export function groupMaxRounds(step: GroupStep): number {
  return step.exercises.reduce((m, e) => Math.max(m, e.sets?.length ?? 0), 0);
}

/** تعریف ست N برای یک عضو — اعضای با ست کمتر undefined می‌گیرند (سطر «—») */
export function memberSetFor(ex: PlanExercise, setNumber: number): PlanExercise["sets"][number] | undefined {
  return ex.sets?.find((s) => s.setNumber === setNumber);
}

/** استراحتِ پس از اتمام دور N گروه — جاینت‌ست: restBetweenRounds؛ بقیه: restSec
 *  ست N عضو آخر (قرارداد داده: اعضا ۰ دارند و عضو آخر استراحت گروه را حمل می‌کند) */
export function groupRoundRestSec(step: GroupStep, setNumber: number): number {
  if (typeof step.restBetweenRounds === "number" && step.restBetweenRounds > 0) {
    return step.restBetweenRounds;
  }
  const lastMember = step.exercises[step.exercises.length - 1];
  return memberSetFor(lastMember, setNumber)?.restSec ?? 0;
}

/** آیا همهٔ اعضای دارای ست N، ست N شان ثبت شده؟ */
export function isGroupRoundDone(
  step: GroupStep,
  setNumber: number,
  isSetDone: (exId: string, setNumber: number) => boolean
): boolean {
  for (const ex of step.exercises) {
    const setDef = memberSetFor(ex, setNumber);
    if (!setDef) continue; // عضو بدون ست N — در دور نقش ندارد
    if (!isSetDone(ex.id, setNumber)) return false;
  }
  return true;
}
