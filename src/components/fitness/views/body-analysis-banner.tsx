"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Video, Upload, X, Loader2, AlertCircle, Ruler, Sparkles, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";

interface BodyAnalysisState {
  needsBodyPhoto: boolean;
  canSubmitVideo: boolean;
  pendingStatus: string | null;
  hasWorkoutPlan: boolean;
  awaitingMedia: boolean;
  // NEW (وظیفه ۱۰): اطلاعات دانه‌دانه پیش‌نیازها
  prerequisites?: {
    id: string;
    type: "body_photo" | "video_body" | "blood_test" | "body_measurements";
    label: string;
    description: string;
    required: boolean;
    status: "completed" | "pending" | "pending_decision" | "incomplete";
    statusLabel: string;
    tab: string;
    actionLabel: string;
  }[];
  canGenerateProgram?: boolean;
  blockingReason?: string | null;
}

interface MeasurementsForm {
  waist: string;
  neck: string;
  hip: string;
  chest: string;
  arm: string;
  thigh: string;
  shoulder: string;
  calf: string;
}

/**
 * بنر هشدار برای کاربران پلن Advanced / Ultimate که هنوز عکس/ویدیو بدن
 * خود را ارسال نکرده‌اند. کاربر بدون این مدیاها برنامه‌ای دریافت نمی‌کند.
 *
 * NEW (BODY-COMPOSITION-PRO): قبل از آپلود عکس، فرم اندازه‌های بدنی (اختیاری)
 * نمایش داده می‌شود تا درصد چربی بدن با فرمول US Navy محاسبه شود.
 */
