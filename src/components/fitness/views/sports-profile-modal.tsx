"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  // v157 — آیکن‌های کارت‌های آماری و بخش‌های جدید
  Flame,
  Scale,
  CalendarCheck,
  NotebookPen,
  TrendingUp,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
// v171 — واکشی‌های SWR مشترک پنل (تحلیل آنبوردینگ + رسانهٔ کاربر) — همان منبع
// اورلی پروفایل/تب پیشرفت؛ باز شدن مودال دیگر دانلود تکراری نمی‌زند
import { fetchOnboardingAnalysisCached, fetchUserMediaCached, invalidateOnboardingAnalysisCache } from "@/lib/fitness/panel-fetch";
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
  // v162 — فیلدهای جدید: فرم بدن/دخانیات/نواحی آسیب
  BODY_SHAPE_LABELS_FA, SMOKING_HABIT_LABELS_FA, SMOKING_INPUT_OPTIONS, INJURY_AREA_LABELS_FA,
  type Discipline,
  type Goal, type ActivityLevel, type WorkoutPlace, type DietType,
  type TrainingExperience, type BodyFrame, type WorkoutTime,
  type PreferredCuisine, type MedicalConditionKey,
  type BodyShapeKey, type InjuryAreaKey,
} from "@/lib/fitness/types";
import { toast } from "sonner";
// v159 (T6) — پاک‌ساز متن تحلیل (دفاعی در رندر رکوردهای قدیمی «\n-») + آیکن‌های جدید
import { sanitizeAiText } from "@/lib/fitness/ai-text-sanitize";

/**
 * ─── مودال «پروندهٔ ورزشی» (Sports Profile Modal) — بازطراحی v157 ───
 *
 * درخواست مالک (Task 6 / v157-b):
 *   ۱) «تمام» داده‌های آنبوردینگ باید در پروندهٔ ورزشیِ پنل کاربر دیده شوند —
 *      حتی فیلدهای خالی (با نمایش محترمانهٔ «ثبت نشده»).
 *   ۲) بخش «مشاهدهٔ پروندهٔ ورزشی» باید بسیار جذاب، شیک و کامل شود — کارت‌های
 *      آماری بالا (مسیر وزن → هدف، تمرین هفتگی، پیوستگی/استریک)، سربرگ‌های
 *      بخش با آیکن، اسکرول نرم با اسکرول‌بار سفارشی و انیمیشن ظریف.
 *   ۳) همهٔ امکانات قبلی (ویرایش ۹ سکشن، اندازه‌های اولیه، تحلیل هوشمند،
 *      پروندهٔ رسانه/آزمایش خون، جریان «وزن جدید → بازسازی برنامه») سر جایش
 *      کار می‌کنند.
 *
 * این مودال از پروفایل (منوی بازشو) جدا است و دادهٔ خودش را مستقل می‌گیرد:
 *   • /api/onboarding/analysis  → پروفایل کامل + اندازه‌های اولیه + تحلیل
 *   • /api/user-media           → عکس‌ها/ویدیوها/تحلیل‌ها گروه‌بندی بر اساس پلن
 *   • /api/dashboard/journey    → آمار گیمیفیکیشن (استریک/وزن/روزها — اختیاری)
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
  /** v157 — تکمیل پروندهٔ کامل: تعداد وعده‌ها + یادداشت‌های تغذیه‌ای کاربر */
  mealCount?: number | null;
  nutritionNotes?: string | null;
  /** v162 — فرم بدن + دخانیات + نواحی آسیب + سایر مشکلات */
  bodyShape?: string | null;
  bodyShapeLabel?: string | null;
  smokingHabit?: string | null;
  smokingHabitLabel?: string | null;
  injuryAreas?: string[];
  injuryAreasLabel?: string | null;
  otherHealthIssues?: string | null;
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

/** v157 — آمار «مسیر پیشرفت» از GET /api/dashboard/journey (فقط-خواندنی؛ شکست = مخفی) */
interface JourneyStatsDto {
  daysWithFitup?: number;
  startWeight?: number | null;
  currentWeight?: number | null;
  targetWeight?: number | null;
  currentStreak?: number;
  bestStreak?: number;
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
  if (typeof result.analysis === "string" && result.analysis.trim()) return sanitizeAiText(result.analysis);
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
  return sanitizeAiText(lines.join("\n"));
}

