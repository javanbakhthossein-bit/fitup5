"use client";

import { useEffect, useState, useCallback } from "react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { motion } from "framer-motion";
import {
  X,
  Dumbbell,
  Activity,
  Target,
  Salad,
  HeartPulse,
  Moon,
  Trophy,
  Calendar,
  Pill,
  Ruler,
  Camera,
  TestTube,
  Video,
  Loader2,
  Save,
  Pencil,
  Sparkles,
  CalendarDays,
  ChevronDown,
  Images,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineVideoPreview } from "@/components/fitness/inline-video-preview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaImage } from "@/components/fitness/media-image";
import { MediaLightbox, type LightboxItem } from "@/components/fitness/media-lightbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  toPersianDigits,
  GOAL_LABELS, ACTIVITY_LABELS,
  WORKOUT_PLACE_LABELS, DIET_LABELS, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS,
  MEDICAL_CONDITION_LABELS,
  PERSIAN_WEEKDAYS,
  // v75 — رشتهٔ ورزشی + برچسب فارسی تجهیزات (مرجع واحد: lib/fitness/types)
  // v78 — equipmentListToIds: برگرداندن برچسب فارسی به id در لحظهٔ ذخیره
  DISCIPLINE_LABELS,
  DISCIPLINE_ORDER,
  equipmentFa,
  equipmentListToIds,
  type Discipline,
  type Goal, type ActivityLevel, type WorkoutPlace, type DietType,
  type TrainingExperience, type BodyFrame, type WorkoutTime,
  type PreferredCuisine, type MedicalConditionKey,
} from "@/lib/fitness/types";
import { toast } from "sonner";

/**
 * ─── مودال «پرونده ورزشی» (Sports Profile Modal) ───
 *
 * درخواست مالک: «نیازی نیست تمام اطلاعات پرونده ورزشی کاربر رو در منوی
 * پروفایل نشون بدی — اطلاعات پایه رو در منوی پروفایل بیار و یک دکمه بذار
 * با عنوان "مشاهده پرونده ورزشی" که همه‌چیز به‌صورت یک مدال جذاب با قابلیت
 * ویرایش در اونجا وجود داشته باشه».
 *
 * این مودال از پروفایل (منوی بازشو) جدا است و داده‌ی خودش را مستقل می‌گیرد:
 *   • ۹ سکشن پرونده با ویرایش آیتم‌به‌آیتم (PUT /api/onboarding/profile)
 *   • اندازه‌های اولیه بدن (baseline چکاپ فاز ۰)
 *   • تحلیل فیتاپ هوشمند
 *   • عکس‌های پیشرفت + تحلیل‌های عکس بدن / آزمایش خون / ویدیو
 */

interface OnboardingProfileDto {
  genderLabel?: string;
  age: number;
  height: number;
  weight: number;
  targetWeight?: number | null;
  goalLabel: string;
  activityLabel: string;
  workoutDays: number;
  workoutDaysList?: string[];
  workoutPlaceLabel: string;
  workoutTimeLabel?: string;
  equipment?: string[];
  dietLabel: string;
  allergies?: string;
  dislikedFoods?: string;
  preferredCuisineLabel?: string;
  waterHabit?: number | null;
  injuries?: string;
  diseases?: string;
  drugAllergies?: string;
  currentMedications?: string;
  medicalConditionsLabel?: string;
  sleepHours?: number | null;
  stressLevel?: number | null;
  bodyFrameLabel?: string;
  trainingExperienceLabel?: string;
  previousTrainingType?: string;
  maxLifts?: string;
  targetDate?: string;
  currentSupplements?: string;
  gender?: string;
  goal?: string;
  activityLevel?: string;
  workoutPlace?: string;
  workoutTime?: string;
  dietType?: string;
  preferredCuisine?: string;
  trainingExperience?: string;
  bodyFrame?: string;
  medicalConditions?: string[];
  /** v75 — رشتهٔ ورزشی (id خام + برچسب فارسی از سرور) و توضیحات کاربر */
  discipline?: string | null;
  disciplineLabel?: string | null;
  specialConditions?: string | null;
}

interface BaselineDto {
  weight: number;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  createdAt?: string;
}

type SectionId =
  | "basic" | "goal" | "equipment" | "nutrition"
  | "health" | "recovery" | "experience" | "target" | "supplements";

/** v75 — شکل آیتم‌های رسانهٔ کاربر از GET /api/user-media (برای تایپ‌سیف بودن رندر تحلیل‌ها) */
interface UserMediaItemDto {
  id?: string | number;
  mediaUrl?: string | null;
  createdAt?: string | null;
  // Task 4 — شکل result بسته به نوع تحلیل فرق می‌کند (عکس: {analysis}،
  // ویدیو: {analysis} یا {posture,symmetry,...}، خون: {overall,score,markers,...})
  // — فیلدها در helperهای videoAnalysisText/bloodAnalysisText خوانده می‌شوند.
  result?: any;
}

/** v75 — ترتیب گزینه‌های رشتهٔ ورزشی: اگر جنسیت شناخته‌شده باشد ترتیب جنسیت‌آگاه،
 *  وگرنه ترتیب پیش‌فرض DISCIPLINE_LABELS (همهٔ گزینه‌ها برای هر دو جنسیت هست). */
function disciplineOptionsFor(gender?: string | null): Discipline[] {
  return gender === "male" || gender === "female"
    ? DISCIPLINE_ORDER[gender]
    : (Object.keys(DISCIPLINE_LABELS) as Discipline[]);
}

/**
 * Task 4 — شکل گروه پلن از GET /api/user-media (planGroups).
 * هر گروه = یک دورهٔ اشتراک (تمدید/ارتقا) — آیتم‌های رسانه و تحلیل همان دوره.
 * شکل آیتم‌های داخل گروه عیناً همان آیتم‌های flat است (بدون تبدیل رندر می‌شود).
 */
interface UserMediaPhotoDto {
  id: string;
  imageUrl: string;
  type?: string | null;
  note?: string | null;
  takenAt: string;
}

interface PlanGroupDto {
  id: string;
  plan?: string | null;
  planLabel?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  label: string;
  counts?: { photos: number; bodyAnalyses: number; videoAnalyses: number; bloodTests: number };
  bodyPhotos?: UserMediaPhotoDto[];
  bodyAnalyses?: UserMediaItemDto[];
  videoAnalyses?: UserMediaItemDto[];
  bloodTests?: UserMediaItemDto[];
}

/**
 * Task 4 — عدد ترتیبی فارسی برای «تحلیل عکس اول/دوم/…».
 * دیرکتیو مالک: عکس‌ها هرگز بر اساس زاویه (جلو/بغل/عقب) دسته‌بندی نمی‌شوند —
 * فقط شمارهٔ ترتیبی. تا «دهم» واژه‌ای، بعدش عدد فارسی (یازدهم به بعد).
 */
const ORDINAL_FA = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم", "هفتم", "هشتم", "نهم", "دهم"];

function ordinalPersian(n: number): string {
  return ORDINAL_FA[n - 1] ?? toPersianDigits(n);
}

/**
 * Task 4 — متن خوانای تحلیل ویدیو از result JSON.
 * دو شکل واقعی در DB داریم:
 *  ۱) submit-body-analysis → { analysis: "..." } (متن یکجا)
 *  ۲) /api/coach/analyze-video → { posture, symmetry, issues[], recommendations[], score }
 * هر دو پوشش داده می‌شود تا آکاردئون ویدیو همیشه محتوا دارد (باگ «ویدیو تحلیلش نمایش داده نمی‌شد»).
 */