export function BodyAnalysisBanner() {
  const { user, setWorkoutPlan, setMealPlan, bodyAnalysisOpen, setBodyAnalysisOpen } = useAppStore();
  const [state, setState] = useState<BodyAnalysisState | null>(null);
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // مرحله‌بندی مجزای ارسال عکس بدن (وظیفه ۱ FOOD-ANALYSIS-LOGGING)
  const [submitStage, setSubmitStage] = useState<
    "idle" | "uploading" | "analyzing" | "generating" | "done" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState<string>("");
  const [skippingVideo, setSkippingVideo] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // NEW: post-purchase measurements step
  const [measurementsStep, setMeasurementsStep] = useState<"prompt" | "form" | "skip" | "done">("prompt");
  const [measurements, setMeasurements] = useState<MeasurementsForm>({
    waist: "", neck: "", hip: "", chest: "", arm: "", thigh: "", shoulder: "", calf: "",
  });
  const [savingMeasurements, setSavingMeasurements] = useState(false);

  useEffect(() => {
    // فقط اگر کاربر قابلیت bodyPhotoAnalysis داشت چک کن
    if (!user?.planName || (user.planName !== "advanced" && user.planName !== "ultimate")) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coach/submit-body-analysis", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setState(data);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.planName]);

  // ─── Global open trigger: هر view دیگری (مثل programs-view) می‌تواند با
  // setBodyAnalysisOpen(true) درخواست باز کردن modal آپلود کند. این useEffect
  // فلگ را می‌خواند و در صورت true بودن، modal را باز می‌کند و فلگ را ریست می‌کند. ───
  useEffect(() => {
    if (bodyAnalysisOpen && state && state.awaitingMedia) {
      setMeasurementsStep("prompt");
      setOpen(true);
      setBodyAnalysisOpen(false);
    } else if (bodyAnalysisOpen) {
      // اگر awaitingMedia نبود ولی کاربر اصرار داشت modal باز شود، بازش کن
      // (مثلاً برای آپلود مجدد عکس بعد از تکمیل اولیه)
      setMeasurementsStep("prompt");
      setOpen(true);
      setBodyAnalysisOpen(false);
    }
  }, [bodyAnalysisOpen, state, setBodyAnalysisOpen]);

  async function skipVideo() {
    setSkippingVideo(true);
    try {
      const res = await fetch("/api/video-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      if (!res.ok) throw new Error("خطا در رد کردن ویدیو");
      toast.success("باشه! برنامه بدون تحلیل ویدیو طراحی می‌شود.");
      // refetch state
      const r = await fetch("/api/coach/submit-body-analysis", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setSkippingVideo(false);
    }
  }

  if (!state) return null;
  // بنر اصلی (آپلود عکس بدن) فقط وقتی awaitingMedia=true نمایش داده می‌شود.
  // بنر تصمیمات (تعیین تکلیف ویدیو/آزمایش خون) در کامپوننت جداگانه رندر می‌شود.
  if (!state.awaitingMedia) {
    // اگر برنامه ساخته شده، چیزی نمایش نده
    if (state.hasWorkoutPlan) return null;
    // اگر عکس‌ها آپلود شده ولی پیش‌نیازهای اختیاری تعیین تکلیف نشده، بنر تصمیمات را نشان بده
    if (!state.canGenerateProgram) {
      return <PendingDecisionsBanner state={state} onRefresh={() => {
        // refetch
        (async () => {
          try {
            const res = await fetch("/api/coach/submit-body-analysis", { cache: "no-store" });
            if (!res.ok) return;
            const data = await res.json();
            setState(data);
          } catch {}
        })();
      }} />;
    }
    return null;
  }

  function handlePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    if (photos.length + files.length > 4) {
      toast.error("حداکثر ۴ عکس مجاز است");
      e.target.value = "";
      return;
    }
    setPhotos((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function handleVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("فقط فایل ویدیویی مجاز است");
      e.target.value = "";
      return;
    }
    // محدودیت حجم افزایش یافت — تا ۵۰ مگابایت
    if (f.size > 50 * 1024 * 1024) {
      toast.error("حجم ویدیو باید کمتر از ۵۰ مگابایت باشد");
      e.target.value = "";
      return;
    }
    setVideo(f);
    e.target.value = "";
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveMeasurements() {
    setSavingMeasurements(true);
    try {
      const payload: Record<string, number | undefined> = {};
      const fields: { key: keyof MeasurementsForm; api: string }[] = [
        { key: "waist", api: "waistMeasurement" },
        { key: "neck", api: "neckMeasurement" },
        { key: "hip", api: "hipMeasurement" },
        { key: "chest", api: "chestMeasurement" },
        { key: "arm", api: "armMeasurement" },
        { key: "thigh", api: "thighMeasurement" },
        { key: "shoulder", api: "shoulderMeasurement" },
        { key: "calf", api: "calfMeasurement" },
      ];
      for (const f of fields) {
        const v = measurements[f.key];
        if (v && Number(v) > 0) payload[f.api] = Number(v);
      }
      if (Object.keys(payload).length > 0) {
        const res = await fetch("/api/checkup/baseline-measurements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || "خطا در ذخیره اندازه‌ها");
        }
        toast.success("اندازه‌های شما ذخیره شد ✅");
      }
      setMeasurementsStep("done");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیره اندازه‌ها");
    } finally {
      setSavingMeasurements(false);
    }
  }

  async function submit() {
    if (photos.length === 0) {
      toast.error("حداقل یک عکس بدن ارسال کنید");
      return;
    }
    // ویدیو اختیاری است — حتی برای پلن Ultimate — نیازی به بررسی الزامی بودن نیست
    setSubmitting(true);
    setSubmitError("");
    setSubmitStage("uploading");
    // تایمرهای مرحله‌بندی: به‌کاربر نشان می‌دهیم در کدام مرحله است.
    // سرور همه‌چیز را در یک درخواست انجام می‌دهد، ولی ما با تایمر مرحله را شبیه‌سازی می‌کنیم
    // تا تجربه کاربری بهتر شود (وظیفه ۱: نمایش مراحل مجزا).
    const stageTimers: ReturnType<typeof setTimeout>[] = [];
    stageTimers.push(setTimeout(() => setSubmitStage("analyzing"), 1500));
    stageTimers.push(setTimeout(() => setSubmitStage("generating"), 5000));
    try {
      const fd = new FormData();
      photos.forEach((p) => fd.append("bodyPhotos", p));
      if (video) fd.append("bodyVideo", video);

      const res = await fetch("/api/coach/submit-body-analysis", {
        method: "POST",
        body: fd,
        // keepalive: اگر کاربر از صفحه خارج شد، آپلود/تحلیل در پس‌زمینه ادامه می‌یابد
        keepalive: true,
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        throw new Error("پاسخ سرور نامعتبر است. لطفاً دوباره تلاش کنید.");
      }
      if (!res.ok) throw new Error(data.error || "خطا در ارسال مدیا");

      setSubmitStage("done");
      toast.success("برنامه شما ساخته شد! 🎯");
      // پاک کردن فرم
      setPhotos([]);
      setVideo(null);
      setOpen(false);

      // به‌روزرسانی state و دریافت برنامه جدید
      setState({
        needsBodyPhoto: state?.needsBodyPhoto ?? false,
        canSubmitVideo: state?.canSubmitVideo ?? false,
        pendingStatus: "ready",
        hasWorkoutPlan: true,
        awaitingMedia: false,
      });

      // بارگذاری برنامه جدید
      const planRes = await fetch("/api/coach/plan", { cache: "no-store" });
      const planData = await planRes.json();
      if (planData.workout) setWorkoutPlan(planData.workout);
      if (planData.meal) setMealPlan(planData.meal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در ارسال مدیا";
      setSubmitError(msg);
      setSubmitStage("error");
      toast.error(msg);
    } finally {
      for (const t of stageTimers) clearTimeout(t);
      setSubmitting(false);
      // ریست مرحله بعد از ۳ ثانیه (مگر خطا)
      setTimeout(() => {
        setSubmitStage((s) => (s === "error" ? s : "idle"));
      }, 3000);
    }
  }

  const measurementFields: { key: keyof MeasurementsForm; label: string; required?: boolean }[] = [
    { key: "waist", label: "دور کمر", required: true },
    { key: "neck", label: "دور گردن", required: true },
    { key: "hip", label: "دور باسن" },
    { key: "chest", label: "دور سینه" },
    { key: "arm", label: "دور بازو" },
    { key: "thigh", label: "دور ران" },
    { key: "shoulder", label: "دور شانه" },
    { key: "calf", label: "دور ساق پا" },
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 p-4 shadow-sm relative overflow-hidden"
      >
        {/* subtle decorative glow */}
        <div
          className="absolute -top-12 -left-12 w-32 h-32 rounded-full opacity-30 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #f97316, transparent)" }}
        />
        <div className="flex items-start gap-3 relative">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Camera className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="font-black text-sm text-amber-900 dark:text-amber-200">
                برای دریافت برنامه، عکس بدن خود را ارسال کنید
              </h4>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                الزامی
              </span>
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
              {state.canSubmitVideo
                ? "۴ عکس از زوایای جلو، پهلو، پشت و سه‌چهارم بدن خود ارسال کنید تا فیتاپ هوشمند بر اساس فرم بدن شما برنامه اختصاصی طراحی کند. ارسال ویدیوی فرم حرکات اختیاری است اما به دقت برنامه کمک می‌کند."
                : "۴ عکس از زوایای جلو، پهلو، پشت و سه‌چهارم بدن خود ارسال کنید تا فیتاپ هوشمند بر اساس فرم بدن شما برنامه اختصاصی طراحی کند."}
            </p>
            {/* Action buttons — prominent + clear */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                className="rounded-xl text-white font-bold shadow-md hover:shadow-lg transition-all gap-1.5"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                onClick={() => {
                  setMeasurementsStep("prompt");
                  setOpen(true);
                }}
              >
                <Camera className="w-4 h-4" />
                آپلود عکس بدن
              </Button>
              {state.canSubmitVideo && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-2 border-orange-300 text-orange-700 bg-white/70 hover:bg-orange-50 gap-1.5"
                    onClick={() => {
                      setMeasurementsStep("prompt");
                      setOpen(true);
                    }}
                  >
                    <Video className="w-4 h-4" />
                    آپلود ویدیو (اختیاری)
                  </Button>
                  <button
                    type="button"
                    disabled={skippingVideo}
                    onClick={skipVideo}
                    className="text-[11px] text-amber-700 hover:text-amber-900 underline underline-offset-2 disabled:opacity-50"
                  >
                    {skippingVideo ? "..." : "رد کردن ویدیو"}
                  </button>
                </>
              )}
              <span className="text-[10px] text-amber-600 dark:text-amber-400 ms-auto">
                {toPersianDigits(photos.length)}/۴ عکس
                {state.canSubmitVideo ? ` • ${video ? "۱" : "۰"}/۱ ویدیو` : ""}
              </span>
            </div>
            {/* Mini steps hint */}
            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-amber-700/80 dark:text-amber-400/80">
              <Sparkles className="w-3 h-3" />
              <span>آپلود عکس → تحلیل هوش مصنوعی → ساخت برنامه اختصاصی</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Modal upload — including measurements step */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => !submitting && !savingMeasurements && setOpen(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[90vh] overflow-y-auto custom-scrollbar"
              dir="rtl"
            >
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-orange-100 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  {measurementsStep === "done" ? (
                    <>
                      <Camera className="w-5 h-5 text-orange-500" />
                      <h3 className="font-bold text-slate-900">
                        {state.canSubmitVideo ? "ارسال عکس بدن (ویدیو اختیاری)" : "ارسال عکس بدن"}
                      </h3>
                    </>
                  ) : (
                    <>
                      <Ruler className="w-5 h-5 text-orange-500" />
                      <h3 className="font-bold text-slate-900">اندازه‌های بدنی (اختیاری)</h3>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => !submitting && !savingMeasurements && setOpen(false)}
                  className="p-1.5 rounded-full hover:bg-orange-50 text-slate-500"
                  aria-label="بستن"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* ─── NEW: Post-purchase measurements prompt ─── */}
              {measurementsStep === "prompt" && (
                <div className="p-5 space-y-4">
                  <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                        style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                      >
                        <Ruler className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-900 mb-1">
                          برای برنامه دقیق‌تر، اندازه‌های بدنی خود را وارد کنید
                        </p>
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                          با وارد کردن دور کمر و گردن، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و برنامه تمرینی و غذایی دقیق‌تری طراحی می‌کند. این مرحله کاملاً اختیاری است.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="flex-1 rounded-xl text-white"
                      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                      onClick={() => setMeasurementsStep("form")}
                    >
                      وارد می‌کنم
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 rounded-xl"
                      onClick={() => setMeasurementsStep("done")}
                    >
                      رد کردن
                    </Button>
                  </div>
                </div>
              )}

              {/* ─── Measurements form ─── */}
              {measurementsStep === "form" && (
                <div className="p-4 space-y-4">
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      اندازه‌ها را با متر نرم و در حالت ایستاده و عادی وارد کنید. دور کمر و گردن برای محاسبه درصد چربی الزامی هستند.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {measurementFields.map((f) => (
                      <div key={f.key}>
                        <Label className="mb-1 block text-[11px] text-slate-700 flex items-center gap-1">
                          {f.label}
                          {f.required ? (
                            <span className="text-amber-600 font-bold">*</span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">(اختیاری)</span>
                          )}
                          <span className="text-slate-400 text-[10px]">(cm)</span>
                        </Label>
                        <Input
                          dir="ltr"
                          type="number"
                          inputMode="numeric"
                          value={measurements[f.key]}
                          onChange={(e) =>
                            setMeasurements((m) => ({ ...m, [f.key]: e.target.value }))
                          }
                          placeholder="مثلاً ۹۰"
                          className="h-10 rounded-xl text-center text-sm"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 rounded-xl"
                      disabled={savingMeasurements}
                      onClick={() => setMeasurementsStep("prompt")}
                    >
                      بازگشت
                    </Button>
                    <Button
                      className="flex-1 rounded-xl text-white"
                      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                      disabled={savingMeasurements}
                      onClick={saveMeasurements}
                    >
                      {savingMeasurements ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> در حال ذخیره...
                        </span>
                      ) : (
                        "ذخیره و ادامه"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* ─── Photo upload step ─── */}
              {measurementsStep === "done" && (
                <div className="p-4 space-y-4">
                  {/* توضیح */}
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      عکس‌ها را با نور کافی، لباس تنگ یا ورزشی و در ۴ زوایای جلو، پهلو، پشت و سه‌چهارم بگیرید.
                      {state.canSubmitVideo && " ارسال ویدیوی کوتاه (۲۰ ثانیه) از یک حرکت اساسی مثل اسکوات بدون وزنه اختیاری است اما به دقت برنامه کمک می‌کند."}
                    </p>
                  </div>

                  {/* Photos */}
                  <div>
                    <label className="text-sm font-bold text-slate-700 mb-2 block">
                      عکس‌های بدن (حداکثر ۴)
                    </label>
                    {photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {photos.map((p, i) => (
                          <div key={i} className="relative rounded-xl overflow-hidden border-2 border-orange-200 aspect-square">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={URL.createObjectURL(p)} alt={`عکس ${i + 1}`} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removePhoto(i)}
                              className="absolute top-1 left-1 w-6 h-6 rounded-full bg-white/90 backdrop-blur flex items-center justify-center text-red-500 shadow"
                              aria-label="حذف"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <span className="absolute bottom-1 right-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                              {toPersianDigits(i + 1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {photos.length < 4 && (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="w-full rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/30 hover:bg-orange-50/60 hover:border-orange-400 transition p-5 text-center"
                      >
                        <Camera className="w-7 h-7 text-orange-500 mx-auto mb-1.5" />
                        <p className="text-sm font-medium text-slate-900">افزودن عکس بدن</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{toPersianDigits(photos.length)}/۴ عکس — حداکثر ۵ مگابایت</p>
                      </button>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handlePhotos}
                    />
                  </div>

                  {/* Video (Ultimate only — optional) */}
                  {state.canSubmitVideo && (
                    <div>
                      <label className="text-sm font-bold text-slate-700 mb-2 block flex items-center gap-1.5">
                        <Video className="w-4 h-4 text-orange-500" />
                        ویدیوی فرم بدن (اختیاری)
                      </label>
                      {video ? (
                        <div className="rounded-2xl border-2 border-orange-200 p-3 flex items-center gap-3 bg-white">
                          <div className="w-12 h-12 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
                            <Video className="w-6 h-6 text-orange-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{video.name}</p>
                            <p className="text-[11px] text-slate-500 font-stat">{toPersianDigits(Math.round(video.size / 1024))} KB</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setVideo(null)}
                            className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition"
                            aria-label="حذف ویدیو"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => videoInputRef.current?.click()}
                          className="w-full rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/30 hover:bg-orange-50/60 hover:border-orange-400 transition p-5 text-center"
                        >
                          <Video className="w-7 h-7 text-orange-500 mx-auto mb-1.5" />
                          <p className="text-sm font-medium text-slate-900">افزودن ویدیو (اختیاری)</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">حداکثر ۲۰ مگابایت — MP4/WebM/MOV</p>
                        </button>
                      )}
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleVideo}
                      />
                      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                        💡 ارسال ویدیو اختیاری است اما به دقت برنامه کمک می‌کند.
                        برای تحلیل آزمایش خون (دلبخواه)، بعد از ساخت برنامه از بخش «آزمایش خون» در پنل اقدام کنید.
                      </p>
                    </div>
                  )}

                  {/* Back to measurements button */}
                  <button
                    type="button"
                    onClick={() => setMeasurementsStep("prompt")}
                    className="w-full text-[11px] text-orange-600 hover:text-orange-700 transition flex items-center justify-center gap-1"
                  >
                    <Ruler className="w-3 h-3" />
                    ویرایش اندازه‌های بدنی
                  </button>
                </div>
              )}

              {/* Footer — only show on photo upload step */}
              {measurementsStep === "done" && (
                <>
                  {/* نمایش مراحل مجزا هنگام ارسال (وظیفه ۱) */}
                  {submitting && (
                    <div className="p-3 border-t border-orange-100 bg-orange-50/40 space-y-2">
                      <SubmitStageDisplay stage={submitStage} photoCount={photos.length} />
                    </div>
                  )}
                  {/* نمایش خطا */}
                  {submitStage === "error" && submitError && (
                    <div className="p-3 border-t border-orange-100 bg-red-50/60 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-700">{submitError}</p>
                    </div>
                  )}
                <div className="sticky bottom-0 bg-white border-t border-orange-100 p-3 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl"
                    disabled={submitting}
                    onClick={() => setOpen(false)}
                  >
                    انصراف
                  </Button>
                  <Button
                    className="flex-1 rounded-xl text-white"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                    disabled={submitting || photos.length === 0}
                    onClick={submit}
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        در حال پردازش...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        ارسال و ساخت برنامه
                      </span>
                    )}
                  </Button>
                </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * بنر تصمیمات — وقتی عکس‌های بدن آپلود شده اما پیش‌نیازهای اختیاری
 * (ویدیو، آزمایش خون) هنوز تعیین تکلیف نشده‌اند.
 *
 * این بنر به کاربر کمک می‌کند تا:
 *  - ویدیو را آپلود یا «آپلود نمی‌کنم» بزند
 *  - آزمایش خون را آپلود، «منتظر جوابم»، یا «آپلود نمی‌کنم» بزند
 *  - وقتی همه تصمیمات گرفته شد، دکمه «ساخت برنامه» بزند
 */
function PendingDecisionsBanner({
  state,
  onRefresh,
}: {
  state: BodyAnalysisState;
  onRefresh: () => void;
}) {
  const { setWorkoutPlan, setMealPlan } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  const prerequisites = state.prerequisites || [];
  // فقط مواردی که هنوز تصمیم نشده‌اند (نه body_measurements)
  const pendingItems = prerequisites.filter(
    (p) =>
      p.type !== "body_measurements" &&
      p.status !== "completed"
  );

  if (pendingItems.length === 0 && !state.canGenerateProgram) return null;

  async function setVideoStatus(status: "skipped" | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/video-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("خطا در به‌روزرسانی وضعیت ویدیو");
      toast.success(
        status === "skipped"
          ? "باشه! برنامه بدون تحلیل ویدیو طراحی می‌شود."
          : "وضعیت ویدیو بازنشانی شد."
      );
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  async function setBloodTestStatus(status: "declined" | "pending_blood_test" | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/blood-test-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("خطا در به‌روزرسانی وضعیت آزمایش خون");
      toast.success(
        status === "declined"
          ? "باشه! برنامه بدون آزمایش خون طراحی می‌شود."
          : status === "pending_blood_test"
          ? "باشه! تا زمان آپلود نتایج، تولید برنامه متوقف می‌ماند."
          : "وضعیت آزمایش خون بازنشانی شد."
      );
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  async function generateProgram() {
    setGenerating(true);
    try {
      const res = await fetch("/api/coach/plan", { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در ساخت برنامه");
      toast.success("برنامه شما ساخته شد! 🎯");
      // بارگذاری برنامه جدید
      const planRes = await fetch("/api/coach/plan", { cache: "no-store" });
      const planData = await planRes.json();
      if (planData.workout) setWorkoutPlan(planData.workout);
      if (planData.meal) setMealPlan(planData.meal);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ساخت برنامه");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-purple-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-sm text-violet-900 dark:text-violet-200">
            مراحل نهایی برای ساخت برنامه
          </h4>
          <p className="text-[11px] text-violet-700 dark:text-violet-300 mt-1 leading-relaxed">
            عکس‌های بدن شما ذخیره شد. برای ساخت برنامه، باید موارد اختیاری زیر را تعیین تکلیف کنید (آپلود یا «رد کردن»).
          </p>
        </div>
      </div>

      {/* لیست موارد در انتظار تصمیم */}
      <div className="space-y-2.5 mb-3">
        {pendingItems.map((pre) => (
          <div
            key={pre.id}
            className="rounded-xl bg-white/70 border border-violet-200 p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <p className="text-xs font-bold text-slate-900">{pre.label}</p>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                  pre.status === "pending_decision"
                    ? "bg-amber-100 text-amber-700 border-amber-200"
                    : pre.status === "pending"
                    ? "bg-blue-100 text-blue-700 border-blue-200"
                    : "bg-rose-100 text-rose-700 border-rose-200"
                }`}
              >
                {pre.statusLabel}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
              {pre.description}
            </p>

            {/* دکمه‌های تصمیم برای ویدیو */}
            {pre.type === "video_body" && pre.status === "pending_decision" && (
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setVideoStatus("skipped")}
                  className="rounded-lg text-[11px] h-8 border-violet-300 text-violet-700 hover:bg-violet-50"
                >
                  ❌ آپلود نمی‌کنم
                </Button>
                <span className="text-[10px] text-slate-500 self-center">
                  💡 برای آپلود ویدیو، دوباره روی «ارسال عکس بدن» بزنید و ویدیو را اضافه کنید.
                </span>
              </div>
            )}

            {/* دکمه‌های تصمیم برای آزمایش خون */}
            {pre.type === "blood_test" && pre.status === "pending_decision" && (
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setBloodTestStatus("pending_blood_test")}
                  className="rounded-lg text-[11px] h-8 border-violet-300 text-violet-700 hover:bg-violet-50"
                >
                  🔄 آزمایش دادم، منتظر جوابم
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setBloodTestStatus("declined")}
                  className="rounded-lg text-[11px] h-8 border-violet-300 text-violet-700 hover:bg-violet-50"
                >
                  ❌ آپلود نمی‌کنم
                </Button>
              </div>
            )}

            {/* پیام در انتظار نتایج آزمایش */}
            {pre.type === "blood_test" && pre.status === "pending" && (
              <div className="text-[11px] text-blue-700 bg-blue-50 rounded-lg p-2 border border-blue-200">
                ⏳ در انتظار نتایج آزمایش خون. وقتی جواب آماده شد، از بخش «آزمایش خون» آپلود کنید.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setBloodTestStatus("declined")}
                  className="block mt-1.5 text-[10px] text-rose-600 hover:text-rose-700 underline"
                >
                  تغییر تصمیم: آپلود نمی‌کنم
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* دکمه ساخت برنامه — وقتی همه پیش‌نیازها تعیین تکلیف شد */}
      {state.canGenerateProgram && (
        <div className="pt-2 border-t border-violet-200">
          <Button
            size="sm"
            disabled={generating}
            onClick={generateProgram}
            className="w-full rounded-xl text-white font-bold"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> در حال ساخت برنامه...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> ساخت برنامه با فیتاپ هوشمند
              </span>
            )}
          </Button>
        </div>
      )}

      {/* پیام بلاکر */}
      {state.blockingReason && !state.canGenerateProgram && (
        <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-center">
          <p className="text-[11px] text-rose-700 leading-relaxed font-medium">
            ⚠️ {state.blockingReason}
          </p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * نمایش مراحل مجزای ارسال عکس بدن (وظیفه ۱ FOOD-ANALYSIS-LOGGING).
 * سه مرحله: آپلود → تحلیل توسط هوش مصنوعی → ساخت برنامه
 */
function SubmitStageDisplay({
  stage,
  photoCount,
}: {
  stage: "idle" | "uploading" | "analyzing" | "generating" | "done" | "error";
  photoCount: number;
}) {
  const stages: { key: typeof stage; label: string; desc: string }[] = [
    {
      key: "uploading",
      label: "در حال آپلود عکس‌ها",
      desc: `${toPersianDigits(photoCount)} عکس در حال ارسال به سرور`,
    },
    {
      key: "analyzing",
      label: "در حال تحلیل توسط هوش مصنوعی",
      desc: "فرم بدن و تعادل عضلانی تحلیل می‌شود",
    },
    {
      key: "generating",
      label: "در حال ساخت برنامه",
      desc: "برنامه تمرینی و غذایی شخصی‌سازی‌شده ساخته می‌شود",
    },
  ];
  const activeIdx = stages.findIndex((s) => s.key === stage);

  return (
    <div className="space-y-1.5">
      {stages.map((s, i) => {
        const isDone = stage === "done" || i < activeIdx;
        const isActive = i === activeIdx && stage !== "done";
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] ${
                isDone
                  ? "bg-emerald-500 text-white"
                  : isActive
                    ? "bg-orange-500 text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : isActive ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                toPersianDigits(i + 1)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={`text-[11px] font-bold ${
                  isDone
                    ? "text-emerald-700"
                    : isActive
                      ? "text-slate-900"
                      : "text-muted-foreground"
                }`}
              >
                {s.label}
              </p>
              {(isActive || isDone) && (
                <p className="text-[10px] text-slate-500">{s.desc}</p>
              )}
            </div>
          </div>
        );
      })}
      {stage === "done" && (
        <div className="flex items-center gap-2 pt-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <p className="text-[11px] font-bold text-emerald-700">
            برنامه شما ساخته شد! در حال بارگذاری...
          </p>
        </div>
      )}
    </div>
  );
}
