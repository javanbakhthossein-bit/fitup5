"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  Crown,
  Shield,
  LogOut,
  ChevronLeft,
  CreditCard,
  Settings,
  Dumbbell,
  Activity,
  Wallet,
  Ruler,
  HeartPulse,
  Salad,
  Trophy,
  Camera,
  TestTube,
  Video,
  Loader2,
  TrendingUp,
  TrendingDown,
  Save,
  Pencil,
  Target,
  Moon,
  Pill,
  Calendar,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  toPersianDigits, formatToman,
  PLAN_LABELS,
  GOAL_LABELS, ACTIVITY_LABELS, GENDER_LABELS,
  WORKOUT_PLACE_LABELS, DIET_LABELS, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS,
  MEDICAL_CONDITION_LABELS, MEDICAL_CONDITION_KEY,
  PERSIAN_WEEKDAYS,
  type Goal, type ActivityLevel, type WorkoutPlace, type DietType,
  type TrainingExperience, type BodyFrame, type WorkoutTime,
  type PreferredCuisine,
} from "@/lib/fitness/types";
import { toast } from "sonner";

// ─── DTO شامل تمام فیلدهای آنبوردینگ ───
interface OnboardingProfileDto {
  // Basic
  gender: string;
  genderLabel: string;
  age: number;
  height: number;
  weight: number;
  targetWeight: number | null;
  goal: string;
  goalLabel: string;
  activityLevel: string;
  activityLabel: string;
  workoutDays: number;
  workoutDaysList: string[];
  workoutPlace: string;
  workoutPlaceLabel: string;
  workoutTime: string | null;
  workoutTimeLabel: string | null;
  // Equipment
  equipment: string[];
  // Diet
  dietType: string;
  dietLabel: string;
  preferredCuisine: string | null;
  preferredCuisineLabel: string | null;
  dislikedFoods: string | null;
  allergies: string;
  // Health
  injuries: string;
  diseases: string;
  drugAllergies: string | null;
  currentMedications: string | null;
  medicalConditions: string[];
  medicalConditionsLabel: string | null;
  // Recovery
  sleepHours: number | null;
  stressLevel: number | null;
  waterHabit: number | null;
  waterGoalMl: number | null;
  bodyFrame: string | null;
  bodyFrameLabel: string | null;
  // Training experience
  trainingExperience: string | null;
  trainingExperienceLabel: string | null;
  previousTrainingType: string | null;
  maxLifts: string | null;
  // Target date
  targetDate: string | null;
  // Supplements
  currentSupplements: string | null;
  // Body composition measurements
  neckMeasurement: number | null;
  shoulderMeasurement: number | null;
  calfMeasurement: number | null;
}

interface BaselineDto {
  weight: number;
  chestMeasurement: number | null;
  armMeasurement: number | null;
  waistMeasurement: number | null;
  hipMeasurement: number | null;
  thighMeasurement: number | null;
  createdAt: string;
}

interface WalletTxnDto {
  id: string;
  type: string;
  amount: number;
  balance: number;
  description: string;
  createdAt: string;
}

// شناسه‌های سکشن‌های قابل ویرایش
type SectionId =
  | "basic" | "goal" | "equipment" | "nutrition"
  | "health" | "recovery" | "experience" | "target" | "supplements";