function videoAnalysisText(result: any): string {
  if (!result || typeof result !== "object") return "";
  if (typeof result.analysis === "string" && result.analysis.trim()) return result.analysis;
  const parts: string[] = [];
  if (typeof result.posture === "string" && result.posture.trim()) parts.push(`فرم و وضعیت بدن: ${result.posture}`);
  if (result.symmetry != null && result.symmetry !== 0) parts.push(`تقارن: ${toPersianDigits(result.symmetry)} از ۱۰۰`);
  if (result.score != null && result.score !== 0) parts.push(`امتیاز: ${toPersianDigits(result.score)} از ۱۰۰`);
  if (Array.isArray(result.issues) && result.issues.length) parts.push(`مشکلات: ${result.issues.join("، ")}`);
  if (Array.isArray(result.recommendations) && result.recommendations.length) parts.push(`توصیه‌ها: ${result.recommendations.join("، ")}`);
  return parts.join("\n");
}

/** برچسب فارسی وضعیت نشانگر آزمایش خون (هم‌قرارداد با blood-test-view) */
const BLOOD_STATUS_LABELS: Record<string, string> = {
  normal: "نرمال",
  low: "پایین",
  high: "بالا",
  borderline: "مرزی",
  unknown: "نامشخص",
};

const BLOOD_STATUS_CLASSES: Record<string, string> = {
  normal: "bg-emerald-100 text-emerald-700",
  low: "bg-amber-100 text-amber-700",
  high: "bg-rose-100 text-rose-700",
  borderline: "bg-orange-100 text-orange-700",
  unknown: "bg-slate-100 text-slate-500",
};

/**
 * Task 4 — متن کامل خوانای تحلیل آزمایش خون از result JSON.
 * شکل واقعی ردیف (analyze-blood): { overall, score, markers[], deficiencies[],
 * recommendations[], supplements[], warnings[] } — این متن داخل آکاردئون رندر
 * می‌شود (بازسازی کامل UI تحلیل خون عمداً نمی‌شود — برای آن «مشاهدهٔ تحلیل کامل»
 * کاربر به BloodTestView می‌رود).
 */
function bloodAnalysisText(result: any): string {
  if (!result || typeof result !== "object") return "";
  const lines: string[] = [];
  if (typeof result.overall === "string" && result.overall.trim()) lines.push(result.overall.trim());
  if (Array.isArray(result.deficiencies) && result.deficiencies.length) {
    lines.push(`کمبودها: ${result.deficiencies.join("، ")}`);
  }
  if (Array.isArray(result.markers) && result.markers.length) {
    lines.push("نشانگرها:");
    for (const m of result.markers) {
      const status = BLOOD_STATUS_LABELS[m?.status] || "";
      lines.push(`• ${m?.name || "نشانگر"}${m?.value ? `: ${m.value}${m?.unit ? ` ${m.unit}` : ""}` : ""}${status ? ` (${status})` : ""}`);
    }
  }
  if (Array.isArray(result.recommendations) && result.recommendations.length) {
    lines.push("توصیه‌ها:");
    for (const rec of result.recommendations) lines.push(`• ${rec}`);
  }
  if (Array.isArray(result.supplements) && result.supplements.length) {
    lines.push(`مکمل‌های پیشنهادی: ${result.supplements.join("، ")}`);
  }
  if (Array.isArray(result.warnings) && result.warnings.length) {
    lines.push(`⚠️ هشدارها: ${result.warnings.join("، ")}`);
  }
  return lines.join("\n");
}

