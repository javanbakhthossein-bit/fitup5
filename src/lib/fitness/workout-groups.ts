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
