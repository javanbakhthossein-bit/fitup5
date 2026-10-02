"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v135 — تب «بانک حرکات» پنل ادمین — ویدیوها + مدیریت کامل بانک حرکات
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * self-contained (بدون prop — مثل admin-referral-tab برای ادغام کافی است
 * <AdminExercisesTab /> رندر شود):
 *   • GET  /api/admin/exercises              — لیست کامل حرکات (رکورد خام شامل همهٔ فیلدها)
 *   • PUT  /api/admin/exercises              — ویرایش متن‌ها/لینک + کلید یوتیوب + فعال/غیرفعال
 *   • POST /api/admin/exercises              — ساخت حرکت (دستی یا ذخیرهٔ پیش‌نویس هوش مصنوعی)
 *   • POST /api/admin/exercises/ai-generate  — تحقیق هوش مصنوعی (~۳۰-۶۰ ثانیه):
 *     ویدیوی یوتیوب مختص همان حرکت (oEmbed راستی‌آزمایی‌شده) + پیش‌نویس متن
 *   • POST /api/admin/exercises/upload-chunk + upload-complete — آپلود چانکی
 *     (۴MB per chunk — همان موتور ضدتایم‌اوت گیت‌وی v90) با فشرده‌سازی +
 *     پوستر خودکار سمت سرور؛ پاسخ { videoUrl, videoPosterUrl, compressed, sizeBefore, sizeAfter }
 *   • DELETE /api/admin/exercises/video?exerciseId= — حذف فایل + ریست فیلدها
 *
 * قانون اولویت نمایش (v112): videoUrl (اختصاصی فیتاپ) > youtubeUrl (فال‌بک).
 * v135 — کلید فعال/غیرفعال تک‌حرکتی: غیرفعال = حذف از همهٔ لیست‌های عمومی سایت
 * (بانک، API عمومی، sitemap و…)؛ صفحهٔ /exercise/[id] پیام لطیف «غیرفعال»
 * نشان می‌دهد — مدیریت با کلید همان ردیف + چیپ‌های فیلتر وضعیت.
 *
 * استایل: شیشه‌ای ملایم هم‌خانوادهٔ پنل ادمین (rounded-2xl + bg-white/70 +
 * لهجهٔ نارنجی/امرالدی — بدون indigo/blue)، اعداد فارسی، توست‌های sonner.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clapperboard,
  Dumbbell,
  Eye,
  EyeOff,
  Film,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { exerciseMatchesSearch } from "@/lib/fitness/exercise-search";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  uploadFileChunked,
  type ChunkedUploadResult,
} from "@/lib/fitness/client-chunked-upload";

/* ─────────────────────────── انواع و ثابت‌ها ─────────────────────────── */

interface ExerciseRow {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  description: string;
  tips: string;
  youtubeUrl: string;
  // v113 — کلید تک‌حرکتی یوتیوب (سوییچ هر ردیف در پنل)
  youtubeEnabled: boolean;
  // v135 — کلید فعال/غیرفعال (ردیف‌های قدیمی‌تر ممکن است undefined باشند = فعال)
  isActive: boolean;
  videoUrl: string;
  videoSizeBytes: number;
  videoPosterUrl: string;
}

/** ردیف‌های قدیمی isActive ندارند — undefined = فعال (رفتار پیش‌فرض) */
function isRowActive(ex: ExerciseRow): boolean {
  return ex.isActive !== false;
}

/** فرم مشترک دیالوگ‌های «افزودن حرکت» و «ویرایش حرکت» */
interface ExerciseFormValue {
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  description: string;
  tips: string;
  youtubeUrl: string;
  youtubeEnabled: boolean;
  isActive: boolean;
}

const EMPTY_FORM: ExerciseFormValue = {
  name: "",
  muscle: "",
  category: "fullbody",
  equipment: "",
  difficulty: "intermediate",
  description: "",
  tips: "",
  youtubeUrl: "",
  youtubeEnabled: true,
  isActive: true,
};

type AdminUploadResult = ChunkedUploadResult & {
  videoUrl?: string;
  videoPosterUrl?: string;
  compressed?: boolean;
  sizeBefore?: number;
  sizeAfter?: number;
};

type VideoFilter = "all" | "custom" | "youtube" | "none";

// v135 — فیلتر وضعیت فعال/غیرفعال
type ActiveFilter = "all" | "active" | "inactive";

const CATEGORY_LABELS: Record<string, string> = {
  push: "فشار",
  pull: "کشش",
  legs: "پا",
  core: "مرکز بدن",
  cardio: "هوازی",
  fullbody: "بدن کامل",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

/** عضله‌های هدف — همان انام سمت سرور (POST / ai-generate) */
const MUSCLE_OPTIONS = [
  "سینه",
  "سرشانه",
  "پشت",
  "جلو بازو",
  "پشت بازو",
  "پا",
  "باسن",
  "ساق",
  "شکم",
  "کل بدن",
  "گردن و کول",
];

const FILE_ACCEPT = ".mp4,.webm,.mov,.m4v,.mkv,video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-matroska";

/** چک سبک سمت کلاینت لینک یوتیوب — خالی مجاز است؛ نرمال‌سازی نهایی با سرور */
const YOUTUBE_URL_PATTERN = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/\S+|youtu\.be\/\S+)$/i;

function youtubeUrlLooksValid(v: string): boolean {
  const t = v.trim();
  return t === "" || YOUTUBE_URL_PATTERN.test(t);
}

const YOUTUBE_HINT =
  "اختیاری — خالی = بدون ویدیوی یوتیوب. قالب درست: https://www.youtube.com/watch?v=XXXXXXXXXXX";

/* ─────────────────────────── هلپرهای محلی ─────────────────────────── */

/** حجم خوانا با رقم فارسی (پیش‌فرض — برای نمایش در ردیف) */
function fmtSize(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!n || n <= 0) return "—";
  if (n >= 1024 * 1024) return `${toPersianDigits((n / (1024 * 1024)).toFixed(1))} مگابایت`;
  return `${toPersianDigits(Math.max(1, Math.round(n / 1024)))} کیلوبایت`;
}

