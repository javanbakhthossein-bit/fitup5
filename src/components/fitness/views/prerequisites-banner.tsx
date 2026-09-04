"use client";

import { useEffect, useState } from "react";
import { Camera, Video, TestTube, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { toPersianDigits } from "@/lib/fitness/types";
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

/**
 * PrerequisitesBanner — نمایش پیش‌نیازهای ساخت برنامه در داشبورد.
 *
 * ─── طراحی جدید (درخواست مالک) ───
 *
 * پلن حرفه‌ای (Ultimate) — ۳ مرحله شماره‌دار که به‌ترتیب انجام می‌شوند:
 *   ۱. آزمایش خون (اختیاری — با تعیین تکلیف تیک می‌خورد)
 *   ۲. آنالیز ویدیویی (اختیاری — با تعیین تکلیف تیک می‌خورد)
 *   ۳. ارسال عکس بدن و ساخت برنامه (الزامی — با ارسال عکس، تولید برنامه شروع می‌شود)
 *
 * پلن پیشرفته (Advanced):
 *   - فقط «ارسال عکس بدن و ساخت برنامه» — بدون شماره مرحله
 *
 * هر مرحله که تعیین تکلیف شود، تیک سبز می‌خورد. تا همه مراحل تعیین تکلیف
 * نشوند، برنامه ساخته نمی‌شود.
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

      {/* Prerequisite cards — به‌ترتیب مرحله (۱ آزمایش خون، ۲ آنالیز ویدیویی، ۳ عکس بدن) */}
      <div className="space-y-2.5">
        {importantPrereqs.map((p) => {
          const isCompleted = p.status === "completed";
          const isRequired = p.required;

          return (
            <PrereqCard
              key={p.type}
              type={p.type}
              step={p.step}
              label={p.label}
              statusLabel={p.statusLabel}
              isCompleted={isCompleted}
              isRequired={isRequired}
              actionLabel={p.actionLabel}
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
 */
function PrereqCard({
  type,
  step,
  label,
  statusLabel,
  isCompleted,
  isRequired,
  actionLabel,
  onAction,
}: {
  type: string;
  step: number | null;
  label: string;
  statusLabel: string;
  isCompleted: boolean;
  isRequired: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  const icons: Record<string, typeof Camera> = {
    body_photo: Camera,
    video_body: Video,
    blood_test: TestTube,
  };
  const Icon = icons[type] || Camera;

  return (
    <div
      onClick={isCompleted ? undefined : onAction}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition text-right ${
        isCompleted
          ? "border-emerald-200 bg-emerald-50/50 cursor-default"
          : isRequired
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
      </div>

      {/* Status badge — فقط برای کارت‌های تکمیل‌شده */}
      {isCompleted ? (
        <div className="text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-600">
          ✓
        </div>
      ) : (
        <div
          className={`text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg transition flex items-center gap-1 ${
            isRequired
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