export function ProfileOverlay() {
  const { user, setOverlay, reset } = useAppStore();
  const [profile, setProfile] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<{
    analysis?: string;
    bmi?: number;
    bmr?: number;
    tdee?: number;
    profile?: OnboardingProfileDto;
    baseline?: BaselineDto | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletOpen, setWalletOpen] = useState(false);
  const [chargeAmount, setChargeAmount] = useState("");
  const [walletTxns, setWalletTxns] = useState<WalletTxnDto[]>([]);
  const [walletTxnsLoading, setWalletTxnsLoading] = useState(true);
  const [progressPhotos, setProgressPhotos] = useState<any[]>([]);
  const [userMedia, setUserMedia] = useState<{
    bodyPhotos: any[];
    bloodTests: any[];
    videoAnalysis: any[];
    bodyAnalysis: any[];
  }>({ bodyPhotos: [], bloodTests: [], videoAnalysis: [], bodyAnalysis: [] });
  // سکشنی که در حال ویرایش است (null یعنی هیچ‌کدام)
  const [editingSection, setEditingSection] = useState<SectionId | null>(null);
  // داده‌های فرم ویرایش — مپ field key به value (همیشه به‌صورت string)
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadData = useCallback(async () => {
    const [progressRes, onboardingRes, mediaRes, walletRes] = await Promise.all([
      fetch("/api/progress"),
      fetch("/api/onboarding/analysis"),
      fetch("/api/user-media"),
      fetch("/api/wallet"),
    ]);
    const progressData = await progressRes.json();
    let onboardingData: any = null;
    try { onboardingData = await onboardingRes.json(); } catch {}
    let mediaData: any = null;
    try { mediaData = await mediaRes.json(); } catch {}
    let walletData: any = null;
    try { walletData = await walletRes.json(); } catch {}
    setProfile({
      startWeight: progressData.startWeight,
      targetWeight: progressData.targetWeight,
      bmi: onboardingData?.bmi,
      bmr: onboardingData?.bmr,
      tdee: onboardingData?.tdee,
      gender: (onboardingData?.profile?.genderLabel || "").includes("آقا") ? "male" : (onboardingData?.profile?.genderLabel || "").includes("خانم") ? "female" : null,
    });
    if (onboardingData) setOnboarding(onboardingData);
    if (progressData?.progressPhotos) setProgressPhotos(progressData.progressPhotos);
    if (mediaData) setUserMedia(mediaData);
    if (Array.isArray(walletData?.transactions)) {
      setWalletTxns(walletData.transactions as WalletTxnDto[]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadData();
      } catch {
      } finally {
        setLoading(false);
        setWalletTxnsLoading(false);
      }
    })();
  }, [loadData]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // پاک کردن sessionStorage
      try {
        window.sessionStorage.removeItem("fitap_last_screen");
      } catch {}
      // پاک کردن URL
      window.history.replaceState({}, "", "/");
      // reset مستقیماً screen را به landing می‌برد (نه loading)
      reset();
      setOverlay(null);
    } catch {
      // حتی اگر خطا شد، باز هم logout کن
      try {
        window.sessionStorage.removeItem("fitap_last_screen");
      } catch {}
      window.history.replaceState({}, "", "/");
      reset();
      setOverlay(null);
    }
  }

  // شروع ویرایش یک سکشن: editData را از پروفایل فعلی پر می‌کنیم
  function startEditing(section: SectionId) {
    const p = onboarding?.profile;
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
        d.equipment = (p.equipment || []).join(", ");
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

  // ذخیره تغییرات سکشن فعلی
  async function saveSection() {
    if (!editingSection) return;
    setSaving(true);
    try {
      // پارسvalues به نوع مناسب قبل از ارسال
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
      for (const [k, v] of Object.entries(editData)) {
        if (numFields[editingSection].includes(k)) {
          payload[k] = v === "" ? null : Number(v);
        } else {
          payload[k] = v;
        }
      }
      const res = await fetch("/api/onboarding/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data?.ok) {
        toast.success("پروفایل به‌روزرسانی شد و به مربی هوشمند تزریق شد ✅");
      } else {
        toast.success("پروفایل و پرونده پزشکی به‌روزرسانی شد ✅");
      }
      setEditingSection(null);
      setEditData({});
      // Reload profile data
      await loadData();
    } catch {
      toast.error("خطا در ذخیره پروفایل");
    } finally {
      setSaving(false);
    }
  }

  const subEndDate = user?.subscriptionEnd ? new Date(user.subscriptionEnd) : null;
  const daysLeft = subEndDate ? Math.ceil((subEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

  const p = onboarding?.profile;
  const baseline = onboarding?.baseline;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-bold">پروفایل</h2>
        <Button variant="ghost" size="icon" onClick={() => setOverlay(null)} className="rounded-full">
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* User card */}
        <Card className="p-5 relative overflow-hidden">
          <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-primary/10" />
          <div className="relative flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center text-white text-2xl font-black shadow-lg">
              {user?.name?.[0] || "ک"}
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg">{user?.name || "ورزشکار"}</h3>
              <p className="text-sm text-muted-foreground" dir="ltr">{user?.mobile}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {user?.role === "ADMIN" && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    <Shield className="w-3 h-3" /> مدیر سیستم
                  </span>
                )}
                {user?.planName && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">
                    <Crown className="w-3 h-3" /> پلن {PLAN_LABELS[user.planName as keyof typeof PLAN_LABELS] ?? user.planName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Subscription status */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-sm">وضعیت اشتراک</h3>
            </div>
          </div>
          {user?.hasActiveSubscription ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-emerald-600 dark:text-emerald-400">اشتراک فعال ✓</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {toPersianDigits(daysLeft)} روز باقی‌مانده
                  </p>
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-muted-foreground">تاریخ پایان</p>
                  <p className="text-xs font-medium">{subEndDate?.toLocaleDateString("fa-IR")}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">اشتراک فعال نیست</p>
              <Button
                size="sm"
                className="w-full rounded-xl"
                onClick={() => setOverlay("subscription")}
              >
                <Crown className="w-4 h-4" />
                خرید پلن
              </Button>
            </div>
          )}
        </Card>

        {/* Wallet */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-cyan-500" />
              <h3 className="font-bold text-sm">کیف پول</h3>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[11px] text-muted-foreground">موجودی فعلی</p>
                <p className="font-black text-lg text-cyan-600 dark:text-cyan-400">
                  {toPersianDigits((user?.walletBalance ?? 0).toLocaleString("en-US"))} <span className="text-xs font-normal">تومان</span>
                </p>
              </div>
              <Wallet className="w-8 h-8 text-cyan-500/40" />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => setWalletOpen(true)}
            >
              شارژ کیف پول
            </Button>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-muted-foreground">تراکنش‌های اخیر</h4>
              {walletTxns.length > 5 && (
                <span className="text-[10px] text-muted-foreground/70">
                  {toPersianDigits(walletTxns.length)} تراکنش
                </span>
              )}
            </div>
            {walletTxnsLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : walletTxns.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground rounded-xl bg-muted/30 border border-dashed">
                هنوز تراکنشی ثبت نشده است
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar pl-1">
                {walletTxns.slice(0, 20).map((t) => {
                  const isIncome = t.amount >= 0;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50"
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isIncome
                            ? "bg-emerald-100 text-emerald-600"
                            : "bg-rose-100 text-rose-600"
                        }`}
                      >
                        {isIncome ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {t.description || txnTypeLabel(t.type)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatJalaliDateTime(t.createdAt)}
                        </p>
                      </div>
                      <div
                        className={`text-xs font-bold font-stat shrink-0 ${
                          isIncome ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {isIncome ? "+" : ""}
                        {toPersianDigits(Math.abs(t.amount).toLocaleString("en-US"))}
                        <span className="text-[9px] font-normal mr-0.5 opacity-70">ت</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Physical info / metrics */}
        {loading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : (
          profile && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-sm">اطلاعات فیزیکی</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <InfoRow label="وزن شروع" value={profile.startWeight ? `${toPersianDigits(profile.startWeight)} kg` : "—"} />
                <InfoRow label="وزن هدف" value={profile.targetWeight ? `${toPersianDigits(profile.targetWeight)} kg` : "—"} />
                {profile.bmi && <InfoRow label="شاخص BMI" value={toPersianDigits(profile.bmi)} />}
                {profile.bmr && <InfoRow label="متابولیسم (BMR)" value={`${toPersianDigits(profile.bmr)} کالری`} />}
                {profile.tdee && <InfoRow label="کالری روزانه (TDEE)" value={`${toPersianDigits(profile.tdee)} کالری`} />}
              </div>
            </Card>
          )
        )}

        {/* ─── پروفایل کامل آنبوردینگ با ویرایش سکشن‌به‌سکشن ─── */}
        {loading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : p ? (
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-sm">پرونده کامل ورزشی و پزشکی</h3>
            </div>

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
                  <InfoRow label="نام" value={user?.name || "—"} />
                  <InfoRow label="موبایل" value={user?.mobile ? toPersianDigits(user.mobile) : "—"} />
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
                    {p.equipment.map((eq) => (
                      <span key={eq} className="text-[11px] px-2 py-1 rounded-lg bg-muted/60 text-foreground">
                        {eq}
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
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <InfoRow label="آسیب‌دیدگی" value={p.injuries?.trim() ? p.injuries : "ندارد"} />
                  <InfoRow label="بیماری‌ها" value={p.diseases?.trim() ? p.diseases : "ندارد"} />
                  <InfoRow label="آلرژی دارویی" value={p.drugAllergies?.trim() ? p.drugAllergies : "ندارد"} />
                  <InfoRow label="داروهای مصرفی" value={p.currentMedications?.trim() ? p.currentMedications : "ندارد"} />
                  <InfoRow label="شرایط پزشکی" value={p.medicalConditionsLabel || "ندارد"} />
                </div>
              )}
            </Section>

            {/* ۶) ریکاوری */}
            <Section
              title="ریکاوری"
              icon={<Moon className="w-4 h-4 text-indigo-500" />}
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
                <div className="grid grid-cols-1 gap-2">
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
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <InfoRow
                    label="تاریخ هدف"
                    value={p.targetDate ? new Date(p.targetDate).toLocaleDateString("fa-IR") : "مشخص نشده"}
                  />
                </div>
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

            {/* اندازه‌های اولیه بدن (Baseline) — read-only از چکاپ phase 0 */}
            {baseline && (
              <Section title="اندازه‌های اولیه بدن (Baseline)" icon={<Ruler className="w-4 h-4 text-violet-500" />}>
                <div className="grid grid-cols-2 gap-2">
                  <InfoRow label="وزن اولیه" value={`${toPersianDigits(baseline.weight)} kg`} />
                  {baseline.chestMeasurement != null && (
                    <InfoRow label="دور سینه" value={`${toPersianDigits(baseline.chestMeasurement)} cm`} />
                  )}
                  {baseline.armMeasurement != null && (
                    <InfoRow label="دور بازو" value={`${toPersianDigits(baseline.armMeasurement)} cm`} />
                  )}
                  {baseline.waistMeasurement != null && (
                    <InfoRow label="دور کمر" value={`${toPersianDigits(baseline.waistMeasurement)} cm`} />
                  )}
                  {baseline.hipMeasurement != null && (
                    <InfoRow label="دور باسن" value={`${toPersianDigits(baseline.hipMeasurement)} cm`} />
                  )}
                  {baseline.thighMeasurement != null && (
                    <InfoRow label="دور ران" value={`${toPersianDigits(baseline.thighMeasurement)} cm`} />
                  )}
                </div>
                {baseline.createdAt && (
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    ثبت شده در: {new Date(baseline.createdAt).toLocaleDateString("fa-IR")}
                  </p>
                )}
              </Section>
            )}
          </Card>
        ) : null}

        {/* AI analysis snippet */}
        {onboarding?.analysis && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-sm">تحلیل فیتاپ هوشمند</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
              {onboarding.analysis}
            </p>
          </Card>
        )}

        {/* ─── عکس‌های پیشرفت بدن ─── */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Camera className="w-5 h-5 text-violet-500" />
            <h3 className="font-bold text-sm">عکس‌های پیشرفت بدن</h3>
          </div>
          {progressPhotos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {progressPhotos.slice(0, 9).map((photo: any) => (
                <div key={photo.id} className="relative group rounded-xl overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.imageUrl} alt={photo.type || "عکس"} className="w-full h-24 object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex flex-col justify-end p-1.5">
                    <p className="text-[9px] text-white font-medium">{photo.takenAt ? new Date(photo.takenAt).toLocaleDateString("fa-IR") : ""}</p>
                    {photo.type && <p className="text-[8px] text-white/80">{photo.type === "front" ? "جلو" : photo.type === "side" ? "پهلو" : photo.type === "back" ? "پشت" : "سایر"}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">هنوز عکس پیشرفتی ثبت نشده است</p>
          )}
        </Card>

        {/* ─── تحلیل عکس بدن ─── */}
        {userMedia.bodyAnalysis.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-orange-500" />
              <h3 className="font-bold text-sm">تحلیل عکس بدن ({toPersianDigits(userMedia.bodyAnalysis.length)})</h3>
            </div>
            <div className="space-y-3">
              {userMedia.bodyAnalysis.map((item: any) => (
                <div key={item.id} className="p-3 rounded-xl bg-orange-50/50 border border-orange-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("fa-IR")}</span>
                  </div>
                  {item.mediaUrl && (
                    <div className="mb-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.mediaUrl} alt="عکس بدن" className="w-full h-32 object-cover rounded-lg" loading="lazy" />
                    </div>
                  )}
                  {item.result?.analysis && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{item.result.analysis}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ─── تحلیل آزمایش خون ─── */}
        {userMedia.bloodTests.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TestTube className="w-5 h-5 text-rose-500" />
              <h3 className="font-bold text-sm">تحلیل آزمایش خون ({toPersianDigits(userMedia.bloodTests.length)})</h3>
            </div>
            <div className="space-y-3">
              {userMedia.bloodTests.map((item: any) => (
                <div key={item.id} className="p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("fa-IR")}</span>
                  </div>
                  {item.result?.summary && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{item.result.summary}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ─── تحلیل ویدیویی بدن ─── */}
        {userMedia.videoAnalysis.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Video className="w-5 h-5 text-cyan-500" />
              <h3 className="font-bold text-sm">تحلیل ویدیویی بدن ({toPersianDigits(userMedia.videoAnalysis.length)})</h3>
            </div>
            <div className="space-y-3">
              {userMedia.videoAnalysis.map((item: any) => (
                <div key={item.id} className="p-3 rounded-xl bg-cyan-50/50 border border-cyan-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("fa-IR")}</span>
                  </div>
                  {item.mediaUrl && (
                    <div className="mb-2">
                      <video src={item.mediaUrl} controls className="w-full h-32 object-cover rounded-lg" />
                    </div>
                  )}
                  {item.result?.analysis && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{item.result.analysis}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Settings list */}
        <div className="space-y-1">
          <SettingsRow
            icon={CreditCard}
            label="مدیریت اشتراک"
            onClick={() => setOverlay("subscription")}
            chevron
          />
          {user?.role === "ADMIN" && (
            <SettingsRow
              icon={Settings}
              label="پنل مدیریت"
              onClick={() => setOverlay("admin")}
              chevron
              highlight
            />
          )}
        </div>

        {/* Logout */}
        <Button
          variant="outline"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-xl text-destructive hover:text-destructive hover:bg-destructive/5"
        >
          {loggingOut ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              در حال خروج...
            </>
          ) : (
            <>
              <LogOut className="w-4 h-4" />
              خروج از حساب
            </>
          )}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground pt-2">
          فیتاپ — نسخه ۱.۰.۰
        </p>
      </div>

      {/* Wallet Charge Modal */}
      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>شارژ کیف پول</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="p-2 rounded-lg bg-orange-50 text-xs text-center">موجودی فعلی: <b className="font-stat">{toPersianDigits(formatToman(user?.walletBalance || 0))} ت</b></div>
            <div>
              <Label className="mb-1 block">مبلغ (تومان)</Label>
              <Input type="number" dir="ltr" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="مثلاً ۵۰۰۰۰۰" className="rounded-xl text-center font-stat" />
            </div>
            <div className="flex gap-2 flex-wrap">
              {[100000, 500000, 1000000].map(v => (
                <button key={v} onClick={() => setChargeAmount(String(v))} className="text-xs px-3 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 font-stat transition">
                  {toPersianDigits(formatToman(v))}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletOpen(false)} className="rounded-xl">انصراف</Button>
            <Button
              onClick={async () => {
                if (!chargeAmount || Number(chargeAmount) <= 0) return;
                try {
                  const res = await fetch("/api/wallet", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: Number(chargeAmount) }),
                  });
                  if (!res.ok) throw new Error();
                  const data = await res.json();
                  toast.success(`کیف پول ${toPersianDigits(formatToman(Number(chargeAmount)))} ت شارژ شد ✓`);
                  setWalletOpen(false);
                  setChargeAmount("");
                  if (data.user) useAppStore.getState().setUser(data.user);
                  if (data.transaction) {
                    setWalletTxns((prev) => [data.transaction as WalletTxnDto, ...prev]);
                  }
                } catch { toast.error("خطا در شارژ کیف پول"); }
              }}
              className="rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              شارژ کیف پول
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** برچسب فارسی نوع تراکنش کیف پول */
function txnTypeLabel(type: string): string {
  switch (type) {
    case "deposit":
      return "شارژ کیف پول";
    case "purchase":
      return "خرید";
    case "refund":
      return "بازگشت وجه";
    case "bonus":
      return "پاداش";
    default:
      return "تراکنش";
  }
}

/** فرمت تاریخ شمسی + ساعت — برای نمایش در لیست تراکنش‌ها */
function formatJalaliDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "long",
    }).format(d);
    const time = new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${date} · ${time}`;
  } catch {
    return "";
  }
}

// ─── کامپوننت Section با هدر، آیکون و دکمه‌های ویرایش ───
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

function SettingsRow({
  icon: Icon,
  label,
  action,
  onClick,
  chevron,
  highlight,
}: {
  icon: any;
  label: string;
  action?: React.ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition text-right ${
        highlight ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted"
      }`}
    >
      <Icon className={`w-5 h-5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {action}
      {chevron && <ChevronLeft className="w-4 h-4 text-muted-foreground" />}
    </button>
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

function EditTextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg text-sm min-h-[60px] resize-y"
        dir="rtl"
      />
    </div>
  );
}

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
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 rounded-lg text-sm">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