/** حجم کوتاه برای توست («۴۲.۳MB») */
function fmtSizeShort(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!v || v <= 0) return "۰";
  if (v >= 1024 * 1024) return `${toPersianDigits((v / (1024 * 1024)).toFixed(1))}MB`;
  return `${toPersianDigits(Math.max(1, Math.round(v / 1024)))}KB`;
}

function videoSourceOf(ex: ExerciseRow): "custom" | "youtube" | "none" {
  if (ex.videoUrl && ex.videoUrl.trim() !== "") return "custom";
  if (ex.youtubeUrl && ex.youtubeUrl.trim() !== "") return "youtube";
  return "none";
}

/** بج منبع ویدیو — هم‌خانوادهٔ بج‌های ادمین (بدون indigo/blue) */
function SourceBadge({ source }: { source: "custom" | "youtube" | "none" }) {
  if (source === "custom") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700 shrink-0">
        <Clapperboard className="w-3 h-3" />
        ویدیوی اختصاصی
      </span>
    );
  }
  if (source === "youtube") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[10px] font-bold text-red-600 shrink-0">
        <Youtube className="w-3 h-3" />
        فقط یوتیوب
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500 shrink-0">
      بدون ویدیو
    </span>
  );
}

function StatTile({ icon: Icon, tone, label, value }: {
  icon: typeof Film;
  tone: "orange" | "emerald" | "red" | "slate";
  label: string;
  value: string;
}) {
  const tones: Record<string, string> = {
    orange: "bg-orange-100 text-orange-600",
    emerald: "bg-emerald-100 text-emerald-600",
    red: "bg-red-100 text-red-500",
    slate: "bg-slate-100 text-slate-500",
  };
  return (
    <Card className="p-3.5 border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
          <p className="text-lg font-black text-slate-900 leading-tight tabular-nums">{value}</p>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────── v135 — فیلدهای فرم حرکت (افزودن دستی/AI + ویرایش) ─────────────── */

function Field({
  id,
  label,
  required,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-bold text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[10px] leading-tight text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** پیام خطای اینلاین فرم‌ها */
function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-red-600"
    >
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{message}</span>
    </p>
  );
}

const SELECT_CLASS =
  "h-11 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-900 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-orange-300 focus-visible:ring-[3px] focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50";

const INPUT_CLASS = "h-11 text-sm bg-white/80 border-slate-200 focus-visible:ring-orange-300";
const TEXTAREA_CLASS = "text-sm bg-white/80 border-slate-200 focus-visible:ring-orange-300";

function ExerciseFormFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: ExerciseFormValue;
  onChange: (patch: Partial<ExerciseFormValue>) => void;
  disabled?: boolean;
}) {
  const ytInvalid = !youtubeUrlLooksValid(value.youtubeUrl);
  return (
    <div className="space-y-3">
      <Field id={`${idPrefix}-name`} label="نام حرکت" required>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          maxLength={100}
          placeholder="مثال: پرس سینه هالتر (Barbell Bench Press)"
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field id={`${idPrefix}-muscle`} label="عضلهٔ هدف">
          <select
            id={`${idPrefix}-muscle`}
            value={value.muscle}
            onChange={(e) => onChange({ muscle: e.target.value })}
            disabled={disabled}
            className={SELECT_CLASS}
          >
            <option value="">— نامشخص —</option>
            {MUSCLE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${idPrefix}-category`} label="دسته">
          <select
            id={`${idPrefix}-category`}
            value={value.category}
            onChange={(e) => onChange({ category: e.target.value })}
            disabled={disabled}
            className={SELECT_CLASS}
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field id={`${idPrefix}-equipment`} label="تجهیزات">
          <Input
            id={`${idPrefix}-equipment`}
            value={value.equipment}
            onChange={(e) => onChange({ equipment: e.target.value })}
            disabled={disabled}
            placeholder="مثال: هالتر، دمبل، وزن بدن"
            className={INPUT_CLASS}
          />
        </Field>
        <Field id={`${idPrefix}-difficulty`} label="سختی">
          <select
            id={`${idPrefix}-difficulty`}
            value={value.difficulty}
            onChange={(e) => onChange({ difficulty: e.target.value })}
            disabled={disabled}
            className={SELECT_CLASS}
          >
            {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id={`${idPrefix}-description`} label="توضیحات (نحوهٔ اجرا)">
        <Textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
          disabled={disabled}
          rows={3}
          placeholder="۲ تا ۳ جمله دربارهٔ اجرای صحیح حرکت…"
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field id={`${idPrefix}-tips`} label="نکات ایمنی">
        <Textarea
          id={`${idPrefix}-tips`}
          value={value.tips}
          onChange={(e) => onChange({ tips: e.target.value })}
          disabled={disabled}
          rows={2}
          placeholder="اشتباهات رایج و نکات ایمنی حرکت…"
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field id={`${idPrefix}-youtube`} label="لینک یوتیوب" hint={YOUTUBE_HINT}>
        <Input
          id={`${idPrefix}-youtube`}
          dir="ltr"
          value={value.youtubeUrl}
          onChange={(e) => onChange({ youtubeUrl: e.target.value })}
          disabled={disabled}
          placeholder="https://www.youtube.com/watch?v=XXXXXXXXXXX"
          className={`${INPUT_CLASS} text-left ${ytInvalid ? "border-red-300 focus-visible:ring-red-300" : ""}`}
        />
      </Field>
    </div>
  );
}

/* ─────────────────────────── کامپوننت اصلی ─────────────────────────── */

export function AdminExercisesTab() {
  const [exercises, setExercises] = useState<ExerciseRow[] | null>(null); // null = بار اول
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState<VideoFilter>("all");
  // v135 — فیلتر وضعیت فعال/غیرفعال
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  // v113 — کلید سراسری یوتیوب (دیرکتیو مالک) — SiteSetting exercise_youtube_enabled
  const [globalYoutube, setGlobalYoutube] = useState(true);
  const [globalYoutubeSaving, setGlobalYoutubeSaving] = useState(false);

  // آپلود چانکی per-row
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // انتخاب فایل + دیالوگ‌های تأیید
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPickRef = useRef<ExerciseRow | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<ExerciseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExerciseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* ─── v135 — دیالوگ «افزودن حرکت» (دستی / هوش مصنوعی) ─── */
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "ai">("manual");
  // مرحلهٔ حالت AI: ورودی نام → فرم پیش‌نویس
  const [aiStage, setAiStage] = useState<"input" | "form">("input");
  const [createForm, setCreateForm] = useState<ExerciseFormValue>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [verifiedVideo, setVerifiedVideo] = useState<{ title: string; channel: string } | null>(null);

  /* ─── v135 — دیالوگ «ویرایش حرکت» ─── */
  const [editTarget, setEditTarget] = useState<ExerciseRow | null>(null);
  const [editForm, setEditForm] = useState<ExerciseFormValue>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/exercises", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      setExercises((data.exercises || []) as ExerciseRow[]);
      // v113 — کلید سراسری از همان پاسخ (بدون درخواست اضافه)
      if (typeof data.globalYoutubeEnabled === "boolean") {
        setGlobalYoutube(data.globalYoutubeEnabled);
      }
    } catch (e) {
      toast.error("دریافت بانک حرکات ناموفق بود", {
        description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ─── آمار + لیست فیلترشده ───
   * v113 — رفع باگ شمارنده (گزارش مالک: «بدون ویدیو زده ۵۰ ولی ۱ نشان می‌دهد»):
   * شمارش چیپ‌ها قبلاً روی کل لیست انجام می‌شد ولی لیست علاوه بر فیلتر،
   * جستجو را هم اعمال می‌کرد → عدد چیپ ≠ طول لیست. حالا هر دو از «همان
   * زیرمجموعهٔ جستجوشده» محاسبه می‌شوند — عدد هر چیپ همیشه = طول لیستِ همان فیلتر.
   * v135 — دو بعدِ فیلتر (ویدیو × وضعیت) به‌صورت متقاطع شمرده می‌شوند:
   * عدد هر چیپ = تعداد ردیف‌هایی که با کلیک روی آن دیده می‌شود. */
  const list = exercises ?? [];
  const q = searchInput.trim();
  const searchMatched = useMemo(() => {
    if (!q) return list;
    // v114 — جستجوی مترادف‌محور ادمین (همان موتور بانک عمومی):
    // «پرس زیر سینه» ← پرس سینه با شیب منفی، «دمبل» روی تجهیزات هم می‌خواند و…
    // v116 — فالبک نام‌های بلند: «… با …» صفر نتیجه → حذف پسوند «با X» و تلاش دوباره
    // v135 — توضیحات هم در هِی‌استک جستجو وارد شد (ردیف‌ها فیلد کامل دارند)
    const matches = (ex: (typeof list)[number], query: string) =>
      exerciseMatchesSearch(
        { name: ex.name, muscle: ex.muscle, equipment: ex.equipment, description: ex.description || null },
        query
      );
    let matched = list.filter((ex) => matches(ex, q));
    if (matched.length === 0) {
      const stripped = q.replace(/\s+با\s+\S+\s*$/u, "").trim();
      if (stripped && stripped !== q) {
        matched = list.filter((ex) => matches(ex, stripped));
      }
    }
    return matched;
  }, [list, q]);

  // v135 — اعمال فیلتر وضعیت (فعال/غیرفعال)
  const activeMatched =
    activeFilter === "all"
      ? searchMatched
      : searchMatched.filter((ex) => (activeFilter === "active") === isRowActive(ex));

  const applyVideoFilter = (ex: ExerciseRow) => {
    const source = videoSourceOf(ex);
    if (filter === "custom" && source !== "custom") return false;
    if (filter === "youtube" && source !== "youtube") return false;
    if (filter === "none" && source !== "none") return false;
    return true;
  };

  // شمارش چیپ‌های ویدیو روی زیرمجموعهٔ وضعیت‌دار
  const videoMatched = searchMatched.filter(applyVideoFilter);

  // کاشی‌های آمار — روی همهٔ نتایج جستجو (مستقل از فیلترها؛ همان رفتار قبل)
  const stats = {
    total: searchMatched.length,
    custom: searchMatched.filter((e) => videoSourceOf(e) === "custom").length,
    youtube: searchMatched.filter((e) => videoSourceOf(e) === "youtube").length,
    none: searchMatched.filter((e) => videoSourceOf(e) === "none").length,
  };

  const filtered = activeMatched.filter(applyVideoFilter);

  /* ─── v113 — کلید سراسری یوتیوب (همهٔ حرکات) ─── */
  const toggleGlobalYoutube = useCallback(async (next: boolean) => {
    setGlobalYoutubeSaving(true);
    const prev = globalYoutube;
    setGlobalYoutube(next); // optimistic
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "exercise_youtube_enabled", value: next ? "1" : "0" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      toast.success(next ? "ویدیوهای یوتیوب روشن شد" : "ویدیوهای یوتیوب خاموش شد", {
        description: next
          ? "یوتیوبِ همهٔ حرکات (که کلید تک‌حرکتی‌شان روشن است) در سایت نمایش داده می‌شود."
          : "در هیچ‌جای سایت ویدیوی یوتیوب نشان داده نمی‌شود؛ فقط ویدیوهای اختصاصی/انیمیشن.",
      });
    } catch (e) {
      setGlobalYoutube(prev); // rollback
      toast.error("تغییر کلید سراسری یوتیوب ناموفق بود", {
        description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
      });
    } finally {
      setGlobalYoutubeSaving(false);
    }
  }, [globalYoutube]);

  /* ─── v113 — کلید یوتیوبِ تک‌حرکتی ─── */
  const toggleRowYoutube = useCallback(async (ex: ExerciseRow, next: boolean) => {
    const prev = ex.youtubeEnabled;
    // optimistic — بدون reload لیست
    setExercises((rows) =>
      (rows ?? []).map((r) => (r.id === ex.id ? { ...r, youtubeEnabled: next } : r))
    );
    try {
      const res = await fetch("/api/admin/exercises", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ex.id, youtubeEnabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      toast.success(next ? "یوتیوب این حرکت روشن شد" : "یوتیوب این حرکت خاموش شد", {
        description: next
          ? `«${ex.name}»: ویدیوی یوتیوب (اگر ثبت شده باشد) در سایت نمایش داده می‌شود.`
          : `«${ex.name}»: فقط ویدیوی اختصاصی/انیمیشن نشان داده می‌شود و یوتیوب پنهان است.`,
      });
    } catch (e) {
      setExercises((rows) =>
        (rows ?? []).map((r) => (r.id === ex.id ? { ...r, youtubeEnabled: prev } : r))
      );
      toast.error("تغییر کلید یوتیوب ناموفق بود", {
        description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
      });
    }
  }, []);

  /* ─── v135 — کلید فعال/غیرفعال تک‌حرکتی (optimistic مثل کلید یوتیوب) ─── */
  const toggleRowActive = useCallback(async (ex: ExerciseRow, next: boolean) => {
    const prev = isRowActive(ex);
    setExercises((rows) =>
      (rows ?? []).map((r) => (r.id === ex.id ? { ...r, isActive: next } : r))
    );
    try {
      const res = await fetch("/api/admin/exercises", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ex.id, isActive: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      toast.success(next ? "حرکت فعال شد" : "حرکت غیرفعال شد", {
        description: next
          ? `«${ex.name}» دوباره در بانک حرکات و همهٔ لیست‌های عمومی سایت نمایش داده می‌شود.`
          : `«${ex.name}» از همهٔ لیست‌های عمومی حذف شد؛ صفحهٔ خودِ حرکت پیام لطیف «غیرفعال» نشان می‌دهد.`,
      });
    } catch (e) {
      setExercises((rows) =>
        (rows ?? []).map((r) => (r.id === ex.id ? { ...r, isActive: prev } : r))
      );
      toast.error("تغییر وضعیت حرکت ناموفق بود", {
        description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
      });
    }
  }, []);

  /* ─── v135 — دیالوگ افزودن حرکت ─── */

  const openCreate = () => {
    setCreateMode("manual");
    setAiStage("input");
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setCreateSaving(false);
    setAiLoading(false);
    setVideoNote(null);
    setVerifiedVideo(null);
    setCreateOpen(true);
  };

  /** جابه‌جایی بین تب‌های «دستی» و «هوش مصنوعی» — مقادیر فرم حفظ می‌شود */
  const switchCreateMode = (m: "manual" | "ai") => {
    if (m === createMode) return;
    setCreateMode(m);
    setCreateError(null);
    if (m === "ai") {
      setAiStage("input");
      setVideoNote(null);
      setVerifiedVideo(null);
    }
  };

  /** تولید پیش‌نویس با هوش مصنوعی (تحقیق سمت سرور — تا ~۶۰ ثانیه) */
  const runAiGenerate = async () => {
    const name = createForm.name.trim();
    if (!name) {
      setCreateError("نام حرکت را وارد کنید تا هوش مصنوعی تحقیق کند.");
      return;
    }
    setAiLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/exercises/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      const draft = (data?.draft ?? {}) as Partial<ExerciseFormValue>;
      setCreateForm((f) => ({
        ...f,
        name: typeof draft.name === "string" && draft.name.trim() ? draft.name : name,
        muscle: typeof draft.muscle === "string" && draft.muscle ? draft.muscle : f.muscle,
        category: typeof draft.category === "string" && draft.category ? draft.category : f.category,
        equipment: typeof draft.equipment === "string" ? draft.equipment : f.equipment,
        difficulty:
          typeof draft.difficulty === "string" && draft.difficulty ? draft.difficulty : f.difficulty,
        description: typeof draft.description === "string" ? draft.description : f.description,
        tips: typeof draft.tips === "string" ? draft.tips : f.tips,
        youtubeUrl: typeof draft.youtubeUrl === "string" ? draft.youtubeUrl : f.youtubeUrl,
        youtubeEnabled: draft.youtubeEnabled === false ? false : true,
        isActive: draft.isActive === false ? false : true,
      }));
      setVideoNote(
        typeof data?.videoNote === "string" && data.videoNote.trim() ? data.videoNote : null
      );
      setVerifiedVideo(
        data?.video && typeof data.video === "object"
          ? { title: String(data.video.title ?? ""), channel: String(data.video.channel ?? "") }
          : null
      );
      setAiStage("form");
      toast.success("پیش‌نویس آماده شد", {
        description: "فیلدها را بازبینی و در صورت نیاز ویرایش کنید، سپس ذخیره کنید.",
      });
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : "تولید پیش‌نویس ناموفق بود؛ لطفاً دوباره تلاش کنید."
      );
    } finally {
      setAiLoading(false);
    }
  };

  /** اعتبارسنجی سبک مشترک فرم افزودن/ویرایش — پیام خطا یا null */
  const validateForm = (form: ExerciseFormValue): string | null => {
    if (!form.name.trim()) return "نام حرکت الزامی است.";
    if (!youtubeUrlLooksValid(form.youtubeUrl)) {
      return "لینک یوتیوب معتبر نیست. مثال درست: https://www.youtube.com/watch?v=XXXXXXXXXXX";
    }
    return null;
  };

  /** ذخیرهٔ حرکت جدید — هم برای «ساخت دستی» و هم برای «ذخیرهٔ پیش‌نویس AI» */
  const runCreate = async () => {
    const invalid = validateForm(createForm);
    if (invalid) {
      setCreateError(invalid);
      return;
    }
    setCreateSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          muscle: createForm.muscle.trim(),
          category: createForm.category,
          equipment: createForm.equipment.trim(),
          difficulty: createForm.difficulty,
          description: createForm.description.trim(),
          tips: createForm.tips.trim(),
          youtubeUrl: createForm.youtubeUrl.trim(),
          youtubeEnabled: createForm.youtubeEnabled,
          isActive: createForm.isActive,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      toast.success("حرکت اضافه شد", {
        description: `«${createForm.name.trim()}» به بانک حرکات اضافه شد.`,
      });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : "ذخیرهٔ حرکت ناموفق بود؛ لطفاً دوباره تلاش کنید."
      );
    } finally {
      setCreateSaving(false);
    }
  };

  /* ─── v135 — ویرایش متن حرکت (optimistic + rollback مثل کلید یوتیوب) ─── */

  const openEdit = (ex: ExerciseRow) => {
    setEditTarget(ex);
    setEditForm({
      name: ex.name,
      muscle: ex.muscle || "",
      category: ex.category,
      equipment: ex.equipment ?? "",
      difficulty: ex.difficulty,
      description: ex.description ?? "",
      tips: ex.tips ?? "",
      youtubeUrl: ex.youtubeUrl ?? "",
      youtubeEnabled: ex.youtubeEnabled !== false,
      isActive: isRowActive(ex),
    });
    setEditError(null);
    setEditSaving(false);
  };

  const runEditSave = async () => {
    const target = editTarget;
    if (!target) return;
    const invalid = validateForm(editForm);
    if (invalid) {
      setEditError(invalid);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const prevRow = target;
    const patched: ExerciseRow = {
      ...target,
      name: editForm.name.trim(),
      muscle: editForm.muscle.trim(),
      category: editForm.category,
      equipment: editForm.equipment.trim(),
      difficulty: editForm.difficulty,
      description: editForm.description.trim(),
      tips: editForm.tips.trim(),
      youtubeUrl: editForm.youtubeUrl.trim(),
    };
    // optimistic — ردیف بلافاصله آپدیت می‌شود
    setExercises((rows) => (rows ?? []).map((r) => (r.id === target.id ? patched : r)));
    try {
      const res = await fetch("/api/admin/exercises", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: target.id,
          name: patched.name,
          muscle: patched.muscle,
          category: patched.category,
          equipment: patched.equipment,
          difficulty: patched.difficulty,
          description: patched.description,
          tips: patched.tips,
          youtubeUrl: patched.youtubeUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "خطا"));
      // تطبیق نهایی با پاسخ سرور (مثلاً youtubeUrl نرمال‌شده به قالب امبد)
      const saved = data?.exercise as Partial<ExerciseRow> | undefined;
      if (saved && typeof saved === "object") {
        setExercises((rows) =>
          (rows ?? []).map((r) => (r.id === target.id ? { ...r, ...saved } : r))
        );
      }
      toast.success("ذخیره شد", {
        description: `تغییرات «${patched.name}» اعمال شد.`,
      });
      setEditTarget(null);
    } catch (e) {
      // rollback — ردیف به حالت قبلی برمی‌گردد و خطا داخل دیالوگ نشان داده می‌شود
      setExercises((rows) => (rows ?? []).map((r) => (r.id === target.id ? prevRow : r)));
      setEditError(
        e instanceof Error ? e.message : "ذخیرهٔ تغییرات ناموفق بود؛ لطفاً دوباره تلاش کنید."
      );
    } finally {
      setEditSaving(false);
    }
  };

  /* ─── آپلود ─── */
  const runUpload = useCallback(async (ex: ExerciseRow, file: File) => {
    setUploadingId(ex.id);
    setUploadPct(0);
    try {
      const data = (await uploadFileChunked(file, "exercise-videos", {
        onProgress: (pct) => setUploadPct(pct),
        abortRef,
        endpoints: {
          chunk: "/api/admin/exercises/upload-chunk",
          complete: "/api/admin/exercises/upload-complete",
        },
        completeBody: { exerciseId: ex.id, filename: file.name, mime: file.type || "video/mp4" },
      })) as AdminUploadResult;

      if (data.compressed) {
        toast.success("ویدیوی اختصاصی ذخیره شد", {
          description: `فشرده‌سازی: ${fmtSizeShort(data.sizeBefore)} → ${fmtSizeShort(data.sizeAfter)} — کیفیت حفظ شد`,
        });
      } else {
        toast.success("ویدیوی اختصاصی ذخیره شد", {
          description: "بدون فشرده‌سازی ذخیره شد (حجم مناسب بود یا ffmpeg روی سرور در دسترس نیست).",
        });
      }
      await load();
    } catch (e) {
      if (e instanceof Error && e.message.includes("لغو")) {
        toast.info("آپلود لغو شد");
      } else {
        toast.error("آپلود ویدیو ناموفق بود", {
          description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
        });
      }
    } finally {
      setUploadingId(null);
      setUploadPct(0);
    }
  }, [load]);

  const openFilePicker = (ex: ExerciseRow) => {
    pendingPickRef.current = ex;
    fileInputRef.current?.click();
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    const target = pendingPickRef.current;
    pendingPickRef.current = null;
    e.target.value = ""; // اجازهٔ انتخاب همان فایل دوباره
    if (file && target) void runUpload(target, file);
  };

  /* ─── حذف ─── */
  const runDelete = async () => {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/exercises/video?exerciseId=${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || "خطا"));
      toast.success("ویدیوی اختصاصی حذف شد", { description: `«${target.name}» به فال‌بک یوتیوب برمی‌گردد.` });
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error("حذف ویدیو ناموفق بود", {
        description: e instanceof Error ? e.message : "دوباره تلاش کنید.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const isInitial = exercises === null;
  const busy = uploadingId !== null;

  const FILTERS: { key: VideoFilter; label: string; count: number }[] = [
    { key: "all", label: "همه", count: activeMatched.length },
    { key: "custom", label: "ویدیوی اختصاصی", count: activeMatched.filter((e) => videoSourceOf(e) === "custom").length },
    { key: "youtube", label: "فقط یوتیوب", count: activeMatched.filter((e) => videoSourceOf(e) === "youtube").length },
    { key: "none", label: "بدون ویدیو", count: activeMatched.filter((e) => videoSourceOf(e) === "none").length },
  ];

  // v135 — چیپ‌های وضعیت (شمارش روی زیرمجموعهٔ فیلتر ویدیو — متقاطع)
  const ACTIVE_FILTERS: { key: ActiveFilter; label: string; count: number }[] = [
    { key: "all", label: "همه", count: videoMatched.length },
    { key: "active", label: "فعال", count: videoMatched.filter((e) => isRowActive(e)).length },
    { key: "inactive", label: "غیرفعال", count: videoMatched.filter((e) => !isRowActive(e)).length },
  ];

  return (
    <div className="space-y-4">
      {/* ─── ۱. هدر ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shrink-0 shadow-sm">
            <Clapperboard className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-black text-slate-900 text-base leading-tight">بانک حرکات — ویدیوهای اختصاصی</h2>
            <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
              آپلود ویدیوی هر حرکت؛ فشرده‌سازی و پوستر خودکار — نمایش همه‌جا بالاتر از یوتیوب
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 bg-white/80 border-slate-200 hover:border-orange-300"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          بروزرسانی
        </Button>
      </div>

      {/* ─── ۱.۵. کلید سراسری یوتیوب (v113 — دیرکتیو مالک) + افزودن حرکت (v135) ─── */}
      <Card className="p-4 border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                globalYoutube ? "bg-gradient-to-br from-red-500 to-rose-500" : "bg-slate-200"
              }`}
            >
              <Youtube className={`w-5 h-5 ${globalYoutube ? "text-white" : "text-slate-500"}`} />
            </div>
            <div className="min-w-0">
              <p className="font-black text-slate-900 text-sm leading-tight flex items-center gap-1.5">
                ویدیوهای یوتیوب (همهٔ حرکات)
                <Globe className="w-3.5 h-3.5 text-slate-400" />
              </p>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                {globalYoutube
                  ? "روشن — یوتیوبِ حرکات (کلید تک‌حرکتی‌شان روشن است) در سایت نمایش داده می‌شود؛ اگر ویدیوی اختصاصی باشد، هر دو نشان داده می‌شوند."
                  : "خاموش — در هیچ‌جای سایت ویدیوی یوتیوب نمایش داده نمی‌شود؛ فقط ویدیوهای اختصاصی/انیمیشن."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {/* v135 — افزودن حرکت (دستی یا با هوش مصنوعی) */}
            <Button
              onClick={openCreate}
              className="min-h-11 bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              افزودن حرکت
            </Button>
            <Switch
              checked={globalYoutube}
              disabled={globalYoutubeSaving}
              onCheckedChange={(v) => void toggleGlobalYoutube(v)}
              aria-label="کلید سراسری ویدیوهای یوتیوب"
            />
          </div>
        </div>
      </Card>

      {/* ─── ۲. کاشی‌های آمار ─── */}
      {isInitial ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={Dumbbell} tone="orange" label="کل حرکات" value={toPersianDigits(stats.total)} />
          <StatTile icon={Clapperboard} tone="emerald" label="ویدیوی اختصاصی" value={toPersianDigits(stats.custom)} />
          <StatTile icon={Youtube} tone="red" label="فقط یوتیوب" value={toPersianDigits(stats.youtube)} />
          <StatTile icon={Film} tone="slate" label="بدون ویدیو" value={toPersianDigits(stats.none)} />
        </div>
      )}

      {/* ─── ۳. جستجو + فیلتر + لیست ─── */}
      <Card className="p-4 border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="جستجو: نام حرکت یا عضله…"
            className="pr-9 h-11 text-sm bg-white/80 border-slate-200 focus-visible:ring-orange-300"
            aria-label="جستجوی حرکت"
          />
          {loading && !isInitial && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400 animate-spin" />
          )}
        </div>

        {/* چیپ‌های فیلتر ویدیو */}
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span className="text-[11px] font-bold text-slate-400 shrink-0">ویدیو:</span>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`min-h-11 px-3.5 rounded-full text-xs font-bold border transition ${
                filter === f.key
                  ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                  : "bg-white/80 text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-700"
              }`}
            >
              {f.label} ({toPersianDigits(f.count)})
            </button>
          ))}
        </div>

        {/* v135 — چیپ‌های وضعیت (فعال/غیرفعال) */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-[11px] font-bold text-slate-400 shrink-0">وضعیت:</span>
          {ACTIVE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={`min-h-11 px-3.5 rounded-full text-xs font-bold border transition ${
                activeFilter === f.key
                  ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                  : "bg-white/80 text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800"
              }`}
            >
              {f.label} ({toPersianDigits(f.count)})
            </button>
          ))}
        </div>

        {/* لیست — اسکرول با اسکرول‌بار سفارشی */}
        {isInitial ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
              <Dumbbell className="w-10 h-10 text-slate-300" />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-600">حرکتی با این فیلتر/جستجو یافت نشد</p>
            <p className="mt-1 text-[11px] text-slate-400">فیلتر دیگری را امتحان کنید یا جستجو را پاک کنید.</p>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto custom-scrollbar pl-1 space-y-2">
            {filtered.map((ex) => {
              const source = videoSourceOf(ex);
              const isUploadingRow = uploadingId === ex.id;
              const rowActive = isRowActive(ex);
              return (
                <div
                  key={ex.id}
                  className={`p-3 rounded-xl border bg-white/80 transition ${
                    isUploadingRow ? "border-orange-300 bg-orange-50/40" : "border-slate-200/70"
                  } ${!rowActive ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    {/* پیش‌نمایش */}
                    <div className="w-full sm:w-28 shrink-0 aspect-video rounded-lg overflow-hidden border border-slate-200 bg-slate-900 relative">
                      {source === "custom" ? (
                        <video
                          src={`${ex.videoUrl}#t=0.1`}
                          poster={ex.videoPosterUrl || undefined}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full"
                        />
                      ) : source === "youtube" ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-red-400">
                          <Youtube className="w-5 h-5" />
                          <span className="text-[9px] font-bold">یوتیوب</span>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-500">
                          <Dumbbell className="w-5 h-5" />
                          <span className="text-[9px] font-bold">بدون ویدیو</span>
                        </div>
                      )}
                    </div>

                    {/* اطلاعات */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-slate-900 truncate max-w-full">{ex.name}</p>
                        <SourceBadge source={source} />
                        {/* v135 — بج غیرفعال */}
                        {!rowActive && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-700 shrink-0">
                            <EyeOff className="w-3 h-3" />
                            غیرفعال
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {ex.muscle && (
                          <span className="px-2 py-0.5 rounded-full bg-orange-50 border border-orange-100 text-[10px] font-bold text-orange-700">
                            {ex.muscle}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                          {CATEGORY_LABELS[ex.category] || ex.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100 text-[10px] font-bold text-amber-700">
                          {DIFFICULTY_LABELS[ex.difficulty] || ex.difficulty}
                        </span>
                        {source === "custom" && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-bold text-emerald-600 tabular-nums">
                            حجم: {fmtSize(ex.videoSizeBytes)}
                          </span>
                        )}
                      </div>

                      {/* پیشرفت آپلود inline */}
                      {isUploadingRow && (
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-orange-700 mb-1">
                            <span className="flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {uploadPct >= 99
                                ? "در حال پردازش سرور (فشرده‌سازی + پوستر)…"
                                : "در حال آپلود چانک‌ها…"}
                            </span>
                            <span className="tabular-nums">{toPersianDigits(uploadPct)}٪</span>
                          </div>
                          <div className="h-2 rounded-full bg-orange-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-l from-orange-500 to-amber-500 transition-all duration-300"
                              style={{ width: `${uploadPct}%` }}
                            />
                          </div>
                          {uploadPct < 99 && (
                            <button
                              type="button"
                              onClick={() => abortRef.current?.abort()}
                              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition"
                            >
                              <X className="w-3 h-3" />
                              لغو آپلود
                            </button>
                          )}
                        </div>
                      )}

                      {/* v135 — کلید فعال/غیرفعال تک‌حرکتی */}
                      <div
                        className={`mt-2.5 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                          rowActive ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-800 leading-tight flex items-center gap-1.5">
                            {rowActive ? (
                              <Eye className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                            )}
                            نمایش این حرکت در سایت
                          </p>
                          <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                            {rowActive
                              ? "فعال — در بانک حرکات و همهٔ لیست‌های عمومی سایت نمایش داده می‌شود."
                              : "غیرفعال — از لیست‌های عمومی حذف شده؛ فقط در همین پنل دیده می‌شود."}
                          </p>
                        </div>
                        <Switch
                          checked={rowActive}
                          disabled={busy}
                          onCheckedChange={(v) => void toggleRowActive(ex, v)}
                          aria-label={`کلید فعال/غیرفعال حرکت ${ex.name}`}
                        />
                      </div>

                      {/* v113 — کلید یوتیوبِ تک‌حرکتی (فقط برای حرکاتی که لینک یوتیوب دارند) */}
                      {ex.youtubeUrl && ex.youtubeUrl.trim() !== "" && (
                        <div
                          className={`mt-2.5 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                            ex.youtubeEnabled && globalYoutube
                              ? "border-red-200 bg-red-50/60"
                              : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-800 leading-tight flex items-center gap-1.5">
                              <Youtube
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  ex.youtubeEnabled && globalYoutube ? "text-red-500" : "text-slate-400"
                                }`}
                              />
                              ویدیوی یوتیوب این حرکت
                              {!globalYoutube && (
                                <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5">
                                  کلید سراسری خاموش است
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                              {ex.youtubeEnabled
                                ? source === "custom"
                                  ? "در سایت، هر دو ویدیوی اختصاصی و یوتیوب نمایش داده می‌شوند."
                                  : "در سایت نمایش داده می‌شود (کلید سراسری روشن باشد)."
                                : source === "custom"
                                ? "فقط ویدیوی اختصاصی فیتاپ نمایش داده می‌شود؛ یوتیوب پنهان است."
                                : "پنهان است — این حرکت فعلاً هیچ ویدیویی در سایت نشان نمی‌دهد."}
                            </p>
                          </div>
                          <Switch
                            checked={ex.youtubeEnabled}
                            disabled={busy}
                            onCheckedChange={(v) => void toggleRowYoutube(ex, v)}
                            aria-label={`کلید یوتیوب حرکت ${ex.name}`}
                          />
                        </div>
                      )}
                    </div>

                    {/* اکشن‌ها */}
                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:flex-col sm:items-stretch">
                      {/* v135 — ویرایش متن حرکت */}
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => openEdit(ex)}
                        className="min-h-11 flex-1 sm:flex-none text-xs bg-white border-slate-200 hover:border-orange-300 hover:text-orange-700"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        ویرایش
                      </Button>
                      {source === "custom" ? (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setConfirmReplace(ex)}
                          className="min-h-11 flex-1 sm:flex-none text-xs bg-white border-slate-200 hover:border-orange-300 hover:text-orange-700"
                        >
                          <Replace className="w-3.5 h-3.5" />
                          جایگزینی
                        </Button>
                      ) : (
                        <Button
                          disabled={busy}
                          onClick={() => openFilePicker(ex)}
                          className="min-h-11 flex-1 sm:flex-none text-xs bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          آپلود ویدیو
                        </Button>
                      )}
                      {source === "custom" && (
                        <Button
                          variant="outline"
                          disabled={busy || deleting}
                          onClick={() => setConfirmDelete(ex)}
                          className="min-h-11 flex-1 sm:flex-none text-xs bg-white border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          حذف
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ورودی فایل پنهان — همهٔ ردیف‌ها از همین استفاده می‌کنند */}
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        onChange={onFilePicked}
        className="hidden"
        aria-hidden
      />

      {/* ─── v135 — دیالوگ افزودن حرکت (ساخت دستی / ساخت با هوش مصنوعی) ─── */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent
          dir="rtl"
          className="max-w-[calc(100%-1rem)] sm:max-w-md max-h-[85dvh] overflow-y-auto custom-scrollbar"
        >
          <DialogHeader>
            <DialogTitle className="text-right">افزودن حرکت به بانک</DialogTitle>
            <DialogDescription className="text-right leading-relaxed">
              حرکت جدید را دستی کامل کنید یا نامش را به هوش مصنوعی بدهید تا تحقیق کند و پیش‌نویس آماده بسازد.
            </DialogDescription>
          </DialogHeader>

          {/* تب‌های حالت ساخت */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="روش ساخت حرکت">
            <button
              type="button"
              role="tab"
              aria-selected={createMode === "manual"}
              onClick={() => switchCreateMode("manual")}
              disabled={createSaving || aiLoading}
              className={`min-h-11 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition disabled:opacity-50 ${
                createMode === "manual"
                  ? "bg-white text-orange-700 border border-orange-200 shadow-sm"
                  : "text-slate-500 border border-transparent hover:text-slate-700"
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
              ساخت دستی
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createMode === "ai"}
              onClick={() => switchCreateMode("ai")}
              disabled={createSaving || aiLoading}
              className={`min-h-11 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition disabled:opacity-50 ${
                createMode === "ai"
                  ? "bg-white text-orange-700 border border-orange-200 shadow-sm"
                  : "text-slate-500 border border-transparent hover:text-slate-700"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              ساخت با هوش مصنوعی
            </button>
          </div>

          {createMode === "manual" ? (
            <>
              <ExerciseFormFields
                idPrefix="create"
                value={createForm}
                onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
                disabled={createSaving}
              />
              {createError && <FormError message={createError} />}
              <div className="flex gap-2 justify-start">
                <Button
                  onClick={() => void runCreate()}
                  disabled={createSaving}
                  className="min-h-11 flex-1 bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
                >
                  {createSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  ذخیرهٔ حرکت
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createSaving}
                  className="min-h-11 bg-white"
                >
                  انصراف
                </Button>
              </div>
            </>
          ) : aiStage === "input" ? (
            <>
              <Field id="ai-name" label="نام حرکت" required>
                <Input
                  id="ai-name"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={aiLoading}
                  maxLength={100}
                  placeholder="مثال: پرس سینه هالتر"
                  className={INPUT_CLASS}
                />
              </Field>
              <p className="text-[11px] leading-relaxed text-slate-500">
                هوش مصنوعی تحقیق می‌کند: مشخصات حرکت، نحوهٔ اجرا، نکات ایمنی و ویدیوی یوتیوبِ مختص همان حرکت
                (با راستی‌آزمایی) را پیدا می‌کند و پیش‌نویس را برای بازبینی شما پر می‌کند. این کار تا حدود
                یک دقیقه طول می‌کشد.
              </p>
              {aiLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50/70 px-3 py-3.5 text-xs font-bold text-orange-700">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  هوش مصنوعی دارد تحقیق می‌کند…
                </div>
              ) : (
                <Button
                  onClick={() => void runAiGenerate()}
                  disabled={aiLoading}
                  className="min-h-11 w-full bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
                >
                  <Sparkles className="w-4 h-4" />
                  تولید با هوش مصنوعی
                </Button>
              )}
              {createError && <FormError message={createError} />}
            </>
          ) : (
            <>
              {/* بج ویدیوی راستی‌آزمایی‌شده + یادداشت تحقیق */}
              {verifiedVideo && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                  <p className="text-[11px] font-bold leading-relaxed text-emerald-700 flex items-start gap-1.5">
                    <BadgeCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      ویدیو تأیید شد
                      {verifiedVideo.title ? `: ${verifiedVideo.title}` : ""}
                      {verifiedVideo.channel ? ` — ${verifiedVideo.channel}` : ""}
                    </span>
                  </p>
                </div>
              )}
              {videoNote && (
                <p className="text-[11px] leading-relaxed text-slate-500">{videoNote}</p>
              )}
              <p className="text-[11px] font-bold text-orange-700">
                پیش‌نویس هوش مصنوعی — همهٔ فیلدها قابل ویرایش‌اند؛ بعد از بازبینی ذخیره کنید.
              </p>
              <ExerciseFormFields
                idPrefix="create"
                value={createForm}
                onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
                disabled={createSaving}
              />
              {createError && <FormError message={createError} />}
              <div className="flex gap-2 justify-start">
                <Button
                  onClick={() => void runCreate()}
                  disabled={createSaving}
                  className="min-h-11 flex-1 bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
                >
                  {createSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  ذخیرهٔ حرکت
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createSaving}
                  className="min-h-11 bg-white"
                >
                  انصراف
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── v135 — دیالوگ ویرایش حرکت ─── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent
          dir="rtl"
          className="max-w-[calc(100%-1rem)] sm:max-w-md max-h-[85dvh] overflow-y-auto custom-scrollbar"
        >
          <DialogHeader>
            <DialogTitle className="text-right">ویرایش حرکت</DialogTitle>
            <DialogDescription className="text-right leading-relaxed">
              متن‌ها و لینک یوتیوب «{editTarget?.name}» را ویرایش کنید؛ تغییرات پس از ذخیره بلافاصله در سایت اعمال می‌شود.
            </DialogDescription>
          </DialogHeader>
          <ExerciseFormFields
            idPrefix="edit"
            value={editForm}
            onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
            disabled={editSaving}
          />
          {editError && <FormError message={editError} />}
          <div className="flex gap-2 justify-start">
            <Button
              onClick={() => void runEditSave()}
              disabled={editSaving}
              className="min-h-11 flex-1 bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
            >
              {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              ذخیرهٔ تغییرات
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={editSaving}
              className="min-h-11 bg-white"
            >
              انصراف
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تأیید جایگزینی */}
      <Dialog open={!!confirmReplace} onOpenChange={(o) => !o && setConfirmReplace(null)}>
        <DialogContent dir="rtl" className="max-w-[calc(100%-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">جایگزینی ویدیوی اختصاصی؟</DialogTitle>
            <DialogDescription className="text-right leading-relaxed">
              ویدیوی فعلی «{confirmReplace?.name}» {confirmReplace ? `(${fmtSize(confirmReplace.videoSizeBytes)})` : ""} حذف
              و با فایل جدید جایگزین می‌شود. پوستر جدید هم به‌طور خودکار ساخته می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-start">
            <Button
              onClick={() => {
                const target = confirmReplace;
                setConfirmReplace(null);
                if (target) openFilePicker(target);
              }}
              className="min-h-11 bg-gradient-to-l from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-0"
            >
              <Upload className="w-4 h-4" />
              انتخاب فایل جدید
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmReplace(null)}
              className="min-h-11 bg-white"
            >
              انصراف
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تأیید حذف */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent dir="rtl" className="max-w-[calc(100%-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">حذف ویدیوی اختصاصی؟</DialogTitle>
            <DialogDescription className="text-right leading-relaxed">
              فایل ویدیو و پوستر «{confirmDelete?.name}» از سرور حذف و فیلدهای حرکت ریست می‌شود. یوتیوب (اگر ثبت
              شده باشد) به‌عنوان فال‌بک نمایش داده می‌شود. این عمل بازگشت‌پذیر نیست.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-start">
            <Button
              variant="destructive"
              onClick={() => void runDelete()}
              disabled={deleting}
              className="min-h-11"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              حذف قطعی
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
              className="min-h-11 bg-white"
            >
              انصراف
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
