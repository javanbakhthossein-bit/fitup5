import { db } from "@/lib/db";
import type { Plan } from "@/lib/fitness/types";

/**
 * سیستمی برای بررسی پیش‌نیازهای ساخت برنامه بر اساس پلن کاربر.
 *
 * ─── ترتیب جدید (درخواست مالک) ───
 *
 * پلن حرفه‌ای (Ultimate) — ۳ مرحله شماره‌دار:
 *   ۱. آزمایش خون (اختیاری — اما باید تعیین تکلیف شود)
 *   ۲. آنالیز ویدیویی فرم حرکات (اختیاری — اما باید تعیین تکلیف شود)
 *   ۳. ارسال عکس بدن و ساخت برنامه (الزامی — با ارسال عکس، تولید برنامه شروع می‌شود)
 *
 * پلن پیشرفته (Advanced):
 *   - فقط ارسال عکس بدن (الزامی) — بدون شماره‌گذاری مرحله
 *
 * همه پلن‌ها: اندازه‌های بدنی (تشویقی، نه الزامی — در بنر داشبورد نمایش داده نمی‌شود)
 *
 * وضعیت‌های ممکن هر پیش‌نیاز:
 * - "completed": تکمیل شده (آپلود شده یا تعیین تکلیف/رد شده) → تیک می‌خورد
 * - "pending": در انتظار (مثلاً کاربر آزمایش داده و منتظر نتایج است) → تیک می‌خورد (تعیین تکلیف شده)
 * - "pending_decision": تعیین تکلیف نشده — کاربر باید تصمیم بگیرد
 * - "incomplete": هنوز انجام نشده (برای موارد الزامی مثل عکس بدن)
 */

export type PrerequisiteStatus =
  | "completed"
  | "pending"
  | "pending_decision"
  | "incomplete";

export interface Prerequisite {
  id: string;
  /** نوع پیش‌نیاز: body_photo | video_body | blood_test | body_measurements */
  type: "body_photo" | "video_body" | "blood_test" | "body_measurements";
  /** شماره مرحله (فقط پلن حرفه‌ای: ۱=آزمایش خون، ۲=آنالیز ویدیویی، ۳=عکس بدن) — برای پلن پیشرفته null (بدون شماره) */
  step: number | null;
  label: string;
  description: string;
  /** آیا این پیش‌نیاز برای ساخت برنامه الزامی است؟ */
  required: boolean;
  /** وضعیت فعلی پیش‌نیاز */
  status: PrerequisiteStatus;
  /** متن فارسی وضعیت فعلی */
  statusLabel: string;
  /** تب مربوط به این پیش‌نیاز (برای دکمه "شروع" یا "تعیین تکلیف") */
  tab: string;
  /** دکمه‌ای که باید نمایش داده شود */
  actionLabel: string;
}

export interface PrerequisiteCheckResult {
  /** لیست همه پیش‌نیازها (برای نمایش دانه‌دانه) */
  prerequisites: Prerequisite[];
  /** آیا همه پیش‌نیازهای الزامی تکمیل شده‌اند؟ */
  allRequiredCompleted: boolean;
  /** آیا همه پیش‌نیازهای اختیاری تعیین تکلیف شده‌اند؟ */
  allOptionalDecided: boolean;
  /** آیا می‌توان برنامه ساخت؟ */
  canGenerateProgram: boolean;
  /** پیام خطا (در صورت عدم امکان ساخت برنامه) */
  blockingReason: string | null;
}

/**
 * بررسی وضعیت پیش‌نیازهای کاربر برای ساخت برنامه.
 *
 * @param userId آیدی کاربر
 * @param planName نام پلن فعال کاربر
 */
