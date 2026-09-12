"use client";

import { useEffect, useState } from "react";
import { Camera, Video, TestTube, CheckCircle2, AlertCircle, Sparkles, Lock } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  getSequenceBlocker,
  sequenceStepLabel,
  type SequenceBlocker,
} from "@/lib/fitness/prereq-sequence";
import { fetchJson } from "@/lib/fitness/fetch-json";
import { ProgramStatusBanner } from "./program-status-banner";

interface PrereqState {
  needsBodyPhoto: boolean;
  canSubmitVideo: boolean;
  pendingStatus: string | null;
  hasWorkoutPlan: boolean;
  awaitingMedia: boolean;
  canGenerateProgram?: boolean;
  blockingReason?: string | null;
  prerequisites?: {
    type: string;
    step: number | null;
    label: string;
    required: boolean;
    status: string;
    statusLabel: string;
    actionLabel: string;
  }[];
}

/** توست سبک — همان الگوی dashboard-view (import پویای sonner) */
function toastInfo(msg: string) {
  import("sonner").then(({ toast }) => toast.info(msg));
}

/**
 * توست کارت قفل (درخواست مالک: کارت‌های بعدی «کار نکنن») — کلیک روی کارت
 * قفل هیچ اورلی‌ای باز نمی‌کند؛ فقط همین توست فارسی با نام مرحله نشان داده می‌شود.
 */
function showLockedStepToast(blocker: SequenceBlocker) {
  toastInfo(
    `اول مرحلهٔ ${toPersianDigits(blocker.step)} (${sequenceStepLabel(blocker.type)}) را تکمیل کنید`
  );
}

/**
 * PrerequisitesBanner — نمایش پیش‌نیازهای ساخت برنامه در داشبورد.
 *
 * ─── زنجیرهٔ سخت‌گیرانه (درخواست مالک — Task 3-a) ───
 *
 * پلن حرفه‌ای (Ultimate) — ۳ مرحله شماره‌دار که «فقط به‌ترتیب» فعال می‌شوند:
 *   ۱. تحلیل آزمایش خون — اولین کارتِ فعال؛ بقیه خاموش و غیرفعال
 *   ۲. آنالیز ویدیویی — بعد از تعیین تکلیف مرحلهٔ ۱ فعال می‌شود
 *   ۳. ارسال عکس بدن و ساخت برنامه — بعد از تعیین تکلیف مرحلهٔ ۲
 *
 * پلن پیشرفته (Advanced):
 *   - فقط «ارسال عکس بدن و ساخت برنامه» — بدون شماره مرحله
 *
 * کارت قفل: opacity کم + قفل + متن «پس از تکمیل مرحلهٔ N فعال می‌شود»؛
 * کلیک روی آن هیچ اورلی‌ای باز نمی‌کند و فقط توست «اول مرحلهٔ N (نام) را
 * تکمیل کنید» می‌دهد. منطق زنجیره = getSequenceBlocker (منبع واحد با سرور).
 */