export function SportsProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useScrollLock(open);
  const { user, setOverlay } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<OnboardingProfileDto | null>(null);
  const [baseline, setBaseline] = useState<BaselineDto | null>(null);
  const [analysis, setAnalysis] = useState<string>("");
  const [userMedia, setUserMedia] = useState<any>({
    bodyPhotos: [], bloodTests: [], videoAnalysis: [], bodyAnalysis: [], planGroups: [],
  });
  // Task 4-a: لایت‌باکس عکس‌های بدن داخل گروه‌های پلن — آیتم‌ها از همان گروه
  const [lightboxItems, setLightboxItems] = useState<LightboxItem[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [editingSection, setEditingSection] = useState<SectionId | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // v15: تاریخ عضویت در فیتاپ — از پاسخ /api/onboarding/analysis (memberSince)
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const memberSinceText = (() => {
    if (!memberSince) return null;
    try {
      return new Date(memberSince).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return null;
    }
  })();

  // ─── Task 4 — گروه‌های پلن (نمایش: جدیدترین اول) + fallback پاسخ قدیمی ───
  // اگر پاسخ API کلید planGroups نداشت (کش قدیمی)، یک گروه واحد «همهٔ دوره‌ها»
  // از آرایه‌های flat ساخته می‌شود تا UI هیچ‌وقت خالی‌شیک نمی‌ماند.
  const planGroups: PlanGroupDto[] = (() => {
    const raw = userMedia?.planGroups;
    if (Array.isArray(raw) && raw.length > 0) {
      return [...raw].reverse() as PlanGroupDto[];
    }
    const flat = userMedia ?? {};
    const bodyPhotos = Array.isArray(flat.bodyPhotos) ? flat.bodyPhotos : [];
    const bodyAnalyses = Array.isArray(flat.bodyAnalysis) ? flat.bodyAnalysis : [];
    const videoAnalyses = Array.isArray(flat.videoAnalysis) ? flat.videoAnalysis : [];
    const bloodTests = Array.isArray(flat.bloodTests) ? flat.bloodTests : [];
    if (!bodyPhotos.length && !bodyAnalyses.length && !videoAnalyses.length && !bloodTests.length) {
      return [];
    }
    return [{
      id: "all",
      label: "همهٔ دوره‌ها",
      bodyPhotos,
      bodyAnalyses,
      videoAnalyses,
      bloodTests,
      counts: {
        photos: bodyPhotos.length,
        bodyAnalyses: bodyAnalyses.length,
        videoAnalyses: videoAnalyses.length,
        bloodTests: bloodTests.length,
      },
    }];
  })();

  const totalMediaCount = planGroups.reduce((sum, g) => {
    const c = g.counts ?? {
      photos: g.bodyPhotos?.length ?? 0,
      bodyAnalyses: g.bodyAnalyses?.length ?? 0,
      videoAnalyses: g.videoAnalyses?.length ?? 0,
      bloodTests: g.bloodTests?.length ?? 0,
    };
    return sum + c.photos + c.bodyAnalyses + c.videoAnalyses + c.bloodTests;
  }, 0);

  const loadData = useCallback(async () => {
    try {
      // Task 4: /api/progress حذف شد — عکس‌های بدن حالا از planGroups همان
      // /api/user-media می‌آیند (گروه‌بندی‌شده بر اساس دورهٔ پلن) و کارت تختِ
      // «عکس‌های پیشرفت» جای خود را به بخش گروه‌بندی‌شده داده است.
      const [onboardingRes, mediaRes] = await Promise.all([
        fetch("/api/onboarding/analysis"),
        fetch("/api/user-media"),
      ]);
      const onboardingData = await onboardingRes.json().catch(() => null);
      const mediaData = await mediaRes.json().catch(() => null);
      if (onboardingData?.profile) setProfile(onboardingData.profile);
      if (onboardingData?.baseline) setBaseline(onboardingData.baseline);
      if (onboardingData?.analysis) setAnalysis(onboardingData.analysis);
      // v15: تاریخ عضویت در فیتاپ
      setMemberSince(onboardingData?.memberSince ?? null);
      if (mediaData) setUserMedia(mediaData);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      setEditingSection(null);
      loadData();
    }
  }, [open, loadData]);

  function startEditing(section: SectionId) {
    const p = profile;
    if (!p) return;
    const d: Record<string, string> = {};
    switch (section) {
      case "basic":
        d.age = String(p.age ?? "");
        d.height = String(p.height ?? "");
        d.weight = String(p.weight ?? "");
        d.targetWeight = String(p.targetWeight ?? "");
        d.gender = p.gender || "male";
        break;
      case "goal":
        d.goal = p.goal || "fitness";
        d.activityLevel = p.activityLevel || "moderate";
        d.workoutDays = String(p.workoutDays ?? "");
        d.workoutPlace = p.workoutPlace || "gym";
        d.workoutTime = p.workoutTime || "";
        d.workoutDaysList = (p.workoutDaysList || []).join(",");
        break;
      case "equipment":
        // v78 — گزارش مالک: ویرایش تجهیزات انگلیسی بود. حالا فرم ویرایش برچسب
        // فارسی نشان می‌دهد (equipmentFa) و در saveSection به id برمی‌گردد؛
        // متن ناشناس/id خام هم دست‌نخورده حفظ می‌شود تا داده خراب نشود.
        d.equipment = (p.equipment || []).map((eq) => equipmentFa(eq)).join("، ");
        break;
      case "nutrition":
        d.dietType = p.dietType || "standard";
        d.preferredCuisine = p.preferredCuisine || "";
        d.dislikedFoods = p.dislikedFoods || "";
        d.allergies = p.allergies || "";
        break;
      case "health":
        d.injuries = p.injuries || "";
        d.diseases = p.diseases || "";
        d.drugAllergies = p.drugAllergies || "";
        d.currentMedications = p.currentMedications || "";
        d.medicalConditions = (p.medicalConditions || []).join(",");
        // v75 — توضیحات کاربر: همیشه در editData هست (حتی وقتی خالی است) تا کاربر
        // بتواند در فیلد خالی بنویسد و رشتهٔ خالی هم برای پاک‌کردن مقدار به سرور برود
        d.specialConditions = p.specialConditions ?? "";
        break;
      case "recovery":
        d.sleepHours = String(p.sleepHours ?? "");
        d.stressLevel = String(p.stressLevel ?? "");
        d.waterHabit = String(p.waterHabit ?? "");
        d.bodyFrame = p.bodyFrame || "";
        break;
      case "experience":
        d.trainingExperience = p.trainingExperience || "beginner";
        d.previousTrainingType = p.previousTrainingType || "";
        d.maxLifts = p.maxLifts || "";
        // v75 — رشتهٔ ورزشی (مقدار خالی = گزینهٔ «— انتخاب رشته —» و پاک‌کردن در سرور)
        d.discipline = p.discipline || "";
        break;
      case "target":
        d.targetDate = p.targetDate || "";
        break;
      case "supplements":
        d.currentSupplements = p.currentSupplements || "";
        break;
    }
    setEditData(d);
    setEditingSection(section);
  }

  function cancelEditing() {
    setEditingSection(null);
    setEditData({});
  }

  async function saveSection() {
    if (!editingSection) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      const numFields: Record<SectionId, string[]> = {
        basic: ["age", "height", "weight", "targetWeight"],
        goal: ["workoutDays"],
        equipment: [],
        nutrition: [],
        health: [],
        recovery: ["sleepHours", "stressLevel", "waterHabit"],
        experience: [],
        target: [],
        supplements: [],
      };
      // نکتهٔ v75: مقادیر رشتهٔ خالی فیلتر نمی‌شوند — مثلاً «specialConditions: ""»
      // عمداً ارسال می‌شود تا سرور (trim→null) فیلد را پاک کند؛ همین‌طور
      // «discipline: ""» در سرور به null تبدیل می‌شود.
      for (const [k, v] of Object.entries(editData)) {
        if (numFields[editingSection].includes(k)) {
          payload[k] = v === "" ? null : Number(v);
        } else {
          payload[k] = v;
        }
      }
      // v78 — تجهیزات با برچسب فارسی ویرایش می‌شوند؛ در لحظهٔ ذخیره به id
      // برمی‌گردند (سرور همان قرارداد قبلی: آرایهٔ id/متن)
      if (editingSection === "equipment") {
        payload.equipment = equipmentListToIds(editData.equipment || "");
      }
      const res = await fetch("/api/onboarding/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEditingSection(null);
      setEditData({});
      // ─── v80 — دیریکتیو مالک: بعد از تغییر وزن، کاربر باید بلافاصله بتواند
      // برنامه‌ها را با وزن جدید بسازد. سرور هم‌زمان WeightLog جدید ثبت می‌کند،
      // weightUpdatedAt را به‌روز می‌کند و کش تحلیل AI را باطل می‌کند (تحلیل
      // مجدد با دادهٔ جدید). چون مودال باز روی توست اکشن لایه می‌اندازد و کلیک
      // دکمهٔ «بروزرسانی برنامه» را می‌بلعد، ابتدا مودال را می‌بندیم و بعد
      // توستِ اقدام را نشان می‌دهیم.
      if (data?.weightChanged === true) {
        // بستن مودال + Sheet پروفایل قبل از نمایش توست اکشن: رادیکس (scroll-lock)
        // تا وقتی هر overlayای باز است، pointer-events بدنه را none می‌کند و توست
        // قابل کلیک نیست. با بستن هر دو لایه، دکمهٔ «بروزرسانی برنامه» بلافاصله
        // قابل کلیک می‌شود.
        onClose();
        useAppStore.getState().setOverlay(null);
        toast.success("وزن جدید شما ثبت شد ⚖️ و به مربی هوشمند تزریق شد", {
          description:
            "برنامه‌های فعلی شما با وزن قبلی ساخته شده‌اند. همین حالا می‌توانید برنامهٔ تمرینی، غذایی و مکمل را با وزن جدید بازسازی کنید."
            // v107 — تیکت خودکار «تغییر پروفایل» در پنل مدیر ثبت شد — کاربر در جریان باشد
            + (data?.changeTicketCreated
              ? " تغییرات شما برای مدیر هم ارسال شد تا برنامه با مشخصات جدید بازبینی شود."
              : ""),
          action: {
            label: "بروزرسانی برنامه",
            onClick: () => void regeneratePlanWithNewWeight(),
          },
          duration: 15000,
        });
      } else if (data?.ok) {
        // v107 — اگر سرور تیکت بازبینی برای مدیر ساخت، توستِ ارجاع نمایش داده می‌شود
        if (data?.changeTicketCreated) {
          toast.success("پروفایل به‌روزرسانی شد و به مربی هوشمند تزریق شد ✅", {
            description: "تغییرات شما برای مدیر ارسال شد تا برنامه با مشخصات جدید بازبینی شود.",
            duration: 8000,
          });
        } else {
          toast.success("پروفایل به‌روزرسانی شد و به مربی هوشمند تزریق شد ✅");
        }
      } else {
        toast.success("پرونده ورزشی به‌روزرسانی شد ✅");
      }
      await loadData();
    } catch {
      toast.error("خطا در ذخیره پروفایل");
    } finally {
      setSaving(false);
    }
  }

  /**
   * v80 — بازتولید برنامه (تمرینی + غذایی + مکمل) با وزن/اطلاعات جدید پروفایل.
   * PUT /api/coach/plan تولید را در پس‌زمینه شروع می‌کند؛ وقتی وزن ثبت‌شده با
   * وزنِ لحظهٔ ساخت برنامهٔ فعلی ≥۲ کیلو اختلاف داشته باشد، قفل ۲۴ ساعتهٔ
   * «برنامهٔ تازه» هم از سمت سرور بای‌پس می‌شود (سیاست v76 ناسازگاری وزن).
   */
  async function regeneratePlanWithNewWeight() {
    const t = toast.loading("درخواست بازسازی برنامه با اطلاعات جدید ثبت شد...");
    try {
      // v81 — دیرکتیو مالک: بازتولید ناشی از تغییر وزن هرگز نباید اشتراک/پلن/
      // مدت اشتراک را تغییر دهد → source: weight_update (سمت سرور فعال‌سازی
      // اشتراک pending و هر تغییری در پلن skip می‌شود).
      const res = await fetch("/api/coach/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "weight_update" }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.started) {
        toast.success(
          "برنامهٔ جدید با وزن جدید شما در حال ساخت است — طی چند دقیقه در تب «برنامه‌ها» جایگزین برنامهٔ فعلی می‌شود.",
          { id: t, duration: 8000 }
        );
        onClose();
        useAppStore.getState().setMainTab("programs");
      } else {
        toast.error(d?.error ?? "شروع بازسازی برنامه ممکن نشد. بعداً تلاش کنید.", { id: t });
      }
    } catch {
      toast.error("خطای شبکه در بازسازی برنامه.", { id: t });
    }
  }

  const p = profile;

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="پرونده ورزشی"
    >
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg h-[94vh] sm:h-[90vh] bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden shadow-2xl"
        dir="rtl"
      >
        {/* Header */}
        <div
          className="relative flex items-center justify-between p-4 text-white shrink-0 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-black text-base leading-tight">پرونده ورزشی</h2>
              <p className="text-[10px] opacity-80">همه‌چیز درباره بدن و اهدافت — با ویرایش سریع</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="relative rounded-full text-white hover:bg-white/20 hover:text-white"
            aria-label="بستن پرونده ورزشی"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 bg-slate-50/50">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          ) : !p ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                <Dumbbell className="w-7 h-7 text-orange-500" />
              </div>
              <p className="text-sm text-slate-500">پرونده ورزشی یافت نشد — اول آنبوردینگ را کامل کنید.</p>
            </div>
          ) : (
            <>
              {/* خلاصه بالا */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-4 bg-white">
                  {/* v15: تاریخ عضویت در فیتاپ (درخواست مالک — آنبوردینگ/پرونده کامل) */}
                  {memberSinceText && (
                    <div className="flex items-center justify-center gap-1.5 mb-3 pb-3 border-b border-orange-50">
                      <CalendarDays className="w-3.5 h-3.5 text-orange-500" />
                      <p className="text-[11px] text-orange-700 font-bold">عضو فیتاپ از {memberSinceText}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <SummaryChip label="سن" value={p.age ? `${toPersianDigits(p.age)}` : "—"} />
                    <SummaryChip label="قد" value={p.height ? `${toPersianDigits(p.height)}` : "—"} unit="cm" />
                    <SummaryChip label="وزن" value={p.weight ? `${toPersianDigits(p.weight)}` : "—"} unit="kg" />
                    <SummaryChip label="هدف" value={p.goalLabel || "—"} />
                  </div>
                </Card>
              </motion.div>

              {/* ۹ سکشن پرونده */}
              <Card className="p-4 space-y-4 bg-white">
                {/* ۱) اطلاعات پایه */}
                <Section
                  title="اطلاعات پایه"
                  icon={<Activity className="w-4 h-4 text-primary" />}
                  editing={editingSection === "basic"}
                  onEdit={() => startEditing("basic")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "basic" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <EditSelect
                        label="جنسیت"
                        value={editData.gender || "male"}
                        onChange={(v) => setEditData({ ...editData, gender: v })}
                        options={[
                          { value: "male", label: "آقا" },
                          { value: "female", label: "خانم" },
                        ]}
                      />
                      <EditField label="سن (سال)" value={editData.age || ""} onChange={(v) => setEditData({ ...editData, age: v })} type="number" />
                      <EditField label="قد (cm)" value={editData.height || ""} onChange={(v) => setEditData({ ...editData, height: v })} type="number" />
                      <EditField label="وزن (kg)" value={editData.weight || ""} onChange={(v) => setEditData({ ...editData, weight: v })} type="number" />
                      <EditField label="وزن هدف (kg)" value={editData.targetWeight || ""} onChange={(v) => setEditData({ ...editData, targetWeight: v })} type="number" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <InfoRow label="جنسیت" value={p.genderLabel || "—"} />
                      <InfoRow label="سن" value={`${toPersianDigits(p.age)} سال`} />
                      <InfoRow label="قد" value={`${toPersianDigits(p.height)} cm`} />
                      <InfoRow label="وزن فعلی" value={`${toPersianDigits(p.weight)} kg`} />
                      {p.targetWeight != null && <InfoRow label="وزن هدف" value={`${toPersianDigits(p.targetWeight)} kg`} />}
                    </div>
                  )}
                </Section>

                {/* ۲) هدف و فعالیت */}
                <Section
                  title="هدف و فعالیت"
                  icon={<Target className="w-4 h-4 text-amber-500" />}
                  editing={editingSection === "goal"}
                  onEdit={() => startEditing("goal")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "goal" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <EditSelect
                        label="هدف اصلی"
                        value={editData.goal || "fitness"}
                        onChange={(v) => setEditData({ ...editData, goal: v })}
                        options={(Object.keys(GOAL_LABELS) as Goal[]).map((g) => ({ value: g, label: GOAL_LABELS[g] }))}
                      />
                      <EditSelect
                        label="سطح فعالیت"
                        value={editData.activityLevel || "moderate"}
                        onChange={(v) => setEditData({ ...editData, activityLevel: v })}
                        options={(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((g) => ({ value: g, label: ACTIVITY_LABELS[g] }))}
                      />
                      <EditField label="روزهای تمرین در هفته" value={editData.workoutDays || ""} onChange={(v) => setEditData({ ...editData, workoutDays: v })} type="number" />
                      <EditSelect
                        label="محیط تمرین"
                        value={editData.workoutPlace || "gym"}
                        onChange={(v) => setEditData({ ...editData, workoutPlace: v })}
                        options={(Object.keys(WORKOUT_PLACE_LABELS) as WorkoutPlace[]).map((g) => ({ value: g, label: WORKOUT_PLACE_LABELS[g] }))}
                      />
                      <EditSelect
                        label="زمان ترجیحی تمرین"
                        value={editData.workoutTime || ""}
                        onChange={(v) => setEditData({ ...editData, workoutTime: v })}
                        options={[
                          { value: "", label: "—" },
                          ...(Object.keys(WORKOUT_TIME_LABELS) as WorkoutTime[]).map((g) => ({ value: g, label: WORKOUT_TIME_LABELS[g] })),
                        ]}
                      />
                      <div className="col-span-2">
                        <Label className="mb-1 block text-[11px] text-muted-foreground">روزهای انتخابی هفته</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {PERSIAN_WEEKDAYS.map((day) => {
                            const selected = (editData.workoutDaysList || "").split(",").map((s) => s.trim()).includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  const current = (editData.workoutDaysList || "").split(",").map((s) => s.trim()).filter(Boolean);
                                  const next = selected ? current.filter((d) => d !== day) : [...current, day];
                                  setEditData({ ...editData, workoutDaysList: next.join(",") });
                                }}
                                className={`text-[11px] px-2.5 py-1 rounded-lg transition ${
                                  selected ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground hover:bg-muted"
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      <InfoRow label="هدف اصلی" value={p.goalLabel} />
                      <InfoRow label="سطح فعالیت" value={p.activityLabel} />
                      <InfoRow label="روزهای تمرین" value={`${toPersianDigits(p.workoutDays)} روز در هفته`} />
                      {p.workoutDaysList && p.workoutDaysList.length > 0 && (
                        <InfoRow label="روزهای انتخابی" value={p.workoutDaysList.join("، ")} />
                      )}
                      <InfoRow label="محیط تمرین" value={p.workoutPlaceLabel} />
                      {p.workoutTimeLabel && <InfoRow label="زمان ترجیحی تمرین" value={p.workoutTimeLabel} />}
                    </div>
                  )}
                </Section>

                {/* ۳) تجهیزات */}
                <Section
                  title="تجهیزات"
                  icon={<Dumbbell className="w-4 h-4 text-violet-500" />}
                  editing={editingSection === "equipment"}
                  onEdit={() => startEditing("equipment")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "equipment" ? (
                    <EditTextArea
                      label="تجهیزات در دسترس (با کاما جدا کنید)"
                      value={editData.equipment || ""}
                      onChange={(v) => setEditData({ ...editData, equipment: v })}
                      placeholder="مثلاً: دمبل، هالتر، دستگاه پرس سینه، کش"
                    />
                  ) : (
                    p.equipment && p.equipment.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {/* v75 — برچسب فارسی تجهیزات (دیگر id خام مثل dumbbell دیده نمی‌شود).
                            نکته: حالت ویرایش همان idهای خام را ویرایش می‌کند تا داده
                            خراب نشود (سرور id ذخیره می‌کند). */}
                        {p.equipment.map((eq) => (
                          <span key={eq} className="text-[11px] px-2 py-1 rounded-lg bg-muted/60 text-foreground">
                            {equipmentFa(eq)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">بدون تجهیزات خاص</p>
                    )
                  )}
                </Section>

                {/* ۴) تغذیه */}
                <Section
                  title="تغذیه"
                  icon={<Salad className="w-4 h-4 text-emerald-500" />}
                  editing={editingSection === "nutrition"}
                  onEdit={() => startEditing("nutrition")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "nutrition" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <EditSelect
                        label="نوع رژیم"
                        value={editData.dietType || "standard"}
                        onChange={(v) => setEditData({ ...editData, dietType: v })}
                        options={(Object.keys(DIET_LABELS) as DietType[]).map((g) => ({ value: g, label: DIET_LABELS[g] }))}
                      />
                      <EditSelect
                        label="سبک آشپزی"
                        value={editData.preferredCuisine || ""}
                        onChange={(v) => setEditData({ ...editData, preferredCuisine: v })}
                        options={[
                          { value: "", label: "—" },
                          ...(Object.keys(PREFERRED_CUISINE_LABELS) as PreferredCuisine[]).map((g) => ({ value: g, label: PREFERRED_CUISINE_LABELS[g] })),
                        ]}
                      />
                      <EditField label="حساسیت غذایی" value={editData.allergies || ""} onChange={(v) => setEditData({ ...editData, allergies: v })} />
                      <div className="col-span-2">
                        <EditTextArea
                          label="غذاهای دوست‌نداشته/حذفی"
                          value={editData.dislikedFoods || ""}
                          onChange={(v) => setEditData({ ...editData, dislikedFoods: v })}
                          placeholder="مثلاً: بادمجان، کرفس، فست‌فود"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      <InfoRow label="نوع رژیم" value={p.dietLabel} />
                      <InfoRow label="حساسیت غذایی" value={p.allergies?.trim() ? p.allergies : "ندارد"} />
                      {p.dislikedFoods?.trim() && <InfoRow label="غذاهای دوست‌نداشته" value={p.dislikedFoods} />}
                      {p.preferredCuisineLabel && <InfoRow label="سبک آشپزی" value={p.preferredCuisineLabel} />}
                      {p.waterHabit != null && <InfoRow label="مصرف آب فعلی" value={`${toPersianDigits(p.waterHabit)} لیوان در روز`} />}
                    </div>
                  )}
                </Section>

                {/* ۵) سلامت */}
                <Section
                  title="سلامت و پزشکی"
                  icon={<HeartPulse className="w-4 h-4 text-rose-500" />}
                  editing={editingSection === "health"}
                  onEdit={() => startEditing("health")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "health" ? (
                    <div className="grid grid-cols-1 gap-2">
                      <EditTextArea label="آسیب‌دیدگی‌ها" value={editData.injuries || ""} onChange={(v) => setEditData({ ...editData, injuries: v })} placeholder="مثلاً: آسیب زانوی راست، دیسک کمر" />
                      <EditTextArea label="بیماری‌ها" value={editData.diseases || ""} onChange={(v) => setEditData({ ...editData, diseases: v })} placeholder="مثلاً: دیابت نوع ۲، فشار خون" />
                      <EditField label="آلرژی دارویی" value={editData.drugAllergies || ""} onChange={(v) => setEditData({ ...editData, drugAllergies: v })} />
                      <EditField label="داروهای مصرفی" value={editData.currentMedications || ""} onChange={(v) => setEditData({ ...editData, currentMedications: v })} />
                      <div>
                        <Label className="mb-1.5 block text-[11px] text-muted-foreground">شرایط پزشکی خاص</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(MEDICAL_CONDITION_LABELS) as MedicalConditionKey[]).map((c) => {
                            const selected = (editData.medicalConditions || "").split(",").map((s) => s.trim()).includes(c);
                            return (
                              <button
                                key={c}
                                type="button"
                                onClick={() => {
                                  const current = (editData.medicalConditions || "").split(",").map((s) => s.trim()).filter(Boolean);
                                  const next = selected ? current.filter((x) => x !== c) : [...current, c];
                                  setEditData({ ...editData, medicalConditions: next.join(",") });
                                }}
                                className={`text-[11px] px-2.5 py-1 rounded-lg transition ${
                                  selected ? "bg-rose-500 text-white" : "bg-muted/60 text-foreground hover:bg-muted"
                                }`}
                              >
                                {MEDICAL_CONDITION_LABELS[c]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {/* v75 — توضیحات کاربر (برای مربی هوشمند): همیشه قابل ویرایش حتی
                          وقتی خالی است؛ سقف ۶۰۰ کاراکتر (هم‌راستا با سرور). رشتهٔ خالی
                          هم ذخیره می‌شود تا مقدار قبلی پاک شود. */}
                      <EditTextArea
                        label="توضیحات کاربر (برای مربی هوشمند)"
                        value={editData.specialConditions ?? ""}
                        onChange={(v) => setEditData({ ...editData, specialConditions: v })}
                        placeholder="هر شرایط/نیاز/هدف خاصی که می‌خواهی مربی بداند — مثلاً شرایط زندگی، محدودیت‌ها، هدف‌گذاری ویژه…"
                        maxLength={600}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      <InfoRow label="آسیب‌دیدگی" value={p.injuries?.trim() ? p.injuries : "ندارد"} />
                      <InfoRow label="بیماری‌ها" value={p.diseases?.trim() ? p.diseases : "ندارد"} />
                      <InfoRow label="آلرژی دارویی" value={p.drugAllergies?.trim() ? p.drugAllergies : "ندارد"} />
                      <InfoRow label="داروهای مصرفی" value={p.currentMedications?.trim() ? p.currentMedications : "ندارد"} />
                      <InfoRow label="شرایط پزشکی" value={p.medicalConditionsLabel || "ندارد"} />
                      {/* v75 — توضیحات کاربر؛ اگر خالی باشد «—» نشان داده می‌شود */}
                      <InfoRow label="توضیحات کاربر" value={p.specialConditions?.trim() ? p.specialConditions : "—"} />
                    </div>
                  )}
                </Section>

                {/* ۶) ریکاوری */}
                <Section
                  title="ریکاوری"
                  icon={<Moon className="w-4 h-4 text-teal-500" />}
                  editing={editingSection === "recovery"}
                  onEdit={() => startEditing("recovery")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "recovery" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <EditField label="ساعت خواب شبانه" value={editData.sleepHours || ""} onChange={(v) => setEditData({ ...editData, sleepHours: v })} type="number" />
                      <EditField label="سطح استرس (۱-۵)" value={editData.stressLevel || ""} onChange={(v) => setEditData({ ...editData, stressLevel: v })} type="number" />
                      <EditField label="مصرف آب (لیوان/روز)" value={editData.waterHabit || ""} onChange={(v) => setEditData({ ...editData, waterHabit: v })} type="number" />
                      <EditSelect
                        label="فرم بدن"
                        value={editData.bodyFrame || ""}
                        onChange={(v) => setEditData({ ...editData, bodyFrame: v })}
                        options={[
                          { value: "", label: "—" },
                          ...(Object.keys(BODY_FRAME_LABELS) as BodyFrame[]).map((g) => ({ value: g, label: BODY_FRAME_LABELS[g] })),
                        ]}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {p.sleepHours != null && <InfoRow label="ساعت خواب" value={`${toPersianDigits(p.sleepHours)} ساعت`} />}
                      {p.stressLevel != null && (
                        <InfoRow label="سطح استرس" value={p.stressLevel <= 2 ? "کم" : p.stressLevel <= 3 ? "متوسط" : "زیاد"} />
                      )}
                      {p.waterHabit != null && <InfoRow label="مصرف آب" value={`${toPersianDigits(p.waterHabit)} لیوان/روز`} />}
                      {p.bodyFrameLabel && <InfoRow label="فرم بدن" value={p.bodyFrameLabel} />}
                    </div>
                  )}
                </Section>

                {/* ۷) تجربه ورزشی */}
                <Section
                  title="تجربه ورزشی"
                  icon={<Trophy className="w-4 h-4 text-amber-500" />}
                  editing={editingSection === "experience"}
                  onEdit={() => startEditing("experience")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "experience" ? (
                    <div className="grid grid-cols-1 gap-2">
                      {/* v75 — رشتهٔ ورزشی: همهٔ گزینه‌ها با ترتیب جنسیت‌آگاه + گزینهٔ خالی برای پاک‌کردن */}
                      <EditSelect
                        label="رشتهٔ ورزشی"
                        value={editData.discipline || ""}
                        onChange={(v) => setEditData({ ...editData, discipline: v })}
                        options={[
                          { value: "", label: "— انتخاب رشته —" },
                          ...disciplineOptionsFor(p.gender).map((d) => ({ value: d, label: DISCIPLINE_LABELS[d] })),
                        ]}
                      />
                      <EditSelect
                        label="سابقه ورزشی"
                        value={editData.trainingExperience || "beginner"}
                        onChange={(v) => setEditData({ ...editData, trainingExperience: v })}
                        options={(Object.keys(TRAINING_EXPERIENCE_LABELS) as TrainingExperience[]).map((g) => ({ value: g, label: TRAINING_EXPERIENCE_LABELS[g] }))}
                      />
                      <EditField label="نوع تمرین قبلی" value={editData.previousTrainingType || ""} onChange={(v) => setEditData({ ...editData, previousTrainingType: v })} />
                      <EditTextArea label="حداکثر وزنه‌ها (اسکوات/پرس/ددلیفت)" value={editData.maxLifts || ""} onChange={(v) => setEditData({ ...editData, maxLifts: v })} placeholder="مثلاً: اسکوات ۱۰۰، پرس ۸۰، ددلیفت ۱۲۰" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {/* v75 — رشتهٔ ورزشی (برچسب فارسی از سرور می‌آید) */}
                      <InfoRow label="رشتهٔ ورزشی" value={p.disciplineLabel || "—"} />
                      <InfoRow label="سابقه ورزشی" value={p.trainingExperienceLabel || "مشخص نشده"} />
                      {p.previousTrainingType?.trim() && <InfoRow label="نوع تمرین قبلی" value={p.previousTrainingType} />}
                      {p.maxLifts?.trim() && <InfoRow label="حداکثر وزنه‌ها" value={p.maxLifts} />}
                    </div>
                  )}
                </Section>

                {/* ۸) تاریخ هدف */}
                <Section
                  title="تاریخ هدف"
                  icon={<Calendar className="w-4 h-4 text-cyan-500" />}
                  editing={editingSection === "target"}
                  onEdit={() => startEditing("target")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "target" ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-muted-foreground">تاریخ هدف (میلادی)</span>
                      <Input
                        type="date"
                        value={editData.targetDate || ""}
                        onChange={(e) => setEditData({ ...editData, targetDate: e.target.value })}
                        className="h-9 rounded-lg text-sm"
                        dir="ltr"
                      />
                    </div>
                  ) : (
                    <InfoRow
                      label="تاریخ هدف"
                      value={p.targetDate ? new Date(p.targetDate).toLocaleDateString("fa-IR") : "مشخص نشده"}
                    />
                  )}
                </Section>

                {/* ۹) مکمل‌ها */}
                <Section
                  title="مکمل‌ها"
                  icon={<Pill className="w-4 h-4 text-violet-500" />}
                  editing={editingSection === "supplements"}
                  onEdit={() => startEditing("supplements")}
                  onCancel={cancelEditing}
                  onSave={saveSection}
                  saving={saving}
                >
                  {editingSection === "supplements" ? (
                    <EditTextArea
                      label="مکمل‌های فعلی مصرفی"
                      value={editData.currentSupplements || ""}
                      onChange={(v) => setEditData({ ...editData, currentSupplements: v })}
                      placeholder="مثلاً: کراتین ۵ گرم، پروتئین وی، امگا ۳"
                    />
                  ) : (
                    <InfoRow label="مکمل‌های فعلی" value={p.currentSupplements?.trim() ? p.currentSupplements : "ندارد"} />
                  )}
                </Section>

                {/* Baseline */}
                {baseline && (
                  <Section title="اندازه‌های اولیه بدن (Baseline)" icon={<Ruler className="w-4 h-4 text-violet-500" />}>
                    <div className="grid grid-cols-2 gap-2">
                      <InfoRow label="وزن اولیه" value={`${toPersianDigits(baseline.weight)} kg`} />
                      {baseline.chestMeasurement != null && <InfoRow label="دور سینه" value={`${toPersianDigits(baseline.chestMeasurement)} cm`} />}
                      {baseline.armMeasurement != null && <InfoRow label="دور بازو" value={`${toPersianDigits(baseline.armMeasurement)} cm`} />}
                      {baseline.waistMeasurement != null && <InfoRow label="دور کمر" value={`${toPersianDigits(baseline.waistMeasurement)} cm`} />}
                      {baseline.hipMeasurement != null && <InfoRow label="دور باسن" value={`${toPersianDigits(baseline.hipMeasurement)} cm`} />}
                      {baseline.thighMeasurement != null && <InfoRow label="دور ران" value={`${toPersianDigits(baseline.thighMeasurement)} cm`} />}
                    </div>
                    {baseline.createdAt && (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        ثبت شده در: {new Date(baseline.createdAt).toLocaleDateString("fa-IR")}
                      </p>
                    )}
                  </Section>
                )}
              </Card>

              {/* تحلیل هوشمند */}
              {analysis && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <h3 className="font-bold text-sm">تحلیل فیتاپ هوشمند</h3>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                      {analysis}
                    </p>
                  </Card>
                </motion.div>
              )}

              {/* ─── Task 4: پروندهٔ رسانه و تحلیل‌ها — گروه‌بندی بر اساس پلن ───
                  درخواست مالک: کاربر در هر دورهٔ اشتراک (تمدید/ارتقا) عکس/ویدیوی
                  بدن و آزمایش خون جدید می‌فرستد؛ این‌جا هر دوره به‌صورت یک بلوک
                  جمع‌شونده با آیتم‌های همان دوره دیده می‌شود.
                  دسته‌بندی زاویه‌ای (جلو/بغل/عقب) هیچ‌جا وجود ندارد — فقط شمارهٔ
                  ترتیبی «تحلیل عکس اول/دوم/…» (دیرکتیو صریح مالک). */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-4 bg-white">
                  <div className="flex items-center gap-2 mb-1">
                    <Images className="w-4 h-4 text-amber-500" />
                    <h3 className="font-bold text-sm">پروندهٔ رسانه و تحلیل‌ها</h3>
                    {totalMediaCount > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {toPersianDigits(totalMediaCount)} آیتم
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    عکس‌ها، ویدیوها، تحلیل‌ها و آزمایش خون — جدا شده بر اساس هر دورهٔ اشتراک
                  </p>

                  {totalMediaCount === 0 ? (
                    <div className="py-6 px-3 rounded-xl bg-muted/30 border border-dashed text-center">
                      <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center mx-auto mb-2">
                        <Images className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <p className="text-xs font-bold text-foreground">هنوز چیزی در پرونده نیست</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        با ارسال عکس/ویدیوی بدن و آزمایش خون، تحلیل‌های هر دورهٔ اشتراک این‌جا جمع می‌شود.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {planGroups.map((group, gi) => (
                        <PlanGroupBlock
                          key={group.id}
                          group={group}
                          defaultOpen={gi === 0}
                          onOpenPhoto={(photos, index) => {
                            setLightboxItems(
                              photos.map((ph) => ({
                                type: "image" as const,
                                url: ph.imageUrl,
                                title: ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR") : "عکس بدن",
                              }))
                            );
                            setLightboxIndex(index);
                          }}
                          onOpenBloodAnalysis={() => setOverlay("bloodTest")}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>

              <p className="text-center text-[10px] text-muted-foreground pb-2">
                پرونده ورزشی {user?.name || "شما"} — هر تغییری بدهی، مربی هوشمند بلافاصله آن را می‌بیند.
              </p>
            </>
          )}
        </div>

        {/* لایت‌باکس عکس‌های بدن داخل گروه‌های پلن (با دکمهٔ دانلود — Task 4-a) */}
        {lightboxItems && lightboxItems.length > 0 && (
          <MediaLightbox
            items={lightboxItems}
            index={Math.min(lightboxIndex, lightboxItems.length - 1)}
            onClose={() => setLightboxItems(null)}
            onIndexChange={setLightboxIndex}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

/** متن تحلیلِ نمایشی: عنوان تکراری «تحلیل عکس …:» که سرور ابتدای متن می‌گذارد
 * حذف می‌شود — چون کارت خودش عنوان شماره‌دار مستقل دارد (Task 4). */
function stripAnalysisTitle(text: string): string {
  return text.replace(/^\s*تحلیل عکس[^:：\n]{0,20}[::]?\s*/, "").trim();
}

/** بج کوچک شمارندهٔ هر بخش از گروه پلن */
function GroupCountBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  );
}

/**
 * Task 4 — بلوک جمع‌شوندهٔ یک دورهٔ اشتراک (گروه پلن) در «پروندهٔ رسانه و تحلیل‌ها».
 *
 * عنوان گروه = برچسب پلن + ماه شمسی (مثل «پلن پیشرفته — مهر ۱۴۰۵» یا «پیش از
 * اولین پلن») + بج‌های شمارنده (۳ عکس · ۲ تحلیل عکس · ۱ ویدیو · ۱ آزمایش خون).
 * داخل بلوک چهار بخش: عکس‌های بدن (گرید تامبنیل + لایت‌باکس)، تحلیل عکس بدن
 * (کارت‌های شماره‌دار «تحلیل عکس اول/دوم/…» + آکاردئون)، تحلیل ویدیوی بدن
 * (پیش‌نمایش ویدیو + آکاردئون) و آزمایش خون (بج امتیاز + آکاردئون + لینک
 * «مشاهدهٔ تحلیل کامل» که BloodTestView را باز می‌کند).
 *
 * پیاده‌سازی: الگوی grid-template-rows: 0fr → 1fr (همان الگوی AnalysisAccordion —
 * بدون وابستگی جدید). گروه جدیدترین به‌صورت پیش‌فرض باز است (defaultOpen).
 */
function PlanGroupBlock({
  group,
  defaultOpen = false,
  onOpenPhoto,
  onOpenBloodAnalysis,
}: {
  group: PlanGroupDto;
  defaultOpen?: boolean;
  onOpenPhoto: (photos: UserMediaPhotoDto[], index: number) => void;
  onOpenBloodAnalysis: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const photos = group.bodyPhotos ?? [];
  const bodyAnalyses = group.bodyAnalyses ?? [];
  const videoAnalyses = group.videoAnalyses ?? [];
  const bloodTests = group.bloodTests ?? [];
  const isEmpty =
    photos.length + bodyAnalyses.length + videoAnalyses.length + bloodTests.length === 0;

  // گروه خالی هرگز رندر نمی‌شود (سرور هم گروه خالی نمی‌فرستد — دفاع دوطرفه)
  if (isEmpty) return null;

  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-white">
      {/* سربرگ گروه — دکمهٔ باز/بسته */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-3 text-right hover:bg-muted/40 transition"
      >
        <span className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <CalendarDays className="w-4 h-4 text-amber-600" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-black text-slate-800 truncate">{group.label}</span>
          <span className="flex flex-wrap items-center gap-1 mt-1">
            {photos.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(photos.length)} عکس`} className="bg-slate-100 text-slate-600" />
            )}
            {bodyAnalyses.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(bodyAnalyses.length)} تحلیل عکس`} className="bg-orange-100 text-orange-700" />
            )}
            {videoAnalyses.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(videoAnalyses.length)} ویدیو`} className="bg-cyan-100 text-cyan-700" />
            )}
            {bloodTests.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(bloodTests.length)} آزمایش خون`} className="bg-rose-100 text-rose-700" />
            )}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* بدنهٔ گروه — همان الگوی 0fr→1fr آکاردئون سبک */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="p-3 pt-1 space-y-4 border-t border-border/40">
            {/* ۱) عکس‌های بدن — بدون هیچ دسته‌بندی زاویه‌ای؛ فقط تامبنیل + تاریخ */}
            {photos.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Camera className="w-3.5 h-3.5 text-slate-400" />
                  <h5 className="text-[11px] font-bold text-muted-foreground">عکس‌های بدن</h5>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto custom-scrollbar pl-0.5">
                  {photos.map((ph, i) => (
                    <button
                      key={ph.id}
                      type="button"
                      onClick={() => onOpenPhoto(photos, i)}
                      className="relative group rounded-lg overflow-hidden active:scale-[0.98] transition"
                      aria-label={`نمایش عکس بدن — ${ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR") : ""}`}
                    >
                      <MediaImage
                        src={ph.imageUrl}
                        alt="عکس بدن"
                        className="w-full h-20"
                        fallbackLabel="فایل حذف شده"
                        rounding="rounded-lg"
                      />
                      <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex flex-col justify-end p-1.5 pointer-events-none">
                        <span className="text-[9px] text-white font-medium">
                          {ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR") : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ۲) تحلیل عکس بدن — کارت‌های شماره‌دار (اول/دوم/…) — بدون کلمهٔ زاویه */}
            {bodyAnalyses.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Activity className="w-3.5 h-3.5 text-orange-500" />
                  <h5 className="text-[11px] font-bold text-muted-foreground">تحلیل عکس بدن</h5>
                </div>
                <div className="space-y-2">
                  {bodyAnalyses.map((item, i) => {
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR") : undefined;
                    const titleFa = `تحلیل عکس ${ordinalPersian(i + 1)}`;
                    const text = typeof item.result?.analysis === "string" ? stripAnalysisTitle(item.result.analysis) : "";
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-orange-50/50 border border-orange-100">
                        <p className="text-xs font-black text-slate-800 mb-1">{titleFa}</p>
                        {item.mediaUrl && (
                          <div className="mb-1">
                            <MediaImage
                              src={item.mediaUrl}
                              alt={titleFa}
                              className="w-full h-32"
                              fallbackLabel="فایل حذف شده"
                              rounding="rounded-lg"
                            />
                          </div>
                        )}
                        {text ? (
                          <AnalysisAccordion meta={dateFa}>
                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{text}</p>
                          </AnalysisAccordion>
                        ) : item.result?.status === "processing" ? (
                          <p className="text-[11px] text-amber-600 py-1">⏳ تحلیل این عکس در حال آماده‌سازی است — چند لحظه دیگر سر بزن</p>
                        ) : (
                          dateFa && <span className="text-[11px] text-muted-foreground">{dateFa}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ۳) تحلیل ویدیوی بدن — همان الگوی آکاردئون عکس (فیکس: تحلیل ویدیو تا
                حالا فقط در یک شکل JSON ذخیره می‌شد و رندر نمی‌شد) */}
            {videoAnalyses.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Video className="w-3.5 h-3.5 text-cyan-500" />
                  <h5 className="text-[11px] font-bold text-muted-foreground">تحلیل ویدیوی بدن</h5>
                </div>
                <div className="space-y-2">
                  {videoAnalyses.map((item, i) => {
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR") : undefined;
                    const text = videoAnalysisText(item.result);
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-cyan-50/50 border border-cyan-100">
                        <p className="text-xs font-black text-slate-800 mb-1">تحلیل ویدیو {ordinalPersian(i + 1)}</p>
                        {item.mediaUrl && (
                          <div className="my-2">
                            {/* فقط نمایش — خود ویدیو با فریم اول؛ منطق تحلیل دست‌نخورده */}
                            <InlineVideoPreview
                              src={item.mediaUrl}
                              className="rounded-lg"
                              videoClassName="w-full h-32 object-cover rounded-lg"
                            />
                          </div>
                        )}
                        {text ? (
                          <AnalysisAccordion meta={dateFa}>
                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{text}</p>
                          </AnalysisAccordion>
                        ) : (
                          dateFa && <span className="text-[11px] text-muted-foreground">{dateFa}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ۴) آزمایش خون — بج امتیاز + آکاردئون متن کامل + لینک تحلیل کامل */}
            {bloodTests.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <TestTube className="w-3.5 h-3.5 text-rose-500" />
                  <h5 className="text-[11px] font-bold text-muted-foreground">آزمایش خون</h5>
                </div>
                <div className="space-y-2">
                  {bloodTests.map((item, i) => {
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR") : undefined;
                    const fullText = bloodAnalysisText(item.result);
                    const score = typeof item.result?.score === "number" ? item.result.score : null;
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-rose-50/50 border border-rose-100">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-black text-slate-800 flex-1">
                            {bloodTests.length > 1 ? `تحلیل آزمایش خون ${ordinalPersian(i + 1)}` : "تحلیل آزمایش خون"}
                          </p>
                          {score != null && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">
                              امتیاز {toPersianDigits(score)}
                            </span>
                          )}
                        </div>
                        {typeof item.result?.overall === "string" && item.result.overall.trim() && (
                          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2 mb-0.5">
                            {item.result.overall}
                          </p>
                        )}
                        {fullText ? (
                          <AnalysisAccordion meta={dateFa}>
                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{fullText}</p>
                          </AnalysisAccordion>
                        ) : (
                          dateFa && <span className="text-[11px] text-muted-foreground">{dateFa}</span>
                        )}
                      </div>
                    );
                  })}
                  {/* درخواست مالک: جریان کامل آپلود/تحلیل خون سر جای خودش است —
                      این لینک فقط کاربر را به همان نمای کامل می‌برد */}
                  <button
                    type="button"
                    onClick={onOpenBloodAnalysis}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 active:scale-95 transition"
                  >
                    مشاهدهٔ تحلیل کامل
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2">
      <p className="text-[9px] text-slate-400 mb-0.5">{label}</p>
      <p className="text-xs font-black text-slate-800 truncate" title={value}>
        {value}{unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <div className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <h4 className="text-xs font-bold text-muted-foreground">{title}</h4>
        </div>
        {editing ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 px-2 rounded-lg text-[11px]" onClick={onCancel} disabled={saving}>
              انصراف
            </Button>
            <Button size="sm" className="h-7 px-2 rounded-lg text-[11px] gap-1" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              ذخیره
            </Button>
          </div>
        ) : onEdit ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 rounded-lg text-[11px] gap-1 text-muted-foreground" onClick={onEdit}>
            <Pencil className="w-3 h-3" />
            ویرایش
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-left" dir="auto">{value}</span>
    </div>
  );
}

/**
 * v75 — آکاردئون سبک «مشاهده تحلیل» (عکس بدن / آزمایش خون / ویدیو)
 *
 * مشکل (درخواست مالک): متن‌های بلند تحلیل به‌صورت کاملاً باز رندر می‌شدند و
 * کارت‌ها خیلی کشیده بودند. حالا هر آیتم یک سربرگ «مشاهده تحلیل» + تاریخ
 * تحلیل (fa-IR) دارد که با کلیک، متن با ترنزیشن نرم باز/بسته می‌شود.
 *
 * پیاده‌سازی: state محلی + الگوی grid-template-rows: 0fr → 1fr (بدون
 * وابستگی جدید، بدون اندازهٔ ثابت max-height، به‌صورت پیش‌فرض بسته).
 * چرخش chevron با rotate-180 هنگام باز شدن.
 */
function AnalysisAccordion({ meta, children }: { meta?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 py-2 text-right"
      >
        <span className="text-xs font-bold text-slate-700">مشاهده تحلیل</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg text-sm"
        dir="ltr"
      />
    </div>
  );
}

function EditTextArea({ label, value, onChange, placeholder, maxLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="rounded-lg text-sm min-h-[60px] resize-y"
        dir="rtl"
      />
    </div>
  );
}

/**
 * فیکس کرش «A <Select.Item /> must have a value prop that is not an empty string»
 * (گزارش لاگ خطاهای مالک — تب پلن‌ها): آپشن «—» (value: "") در Radix Select
 * مجاز نیست چون رشتهٔ خالی یعنی «پاک‌کردن انتخاب». سنتینل داخلی EMPTY_VALUE
 * جای آن را می‌گیرد و در رفت‌وبرگشت (value ورودی و onChange خروجی) به "" ترجمه
 * می‌شود — بدون تغییر هیچ call-site (سه انتخاب: زمان ترجیحی، سبک آشپزی، فرم بدن).
 */
const EMPTY_SELECT_VALUE = "__fitup_empty__";

function EditSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const toSentinel = (v: string) => (v === "" ? EMPTY_SELECT_VALUE : v);
  const fromSentinel = (v: string) => (v === EMPTY_SELECT_VALUE ? "" : v);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Select
        value={toSentinel(value)}
        onValueChange={(v) => onChange(fromSentinel(v))}
      >
        <SelectTrigger className="h-9 rounded-lg text-sm">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {options.map((opt, idx) => (
            <SelectItem
              key={opt.value === "" ? EMPTY_SELECT_VALUE : `${opt.value}-${idx}`}
              value={toSentinel(opt.value)}
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