export async function checkPrerequisites(
  userId: string,
  planName: Plan | null
): Promise<PrerequisiteCheckResult> {
  const userPlan = planName ?? null;
  const needsBodyPhoto = userPlan === "advanced" || userPlan === "ultimate";
  const isUltimate = userPlan === "ultimate";

  const prerequisites: Prerequisite[] = [];

  // ─── مرحله ۱. آزمایش خون (اختیاری برای ultimate — باید تعیین تکلیف شود) ───
  // شماره ۱ — اولین قدم: کاربر به ماژول آزمایش خون می‌رود، آپلود می‌کند،
  // «آزمایش دادم و منتظر جوابم» می‌زند یا رد می‌کند. با هر تصمیم، تیک می‌خورد.
  if (isUltimate) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bloodTestStatus: true },
    });
    const bloodTestStatus = user?.bloodTestStatus ?? null;
    const bloodTestAnalysis = await db.analysisResult.findFirst({
      where: { userId, type: "blood_test" },
      orderBy: { createdAt: "desc" },
    });

    let status: PrerequisiteStatus = "pending_decision";
    let statusLabel = "در انتظار تعیین تکلیف — آپلود یا رد کنید";

    if (bloodTestAnalysis) {
      status = "completed";
      statusLabel = "آپلود و آنالیز شد ✓";
    } else if (bloodTestStatus === "declined") {
      status = "completed";
      statusLabel = "تعیین تکلیف شد (رد شد) ✓";
    } else if (bloodTestStatus === "waiting" || bloodTestStatus === "pending_blood_test") {
      status = "completed";
      statusLabel = "تعیین تکلیف شد — در انتظار نتایج ⏳";
    }

    prerequisites.push({
      id: "blood_test",
      type: "blood_test",
      step: 1,
      label: "آزمایش خون (اختیاری)",
      description:
        "برای داشتن یک برنامه کاملاً شخصی‌سازی‌شده، آزمایش خون خود را آپلود کنید. اختیاری است اما باید تعیین تکلیف شود (آپلود، «آزمایش دادم و منتظر جوابم»، یا «آپلود نمی‌کنم»).",
      required: false, // خودش اختیاری است، اما تعیین تکلیفش الزامی است
      status,
      statusLabel,
      tab: "dashboard",
      actionLabel: status === "completed" ? "تکمیل شد ✓" : "شروع",
    });
  }

  // ─── مرحله ۲. آنالیز ویدیویی فرم حرکات (اختیاری برای ultimate — باید تعیین تکلیف شود) ───
  // شماره ۲ — مرحله دوم: کاربر ویدیوی فرم حرکات را آپلود یا رد می‌کند. با هر تصمیم، تیک می‌خورد.
  if (isUltimate) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { videoStatus: true },
    });
    const videoStatus = user?.videoStatus ?? null;
    // اگر تحلیل ویدیو در AnalysisResult موجود باشد، یعنی کاربر قبلاً ویدیو آپلود کرده
    const videoAnalysis = await db.analysisResult.findFirst({
      where: { userId, type: "video_analysis" },
      orderBy: { createdAt: "desc" },
    });

    let status: PrerequisiteStatus = "pending_decision";
    let statusLabel = "در انتظار تعیین تکلیف — آپلود یا رد کنید";

    if (videoStatus === "uploaded" || videoAnalysis) {
      status = "completed";
      statusLabel = "آپلود و آنالیز شد ✓";
    } else if (videoStatus === "skipped") {
      status = "completed";
      statusLabel = "تعیین تکلیف شد (رد شد) ✓";
    }

    prerequisites.push({
      id: "video_body",
      type: "video_body",
      step: 2,
      label: "آنالیز ویدیویی فرم حرکات (اختیاری)",
      description:
        "برای دقت بالاتر در اصلاح فرم حرکات، ویدیوی تمرین خود را ارسال کنید. اختیاری است اما باید تعیین تکلیف شود (آپلود یا «آپلود نمی‌کنم»).",
      required: false, // خودش اختیاری است، اما تعیین تکلیفش الزامی است
      status,
      statusLabel,
      tab: "dashboard",
      actionLabel: status === "completed" ? "تکمیل شد ✓" : "شروع",
    });
  }

  // ─── مرحله ۳. ارسال عکس بدن و ساخت برنامه (الزامی برای advanced/ultimate) ───
  // شماره ۳ فقط برای ultimate (مرحله پایانی) — برای advanced بدون شماره (تنها پیش‌نیاز).
  // با ارسال عکس بدن، اگر همه مراحل قبلی تعیین تکلیف شده باشند، تولید برنامه شروع می‌شود.
  if (needsBodyPhoto) {
    const progressPhoto = await db.progressPhoto.findFirst({
      where: { userId },
      orderBy: { takenAt: "desc" },
    });
    const hasBodyPhoto = !!progressPhoto;

    prerequisites.push({
      id: "body_photo",
      type: "body_photo",
      step: isUltimate ? 3 : null,
      label: "ارسال عکس بدن و ساخت برنامه",
      description: isUltimate
        ? "مرحله نهایی: عکس‌های بدن خود را از ۴ زاویه (جلو، پهلو، پشت، سه‌چهارم) ارسال کنید. با ارسال عکس‌ها، ساخت برنامه اختصاصی شما آغاز می‌شود. این مرحله الزامی است."
        : "عکس‌های بدن خود را از ۴ زاویه (جلو، پهلو، پشت، سه‌چهارم) ارسال کنید. با ارسال عکس‌ها، ساخت برنامه اختصاصی شما آغاز می‌شود. این مرحله الزامی است.",
      required: true,
      status: hasBodyPhoto ? "completed" : "incomplete",
      statusLabel: hasBodyPhoto ? "ارسال شد ✓" : "الزامی — هنوز ارسال نشده",
      tab: "dashboard",
      actionLabel: hasBodyPhoto ? "ارسال مجدد" : "شروع",
    });
  }

  // ─── اندازه‌های بدنی (تشویقی، نه الزامی — در بنر پیش‌نیازها نمایش داده نمی‌شود) ───
  const baselineCheckup = await db.checkup.findFirst({
    where: { userId, phaseNumber: 0 },
    orderBy: { createdAt: "desc" },
  });
  const hasMeasurements =
    !!baselineCheckup?.waistMeasurement && !!baselineCheckup?.neckMeasurement;

  prerequisites.push({
    id: "body_measurements",
    type: "body_measurements",
    step: null,
    label: "اندازه‌های بدنی (اختیاری — تشویقی)",
    description:
      "با وارد کردن دور کمر، گردن و سایر اندازه‌ها، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و برنامه دقیق‌تری طراحی می‌کند. این مرحله کاملاً اختیاری است.",
    required: false,
    status: hasMeasurements ? "completed" : "incomplete",
    statusLabel: hasMeasurements ? "تکمیل شده ✓" : "اختیاری — هنوز وارد نشده",
    tab: "progress",
    actionLabel: hasMeasurements ? "ویرایش" : "شروع",
  });

  // ─── محاسبه وضعیت کلی ───
  const requiredPrereqs = prerequisites.filter((p) => p.required);
  const optionalPrereqs = prerequisites.filter((p) => !p.required && p.type !== "body_measurements");
  const allRequiredCompleted = requiredPrereqs.every((p) => p.status === "completed");
  const allOptionalDecided = optionalPrereqs.every((p) => p.status === "completed");

  // برنامه را می‌توان ساخت اگر:
  // ۱. همه پیش‌نیازهای الزامی تکمیل شده باشند (عکس بدن ارسال شده)
  // ۲. همه پیش‌نیازهای اختیاری تعیین تکلیف شده باشند (نه pending_decision)
  //    — «pending» (منتظر نتایج آزمایش) هم تعیین تکلیف حساب می‌شود.
  const canGenerateProgram = allRequiredCompleted && allOptionalDecided;

  let blockingReason: string | null = null;
  if (!canGenerateProgram) {
    const incompleteRequired = requiredPrereqs.filter((p) => p.status !== "completed");
    const pendingOptional = optionalPrereqs.filter((p) => p.status !== "completed");
    if (incompleteRequired.length > 0) {
      blockingReason = `برای ساخت برنامه، ابتدا باید ${incompleteRequired.map((p) => p.label).join("، ")} را تکمیل کنید.`;
    } else if (pendingOptional.length > 0) {
      blockingReason = `برای ساخت برنامه، باید ${pendingOptional.map((p) => p.label).join("، ")} را تعیین تکلیف کنید (آپلود یا «آپلود نمی‌کنم»).`;
    }
  }

  return {
    prerequisites,
    allRequiredCompleted,
    allOptionalDecided,
    canGenerateProgram,
    blockingReason,
  };
}

/**
 * لیست پیش‌نیازهای در انتظار (برای نمایش در programs-view).
 * شامل مواردی که هنوز تکمیل/تعیین تکلیف نشده‌اند.
 */
export function getPendingPrerequisites(result: PrerequisiteCheckResult): Prerequisite[] {
  // body_measurements تشویقی است و در pendingPrerequisites نمایش داده نمی‌شود
  // مگر اینکه هیچ پیش‌نیاز دیگری در انتظار نباشد.
  const blocking = result.prerequisites.filter(
    (p) =>
      p.type !== "body_measurements" &&
      p.status !== "completed"
  );
  if (blocking.length > 0) return blocking;
  // اگر همه پیش‌نیازها تکمیل شده‌اند ولی اندازه‌های بدنی نه، آن را به‌عنوان تشویق نمایش بده
  const measurements = result.prerequisites.find(
    (p) => p.type === "body_measurements" && p.status !== "completed"
  );
  return measurements ? [measurements] : [];
}
