import { toPersianDigits } from "@/lib/fitness/types";

/**
 * زنجیرهٔ سخت‌گیرانهٔ مراحل پیش‌نیاز ساخت برنامه (درخواست مالک — Task 3-a)
 *
 * ─── ترتیب رسمی (پلن حرفه‌ای / Ultimate) ───
 *   مرحلهٔ ۱: تحلیل آزمایش خون        (آپلود یا تعیین تکلیف — ردِ رسمی هم «تعیین تکلیف» است)
 *   مرحلهٔ ۲: آنالیز ویدیوی فرم بدن    (آپلود یا «آپلود نمی‌کنم»)
 *   مرحلهٔ ۳: ارسال عکس بدن            (الزامی — با ارسال، تولید برنامه شروع می‌شود)
 *   پایان:   ساخت برنامه               (فقط بعد از تعیین تکلیف هر سه مرحله به‌ترتیب)
 *
 * قاعدهٔ سخت‌گیرانهٔ مالک: «اول باید تحلیل آزمایش خون فعال باشه و کارت‌های بعدی
 * خاموش و کار نکنن» — یعنی هر مرحلهٔ شماره‌دار تا وقتی مرحلهٔ «تعیین‌تکلیف‌نشده‌ای»
 * قبل از آن وجود دارد، قفل است؛ صرف‌نظر از الزامی/اختیاری بودنِ خودِ آپلود.
 *
 * این ماژول «خالص» است (بدون import دیتابیس) تا هم سرور (prerequisites.ts) و
 * هم کلاینت (بنر پیش‌نیازها + گرید امکانات داشبورد) و هم تست‌ها از یک
 * منبعِ حقیقت واحد استفاده کنند.
 */

export type PrerequisiteStatus =
  | "completed"
  | "pending"
  | "pending_decision"
  | "incomplete";

/** ترتیب رسمی مراحل پلن حرفه‌ای — ۱ خون، ۲ ویدیو، ۳ عکس بدن */
export const PREREQ_SEQUENCE: { type: string; step: number }[] = [
  { type: "blood_test", step: 1 },
  { type: "video_body", step: 2 },
  { type: "body_photo", step: 3 },
];

/** نام فارسی مراحل — برای توست‌ها و پیام‌ها (عبارت مالک: «تحلیل آزمایش خون») */
const SEQUENCE_STEP_LABELS: Record<string, string> = {
  blood_test: "تحلیل آزمایش خون",
  video_body: "آنالیز ویدیوی فرم بدن",
  body_photo: "ارسال عکس بدن",
};

export function sequenceStepLabel(type: string): string {
  return SEQUENCE_STEP_LABELS[type] ?? type;
}

/** شکل حداقلیِ یک مرحله — هم از سرور (Prerequisite) و هم از تست‌ها پر می‌شود */
export interface PrereqSequenceStep {
  type: string;
  step: number | null;
  status: string;
}

/** نتیجهٔ بلاک: شمارهٔ مرحلهٔ بلاک‌کننده + نوع آن (برای متن توست) */
export interface SequenceBlocker {
  step: number;
  type: string;
}

/**
 * نگاشت وضعیت خام «آزمایش خون» به وضعیت مرحله.
 * تعیین تکلیف شده (completed) = تحلیل در چرخهٔ جاری وجود دارد، یا کاربر
 * «آپلود نمی‌کنم» (declined) زده، یا «منتظر جوابم» (waiting/pending) است.
 * در غیر این صورت هنوز تصمیم نگرفته → pending_decision.
 */
export function resolveBloodStepStatus(
  bloodTestStatus: string | null | undefined,
  hasCycleAnalysis: boolean
): PrerequisiteStatus {
  if (hasCycleAnalysis) return "completed";
  if (bloodTestStatus === "declined") return "completed";
  if (bloodTestStatus === "waiting" || bloodTestStatus === "pending_blood_test") return "completed";
  return "pending_decision";
}

/**
 * نگاشت وضعیت خام «ویدیو» به وضعیت مرحله.
 * تعیین تکلیف شده (completed) = ویدیو آپلود شده (یا تحلیل چرخهٔ جاری وجود دارد)
 * یا کاربر رسماً «آپلود نمی‌کنم» (skipped) را انتخاب کرده است.
 */
export function resolveVideoStepStatus(
  videoStatus: string | null | undefined,
  hasCycleAnalysis: boolean
): PrerequisiteStatus {
  if (videoStatus === "uploaded" || hasCycleAnalysis) return "completed";
  if (videoStatus === "skipped") return "completed";
  return "pending_decision";
}

