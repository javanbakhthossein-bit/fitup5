import { db } from "@/lib/db";
import type { Plan } from "@/lib/fitness/types";
import {
  buildBlockingReason,
  computeCanGenerateProgram,
  resolveBloodStepStatus,
  resolveVideoStepStatus,
  type PrerequisiteStatus,
} from "./prereq-sequence";

export type { PrerequisiteStatus } from "./prereq-sequence";

/**
 * سیستمی برای بررسی پیش‌نیازهای ساخت برنامه بر اساس پلن کاربر.
 *
 * ─── ترتیب سخت‌گیرانه (درخواست مالک — Task 3-a) ───
 *
 * پلن حرفه‌ای (Ultimate) — ۳ مرحله شماره‌دار و کاملاً ترتیبی:
 *   ۱. آزمایش خون (آپلودش اختیاری است اما «تعیین تکلیف» الزامی است — ردِ رسمی هم حساب می‌شود)
 *   ۲. آنالیز ویدیوی فرم بدن (آپلودش اختیاری است اما «تعیین تکلیف» الزامی است — یا «آپلود نمی‌کنم»)
 *   ۳. ارسال عکس بدن و ساخت برنامه (الزامی — با ارسال عکس، تولید برنامه شروع می‌شود)
 *
 * قاعدهٔ سخت‌گیرانه: هر مرحله تا وقتی مرحلهٔ قبلی «تعیین تکلیف» نشده قفل است
 * (منطق زنجیره در prereq-sequence.ts — مشترک بین سرور/کلاینت/تست).
 * تعیین تکلیف‌های قبلی دست نمی‌خورند — فقط قدم‌های «آیندهٔ» تعیین‌تکلیف‌نشده
 * توسط زنجیره گیت می‌شوند (سازگار با کاربران وسط چرخه).
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
  /**
   * آیا «تعیین تکلیف» این مرحله برای ادامهٔ زنجیره اجباری است؟
   * برای هر سه مرحلهٔ شماره‌دار (خون/ویدیو/عکس) true است — حتی برای خون و ویدیو
   * که آپلودشان اختیاری است (required=false) چون «تعیین تکلیف»شان اجباری است.
   */
  decisionRequired?: boolean;
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

  // ─── v44 — مرز «چرخهٔ جاری پلن» برای پیش‌نیازهای مدیایی ───
  // دیریکتیو مالک: برای پلن حرفه‌ای/پیشرفتهٔ «جدید» (خرید، ارتقا، تمدید یا
  // فعال‌سازی ادمین) عکس بدنِ «جدید» الزامی است — نه همان عکس دورهٔ قبل.
  // همین منطق برای آزمایش خون و ویدیو هم اعمال شد تا تحلیل‌های دورهٔ قبل،
  // پیش‌نیازِ پلن جدید را «انجام‌شده» نشان ندهند. مرز چرخه = createdAt
  // اشتراک advanced/ultimate جاری (status active/pending).
  let mediaCycleStart: Date | null = null;
  if (needsBodyPhoto) {
    const currentMediaSub = await db.subscription.findFirst({
      where: { userId, plan: { in: ["advanced", "ultimate"] }, status: { in: ["active", "pending"] } },
      orderBy: { createdAt: "desc" },
    });
    mediaCycleStart = currentMediaSub?.createdAt ?? null;
  }
  const inCurrentCycle = (field: "createdAt") =>
    mediaCycleStart ? { [field]: { gte: mediaCycleStart } } : {};

  // ─── مرحله ۱. آزمایش خون (اولین قدمِ زنجیره — آپلودش اختیاری، تعیین تکلیفش اجباری) ───
  // کاربر به ماژول آزمایش خون می‌رود، آپلود می‌کند، «آزمایش دادم و منتظر جوابم»
  // می‌زند یا «آپلود نمی‌کنم». با هر تصمیم، مرحله تیک می‌خورد و مرحلهٔ ۲ باز می‌شود.
  if (isUltimate) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bloodTestStatus: true },
    });
    const bloodTestStatus = user?.bloodTestStatus ?? null;
    // v44 — فقط تحلیلِ در چرخهٔ جاری پلن پیش‌نیاز را کامل می‌کند
    const bloodTestAnalysis = await db.analysisResult.findFirst({
      where: { userId, type: "blood_test", ...inCurrentCycle("createdAt") },
      orderBy: { createdAt: "desc" },
    });

    // نگاشت وضعیت خام → وضعیت مرحله (منبع واحد: prereq-sequence.ts — تست‌شده)
    const status = resolveBloodStepStatus(bloodTestStatus, !!bloodTestAnalysis);
    const statusLabel =
      status === "completed"
        ? bloodTestAnalysis
          ? "آپلود و آنالیز شد ✓"
          : bloodTestStatus === "declined"
            ? "تعیین تکلیف شد (رد شد) ✓"
            : "تعیین تکلیف شد — در انتظار نتایج ⏳"
        : "در انتظار تعیین تکلیف — آپلود یا رد کنید";

    prerequisites.push({
      id: "blood_test",
      type: "blood_test",
      step: 1,
      label: "آزمایش خون (اختیاری)",
      description:
        "برای داشتن یک برنامه کاملاً شخصی‌سازی‌شده، آزمایش خون خود را آپلود کنید. اختیاری است اما باید تعیین تکلیف شود (آپلود، «آزمایش دادم و منتظر جوابم»، یا «آپلود نمی‌کنم»).",
      required: false, // خودِ آپلود اختیاری است، اما تعیین تکلیفش الزامی است
      decisionRequired: true, // مرحلهٔ ۱ زنجیره — تا تعیین تکلیف نشود، مراحل بعدی قفل‌اند
      status,
      statusLabel,
      tab: "dashboard",
      actionLabel: status === "completed" ? "تکمیل شد ✓" : "شروع",
    });
  }

  // ─── مرحله ۲. آنالیز ویدیوی فرم بدن (آپلودش اختیاری، تعیین تکلیفش اجباری) ───
  // v60 — دیریکتیو مالک: این مرحله «آنالیز ویدیوی فرم بدن» است — ویدیوی فرم
  // بدنهٔ کاربر طبق آن برنامهٔ بدنسازی طراحی می‌شود. (آنالیز فرم حرکات چیز
  // دیگری است و در چت با فیتاپ انجام می‌شود.)
  if (isUltimate) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { videoStatus: true },
    });
    const videoStatus = user?.videoStatus ?? null;
    // اگر تحلیل ویدیو در AnalysisResult موجود باشد، یعنی کاربر قبلاً ویدیو آپلود کرده
    // v44 — فقط تحلیلِ در چرخهٔ جاری پلن پیش‌نیاز را کامل می‌کند
    const videoAnalysis = await db.analysisResult.findFirst({
      where: { userId, type: "video_analysis", ...inCurrentCycle("createdAt") },
      orderBy: { createdAt: "desc" },
    });

    // نگاشت وضعیت خام → وضعیت مرحله (منبع واحد: prereq-sequence.ts — تست‌شده)
    // «آپلود نمی‌کنم» (skipped) هم تعیین تکلیف حساب می‌شود → completed
    const status = resolveVideoStepStatus(videoStatus, !!videoAnalysis);
    const statusLabel =
      status === "completed"
        ? videoStatus === "skipped" && !videoAnalysis
          ? "تعیین تکلیف شد (رد شد) ✓"
          : "آپلود و آنالیز شد ✓"
        : "در انتظار تعیین تکلیف — آپلود یا رد کنید";

    prerequisites.push({
      id: "video_body",
      type: "video_body",
      step: 2,
      label: "آنالیز ویدیوی فرم بدن (اختیاری)",
      description:
        "ویدیوی فرم بدن‌ات را ارسال کن تا برنامهٔ بدنسازی دقیقاً بر اساس فرم و ساختار بدن تو طراحی شود. اختیاری است اما باید تعیین تکلیف شود (آپلود یا «آپلود نمی‌کنم»).",
      required: false, // خودِ آپلود اختیاری است، اما تعیین تکلیفش الزامی است
      decisionRequired: true, // مرحلهٔ ۲ زنجیره — تا تعیین تکلیف نشود، عکس بدن قفل است
      status,
      statusLabel,
      tab: "dashboard",
      actionLabel: status === "completed" ? "تکمیل شد ✓" : "شروع",
    });
  }

  // ─── مرحله ۳. ارسال عکس بدن و ساخت برنامه (الزامی برای advanced/ultimate) ───
  // شماره ۳ فقط برای ultimate (مرحله پایانی) — برای advanced بدون شماره (تنها پیش‌نیاز).
  // با ارسال عکس بدن، اگر همه مراحل قبلی تعیین تکلیف شده باشند، تولید برنامه شروع می‌شود.
  // 🩹 v44 — دیریکتیو مالک: «برای کاربری که پلن حرفه‌ای یا پیشرفته جدید براش
  // فعال شده حتماً لازمه که در پیش‌نیازها عکس بدن جدید آپلود کند» — عکسِ
  // دورهٔ قبلی دیگر کافی نیست؛ عکس باید بعد از فعال‌سازیِ چرخهٔ جاریِ پلن
  // (createdAt اشتراک advanced/ultimate جاری — خرید، ارتقا، تمدید یا
  // فعال‌سازی ادمین) آپلود شده باشد. قبلاً هر عکس قدیمی پیش‌نیاز را «ارسال
  // شده» نشان می‌داد که اشتباه بود.
  if (needsBodyPhoto) {
    const cycleStart = mediaCycleStart;

    const cyclePhoto = await db.progressPhoto.findFirst({
      where: {
        userId,
        ...(cycleStart ? { takenAt: { gte: cycleStart } } : {}),
      },
      orderBy: { takenAt: "desc" },
    });
    const hasBodyPhoto = !!cyclePhoto;

    // برای پیام وضعیت: آیا عکس قدیمی (از دورهٔ قبل) دارد؟
    const anyPhoto = hasBodyPhoto
      ? null
      : await db.progressPhoto.findFirst({
          where: { userId },
          orderBy: { takenAt: "desc" },
          select: { id: true },
        });

    prerequisites.push({
      id: "body_photo",
      type: "body_photo",
      step: isUltimate ? 3 : null,
      label: "ارسال عکس بدن و ساخت برنامه",
      description: isUltimate
        ? "مرحله نهایی: عکس‌های بدن خود را از ۴ زاویه (جلو، پهلو، پشت، سه‌چهارم) ارسال کنید. با ارسال عکس‌ها، ساخت برنامه اختصاصی شما آغاز می‌شود. این مرحله الزامی است."
        : "عکس‌های بدن خود را از ۴ زاویه (جلو، پهلو، پشت، سه‌چهارم) ارسال کنید. با ارسال عکس‌ها، ساخت برنامه اختصاصی شما آغاز می‌شود. این مرحله الزامی است.",
      required: true,
      decisionRequired: true, // مرحلهٔ ۳ زنجیره — آخرین قدم قبل از ساخت برنامه
      status: hasBodyPhoto ? "completed" : "incomplete",
      statusLabel: hasBodyPhoto
        ? "ارسال شد ✓"
        : anyPhoto
          ? "پلن جدید فعال شده — عکس بدن جدید الزامی است"
          : "الزامی — هنوز ارسال نشده",
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
  // (برای سازگاریِ payload قدیمی همچنان محاسبه و برگردانده می‌شود)
  const requiredPrereqs = prerequisites.filter((p) => p.required);
  const optionalPrereqs = prerequisites.filter((p) => !p.required && p.type !== "body_measurements");
  const allRequiredCompleted = requiredPrereqs.every((p) => p.status === "completed");
  const allOptionalDecided = optionalPrereqs.every((p) => p.status === "completed");

  // برنامه را می‌توان ساخت اگر همهٔ مراحل شماره‌دار (۱ خون → ۲ ویدیو → ۳ عکس)
  // تعیین تکلیف شده باشند و هیچ مورد الزامیِ بدون‌شماره (پلن پیشرفته) ناقص
  // نمانده باشد — منبع واحد: prereq-sequence.ts (همان تابعی که تست می‌شود).
  // معادل دقیق فرمول قبلی (allRequiredCompleted && allOptionalDecided) است؛
  // فقط حالا با زنجیرهٔ سخت‌گیرانه و blockingReason ترتیبی هم‌منبع شده است.
  const canGenerateProgram = computeCanGenerateProgram(prerequisites);

  // دلیل بلاک — به ترتیب مراحل: اول خون، بعد ویدیو، بعد عکس (درخواست مالک)
  const blockingReason = canGenerateProgram ? null : buildBlockingReason(prerequisites);

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