/** v157 — محاسبهٔ درصد پیشرفت وزن از وزن شروع به وزن هدف (برای چربی‌سوزی و حجم هر دو) */
function weightProgressPercent(
  startW: number | null | undefined,
  currentW: number | null | undefined,
  targetW: number | null | undefined,
): number | null {
  if (startW == null || currentW == null || targetW == null) return null;
  const totalDelta = startW - targetW; // مثبت = کاهش، منفی = افزایش
  const doneDelta = startW - currentW;
  if (Math.abs(totalDelta) < 0.3) {
    // وزن شروع ≈ هدف — فقط اگر الان روی هدفی کامل است
    return Math.abs(currentW - targetW) < 0.3 ? 100 : null;
  }
  const pct = Math.round((doneDelta / totalDelta) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * v157 — ناوبری سریع بخش‌های پرونده: چیپ‌های پرشی بالای کارت‌ها؛ با لمس هر
 * چیپ، اسکرولر مودال نرم به همان بخش می‌رود (پروندهٔ بلند = دسترسی سریع).
 */
const QUICK_NAV: { id: SectionId; label: string }[] = [
  { id: "basic", label: "اطلاعات پایه" },
  { id: "goal", label: "هدف و فعالیت" },
  { id: "equipment", label: "تجهیزات" },
  { id: "nutrition", label: "تغذیه" },
  { id: "health", label: "سلامت" },
  { id: "recovery", label: "ریکاوری" },
  { id: "experience", label: "تجربهٔ ورزشی" },
  { id: "target", label: "هدف زمانی" },
  { id: "supplements", label: "مکمل‌ها" },
];

export function SportsProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useScrollLock(open);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  // ─── v171 — سلکتوری‌کردن اشتراک store (ضد re-render روی هر تپ پالس ۳s) ───
  const user = useAppStore((s) => s.user);
  const setOverlay = useAppStore((s) => s.setOverlay);
  // v171 — آمار مسیر پیشرفت مستقیم از store می‌آید (loadJourney — همان منبع
  // کش‌شدهٔ داشبورد با کش سشن) → مودال در باز شدن بعدی «همان لحظه» آمار دارد
  const storeJourney = useAppStore((s) => s.journey);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<OnboardingProfileDto | null>(null);
  const [baseline, setBaseline] = useState<BaselineDto | null>(null);
  const [analysis, setAnalysis] = useState<string>("");
  const [userMedia, setUserMedia] = useState<any>({
    bodyPhotos: [], bloodTests: [], videoAnalysis: [], bodyAnalysis: [], planGroups: [],
  });
  // v157 — آمار مسیر پیشرفت (استریک/وزن‌ها) — شکستِ واکشی هرگز مودال را خراب نمی‌کند
  const journey: JourneyStatsDto | null = storeJourney
    ? {
        daysWithFitup: storeJourney.daysWithFitup,
        startWeight: storeJourney.startWeight,
        currentWeight: storeJourney.currentWeight,
        targetWeight: storeJourney.targetWeight,
        currentStreak: storeJourney.currentStreak,
        bestStreak: storeJourney.bestStreak,
      }
    : null;
  // Task 4-a: لایت‌باکس عکس‌های بدن داخل گروه‌های پلن — آیتم‌ها از همان گروه
  const [lightboxItems, setLightboxItems] = useState<LightboxItem[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [editingSection, setEditingSection] = useState<SectionId | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // v15: تاریخ عضویت در فیتاپ — از پاسخ /api/onboarding/analysis (memberSince)
  const [memberSince, setMemberSince] = useState<string | null>(null);
  // v159 (T6) — تشخیص قطعی ترکیب بدن (٪ چربی/٪ عضله) — از همان پاسخ
  const [verdictFat, setVerdictFat] = useState<number | null>(null);
  const [verdictMuscle, setVerdictMuscle] = useState<number | null>(null);
  const [verdictAt, setVerdictAt] = useState<string | null>(null);
  const memberSinceText = (() => {
    if (!memberSince) return null;
    try {
      return new Date(memberSince).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran",  year: "numeric", month: "long", day: "numeric" });
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
      // Task 4: /api/progress حذف شده بود — عکس‌های بدن از planGroups همان
      // /api/user-media می‌آیند.
      // v171 — هر دو از کش مشترک SWR لایهٔ panel-fetch (تک‌پرواز؛ بدون دانلود
      // تکراری در هر باز شدن مودال یا همزمان با تب پیشرفت/اورلی پروفایل).
      const [onboardingData, mediaData] = await Promise.all([
        fetchOnboardingAnalysisCached(),
        fetchUserMediaCached(),
      ]);
      if (onboardingData?.profile) setProfile(onboardingData.profile);
      if (onboardingData?.baseline) setBaseline(onboardingData.baseline);
      if (onboardingData?.analysis) setAnalysis(onboardingData.analysis);
      // v159 (T6) — «تشخیص قطعی» درصد چربی/عضله (موتور فیتاپ) — نمایش زیبا بالای پرونده
      setVerdictFat(typeof onboardingData?.bodyFatPercent === "number" ? onboardingData.bodyFatPercent : null);
      setVerdictMuscle(typeof onboardingData?.musclePercent === "number" ? onboardingData.musclePercent : null);
      setVerdictAt(typeof onboardingData?.bodyCompositionAt === "string" ? onboardingData.bodyCompositionAt : null);
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
      // v157 — کارت‌های آماری (پیوستگی/وزن‌ها)
      // v171 — دیگر fetch خام /api/dashboard/journey نمی‌زنیم (قبلاً در هر باز
      // شدن مودال + داشبورد دوبار گرفته می‌شد)؛ منبع همان loadJourney مشترک store
      // است (کش سشن → رندر فوری؛ fetch با diff-guard تازگی را حفظ می‌کند).
      void useAppStore.getState().loadJourney();
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
        // v157 — تعداد وعده‌ها (۲-۸) در ویرایش تغذیه (سرور قبلاً قبولش می‌کند)
        d.mealCount = String(p.mealCount ?? "");
        break;
      case "health":
        d.injuries = p.injuries || "";
        d.diseases = p.diseases || "";
        d.drugAllergies = p.drugAllergies || "";
        d.currentMedications = p.currentMedications || "";
        d.medicalConditions = (p.medicalConditions || []).join(",");
        // v162 — نواحی آسیب (چندانتخابی) + سایر مشکلات (متن آزاد؛ خالی = پاک‌کردن)
        d.injuryAreas = (p.injuryAreas || []).join(",");
        d.otherHealthIssues = p.otherHealthIssues ?? "";
        // v75 — توضیحات کاربر: همیشه در editData هست (حتی وقتی خالی است) تا کاربر
        // بتواند در فیلد خالی بنویسد و رشتهٔ خالی هم برای پاک‌کردن مقدار به سرور برود
        d.specialConditions = p.specialConditions ?? "";
        break;
      case "recovery":
        d.sleepHours = String(p.sleepHours ?? "");
        d.stressLevel = String(p.stressLevel ?? "");
        d.waterHabit = String(p.waterHabit ?? "");
        d.bodyFrame = p.bodyFrame || "";
        // v162 — فرم بدن (شکل کلی) + دخانیات در سبک زندگی
        d.bodyShape = p.bodyShape || "";
        d.smokingHabit = p.smokingHabit || "";
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
        nutrition: ["mealCount"],
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
      // v171 — پروفایل عوض شد: کش تحلیل آنبوردینگ باطل + آمار مسیر پیشرفت تازه
      // (تغییر وزن → WeightLog جدید → استریک/نمودار store هم باید تازه شود)
      invalidateOnboardingAnalysisCache();
      void useAppStore.getState().loadJourney();
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

  /** v157 — پرش نرم به یک بخش پرونده داخل اسکرولر مودال (مستقل از offsetParent) */
  function jumpToSection(id: SectionId) {
    const el = document.getElementById(`sp-section-${id}`);
    const body = scrollBodyRef.current;
    if (el && body) {
      const top =
        el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
      body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  const p = profile;

  // ─── v157 — داده‌های کارت‌های آماری (ترکیب journey + پروفایل + baseline) ───
  const statCurrentWeight = journey?.currentWeight ?? p?.weight ?? null;
  const statTargetWeight = journey?.targetWeight ?? p?.targetWeight ?? null;
  const statStartWeight = journey?.startWeight ?? baseline?.weight ?? statCurrentWeight;
  const statWeightPercent = weightProgressPercent(statStartWeight, statCurrentWeight, statTargetWeight);
  const statWeightRemaining =
    statCurrentWeight != null && statTargetWeight != null
      ? Math.abs(statCurrentWeight - statTargetWeight)
      : null;
  const statWorkoutDays = p?.workoutDays ?? null;
  const statStreak = journey?.currentStreak ?? null;
  const statBestStreak = journey?.bestStreak ?? null;
  const statDaysWithFitup = journey?.daysWithFitup ?? null;

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
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
        className="w-full sm:max-w-lg h-[94vh] sm:h-[90vh] bg-background sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden shadow-2xl ring-1 ring-border"
        dir="rtl"
      >
        {/* سربرگ — گرادیان برند فیتاپ (کهربایی/نارنجی) */}
        <div
          className="relative flex items-center justify-between p-4 text-white shrink-0 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <div className="absolute -left-8 -top-10 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute left-10 -bottom-14 w-28 h-28 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <Dumbbell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-black text-base leading-tight">پروندهٔ ورزشی تو</h2>
              <p className="text-[10px] opacity-90">بدن، اهداف، تغذیه و پیشرفت — همه در یک نگاه</p>
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

        {/* محتوا — اسکرول نرم با اسکرول‌بار سفارشی (relative = مرجع offsetTop برای پرش سریع) */}
        <div ref={scrollBodyRef} className="relative flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4 bg-background">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-44 rounded-2xl" />
              <Skeleton className="h-44 rounded-2xl" />
            </div>
          ) : !p ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center">
                <Dumbbell className="w-7 h-7 text-amber-500" />
              </div>
              <p className="text-sm text-muted-foreground">پرونده ورزشی یافت نشد — اول آنبوردینگ را کامل کنید.</p>
            </div>
          ) : (
            <>
              {/* ═══════════ کارت‌های آماری بالا (v157) ═══════════ */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-3"
              >
                {/* کارت اصلی: مسیر وزن → هدف */}
                <div className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg shadow-amber-500/10"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                >
                  <div className="absolute -left-6 -top-8 w-28 h-28 rounded-full bg-white/10" />
                  <div className="absolute left-8 -bottom-12 w-24 h-24 rounded-full bg-white/5" />
                  <div className="relative">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-1.5">
                        <Scale className="w-4 h-4" />
                        <span className="text-xs font-bold">مسیر وزن تا هدف</span>
                      </div>
                      {memberSinceText && (
                        <span className="text-[10px] bg-white/15 rounded-full px-2 py-0.5 flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          عضو از {memberSinceText}
                        </span>
                      )}
                    </div>
                    {statCurrentWeight == null ? (
                      <p className="text-xs opacity-90 py-1">وزن فعلی ثبت نشده — از بخش «اطلاعات پایه» ویرایش کن</p>
                    ) : (
                      <>
                        <div className="flex items-end justify-between gap-2 mb-2">
                          <div>
                            <p className="text-[10px] opacity-85">وزن فعلی</p>
                            <p className="text-xl font-black leading-tight font-stat">
                              {toPersianDigits(statCurrentWeight)}
                              <span className="text-[11px] font-medium opacity-85"> کیلوگرم</span>
                            </p>
                          </div>
                          <TrendingUp className="w-5 h-5 opacity-70 rotate-180" aria-hidden="true" />
                          <div className="text-center">
                            <p className="text-[10px] opacity-85">هدف</p>
                            <p className="text-sm font-bold font-stat">
                              {statTargetWeight != null ? `${toPersianDigits(statTargetWeight)} کیلوگرم` : "ثبت نشده"}
                            </p>
                          </div>
                          <div className="text-left">
                            <p className="text-[10px] opacity-85">شروع</p>
                            <p className="text-sm font-bold font-stat">
                              {statStartWeight != null ? `${toPersianDigits(statStartWeight)} کیلوگرم` : "—"}
                            </p>
                          </div>
                        </div>
                        {statWeightPercent != null ? (
                          <>
                            <div className="h-2.5 rounded-full bg-black/20 overflow-hidden" role="progressbar"
                              aria-valuenow={statWeightPercent} aria-valuemin={0} aria-valuemax={100}>
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${statWeightPercent}%` }}
                                transition={{ duration: 0.7, ease: "easeOut" }}
                                className="h-full rounded-full bg-white shadow-sm"
                              />
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <p className="text-[11px] font-bold">
                                {statWeightPercent >= 100
                                  ? "🎉 به هدف وزنی رسیده‌ای!"
                                  : `${toPersianDigits(statWeightPercent)}٪ مسیر طی شده`}
                              </p>
                              {statWeightRemaining != null && statWeightPercent < 100 && (
                                <p className="text-[10px] opacity-90 font-stat">
                                  {toPersianDigits(Math.round(statWeightRemaining * 10) / 10)} کیلوگرم تا هدف
                                </p>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px] opacity-90">وزن هدف را در بخش «اطلاعات پایه» ثبت کن تا مسیر پیشرفتت ترسیم شود.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* ─── v159 (T6) — ترکیب بدنی (تشخیص قطعی فیتاپ) — «در یک جای زیبا در بالا» ─── */}
                {(verdictFat != null || verdictMuscle != null) && (
                  <div className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg shadow-stone-900/10"
                    style={{ background: "linear-gradient(140deg, #292524 0%, #1c1917 45%, #0c0a09 100%)" }}
                  >
                    <div className="absolute -left-6 -top-8 w-24 h-24 rounded-full bg-amber-400/10" />
                    <div className="relative">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold text-amber-50">ترکیب بدنی تو</span>
                        </div>
                        {verdictAt && (
                          <span className="text-[10px] bg-white/10 rounded-full px-2 py-0.5 text-amber-100/80 flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {new Date(verdictAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran",  month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl px-3 py-2.5 text-center border border-amber-400/15 bg-amber-400/5">
                          <p className="text-lg font-black leading-none font-stat text-amber-50">
                            {verdictFat != null
                              ? `${toPersianDigits(verdictFat.toFixed(1).replace(".", "٫"))}٪`
                              : "—"}
                          </p>
                          <p className="text-[9px] text-amber-100/60 mt-1">چربی بدن</p>
                        </div>
                        <div className="rounded-xl px-3 py-2.5 text-center border border-amber-400/15 bg-amber-400/5">
                          <p className="text-lg font-black leading-none font-stat text-amber-50">
                            {verdictMuscle != null
                              ? `${toPersianDigits(verdictMuscle.toFixed(1).replace(".", "٫"))}٪`
                              : "—"}
                          </p>
                          <p className="text-[9px] text-amber-100/60 mt-1">عضله</p>
                        </div>
                      </div>
                      <p className="text-[9px] text-amber-100/50 mt-2 leading-relaxed">
                        تشخیص قطعی فیتاپ از روی اندازه‌های بدنی و همهٔ عکس‌های شما — با هر چکاپ تازه می‌شود.
                      </p>
                    </div>
                  </div>
                )}

                {/* سه کارت کوچک: تمرین هفتگی / پیوستگی / بهترین زنجیره */}
                <div className="grid grid-cols-3 gap-2.5">
                  <MiniStat
                    icon={<CalendarCheck className="w-4 h-4" />}
                    label="تمرین در هفته"
                    value={statWorkoutDays != null ? `${toPersianDigits(statWorkoutDays)} روز` : null}
                    tone="text-orange-600 dark:text-orange-400 bg-orange-500/10"
                  />
                  <MiniStat
                    icon={<Flame className="w-4 h-4" />}
                    label="پیوستگی فعلی"
                    value={statStreak != null && statStreak > 0 ? `${toPersianDigits(statStreak)} روز` : null}
                    hint={statStreak != null && statStreak > 0 ? "زنجیرهٔ روزهای کامل 🔥" : "هنوز زنجیره‌ای نساختی"}
                    tone="text-rose-600 dark:text-rose-400 bg-rose-500/10"
                  />
                  <MiniStat
                    icon={<Trophy className="w-4 h-4" />}
                    label="بهترین زنجیره"
                    value={statBestStreak != null && statBestStreak > 0 ? `${toPersianDigits(statBestStreak)} روز` : null}
                    hint={statDaysWithFitup != null ? `${toPersianDigits(statDaysWithFitup)} روز با فیتاپ` : undefined}
                    tone="text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  />
                </div>
              </motion.div>

              {/* ═══════════ ناوبری سریع بخش‌ها (v157 — چیپ‌های پرش) ═══════════ */}
              <motion.nav
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="-mx-1 px-1 flex gap-1.5 overflow-x-auto custom-scrollbar pb-1"
                aria-label="پرش به بخش‌های پرونده ورزشی"
              >
                {QUICK_NAV.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => jumpToSection(n.id)}
                    className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full bg-muted/60 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted hover:border-primary/40 active:scale-95 transition"
                  >
                    {n.label}
                  </button>
                ))}
              </motion.nav>

              {/* ═══════════ بخش‌های پرونده (هر بخش یک کارت با سربرگ آیکن‌دار) ═══════════ */}

              {/* ۱) اطلاعات پایه */}
              <ProfileSection
                domId="sp-section-basic"
                title="اطلاعات پایه"
                subtitle="جنسیت، سن، قد و وزن"
                icon={<Activity className="w-4.5 h-4.5" />}
                iconTone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
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
                    <EditField label="قد (سانتی‌متر)" value={editData.height || ""} onChange={(v) => setEditData({ ...editData, height: v })} type="number" />
                    <EditField label="وزن (کیلوگرم)" value={editData.weight || ""} onChange={(v) => setEditData({ ...editData, weight: v })} type="number" />
                    <EditField label="وزن هدف (کیلوگرم)" value={editData.targetWeight || ""} onChange={(v) => setEditData({ ...editData, targetWeight: v })} type="number" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    <InfoRow label="جنسیت" value={p.genderLabel} />
                    <InfoRow label="سن" value={p.age != null ? `${toPersianDigits(p.age)} سال` : null} />
                    <InfoRow label="قد" value={p.height != null ? `${toPersianDigits(p.height)} سانتی‌متر` : null} />
                    <InfoRow label="وزن فعلی" value={p.weight != null ? `${toPersianDigits(p.weight)} کیلوگرم` : null} />
                    <InfoRow label="وزن هدف" value={p.targetWeight != null ? `${toPersianDigits(p.targetWeight)} کیلوگرم` : null} />
                  </div>
                )}
              </ProfileSection>

              {/* ۲) هدف و فعالیت */}
              <ProfileSection
                domId="sp-section-goal"
                title="هدف و فعالیت"
                subtitle="هدف اصلی و برنامهٔ هفتگی"
                icon={<Target className="w-4.5 h-4.5" />}
                iconTone="bg-orange-500/10 text-orange-600 dark:text-orange-400"
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
                  <div className="grid grid-cols-1 gap-1.5">
                    <InfoRow label="هدف اصلی" value={p.goalLabel} />
                    <InfoRow label="سطح فعالیت" value={p.activityLabel} />
                    <InfoRow label="روزهای تمرین" value={p.workoutDays != null ? `${toPersianDigits(p.workoutDays)} روز در هفته` : null} />
                    <InfoRow
                      label="روزهای انتخابی"
                      value={p.workoutDaysList && p.workoutDaysList.length > 0 ? p.workoutDaysList.join("، ") : null}
                    />
                    <InfoRow label="محیط تمرین" value={p.workoutPlaceLabel} />
                    <InfoRow label="زمان ترجیحی تمرین" value={p.workoutTimeLabel ?? null} />
                  </div>
                )}
              </ProfileSection>

              {/* ۳) تجهیزات */}
              <ProfileSection
                domId="sp-section-equipment"
                title="تجهیزات"
                subtitle="امکانات در دسترس تو"
                icon={<Dumbbell className="w-4.5 h-4.5" />}
                iconTone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
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
                        <span key={eq} className="text-[11px] px-2 py-1 rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20">
                          {equipmentFa(eq)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <EmptyHint text="تجهیزاتی ثبت نشده — بدنسازی با وزن بدن در نظر گرفته می‌شود." />
                  )
                )}
              </ProfileSection>

              {/* ۴) تغذیه */}
              <ProfileSection
                domId="sp-section-nutrition"
                title="تغذیه"
                subtitle="رژیم، وعده‌ها و ترجیحات"
                icon={<Salad className="w-4.5 h-4.5" />}
                iconTone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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
                    {/* v157 — تعداد وعده‌ها (۲-۸): سرور همان محدوده را اعتبارسنجی می‌کند */}
                    <EditField label="تعداد وعده‌ها (۲ تا ۸)" value={editData.mealCount || ""} onChange={(v) => setEditData({ ...editData, mealCount: v })} type="number" />
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
                  <div className="grid grid-cols-1 gap-1.5">
                    <InfoRow label="نوع رژیم" value={p.dietLabel} />
                    <InfoRow label="تعداد وعده‌ها" value={p.mealCount != null ? `${toPersianDigits(p.mealCount)} وعده در روز` : null} />
                    <InfoRow label="حساسیت غذایی" value={p.allergies?.trim() ? p.allergies : null} />
                    <InfoRow label="غذاهای دوست‌نداشته" value={p.dislikedFoods?.trim() ? p.dislikedFoods : null} />
                    <InfoRow label="سبک آشپزی" value={p.preferredCuisineLabel ?? null} />
                    {/* v157 — یادداشت‌های تغذیه‌ای (متن آزاد کاربر/دستیار تغذیه — فقط نمایش) */}
                    <div className="rounded-xl bg-muted/40 border border-border/50 p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <NotebookPen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs text-muted-foreground">یادداشت‌های تغذیه‌ای</span>
                      </div>
                      {p.nutritionNotes?.trim() ? (
                        <p className="text-[13px] font-medium text-foreground leading-relaxed whitespace-pre-line">{p.nutritionNotes}</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/60">ثبت نشده — از چت با دستیار تغذیه یا مربی می‌تواند ثبت شود.</p>
                      )}
                    </div>
                  </div>
                )}
              </ProfileSection>

              {/* ۵) سلامت */}
              <ProfileSection
                domId="sp-section-health"
                title="سلامت و پزشکی"
                subtitle="آسیب‌ها، بیماری‌ها و داروها"
                icon={<HeartPulse className="w-4.5 h-4.5" />}
                iconTone="bg-rose-500/10 text-rose-600 dark:text-rose-400"
                editing={editingSection === "health"}
                onEdit={() => startEditing("health")}
                onCancel={cancelEditing}
                onSave={saveSection}
                saving={saving}
              >
                {editingSection === "health" ? (
                  <div className="grid grid-cols-1 gap-2">
                    <EditTextArea label="آسیب‌دیدگی‌ها" value={editData.injuries || ""} onChange={(v) => setEditData({ ...editData, injuries: v })} placeholder="مثلاً: آسیب زانوی راست، دیسک کمر" />
                    {/* v162 — نواحی آسیب ساختاری (چندانتخابی) — ممنوعیت هوشمند + توانبخشی */}
                    <div>
                      <Label className="mb-1.5 block text-[11px] text-muted-foreground">نواحی آسیب‌دیده یا حساس</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.keys(INJURY_AREA_LABELS_FA) as InjuryAreaKey[]).map((c) => {
                          const selected = (editData.injuryAreas || "").split(",").map((s) => s.trim()).includes(c);
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                const current = (editData.injuryAreas || "").split(",").map((s) => s.trim()).filter(Boolean);
                                const next = selected ? current.filter((x) => x !== c) : [...current, c];
                                setEditData({ ...editData, injuryAreas: next.join(",") });
                              }}
                              className={`text-[11px] px-2.5 py-1 rounded-lg transition ${
                                selected ? "bg-rose-500 text-white" : "bg-muted/60 text-foreground hover:bg-muted"
                              }`}
                            >
                              {INJURY_AREA_LABELS_FA[c]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <EditTextArea label="بیماری‌ها" value={editData.diseases || ""} onChange={(v) => setEditData({ ...editData, diseases: v })} placeholder="مثلاً: دیابت نوع ۲، فشار خون" />
                    {/* v162 — سایر مشکلات بدنی/سلامتی با جزئیات — مستقیم به هوش مصنوعی تزریق می‌شود */}
                    <EditTextArea
                      label="سایر مشکلات بدنی یا مشکلات دیگر (با جزئیات)"
                      value={editData.otherHealthIssues ?? ""}
                      onChange={(v) => setEditData({ ...editData, otherHealthIssues: v })}
                      placeholder="هر مشکل دیگری که مربی باید بداند — با جزئیات بنویسید؛ حرکاتِ در تضاد با آن هرگز در برنامه‌تان نمی‌آید."
                      maxLength={600}
                    />
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
                  <div className="grid grid-cols-1 gap-1.5">
                    <InfoRow label="آسیب‌دیدگی‌ها" value={p.injuries?.trim() ? p.injuries : null} multiline />
                    <InfoRow label="نواحی آسیب‌دیده" value={p.injuryAreasLabel ?? null} />
                    <InfoRow label="بیماری‌ها" value={p.diseases?.trim() ? p.diseases : null} multiline />
                    <InfoRow label="سایر مشکلات (جزئیات کاربر)" value={p.otherHealthIssues?.trim() ? p.otherHealthIssues : null} multiline />
                    <InfoRow label="آلرژی دارویی" value={p.drugAllergies?.trim() ? p.drugAllergies : null} />
                    <InfoRow label="داروهای مصرفی" value={p.currentMedications?.trim() ? p.currentMedications : null} multiline />
                    <InfoRow label="شرایط پزشکی" value={p.medicalConditionsLabel ?? null} />
                    <InfoRow label="توضیحات کاربر" value={p.specialConditions?.trim() ? p.specialConditions : null} multiline />
                  </div>
                )}
              </ProfileSection>

              {/* ۶) ریکاوری */}
              <ProfileSection
                domId="sp-section-recovery"
                title="ریکاوری و سبک زندگی"
                subtitle="خواب، استرس، آب و فرم بدن"
                icon={<Moon className="w-4.5 h-4.5" />}
                iconTone="bg-teal-500/10 text-teal-600 dark:text-teal-400"
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
                      label="فرم بدن (شکل کلی — اجباری آنبوردینگ)"
                      value={editData.bodyShape || ""}
                      onChange={(v) => setEditData({ ...editData, bodyShape: v })}
                      options={[
                        { value: "", label: "— ثبت نشده —" },
                        ...(Object.keys(BODY_SHAPE_LABELS_FA) as BodyShapeKey[]).map((g) => ({ value: g, label: BODY_SHAPE_LABELS_FA[g] })),
                      ]}
                    />
                    <EditSelect
                      label="فرم استخوانی"
                      value={editData.bodyFrame || ""}
                      onChange={(v) => setEditData({ ...editData, bodyFrame: v })}
                      options={[
                        { value: "", label: "—" },
                        ...(Object.keys(BODY_FRAME_LABELS) as BodyFrame[]).map((g) => ({ value: g, label: BODY_FRAME_LABELS[g] })),
                      ]}
                    />
                    <EditSelect
                      label="مصرف دخانیات"
                      value={editData.smokingHabit || ""}
                      onChange={(v) => setEditData({ ...editData, smokingHabit: v })}
                      options={[
                        { value: "", label: "— ثبت نشده —" },
                        // v169 — گزینهٔ «ترجیح می‌دهم نگویم» از ورودی حذف شد (دیرکتیو مالک)؛
                        // فقط مقادیر قدیمیِ ذخیره‌شده در نمایش دیده می‌شوند.
                        ...SMOKING_INPUT_OPTIONS.map((g) => ({ value: g, label: SMOKING_HABIT_LABELS_FA[g] })),
                      ]}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    <InfoRow label="ساعت خواب" value={p.sleepHours != null ? `${toPersianDigits(p.sleepHours)} ساعت` : null} />
                    <InfoRow
                      label="سطح استرس"
                      value={
                        p.stressLevel != null
                          ? p.stressLevel <= 2 ? "کم" : p.stressLevel <= 3 ? "متوسط" : "زیاد"
                          : null
                      }
                    />
                    <InfoRow label="مصرف آب" value={p.waterHabit != null ? `${toPersianDigits(p.waterHabit)} لیوان در روز` : null} />
                    <InfoRow label="فرم بدن (استخوانی)" value={p.bodyFrameLabel ?? null} />
                    <InfoRow label="فرم بدن (شکل کلی)" value={p.bodyShapeLabel ?? null} />
                    <InfoRow label="مصرف دخانیات" value={p.smokingHabitLabel ?? null} />
                  </div>
                )}
              </ProfileSection>

              {/* ۷) تجربه ورزشی */}
              <ProfileSection
                domId="sp-section-experience"
                title="تجربهٔ ورزشی"
                subtitle="رشته، سابقه و رکوردها"
                icon={<Trophy className="w-4.5 h-4.5" />}
                iconTone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
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
                  <div className="grid grid-cols-1 gap-1.5">
                    {/* v75 — رشتهٔ ورزشی (برچسب فارسی از سرور می‌آید) */}
                    <InfoRow label="رشتهٔ ورزشی" value={p.disciplineLabel ?? null} />
                    <InfoRow label="سابقهٔ ورزشی" value={p.trainingExperienceLabel ?? null} />
                    <InfoRow label="نوع تمرین قبلی" value={p.previousTrainingType?.trim() ? p.previousTrainingType : null} />
                    <InfoRow label="حداکثر وزنه‌ها" value={p.maxLifts?.trim() ? p.maxLifts : null} multiline />
                  </div>
                )}
              </ProfileSection>

              {/* ۸) هدف زمانی */}
              <ProfileSection
                domId="sp-section-target"
                title="هدف زمانی"
                subtitle="تاریخ رسیدن به هدف"
                icon={<Calendar className="w-4.5 h-4.5" />}
                iconTone="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
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
                    value={p.targetDate ? new Date(p.targetDate).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : null}
                  />
                )}
              </ProfileSection>

              {/* ۹) مکمل‌ها */}
              <ProfileSection
                domId="sp-section-supplements"
                title="مکمل‌ها"
                subtitle="مکمل‌های فعلی مصرفی"
                icon={<Pill className="w-4.5 h-4.5" />}
                iconTone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
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
                  <InfoRow label="مکمل‌های فعلی" value={p.currentSupplements?.trim() ? p.currentSupplements : null} multiline />
                )}
              </ProfileSection>

              {/* ۱۰) اندازه‌های اولیه بدن (چکاپ فاز ۰) — اگر ثبت شده باشد */}
              {baseline && (
                <ProfileSection
                  title="اندازه‌های اولیهٔ بدن"
                  subtitle="نقطهٔ شروع اندازه‌گیری"
                  icon={<Ruler className="w-4.5 h-4.5" />}
                  iconTone="bg-primary/10 text-primary"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <InfoRow label="وزن اولیه" value={`${toPersianDigits(baseline.weight)} کیلوگرم`} />
                    {baseline.chestMeasurement != null && <InfoRow label="دور سینه" value={`${toPersianDigits(baseline.chestMeasurement)} سانتی‌متر`} />}
                    {baseline.armMeasurement != null && <InfoRow label="دور بازو" value={`${toPersianDigits(baseline.armMeasurement)} سانتی‌متر`} />}
                    {baseline.waistMeasurement != null && <InfoRow label="دور کمر" value={`${toPersianDigits(baseline.waistMeasurement)} سانتی‌متر`} />}
                    {baseline.hipMeasurement != null && <InfoRow label="دور باسن" value={`${toPersianDigits(baseline.hipMeasurement)} سانتی‌متر`} />}
                    {baseline.thighMeasurement != null && <InfoRow label="دور ران" value={`${toPersianDigits(baseline.thighMeasurement)} سانتی‌متر`} />}
                  </div>
                  {baseline.createdAt && (
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      ثبت شده در: {new Date(baseline.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}
                    </p>
                  )}
                </ProfileSection>
              )}

              {/* تحلیل هوشمند */}
              {analysis && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="p-4 bg-card border-border">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                      </span>
                      <div>
                        <h3 className="font-bold text-sm">تحلیل هوشمند فیتاپ</h3>
                        <p className="text-[10px] text-muted-foreground">بر اساس اطلاعات پروندهٔ تو</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                      {/* v159 (T6) — پاک‌ساز دفاعی (رکوردهای «\n-» قدیمی) */}
                      {sanitizeAiText(analysis)}
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
                <Card className="p-4 bg-card border-border">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Images className="w-4 h-4 text-amber-500" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm">پروندهٔ رسانه و تحلیل‌ها</h3>
                      <p className="text-[10px] text-muted-foreground">عکس، ویدیو، تحلیل بدن و آزمایش خون — به تفکیک هر دورهٔ اشتراک</p>
                    </div>
                    {totalMediaCount > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                        {toPersianDigits(totalMediaCount)} آیتم
                      </span>
                    )}
                  </div>

                  {totalMediaCount === 0 ? (
                    <div className="py-6 px-3 rounded-xl bg-muted/30 border border-dashed text-center mt-3">
                      <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center mx-auto mb-2">
                        <Images className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <p className="text-xs font-bold text-foreground">هنوز چیزی در پرونده نیست</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        با ارسال عکس/ویدیوی بدن و آزمایش خون، تحلیل‌های هر دورهٔ اشتراک این‌جا جمع می‌شود.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 mt-3">
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
                                title: ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : "عکس بدن",
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
 * v157 — کارت آماری کوچک بالای پرونده (تمرین هفتگی / پیوستگی / بهترین زنجیره).
 * مقدار خالی = «ثبت نشده» با ظاهر کم‌رنگ (کارت هرگز حذف نمی‌شود).
 */
function MiniStat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-3 flex flex-col items-center text-center gap-1 shadow-sm">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        {icon}
      </span>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      {value ? (
        <>
          <p className="text-sm font-black text-foreground leading-tight font-stat">{value}</p>
          {hint && <p className="text-[9px] text-muted-foreground/80 leading-tight">{hint}</p>}
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 leading-tight">ثبت نشده</p>
      )}
    </div>
  );
}

/**
 * v157 — کارت یک بخش از پرونده با سربرگ آیکن‌دار + دکمهٔ ویرایش (در صورت پشتیبانی).
 * جایگزین بخش‌های فشردهٔ داخل یک کارت واحد شد — هر بخش حالا نفس می‌کشد.
 */
function ProfileSection({
  title,
  subtitle,
  icon,
  iconTone,
  children,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  domId,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  iconTone: string;
  children: React.ReactNode;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  /** v157 — لنگر ناوبری سریع (پرش اسکرول به این بخش) */
  domId?: string;
}) {
  return (
    <motion.div
      id={domId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="p-4 sm:p-5 bg-card border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconTone}`}>
              {icon}
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-foreground leading-tight">{title}</h4>
              {subtitle && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {editing ? (
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" variant="outline" className="h-7 px-2 rounded-lg text-[11px]" onClick={onCancel} disabled={saving}>
                انصراف
              </Button>
              <Button size="sm" className="h-7 px-2 rounded-lg text-[11px] gap-1" onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                ذخیره
              </Button>
            </div>
          ) : onEdit ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 rounded-lg text-[11px] gap-1 text-muted-foreground shrink-0" onClick={onEdit}>
              <Pencil className="w-3 h-3" />
              ویرایش
            </Button>
          ) : null}
        </div>
        {children}
      </Card>
    </motion.div>
  );
}

/** راهنمای محترمانه برای مقدار خالی (به‌جای «ندارد» گمراه‌کننده) */
function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2.5 text-center">
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{text}</p>
    </div>
  );
}

function InfoRow({ label, value, multiline }: { label: string; value?: string | number | null; multiline?: boolean }) {
  const has = value !== null && value !== undefined && String(value).trim() !== "";
  return (
    <div className={`flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/40 border border-border/50 ${multiline ? "items-start" : ""}`}>
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      {has ? (
        <span
          className={`text-[13px] font-semibold text-foreground text-left ${multiline ? "whitespace-pre-line" : "truncate"}`}
          dir="auto"
          title={has ? String(value) : undefined}
        >
          {String(value)}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/60 shrink-0">ثبت نشده</span>
      )}
    </div>
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
    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card">
      {/* سربرگ گروه — دکمهٔ باز/بسته */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-3 text-right hover:bg-muted/40 transition"
      >
        <span className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
          <CalendarDays className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-black text-foreground truncate">{group.label}</span>
          <span className="flex flex-wrap items-center gap-1 mt-1">
            {photos.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(photos.length)} عکس`} className="bg-muted text-muted-foreground" />
            )}
            {bodyAnalyses.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(bodyAnalyses.length)} تحلیل عکس`} className="bg-orange-500/15 text-orange-600 dark:text-orange-400" />
            )}
            {videoAnalyses.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(videoAnalyses.length)} ویدیو`} className="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" />
            )}
            {bloodTests.length > 0 && (
              <GroupCountBadge label={`${toPersianDigits(bloodTests.length)} آزمایش خون`} className="bg-rose-500/15 text-rose-600 dark:text-rose-400" />
            )}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
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
                  <Camera className="w-3.5 h-3.5 text-muted-foreground" />
                  <h5 className="text-[11px] font-bold text-muted-foreground">عکس‌های بدن</h5>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto custom-scrollbar pl-0.5">
                  {photos.map((ph, i) => (
                    <button
                      key={ph.id}
                      type="button"
                      onClick={() => onOpenPhoto(photos, i)}
                      className="relative group rounded-lg overflow-hidden active:scale-[0.98] transition"
                      aria-label={`نمایش عکس بدن — ${ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : ""}`}
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
                          {ph.takenAt ? new Date(ph.takenAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : ""}
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
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : undefined;
                    const titleFa = `تحلیل عکس ${ordinalPersian(i + 1)}`;
                    // v159 (T6) — پاک‌ساز دفاعی: رکوردهای قدیمی «\n-» لفظی دارند (گزارش مالک)
                    const text = typeof item.result?.analysis === "string"
                      ? sanitizeAiText(stripAnalysisTitle(item.result.analysis))
                      : "";
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                        <p className="text-xs font-black text-foreground mb-1">{titleFa}</p>
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
                            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{text}</p>
                          </AnalysisAccordion>
                        ) : item.result?.status === "processing" ? (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 py-1">⏳ تحلیل این عکس در حال آماده‌سازی است — چند لحظه دیگر سر بزن</p>
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
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : undefined;
                    const text = videoAnalysisText(item.result);
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                        <p className="text-xs font-black text-foreground mb-1">تحلیل ویدیو {ordinalPersian(i + 1)}</p>
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
                            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{text}</p>
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
                    const dateFa = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : undefined;
                    const fullText = bloodAnalysisText(item.result);
                    const score = typeof item.result?.score === "number" ? item.result.score : null;
                    return (
                      <div key={String(item.id ?? i)} className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-black text-foreground flex-1">
                            {bloodTests.length > 1 ? `تحلیل آزمایش خون ${ordinalPersian(i + 1)}` : "تحلیل آزمایش خون"}
                          </p>
                          {score != null && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0 font-stat">
                              امتیاز {toPersianDigits(score)}
                            </span>
                          )}
                        </div>
                        {typeof item.result?.overall === "string" && item.result.overall.trim() && (
                          <p className="text-[11px] text-foreground/80 leading-relaxed line-clamp-2 mb-0.5">
                            {item.result.overall}
                          </p>
                        )}
                        {fullText ? (
                          <AnalysisAccordion meta={dateFa}>
                            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{fullText}</p>
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
                    className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:opacity-80 flex items-center gap-1 active:scale-95 transition"
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

/**
 * v157 — آکاردئون سبک «مشاهده تحلیل» (عکس بدن / آزمایش خون / ویدیو)
 *
 * متن‌های بلند تحلیل به‌صورت جمع‌شونده با سربرگ «مشاهده تحلیل» + تاریخ
 * تحلیل (fa-IR) رندر می‌شوند — با کلیک، متن با ترنزیشن نرم باز/بسته می‌شود.
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
        <span className="text-xs font-bold text-foreground/90">مشاهده تحلیل</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`}
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
        className="h-9 rounded-lg text-sm bg-background"
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
        className="rounded-lg text-sm min-h-[60px] resize-y bg-background"
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