/**
 * ❤️ قلب زنجیرهٔ سخت‌گیرانه — برای مرحلهٔ جاری، اولین مرحلهٔ «تعیین‌تکلیف‌نشدهٔ»
 * قبل از آن را برمی‌گرداند (کوچک‌ترین شمارهٔ مرحله با status !== "completed").
 *
 * نکتهٔ فیکس (Task 3-a): قبلاً در بنر داشبورد فقط مراحل «required» بلاک‌کننده
 * بودند — چون خون/ویدیو `required:false` دارند (آپلودشان اختیاری است)، زنجیره
 * عملاً مرده بود و کارت‌های بعدی همیشه باز بودند. قاعدهٔ درست: هر مرحلهٔ
 * شماره‌دارِ تعیین‌تکلیف‌نشده بلاک‌کننده است (تعیین تکلیف = آپلود یا رد رسمی).
 *
 * مراحل بدون شماره (عکس بدنِ پلن پیشرفته، اندازه‌های بدنی) هرگز بلاک‌کننده
 * نیستند — زنجیره فقط بین مراحل شماره‌دار پلن حرفه‌ای معنا دارد.
 */
export function getSequenceBlocker(
  steps: PrereqSequenceStep[],
  currentType: string
): SequenceBlocker | null {
  const current = steps.find((s) => s.type === currentType);
  if (!current || current.step == null) return null;
  const blocker = steps
    .filter(
      (s) =>
        s.step != null &&
        (s.step as number) < (current.step as number) &&
        s.type !== currentType &&
        s.status !== "completed"
    )
    .sort((a, b) => (a.step as number) - (b.step as number))[0];
  return blocker ? { step: blocker.step as number, type: blocker.type } : null;
}

/**
 * آیا می‌توان برنامه ساخت؟ — دقیقاً معادل فرمول قدیمی
 * (allRequiredCompleted && allOptionalDecided) اما از یک منبع واحد:
 *  ۱. هیچ مرحلهٔ شماره‌داری تعیین تکلیف نشده نمانده باشد (خون/ویدیو/عکس)
 *  ۲. هیچ مورد الزامیِ بدون‌شماره (عکس بدنِ پلن پیشرفته) ناقص نمانده باشد
 * اندازه‌های بدنی (تشویقی) نادیده گرفته می‌شود.
 */
export function computeCanGenerateProgram(steps: PrereqSequenceStep[]): boolean {
  const numberedUndecided = steps.some(
    (s) => s.step != null && s.status !== "completed"
  );
  const requiredUnnumberedUndecided = steps.some(
    (s) => s.step == null && s.type === "body_photo" && s.status !== "completed"
  );
  return !numberedUndecided && !requiredUnnumberedUndecided;
}

/**
 * دلیل بلاک بودن تولید برنامه — به «ترتیب مراحل» (اول خون، بعد ویدیو، بعد عکس).
 * فیکس Task 3-a: قبلاً پیام ابتدا «ارسال عکس بدن» را می‌گفت (چون required بود)
 * در حالی که طبق دیرکتیو مالک مرحلهٔ اول آزمایش خون است.
 */
export function buildBlockingReason(steps: PrereqSequenceStep[]): string | null {
  const undecidedNumbered = steps
    .filter((s) => s.step != null && s.status !== "completed")
    .sort((a, b) => (a.step as number) - (b.step as number));

  if (undecidedNumbered.length > 0) {
    const first = undecidedNumbered[0];
    let msg =
      `برای ساخت برنامه، ابتدا باید مرحلهٔ ${toPersianDigits(first.step as number)} ` +
      `(${sequenceStepLabel(first.type)}) را تعیین تکلیف کنید (آپلود یا «آپلود نمی‌کنم»).`;
    const rest = undecidedNumbered.slice(1);
    if (rest.length > 0) {
      msg +=
        " سپس " +
        rest
          .map(
            (r) =>
              `مرحلهٔ ${toPersianDigits(r.step as number)} (${sequenceStepLabel(r.type)})`
          )
          .join(" و ") +
        ".";
    }
    return msg;
  }

  // پلن پیشرفته: عکس بدن بدون شمارهٔ مرحله — تنها پیش‌نیاز
  const photoUnnumbered = steps.find(
    (s) => s.step == null && s.type === "body_photo" && s.status !== "completed"
  );
  if (photoUnnumbered) {
    return "برای ساخت برنامه، ابتدا باید ارسال عکس بدن و ساخت برنامه را تکمیل کنید.";
  }
  return null;
}