export function PrerequisitesBanner() {
  const { user, setBodyAnalysisOpen, setOverlay } = useAppStore();
  const [state, setState] = useState<PrereqState | null>(null);
  const [loading, setLoading] = useState(true);

  // فقط برای پلن پیشرفته/حرفه‌ای
  const shouldShow = user?.planName === "advanced" || user?.planName === "ultimate";

  useEffect(() => {
    if (!shouldShow) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchState() {
      try {
        // fetchJson: پاسخ HTML (خطای گیت‌وی/سرور) → خطای فارسی دوستانه
        const { res, data } = await fetchJson<PrereqState>(
          "/api/coach/submit-body-analysis",
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        setState(data);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    // لود اولیه
    fetchState();

    // گوش دادن به رویداد «پیش‌نیاز تعیین تکلیف شد» برای refresh بدون رفرش صفحه
    function onPrereqUpdate() { fetchState(); }
    if (typeof window !== "undefined") {
      window.addEventListener("prereq-updated", onPrereqUpdate);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("prereq-updated", onPrereqUpdate);
      }
    };
  }, [shouldShow, user?.planName, user?.videoStatus, user?.bloodTestStatus]);

  // اگر برنامه ساخته شده، چیزی نمایش نده
  if (!shouldShow || loading || !state) return null;
  if (state.hasWorkoutPlan) return null;

  const prereqs = state.prerequisites || [];
  // فقط پیش‌نیازهای مهم (بدون body_measurements)
  const importantPrereqs = prereqs.filter((p) => p.type !== "body_measurements");

  // اگر همه تکمیل شده‌اند ولی هنوز برنامه ساخته نشده
  const allDone = importantPrereqs.length > 0 && importantPrereqs.every((p) => p.status === "completed");

  // ─── زنجیرهٔ سخت‌گیرانهٔ مراحل (درخواست مالک) ───
  // قلب فیکس Task 3-a: قبلاً smallestBlockingStep فقط مراحل «required» را
  // بلاک‌کننده می‌دانست — چون خون/ویدیو required:false دارند (آپلودشان اختیاری
  // است)، زنجیره عملاً مرده بود و کارت‌های ۲ و ۳ همیشه باز بودند. حالا از
  // getSequenceBlocker (منبع واحد با سرور/تست) استفاده می‌شود: هر مرحلهٔ
  // شماره‌دارِ تعیین‌تکلیف‌نشده، مراحل بعدی را قفل می‌کند.
  function blockerFor(type: string): SequenceBlocker | null {
    const p = importantPrereqs.find((q) => q.type === type);
    if (!p || p.status === "completed") return null;
    return getSequenceBlocker(importantPrereqs, type);
  }

  // کارت‌های قفل‌شده — فقط کارت‌های تکمیل‌نشدهٔ شماره‌دار (کارت تیک‌خورده دیگر عملی ندارد)
  const hasLockedCards = importantPrereqs.some(
    (p) => p.step != null && p.status !== "completed" && blockerFor(p.type) != null
  );

  // مرحلهٔ «فعالِ فعلی» — کوچک‌ترین مرحلهٔ تعیین‌تکلیف‌نشده (برای هایلایت)
  const undecidedNumbered = importantPrereqs.filter(
    (p) => p.step != null && p.status !== "completed"
  );
  const nextActiveStep =
    undecidedNumbered.length > 0
      ? Math.min(...undecidedNumbered.map((p) => p.step as number))
      : null;

  // ─── همه پیش‌نیازها تعیین تکلیف شده‌اند و تولید برنامه در پس‌زمینه اجراست ───
  // به‌جای لیست کارت‌ها (که همه‌شان تیک خورده‌اند)، بنر «در حال آماده‌سازی»
  // نشان بده — از خرید تا تحویل برنامه، کاربر می‌داند برنامه‌اش در حال ساخت است.
  if (allDone && !state.awaitingMedia) {
    if (state.pendingStatus === "generating") {
      return <ProgramStatusBanner status="generating" />;
    }
    // تولید برنامه با خطا مواجه شده — راهنمایی به تلاش مجدد از تب برنامه‌ها
    if (state.pendingStatus === "failed") {
      return <ProgramStatusBanner status="failed" />;
    }
    // حالت لبه: همه کامل ولی نه در حال تولید و نه خطا (مثلاً ready قدیمی) → هیچ
    return null;
  }

  // پلن حرفه‌ای → مراحل شماره‌دار ۱۲۳؛ پلن پیشرفته → بدون شماره
  const isUltimate = user?.planName === "ultimate";

  return (
    <div className="rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <AlertCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-900 text-sm mb-0.5">
            {isUltimate ? "پیش‌نیازهای ساخت برنامه — ۳ مرحله" : "پیش‌نیاز ساخت برنامه"}
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            {isUltimate
              ? "مراحل را به‌ترتیب از ۱ شروع کن. هر مرحله که تعیین تکلیف شد، تیک می‌خورد. با ارسال عکس بدن (مرحله ۳)، ساخت برنامه آغاز می‌شود."
              : "برای ساخت برنامه اختصاصی، عکس‌های بدن خود را ارسال کن. با ارسال عکس‌ها، ساخت برنامه آغاز می‌شود."}
          </p>
        </div>
      </div>

      {/* توضیح زنجیره — فقط وقتی حداقل یک کارت قفل است (درخواست مالک) */}
      {hasLockedCards && (
        <p className="mb-2.5 text-[11px] font-bold text-amber-800 bg-amber-100/70 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
          <Lock className="w-3 h-3 shrink-0" />
          مراحل به ترتیب تکمیل می‌شوند
        </p>
      )}

      {/* Prerequisite cards — به‌ترتیب مرحله (۱ آزمایش خون، ۲ آنالیز ویدیویی، ۳ عکس بدن) */}
      <div className="space-y-2.5">
        {importantPrereqs.map((p) => {
          const isCompleted = p.status === "completed";
          const isRequired = p.required;
          // زنجیرهٔ سخت‌گیرانه: اگر مرحلهٔ تعیین‌تکلیف‌نشدهٔ قبلی وجود دارد، این کارت قفل است
          const blocker = blockerFor(p.type);
          const blockedByStep = blocker?.step ?? null;
          // کارت «فعالِ فعلی» — کوچک‌ترین مرحلهٔ تعیین‌تکلیف‌نشده (هایلایت نارنجی)
          const isActiveStep =
            !isCompleted && p.step != null && p.step === nextActiveStep;

          return (
            <PrereqCard
              key={p.type}
              type={p.type}
              step={p.step}
              label={p.label}
              statusLabel={blockedByStep != null ? `در انتظار تکمیل مرحلهٔ ${toPersianDigits(blockedByStep)}` : p.statusLabel}
              isCompleted={isCompleted}
              isRequired={isRequired}
              isActiveStep={isActiveStep}
              actionLabel={p.actionLabel}
              lockedByStep={blockedByStep}
              lockedBlocker={blocker}
              onAction={() => handlePrereqAction(p.type)}
            />
          );
        })}
      </div>

      {/* Progress indicator */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-orange-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(importantPrereqs.filter((p) => p.status === "completed").length / importantPrereqs.length) * 100}%`,
              background: "linear-gradient(90deg, #f59e0b, #f97316)",
            }}
          />
        </div>
        <span className="text-[11px] font-bold text-slate-600 shrink-0">
          {toPersianDigits(importantPrereqs.filter((p) => p.status === "completed").length)} / {toPersianDigits(importantPrereqs.length)}
        </span>
      </div>

      {/* Blocking reason */}
      {state.blockingReason && !allDone && (
        <div className="mt-3 p-2.5 rounded-lg bg-amber-100/60 border border-amber-200 text-xs text-amber-800 leading-relaxed">
          {state.blockingReason}
        </div>
      )}
    </div>
  );

  function handlePrereqAction(type: string) {
    switch (type) {
      case "body_photo":
        // مودال عکس بدن — مرحله ۳: ارسال عکس + شروع ساخت برنامه
        setBodyAnalysisOpen(true);
        break;
      case "video_body":
        // مرحله ۲: صفحه آنالیز ویدیویی (آپلود یا «آپلود نمی‌کنم»)
        setOverlay("videoAnalysis");
        break;
      case "blood_test":
        // مرحله ۱: صفحه آزمایش خون (آپلود، منتظر جواب، یا «آپلود نمی‌کنم»)
        setOverlay("bloodTest");
        break;
    }
  }
}

/**
 * کارت پیش‌نیاز — نمایش شماره مرحله (۱/۲/۳)، وضعیت و دکمه عملیات.
 *
 * شماره مرحله: فقط پلن حرفه‌ای (ultimate). وقتی مرحله کامل شد، شماره جای
 * خود را به تیک سبز می‌دهد. پلن پیشرفته شماره ندارد (آیکون نمایش داده می‌شود).
 *
 * زنجیرهٔ سخت‌گیرانه (درخواست مالک — Task 3-a): کارتِ قفل (lockedByStep != null)
 * کم‌رنگ (opacity-60)، با آیکون قفل، متن ریز «پس از تکمیل مرحلهٔ N فعال می‌شود»
 * و بدون باز کردن اورلی رندر می‌شود — کلیک روی آن فقط توست فارسی با نام مرحلهٔ
 * بلاک‌کننده می‌دهد. کارتِ «فعالِ فعلی» (مرحلهٔ بعدیِ ترتیب) با استایل نارنجی
 * هایلایت می‌شود تا کاربر بداند الان نوبت کدام مرحله است.
 */
function PrereqCard({
  type,
  step,
  label,
  statusLabel,
  isCompleted,
  isRequired,
  isActiveStep = false,
  actionLabel,
  lockedByStep = null,
  lockedBlocker = null,
  onAction,
}: {
  type: string;
  step: number | null;
  label: string;
  statusLabel: string;
  isCompleted: boolean;
  isRequired: boolean;
  /** مرحلهٔ فعالِ فعلی زنجیره (قدم بعدی) — هایلایت نارنجی مثل کارت الزامی */
  isActiveStep?: boolean;
  actionLabel: string;
  /** شمارهٔ مرحلهٔ بلاک‌کننده — null یعنی کارت باز است */
  lockedByStep?: number | null;
  /** اطلاعات کامل بلاک‌کننده (شماره + نوع) برای متن توست */
  lockedBlocker?: SequenceBlocker | null;
  onAction: () => void;
}) {
  const isLocked = lockedByStep != null;
  const isHighlighted = isRequired || isActiveStep;
  const icons: Record<string, typeof Camera> = {
    body_photo: Camera,
    video_body: Video,
    blood_test: TestTube,
  };
  const Icon = icons[type] || Camera;

  return (
    <div
      onClick={
        isCompleted
          ? undefined
          : isLocked
          ? lockedBlocker
            ? () => showLockedStepToast(lockedBlocker)
            : undefined
          : onAction
      }
      aria-disabled={isLocked || undefined}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition text-right ${
        isLocked
          ? "border-slate-200 bg-slate-50/70 opacity-60 cursor-default"
          : isCompleted
          ? "border-emerald-200 bg-emerald-50/50 cursor-default"
          : isHighlighted
          ? "border-orange-300 bg-orange-50/80 hover:bg-orange-50 ring-2 ring-orange-300/30 cursor-pointer"
          : "border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
      }`}
    >
      {/* شماره مرحله / تیک — پلن حرفه‌ای: ۱،۲،۳؛ پلن پیشرفته: آیکون */}
      {step != null ? (
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-black text-base ${
            isCompleted
              ? "bg-emerald-100 text-emerald-600"
              : "bg-orange-100 text-orange-600"
          }`}
          aria-hidden="true"
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <span className="font-stat">{toPersianDigits(step)}</span>
          )}
        </div>
      ) : (
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            isCompleted ? "bg-emerald-100" : "bg-orange-100"
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <Icon className="w-5 h-5 text-orange-600" />
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm text-slate-900">{label}</span>
          {isRequired && !isCompleted && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500 text-white font-bold">
              الزامی
            </span>
          )}
          {!isRequired && !isCompleted && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-400 text-white font-bold">
              اختیاری
            </span>
          )}
        </div>
        <p className={`text-[11px] mt-0.5 ${isCompleted ? "text-emerald-600" : "text-slate-500"}`}>
          {statusLabel}
        </p>
        {/* متن ریز کارت قفل (درخواست مالک — Task 3-a) */}
        {isLocked && lockedByStep != null && (
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            پس از تکمیل مرحلهٔ {toPersianDigits(lockedByStep)} فعال می‌شود
          </p>
        )}
      </div>

      {/* Status badge — کارت تکمیل‌شده: تیک / کارت قفل: آیکون قفل / بقیه: دکمه عملیات */}
      {isCompleted ? (
        <div className="text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-600">
          ✓
        </div>
      ) : isLocked ? (
        <div
          className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center"
          title={`پس از تکمیل مرحلهٔ ${toPersianDigits(lockedByStep as number)} باز می‌شود`}
        >
          <Lock className="w-4 h-4" />
        </div>
      ) : (
        <div
          className={`text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg transition flex items-center gap-1 ${
            isHighlighted
              ? "text-white bg-orange-500 hover:bg-orange-600"
              : "text-slate-600 bg-slate-100 hover:bg-slate-200"
          }`}
        >
          {type === "body_photo" && <Sparkles className="w-3.5 h-3.5" />}
          {actionLabel}
        </div>
      )}
    </div>
  );
}
