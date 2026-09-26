"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Sparkles,
  Dumbbell,
  Salad,
  RotateCcw,
  Bot,
  ImageIcon,
  Video,
  Lock,
  X,
  Loader2,
  Mic,
  Square,
  Plus,
  UtensilsCrossed,
  Check,
  ShieldCheck,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { navigateToExercises, navigateToFoods, navigateToArticles, navigateToTdee } from "@/lib/fitness/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineVideoPreview } from "@/components/fitness/inline-video-preview";
import { UpgradeBanner } from "@/components/fitness/upgrade-banner";
import {
  canAccess,
  toPersianDigits,
  PLAN_LABELS,
  type ChatMessageDto,
  type Plan,
  type WorkoutPlanContent,
  type MealPlanContent,
} from "@/lib/fitness/types";
import { useVoiceRecorder } from "@/lib/fitness/use-voice-recorder";
import {
  ApiError,
  fetchJson,
  fetchJsonOrThrow,
} from "@/lib/fitness/fetch-json";
import { createVideoThumbnail } from "@/lib/fitness/video-thumbnail";
// Task 7-e — تایپوگرافی فارسی در زمان رندر (نسخهٔ امنِ ماسک‌کنندهٔ URL)
import { fixPersianTypographySafe } from "@/lib/fitness/persian-typography";
// v90 — آپلود چانکی (فیکس ریشه‌ای «ویدیوی ۸۶ مگابایتی آپلود نمی‌شود» — گیت‌وی ~۱۲۰s)
import { uploadFileChunked } from "@/lib/fitness/client-chunked-upload";
import { downscaleImage } from "@/lib/fitness/client-image";
import { useMediaSourcePicker } from "@/components/fitness/media-source-picker";
import { useQuotaSummary, type QuotaSummary } from "@/lib/fitness/use-quota-summary";
import { toast } from "sonner";

const QUICK_PROMPTS = [
  { icon: Dumbbell, text: "یکی از حرکات امروز را سخت‌تر کن" },
  { icon: Salad, text: "یک میان‌وعده کم‌کالری پیشنهاد بده" },
  { icon: RotateCcw, text: "جایگزینی برای اسکوات بده" },
];

/**
 * v84 — مسیر آپلود ویدیو یکپارچه شد: «همهٔ» ویدیوها (هر حجمی) با multipart به
 * /api/coach/chat/upload می‌روند (الگوی اثبات‌شدهٔ مودال آنالیز فرم بدن).
 * قبلاً مسیر دولگامه بود (base64 <۱۲MB / multipart >۱۲MB) و خودِ مسیر multipart
 * ۴۰۴ می‌داد چون روت سمت سرور وجود نداشت — منبع اصلی «تلاش ناموفق» ویدیوی ۸۶MB.
 */
/**
 * گارد فنی سمت کلاینت (۲ گیگابایت) — سقف کاربر-پسند حذف شد (دیرکتیو مالک:
 * «کاربر محدودیتی در حجم نداشته باشد؛ خودمان فشرده می‌کنیم»). این گارد فقط
 * جلوی درخواست‌های غیرمعقول را می‌گیرد و با سقف فنی سرور (۲GB) هم‌خوان است.
 * حداکثر حجم قابل قبول — متن کنار دکمهٔ ویدیو هم دقیقاً همین عدد است.
 */
const VIDEO_TECHNICAL_CAP = 2 * 1024 * 1024 * 1024;
/** Task 4-a — فیکس اسکرول: در رندر اول فقط ۳۰ پیام آخر، قدیمی‌ترها با اسکرول به بالا */
const INITIAL_VISIBLE_MESSAGES = 30;
const LOAD_OLDER_STEP = 20;

/** id یکتا برای پیام‌های موقت — پسوند تصادفی برای جلوگیری از تصادم id (FE-L6) */
function tempId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ═══════════════════════════════════════════════════════════════
//  v73.4 — پروتکل APPLY_SWAP (توافق‌شده با همکار — دقیقاً همین):
//  اگر انتهای متن پاسخ AI خط دقیق
//  [APPLY_SWAP type=exercise|food from="..." to="..." day="..."]
//  باشد → خط از حباب حذف و به‌جایش دکمهٔ «اعمال این جایگزینی در برنامهٔ من»
//  نمایش داده می‌شود. پیام‌های قدیمی (تاریخچه) هم همین پارس را می‌گیرند.
// ═══════════════════════════════════════════════════════════════

interface ParsedApplySwap {
  type: "exercise" | "food";
  from: string;
  to: string;
  day?: string;
  /** متن پاسخ بدون خط directive */
  remainder: string;
}

function parseApplySwapDirective(content: string): ParsedApplySwap | null {
  if (!content || content.length > 12000) return null;
  const idx = content.lastIndexOf("[APPLY_SWAP ");
  if (idx < 0) return null;
  const tail = content.slice(idx);
  const m = tail.match(
    /^\[APPLY_SWAP type=(exercise|food) from="([^"]*)" to="([^"]*)"(?: day="([^"]*)")?\][ \t\r\n]*$/
  );
  if (!m) return null;
  const from = (m[2] ?? "").trim();
  const to = (m[3] ?? "").trim();
  if (!from || !to) return null;
  return {
    type: m[1] as "exercise" | "food",
    from,
    to,
    day: (m[4] ?? "").trim() || undefined,
    remainder: content.slice(0, idx).trimEnd(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  v111 — پروتکل PLAN_CHANGE_PROPOSAL (آینهٔ پروتکل APPLY_SWAP — توافق با همکار):
//  اگر انتهای متن پاسخ AI خط دقیق
//  [PLAN_CHANGE_PROPOSAL summary="خلاصهٔ یک‌خطی تغییرات"]
//  باشد → خط از حباب حذف و به‌جایش «کارت تایید بازطراحی برنامه» (دکمهٔ
//  «تایید و ساخت برنامهٔ جدید» / «انصراف») نمایش داده می‌شود. پیام‌های قدیمی
//  (تاریخچه) هم همین پارس را می‌گیرند. تایید → POST /api/coach/plan-change/confirm
//  (همان مسیر تایید متنی + شروع تولید با source=chat_request) و بعد از اتمام
//  تولید، سرور خودش پیام خلاصهٔ برنامهٔ جدید را در همین چت درج می‌کند.
// ═══════════════════════════════════════════════════════════════

interface ParsedPlanChangeProposal {
  /** خلاصهٔ یک‌خطی تغییرات توافق‌شده (از داخل تگ) */
  summary: string;
  /** متن پاسخ بدون خط directive */
  remainder: string;
}

function parsePlanChangeProposalDirective(content: string): ParsedPlanChangeProposal | null {
  if (!content || content.length > 12000) return null;
  const idx = content.lastIndexOf("[PLAN_CHANGE_PROPOSAL ");
  if (idx < 0) return null;
  const tail = content.slice(idx);
  const m = tail.match(/^\[PLAN_CHANGE_PROPOSAL summary="([^"]*)"\][ \t\r\n]*$/);
  if (!m) return null;
  const summary = (m[1] ?? "").trim();
  if (!summary) return null;
  return {
    summary,
    remainder: content.slice(0, idx).trimEnd(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  v85 — المان‌های تعاملی چت (درخواست مالک: «المان‌های جذاب و تعاملی مثل
//  باکس سبز رو در چت با فیتاپ زیادتر کن»):
//  ① لینک درون‌برنامه‌ای [متن](action:مقصد) — کلیک → پرش واقعی به همان بخش
//  ② پاک‌سازی خطوط تزئینی (----------) از پیام‌های قدیمی هم
//  v86 — پروتکل پیشنهادهای کلیک‌خور انتهای پاسخ به‌کلی حذف شد (دیرکتیو مالک:
//  کاربر را به استفادهٔ بیش‌ازحد از چت ترغیب می‌کرد و هزینهٔ AI بالا می‌برد).
// ═══════════════════════════════════════════════════════════════

/** مقصدهای مجاز لینک درون‌برنامه‌ای چت مربی (هم‌خوان با پرامپت v85 در ai.ts) */
const COACH_ACTION_TARGETS = new Set<string>([
  "dashboard",
  "programs",
  "workouts",
  "nutrition",
  "progress",
  "chat",
  "referral",
  "support",
  "plans",
  "tool-tdee",
  "tool-exercises",
  "tool-foods",
  "articles",
]);

/** اجرای پرش درون‌برنامه‌ای از لینک پاسخ مربی */
function navigateCoachAction(action: string): void {
  const st = useAppStore.getState();
  const target = action.trim();
  const TABS = new Set(["dashboard", "programs", "workouts", "nutrition", "progress", "chat", "referral", "support"]);
  if (target === "plans") {
    st.setOverlay("subscription");
    return;
  }
  if (TABS.has(target)) {
    st.setMainTab(target as never);
    return;
  }
  // v119 — مجله و TDEE فقط مسیر واقعی SSR دارند (تک‌نسخه‌سازی)
  if (target === "tool-tdee") {
    navigateToTdee();
    return;
  }
  if (target === "articles") {
    navigateToArticles();
    return;
  }
  // v113/v118 — بانک حرکات و بانک غذاها فقط مسیر واقعی SSR دارند (تک‌نسخه‌سازی؛ بدون اسکرین SPA)
  if (target === "tool-exercises") {
    navigateToExercises();
    return;
  }
  if (target === "tool-foods") {
    navigateToFoods();
    return;
  }
}

/**
 * v85 — حذف خطوط تزئینی (----------) از متن هر پیام مربی — سمت کلاینت هم
 * اعمال می‌شود تا پیام‌های قدیمی تاریخچه هم تمیز رندر شوند (سمت سرور هم از
 * v85 برای پیام‌های جدید پاک‌سازی می‌شود).
 * v86 — پروتکل [SUGGEST] کلاً حذف شد (دیریکتیو مالک: باعث مصرف بیش‌ازحد چت و
 * هزینه می‌شد)؛ خط باقی‌ماندهٔ [SUGGEST] در پیام‌های قدیمی تاریخچه هم اینجا
 * پاک می‌شود تا هرگز به‌صورت متن خام دیده نشود.
 */
function stripDecorativeLines(text: string): string {
  if (!text) return text;
  // v86 — حذف دنبالهٔ [SUGGEST] از پیام‌های قدیمی (قبل از پاک‌سازی خطوط تزئینی)
  let cleaned = text.replace(/\n?\s*\[SUGGEST\][^\n]*/g, "").trimEnd();
  if (!cleaned) return "";
  const lines = cleaned.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*[-–—=_*~•·─━═]{3,}\s*$/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** پارامترهای poll پیام‌های pending (تحلیل مدیا در پس‌زمینه — v73.4) */
const PENDING_POLL_INTERVAL_MS = 4_000;
/** v84 — حداکثر ۱۲ دقیقه (هم‌سقف پول آنالیز ویدیویی بدن) — فشرده‌سازی+تحلیل ویدیوی حجیم چند دقیقه طول می‌کشد */
const PENDING_POLL_MAX_MS = 12 * 60_000;

/**
 * v57 — شناسهٔ حباب «پیشنهاد دستیار تغذیه» — بعد از اولین تحلیل عکس غذا در چت،
 * یک‌بار «همیشه» (نه هر سشن) به‌صورت حباب اختصاصی (با دکمهٔ رفتن به دستیار)
 * نشان داده می‌شود تا کاربر بداند تحلیلِ تاریخچه‌دار از کجا انجام می‌شود
 * (درخواست مالک v85: «بذار بمونه و فقط برای بار اول که کاربر عکس آپلود می‌کنه
 * نشون بده» — فلگ با localStorage ماندگار است، نه sessionStorage).
 * v85 — اعلان توستی «ارجاع به دستیار تغذیه» که با «هر» آپلود عکس بالای صفحه
 * می‌آمد کلاً حذف شد — همین حباب سبز درون‌چت تنها راهنمایی است.
 */
const FOOD_TIP_MESSAGE_ID = "fitup-food-assistant-tip";
const FOOD_TIP_PERSIST_FLAG = "fitup_food_tip_shown_v2";

/**
 * Task 7-e — فلگ ماندگار «راهنمای فیلم‌برداری» — فقط بار اول همیشه (الگوی
 * FOOD_TIP_PERSIST_FLAG): کاربر با اولین لمس گزینهٔ ویدیو، قبل از بازشدن
 * فایل‌پیکر راهنمای کوچک فیلم‌برداری را می‌بیند تا هوش مصنوعی بهترین تحلیل
 * را انجام دهد. فلگ «در لحظهٔ بازشدن مودال» ست می‌شود (نه تایید) تا واقعاً
 * فقط بار اول نمایش داده شود — هر دو مسیر «متوجه شدم» و «بعداً» دفعهٔ بعد
 * مستقیم به فایل‌پیکر می‌روند.
 */
const VIDEO_GUIDE_PERSIST_FLAG = "fitup_video_guide_shown_v1";

/** چک‌لیست راهنمای فیلم‌برداری — متن فارسی کوتاه با ارقام فارسی */
const VIDEO_GUIDE_ITEMS: string[] = [
  "نور کافی و از روبه‌رو — بدن کاملاً پیدا باشد",
  "دوربین ثابت: روی میز/سه‌پایه، یا از کسی بخواه فیلم بگیرد",
  "کل بدن در کادر باشد؛ زاویهٔ پهلو یا ۴۵ درجه بهترین تحلیل را می‌دهد",
  "فقط یک حرکت را فیلم بگیر و ۳ تا ۵ تکرار کامل با فرم درست اجرا کن",
  "طول ویدیو ۱۵ تا ۶۰ ثانیه؛ افقی (لنداسکیپ) بگیر اگر ممکن است",
  "صدا لازم نیست؛ حجم کمتر از ۲ گیگابایت",
];

/**
 * Task 7-e — اعمال امنِ تایپوگرافی فارسی در زمان رندر (رندر-تایم فقط —
 * دادهٔ ذخیره‌شده در store/DB جهش نمی‌خورد). خطای غیرمنتظره → متن خام.
 */
function safeFixFaTypography(text: string): string {
  try {
    return fixPersianTypographySafe(text);
  } catch {
    return text;
  }
}

/** تبدیل File به Data URL برای ارسال به سرور */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** قالب‌بندی زمان پیام به فارسی */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** حجم فایل به‌صورت فارسی و خوانا (برای چیپ پیش‌نمایش ویدیو) */
function formatFileSizeFa(bytes: number): string {
  if (!bytes || bytes <= 0) return "۰";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${toPersianDigits(mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10)} مگابایت`;
  return `${toPersianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

/** آزادسازی امن blob URL — روی مقدار غیر blob بی‌اثر است */
function revokeObjectUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}

export function SmartCoachChatView({ variant = "page" }: { variant?: "page" | "panel" }) {
  const { user, chatMessages, setChatMessages, addChatMessage, setOverlay } =
    useAppStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Task 4-a — سهمیه‌ها (بنر شیشه‌ای بالای پیام‌ها) ───
  const planName = (user?.planName ?? null) as Plan | null;
  const canChat = canAccess(planName, "aiChatQuestions");
  const { summary: quotaSummary, refresh: refreshQuota } = useQuotaSummary(
    !!user && canChat
  );

  // قابلیت صوتی — ضبط ویس و تبدیل به متن (ASR — دست‌نخورده)
  const { isRecording, isProcessing, error: voiceError, startRecording, stopRecording } = useVoiceRecorder((text) => {
    setInput((prev) => (prev ? prev + " " + text : text));
    lastWasVoiceRef.current = true; // علامت‌گذاری: این پیام از ویس بود
    toast.success("پیام صوتی تبدیل به متن شد 🎤 — دکمه ارسال را بزنید");
  });

  // نمایش خطای میکروفون
  useEffect(() => {
    if (voiceError) toast.error(voiceError);
  }, [voiceError]);

  // tracking: آیا آخرین پیام ارسالی از طریق ویس بود؟
  const lastWasVoiceRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // v120 — دیرکتیو مالک (تذکر کافه‌بازار): چت با فیتاپ حالا هم «دوربین» دارد هم
  // «گالری» — هم برای عکس و هم برای ویدیو (قبلاً فقط انتخاب از حافظه بود)
  const chatImagePicker = useMediaSourcePicker({
    kind: "image",
    onFiles: (files) => void handleImageSelect(files[0] ?? null),
  });
  const chatVideoPicker = useMediaSourcePicker({
    kind: "video",
    onFiles: (files) => void handleVideoSelect(files[0] ?? null),
  });

  // پیش‌نمایش مدیای انتخاب‌شده قبل از ارسال
  const [selectedImage, setSelectedImage] = useState<string | null>(null); // data URL
  // ─── Task 4-a: ویدیو با blob URL + File + poster کانواسی ───
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null); // blob URL (پیش‌نمایش فوری)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [selectedVideoPoster, setSelectedVideoPoster] = useState<string | null>(null);
  const selectedVideoUrlRef = useRef<string | null>(null);
  const videoSelectionSeqRef = useRef(0); // نسل انتخاب — جلوگیری از overwrite poster قدیمی
  // درصد پیشرفت آپلود چانکی (null = در حال آپلود نیستیم)
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // v90 — ref لغو آپلود چانکی (AbortController) برای دکمهٔ «لغو آپلود»
  const uploadXhrRef = useRef<AbortController | null>(null);
  // v90 — id پیام موقتی که ویدیوش در حال آپلود است (برای اورلی پیشرفت روی خود حباب)
  const [uploadingTempId, setUploadingTempId] = useState<string | null>(null);

  // ─── v88 — فیکس کیبورد موبایل: هدر و نوار سهمیه هرگز با کیبورد جابه‌جا/نیمه نمی‌شوند ───
  // (گزارش مالک: با باز شدن کیبورد، سربرگ چت بالا می‌پرید و نیمه دیده می‌شد —
  // علت: سند قابل‌اسکرول بود + iOS کیبورد را از layout viewport کم نمی‌کند.)
  useEffect(() => {
    if (variant !== "page") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const TOPBAR_PX = 64; // ارتفاع TopBar پنل — شل چت زیر آن می‌نشیند
    const onVv = () => {
      const keyboardVisible = vv.height < window.innerHeight - 60;
      if (keyboardVisible) {
        document.documentElement.style.setProperty(
          "--chat-shell-h",
          `${Math.max(240, Math.round(vv.height - TOPBAR_PX))}px`
        );
      } else {
        document.documentElement.style.removeProperty("--chat-shell-h");
      }
    };
    onVv();
    vv.addEventListener("resize", onVv);
    vv.addEventListener("scroll", onVv);
    return () => {
      vv.removeEventListener("resize", onVv);
      vv.removeEventListener("scroll", onVv);
      document.documentElement.style.removeProperty("--chat-shell-h");
    };
  }, [variant]);

  // ─── منوی بازشدنی دکمه + (انتخاب عکس/ویدیو) ───
  const [showUploadMenu, setShowUploadMenu] = useState(false);

  // ─── Task 7-e — مودال راهنمای فیلم‌برداری (فقط بار اول همیشه) ───
  // ref هم‌نام با state برای گارد دبل‌تپ هم‌زمان (state در کلوژر ممکن است stale بماند)
  const [showVideoGuide, setShowVideoGuide] = useState(false);
  const videoGuideOpenRef = useRef(false);
  /** قفل کوتاه ضد دبل‌تپ روی «متوجه شدم» — فایل‌پیکر هرگز دوبار پشت‌هم باز نشود */
  const videoPickerLockRef = useRef(0);

  /** بستن راهنما بدون بازکردن فایل‌پیکر (دکمهٔ «بعداً» / کلیک روی بک‌دراپ) */
  function closeVideoGuide() {
    videoGuideOpenRef.current = false;
    setShowVideoGuide(false);
  }

  /** «متوجه شدم — انتخاب ویدیو»: بستن مودال و بازکردن فایل‌پیکر ویدیو */
  function confirmVideoGuide() {
    closeVideoGuide();
    const now = Date.now();
    if (now - videoPickerLockRef.current < 800) return; // دبل‌تپ → پیکرِ دوم باز نمی‌شود
    videoPickerLockRef.current = now;
    chatVideoPicker.openPicker();
  }

  // آزادسازی blob URL هنگام unmount — نشت حافظه نماند
  useEffect(() => {
    return () => {
      revokeObjectUrl(selectedVideoUrlRef.current);
      selectedVideoUrlRef.current = null;
    };
  }, []);

  // ─── Task 4-a — فیکس اسکرول چت ───
  // قبلاً کل تاریخچه رندر می‌شد و بعد smooth-scroll به پایین — کاربر اول
  // پیام‌های قدیمی را می‌دید و صفحه «سریع اسکرول» می‌شد. حالا:
  //   الف) فقط ۳۰ پیام آخر در رندر اول + بارگذاری lazy قدیمی‌ترها (۲۰تایی)
  //   ب) اسکرول اولیه behavior:"auto" در useLayoutEffect — فقط یک‌بار
  //   ج) smooth فقط برای پیام‌های جدید بعد از اسکرول اولیه
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const didInitialScrollRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(
    () => chatMessages.slice(Math.max(0, chatMessages.length - visibleCount)),
    [chatMessages, visibleCount]
  );
  const hasOlder = chatMessages.length > visibleCount;

  const loadOlderMessages = useCallback(() => {
    if (chatMessages.length <= visibleCount) return;
    loadingOlderRef.current = true;
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0;
    setVisibleCount((c) => Math.min(c + LOAD_OLDER_STEP, chatMessages.length));
  }, [chatMessages.length, visibleCount]);

  // حفظ موقعیت اسکرول بعد از prepend پیام‌های قدیمی‌تر (بدون پرش)
  useLayoutEffect(() => {
    if (!loadingOlderRef.current) return;
    loadingOlderRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    if (delta > 0) el.scrollTop += delta;
  }, [visibleCount]);

  // IntersectionObserver بالای لیست — نزدیک شدن به بالا → بارگذاری قدیمی‌ترها
  // v59 — گارد مرورگر: بدون IO، صفحه‌بندی نادیده گرفته می‌شود (کرش مرز خطا نشود)
  useEffect(() => {
    const el = topSentinelRef.current;
    const container = scrollRef.current;
    if (!el || !container || loading || !hasOlder) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadOlderMessages();
        }
      },
      { root: container, rootMargin: "160px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, hasOlder, loadOlderMessages]);

  // بارگذاری تاریخچه چت از سرور — تابع جدا تا دکمه «تلاش مجدد» در بنر خطا
  // هم بتواند همان منطق را اجرا کند (قبلاً فقط داخل useEffect یک‌باره بود)
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      // fetchJson: پاسخ HTML (خطای گیت‌وی/سرور در حال ری‌استارت) → خطای فارسی
      const { res, data } = await fetchJson<{ messages?: ChatMessageDto[] }>(
        "/api/coach/chat",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error();
      setChatMessages(data.messages || []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [setChatMessages]);

  // بارگذاری اولیه تاریخچه چت از سرور (یک‌بار در mount)
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ─── v73.4 — poll پیام‌های pending (دوفازی مدیا: تحلیل پس‌زمینه) ───
  // پاسخ POST برای پیام مدیا‌دار فوری برمی‌گردد (placeholder با content خالی) و
  // تحلیل در پس‌زمینهٔ سرور ادامه دارد. این poll هر ۴ ثانیه messages کامل را
  // می‌گیرد؛ به‌محض آنکه پیام assistant با همان id محتوا گرفت، آن را نمایش
  // می‌دهد و poll را تمام می‌کند (سقف ۵ دقیقه). بعد از رفرش صفحه هم کار می‌کند
  // چون GET خودش placeholderهای pending را برمی‌گرداند.
  const mountedRef = useRef(true);
  const pendingPollsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startPendingPoll = useCallback(
    (messageId: string) => {
      if (!messageId || pendingPollsRef.current.has(messageId)) return;
      pendingPollsRef.current.add(messageId);
      void (async () => {
        const deadline = Date.now() + PENDING_POLL_MAX_MS;
        try {
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, PENDING_POLL_INTERVAL_MS));
            if (!mountedRef.current) return;
            try {
              const { res, data } = await fetchJson<{ messages?: ChatMessageDto[] }>(
                "/api/coach/chat",
                { cache: "no-store" }
              );
              if (!res.ok) continue; // خطای موقت سرور — تا ددلاین ادامه بده
              const target = (data.messages || []).find((m) => m.id === messageId);
              if (!target) return; // پیام از تاریخچه حذف شده — poll بی‌معنی است
              if (target.content && target.content.trim().length > 0) {
                // پاسخ آماده شد → همان حباب placeholder پر می‌شود
                setChatMessages((prev) => {
                  if (prev.some((m) => m.id === messageId)) {
                    return prev.map((m) =>
                      m.id === messageId
                        ? { ...m, content: target.content, createdAt: target.createdAt }
                        : m
                    );
                  }
                  // حباب در لیست محلی نبود (مثلاً بعد از خطای بارگذاری) → اضافه شود
                  return [
                    ...prev,
                    {
                      id: target.id,
                      role: target.role,
                      content: target.content,
                      mediaUrl: target.mediaUrl ?? null,
                      mediaType: target.mediaType ?? null,
                      createdAt: target.createdAt,
                    },
                  ];
                });
                return;
              }
            } catch {
              // خطای شبکه — تا ددلاین ادامه بده
            }
          }
          // تایم‌اوت ۵ دقیقه — کاربر راهنمایی می‌شود؛ بعد از تکمیل سمت سرور،
          // رفرش/بازگشت به صفحه پاسخ کامل را نشان می‌دهد
          if (mountedRef.current) {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === messageId && !m.content
                  ? {
                      ...m,
                      content:
                        "⏳ پاسخ به این پیام بیش از حد انتظار طول کشید. چند لحظه دیگر صفحه را دوباره باز کن یا پیام را دوباره بفرست.",
                    }
                  : m
              )
            );
          }
        } finally {
          pendingPollsRef.current.delete(messageId);
        }
      })();
    },
    [setChatMessages]
  );

  // بعد از رفرش صفحه: placeholderهای pending موجود در تاریخچه دوباره poll می‌شوند
  useEffect(() => {
    if (loading) return;
    for (const m of chatMessages) {
      if (
        m.role === "assistant" &&
        m.content === "" &&
        m.id !== FOOD_TIP_MESSAGE_ID
      ) {
        startPendingPoll(m.id);
      }
    }
  }, [loading, chatMessages, startPendingPoll]);

  // اسکرول اولیه — یک‌بار، بلافاصله بعد از اولین رندر پیام‌ها، بدون انیمیشن (auto)
  useLayoutEffect(() => {
    if (loading || chatMessages.length === 0) return;
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [loading, chatMessages.length]);

  // اسکرول smooth فقط برای پیام‌های جدید بعد از اسکرول اولیه:
  //  • وقتی کاربر خودش ارسال می‌کند (sending=true) همیشه دنبال کن
  //  • وقتی پیام جدید می‌آید، فقط اگر کاربر نزدیک پایین است — مزاحم
  //    خواندن تاریخچهٔ بالا نشو
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (sending || distanceFromBottom < 300) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [chatMessages.length, sending]);

  // Auto-resize textarea تا حداکثر ۱۲۰px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  // v120 — گیرندهٔ نهایی فایل عکس (از دوربین یا گالری — انتخابگر مشترک)
  async function handleImageSelect(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("فقط فایل تصویری مجاز است.");
      return;
    }
    // دیرکتیو مالک: هیچ سقف حجمی کاربر-پسند وجود ندارد — قبل از ارسال، عکس
    // بی‌صدا به حداکثر ۱۶۰۰px کوچک می‌شود (هم‌هدف resize سرور) تا آپلود سریع
    // باشد؛ اگر کوچک‌سازی شکست خورد (فرمت عجیب) فایل اصلی ارسال می‌شود.
    // گارد فنی نهایی (۲۰۰MB base64) سمت سرور است با پیام مهربان.
    try {
      const processed = await downscaleImage(file, 1600, 0.85);
      const dataUrl = await fileToDataUrl(processed);
      setSelectedImage(dataUrl);
      clearVideoDraft(); // فقط یک مدیا همزمان
    } catch {
      toast.error("خطا در پردازش عکس. دوباره تلاش کنید.");
    }
  }

  // v120 — گیرندهٔ نهایی فایل ویدیو (از دوربین یا گالری — انتخابگر مشترک)
  async function handleVideoSelect(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("فقط فایل ویدیویی مجاز است.");
      return;
    }
    // گارد فنی ۲GB — با سقف فنی سرور هم‌خوان؛ پیام مهربان و نادر
    if (file.size > VIDEO_TECHNICAL_CAP) {
      toast.error("فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید.");
      return;
    }
    try {
      // ─── Task 4-a: پیش‌نمایش با blob URL (فوری) + poster کانواسی (تضمینی) ───
      // قبلاً data URL کامل در <video preload="metadata"> تا کلیک فقط سیاه بود.
      const seq = ++videoSelectionSeqRef.current;
      revokeObjectUrl(selectedVideoUrlRef.current);
      const blobUrl = URL.createObjectURL(file);
      selectedVideoUrlRef.current = blobUrl;
      setSelectedVideo(blobUrl);
      setSelectedVideoFile(file);
      setSelectedVideoPoster(null);
      setSelectedImage(null); // فقط یک مدیا همزمان
      const poster = await createVideoThumbnail(blobUrl);
      if (videoSelectionSeqRef.current === seq && poster) {
        setSelectedVideoPoster(poster);
      }
    } catch {
      toast.error("خطا در پردازش ویدیو. دوباره تلاش کنید.");
    }
  }

  /** پاک‌کردن پیش‌نویس ویدیو + آزادسازی blob URL */
  function clearVideoDraft() {
    videoSelectionSeqRef.current += 1;
    revokeObjectUrl(selectedVideoUrlRef.current);
    selectedVideoUrlRef.current = null;
    setSelectedVideoFile(null);
    setSelectedVideoPoster(null);
    setSelectedVideo(null);
  }

  function handleRemoveMedia() {
    setSelectedImage(null);
    clearVideoDraft();
  }

  function handleImageBtn() {
    if (canAccess(planName, "chatImageUpload")) {
      chatImagePicker.openPicker();
    } else {
      toast.info("برای ارسال عکس باید پلن خود را به پیشرفته ارتقا دهید");
      setOverlay("subscription");
    }
  }

  function handleVideoBtn() {
    if (canAccess(planName, "chatVideoUpload")) {
      // ─── Task 7-e — راهنمای اولین فیلم‌برداری (فقط بار اول همیشه) ───
      // گارد دبل‌تپ: اگر مودال راهنما همین حالا باز است، هرگز فایل‌پیکر را
      // مستقیم باز نکن (لمس دوم روی گزینهٔ ویدیو نباید پیکرِ دومی بسازد).
      if (videoGuideOpenRef.current) return;
      // فلگ در localStorage — اگر storage در دسترس نبود، «نشان‌داده‌شده» فرض
      // می‌شود (هرگز UX بلاک نشود) و مستقیم فایل‌پیکر باز می‌شود.
      let videoGuideShown = true;
      try {
        videoGuideShown = !!window.localStorage.getItem(VIDEO_GUIDE_PERSIST_FLAG);
      } catch {}
      if (!videoGuideShown) {
        // فلگ همین لحظه ست می‌شود تا واقعاً فقط بار اول نمایش داده شود
        // (هم مسیر «متوجه شدم» و هم «بعداً» دفعهٔ بعد راهنما را نشان نمی‌دهند)
        try {
          window.localStorage.setItem(VIDEO_GUIDE_PERSIST_FLAG, "1");
        } catch {}
        videoGuideOpenRef.current = true;
        setShowVideoGuide(true);
        return; // فایل‌پیکر بعد از بسته‌شدن مودال باز می‌شود
      }
      chatVideoPicker.openPicker();
    } else {
      // v60 — «آنالیز فرم حرکات» همین‌جاست: کاربر با ارسال ویدیوی اجرای حرکت،
      // فرم حرکاتش را بررسی و اصلاح می‌کند (پلن حرفه‌ای).
      toast.info("آنالیز فرم حرکات اینجاست — ویدیوی اجرای حرکتت رو بفرست تا فرمت رو اصلاح کنیم (نیازمند پلن حرفه‌ای)");
      setOverlay("subscription");
    }
  }

  const canSendImage = canAccess(planName, "chatImageUpload");
  const canSendVideo = canAccess(planName, "chatVideoUpload");

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if ((!message && !selectedImage && !selectedVideoFile) || sending) return;
    if (!canChat) {
      toast.info("برای چت با فیتاپ باید پلن خود را ارتقا دهید");
      setOverlay("subscription");
      return;
    }
    setInput("");
    setSending(true);

    // ─── مقادیر مدیا قبل از ارسال — برای بازگرداندن در خطا ───
    const imageData = selectedImage;
    const videoFile = selectedVideoFile;
    const videoPreviewUrl = selectedVideo; // blob URL برای پیش‌نمایش پیام موقت
    const videoPoster = selectedVideoPoster;

    // ساخت پیام موقت با مدیا برای نمایش فوری
    // (v90 — poster کانواسی که در لحظهٔ انتخاب ساخته شده همراه پیام می‌رود تا
    // فریم اول ویدیو «همین حالا» در حباب دیده شود — نه جعبهٔ سیاه حین آپلود)
    const tempUserMsg: ChatMessageDto = {
      id: tempId("temp"),
      role: "user",
      content:
        message ||
        (selectedImage ? "📷 عکس" : videoFile ? "🎬 ویدیو" : ""),
      mediaUrl: selectedImage ?? videoPreviewUrl,
      mediaType: selectedImage ? "image" : videoFile ? "video" : null,
      createdAt: new Date().toISOString(),
      poster: videoFile ? videoPoster : null,
    };
    addChatMessage(tempUserMsg);

    setSelectedImage(null);
    clearVideoDraft();

    try {
      let uploadedVideoUrl: string | undefined;

      if (videoFile) {
        // ─── v90 — آپلود چانکی (همهٔ حجم‌ها) — فیکس ریشه‌ای ۸۶MB ───
        // فایل به چانک‌های ۴ مگابایتی تقسیم می‌شود؛ هر چانک درخواستی چندثانیه‌ای
        // است و هرگز به تایم‌اوت/سقف گیت‌وی نمی‌خورد (مسیر تک‌درخواستی multipart
        // برای اتصال موبایل روی فایل بزرگ قابل‌اعتماد نبود).
        setUploadingTempId(tempUserMsg.id);
        setUploadPct(0);
        try {
          const up = await uploadFileChunked(videoFile, "chat", {
            onProgress: (p) => setUploadPct(p),
            abortRef: uploadXhrRef,
          });
          uploadedVideoUrl = up.mediaUrl;
        } finally {
          setUploadPct(null);
          setUploadingTempId(null);
        }
      }

      // fetchJsonOrThrow: پاسخ HTML (۵۰۲ گیت‌وی / تایم‌اوت درخواست‌های بلند ویدیو)
      // → پیام فارسی «ارتباط با سرور برقرار نشد...» به‌جای «Unexpected token '<'»
      // v73.4 — clientId: همان tempId پیام موقت → idempotency سمت سرور (فیکس دبل‌سند)
      const data = await fetchJsonOrThrow<any>(
        "/api/coach/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            clientId: tempUserMsg.id,
            imageBase64: imageData || undefined,
            videoUrl: uploadedVideoUrl,
            isVoice: lastWasVoiceRef.current, // آیا پیام از طریق ویس بود؟
          }),
        },
        "خطا در ارتباط با سرور"
      );

      // ─── v57/v85: حباب پیشنهاد «دستیار تغذیه» — فقط «بار اول همیشه» ───
      // (گزارش مالک: این باکس سبز زیباست و باید بماند؛ فقط بار اول نشان داده شود
      // و اعلان توستی بالای صفحه که با هر آپلود می‌آمد کلاً حذف شده است.)
      // v59 — گارد storage: getItem در حالت خصوصی می‌تواند throw کند
      let foodTipShown = false;
      try {
        foodTipShown = !!window.localStorage.getItem(FOOD_TIP_PERSIST_FLAG);
      } catch {}
      const shouldPushFoodTip =
        !!imageData && !videoFile && typeof window !== "undefined" && !foodTipShown;
      if (shouldPushFoodTip) {
        try {
          window.localStorage.setItem(FOOD_TIP_PERSIST_FLAG, "1");
        } catch {}
      }

      // ─── v73.4 — فیکس باگ کلوژر: به‌جای ساخت آرایه از chatMessages زمان render
      // (که stale می‌ماند و پیام را دوبار نمایش می‌داد)، آپدیت functional روی
      // آخرین state انجام می‌شود + حذف هر ردیف تکراری سروری (idempotent replay).
      setChatMessages((prev) => {
        const next: ChatMessageDto[] = [];
        for (const m of prev) {
          if (m.id === tempUserMsg.id) continue; // پیام موقت → نسخهٔ سروری می‌آید
          if (data.userMessage && m.id === data.userMessage.id) continue;
          if (data.aiMessage && m.id === data.aiMessage.id) continue;
          next.push(m);
        }
        if (data.userMessage)
          next.push({
            ...(data.userMessage as ChatMessageDto),
            // ─── v95 — فیکس «رندر ویدیو بعد از آپلود طول می‌کشد» ───
            // پیام سروری هنوز فریم استخراج‌شده ندارد؛ poster کانواسیِ لحظهٔ انتخاب
            // حفظ می‌شود تا حباب ویدیو تا رسیدن فریم سرور (mediaFrames[0]) سیاه نماند.
            poster: videoPoster ?? (data.userMessage as ChatMessageDto).poster ?? null,
          });
        if (data.aiMessage) next.push(data.aiMessage as ChatMessageDto);
        if (shouldPushFoodTip) {
          next.push({
            id: FOOD_TIP_MESSAGE_ID,
            role: "assistant",
            content: "", // محتوا در FoodAssistantTipBubble رندر می‌شود
            createdAt: new Date().toISOString(),
          });
        }
        return next;
      });

      // blob پیش‌نمایش دیگر لازم نیست (پیام نهایی URL سروری دارد)
      if (videoPreviewUrl !== selectedVideoUrlRef.current) {
        revokeObjectUrl(videoPreviewUrl);
      }

      // به‌روزرسانی سهمیه‌ها بعد از ارسال موفق عکس/ویدیو (Task 4-a)
      if (imageData || videoFile) refreshQuota();

      // ─── v85 — اعلان توستی «ارجاع به دستیار تغذیه» کلاً حذف شد ───
      // (دیریکتیو مالک: «اون اعلان با هر آپلود عکس در بالای صفحه میاد که این کلاً
      // باید پاک بشه و هیچ وقت نباید بیاد» — راهنمایی فقط با حباب سبز درون‌چت
      // است که خودش فقط بار اول نشان داده می‌شود.)

      // ─── v73.4 — دوفازی مدیا: پاسخ فوری با pending=true → poll تا تکمیل تحلیل ───
      if (data.pending && data.aiMessage?.id) {
        startPendingPoll(data.aiMessage.id);
      }
    } catch (e) {
      // v73.4 — functional update (فیکس باگ کلوژر)
      setChatMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      // ─── بازیابی متن تایپ‌شده و پیوست‌ها ───
      // قبلاً پیام کاربر (متن + عکس/ویدیو) با خطای شبکه «برای همیشه» از دست
      // می‌رفت و کاربر مجبور بود از اول تایپ/انتخاب کند — حالا مقادیر pre-send
      // به input و پیش‌نمایش مدیا برمی‌گردند (فقط اگر کاربر در این بین چیزی
      // جدید تایپ/انتخاب نکرده باشد تا کار تازه‌اش دوباره‌کاری نشود).
      if (message) setInput((prev) => prev || message);
      if (imageData) setSelectedImage((prev) => prev ?? imageData);
      if (videoFile) {
        videoSelectionSeqRef.current += 1;
        selectedVideoUrlRef.current = videoPreviewUrl; // blob هنوز زنده است — revoke نشده
        setSelectedVideoFile(videoFile);
        setSelectedVideo(videoPreviewUrl);
        setSelectedVideoPoster(videoPoster);
      }
      const errMsg =
        e instanceof Error ? e.message : "خطا در ارتباط با سرور";
      // پیام سهمیه/حجم (۴۲۹/۴۱۳) در toast هم نمایش داده می‌شود تا فوری دیده شود
      // (هم خطای ApiError چت و هم خطای آپلود multipart با status ضمیمه)
      const errStatus =
        (e instanceof ApiError && e.status) ||
        ((e as Error & { status?: number }).status ?? 0);
      if (errStatus === 429 || errStatus === 413) {
        toast.error(errMsg);
      }
      addChatMessage({
        id: tempId("err"),
        role: "assistant",
        content: `⚠️ ${errMsg}`,
        createdAt: new Date().toISOString(),
      });
      // همگام‌سازی سهمیه بعد از خطا (مثلاً ۴۲۹ — شمارنده سرور ممکن است تغییر کرده باشد)
      refreshQuota();
    } finally {
      setSending(false);
      lastWasVoiceRef.current = false; // reset برای پیام بعدی
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // اگر کاربر به چت دسترسی ندارد (Basic/Standard) → بنر ارتقا
  // 🩹 v48 (باگ بحرانی مالک): اگر user هنوز null است (لحظهٔ لود/refresh داده)،
  // هرگز بنر «قفل است» نشان نده — همان UI عادی چت می‌ماند و refreshUserIfNeeded
  // (main-app — mount/foreground) ظرف کمتر از یک ثانیه دسترسی واقعی را برمی‌گرداند.
  // قبلاً بنر قفل لحظه‌ای/مsometimes پایدار برای دارندگان پلن حرفه‌ای می‌آمد.
  if (!loading && user && !canChat) {
    return (
      <div className={variant === "panel" ? "px-4 py-4 h-full overflow-y-auto custom-scrollbar" : "px-4 py-4 max-w-md mx-auto"}>
        <UpgradeBanner
          featureLabel="فیتاپ"
          requiredPlan="advanced"
          description="با ارتقا به پلن پیشرفته، به فیتاپ با دسترسی کامل به داده‌های آنبوردینگ، آزمایش خون و اهداف شما دسترسی پیدا کن. برنامه تمرینی هفتگی، کالری دقیق، مکمل‌ها و پاسخ فنی — همه در ۲۴ ساعت شبانه‌روز."
          icon={<img src="/fitup-logo.png" alt="فیتاپ" className="w-8 h-8 rounded-lg object-cover" />}
        />
        <div className="mt-4 p-3 rounded-2xl bg-orange-50 border border-orange-100 text-center">
          <p className="text-xs text-slate-600 mb-2">
            💡 در عوض می‌تونی با «نیکا» چت کنی — راهنمای فروش و پشتیبانی
          </p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => useAppStore.getState().setChatMode("nika")}
          >
            <Bot className="w-4 h-4 text-orange-500" /> رفتن به چت نیکا
          </Button>
        </div>
      </div>
    );
  }

  const containerClass =
    variant === "panel"
      ? "flex flex-col h-full w-full bg-white"
      : "flex flex-col h-[var(--chat-shell-h,calc(100dvh-4rem))] max-w-2xl lg:max-w-4xl mx-auto bg-white overflow-hidden";

  return (
    <div
      className={containerClass}
      dir="rtl"
    >
      {/* v120 — انتخابگرهای دوربین/گالری عکس و ویدیو (inputهای مخفی + شیت) */}
      {chatImagePicker.machinery}
      {chatVideoPicker.machinery}

      {/* هدر فیتاپ — تم سفید حرفه‌ای */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-orange-100 bg-white/95 backdrop-blur-md shrink-0 relative z-10">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-md bg-gradient-to-br from-amber-500 to-orange-600 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="absolute bottom-0 left-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm text-slate-900 truncate">
            فیتاپ
          </h3>
          {/* v92 — دیرکتیو مالک: در سربرگ فقط «آنلاین» بماند؛ متن راهنمای سهمیه‌ها
              کلاً به دکمهٔ راهنمای همین صفحه (مرکز راهنمای پنل — تب چت) منتقل شد */}
          <p className="text-[11px] text-emerald-600 flex items-center gap-1 leading-snug">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span>آنلاین</span>
          </p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-orange-500" />
        </div>
      </header>

      {/* ─── Task 4-a — بنر سهمیه (زیر هدر، بالای پیام‌ها) ─── */}
      {quotaSummary && (
        <CoachQuotaBanner
          summary={quotaSummary}
          planName={planName}
          onUpgrade={() => setOverlay("subscription")}
        />
      )}

      {/* پیام‌ها */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-4 py-4 space-y-3 bg-orange-50/40"
      >
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-3/4 rounded-2xl" />
            <Skeleton className="h-20 w-3/4 rounded-2xl mr-auto" />
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring" }}
              className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg mb-4 bg-gradient-to-br from-amber-500 to-orange-600 overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </motion.div>
            <h3 className="font-bold text-lg text-slate-900 mb-1">
              فیتاپ آماده‌ست 💪
            </h3>
            <p className="text-sm text-slate-500 mb-6 max-w-xs leading-relaxed">
              من به تمام اطلاعات آنبوردینگ، آزمایش خون و اهداف تو دسترسی دارم.
              هر سوال فنی ورزشی یا تغذیه‌ای بپرس، برنامه تمرینی، مکمل یا کالری
              دقیق بخواه.
            </p>
            <div className="w-full max-w-sm space-y-2">
              {QUICK_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => send(p.text)}
                  className="w-full bg-white border border-orange-100 rounded-2xl p-3 hover:border-orange-300 transition text-right text-sm flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-orange-50">
                    <p.icon className="w-4 h-4 text-orange-500" />
                  </div>
                  <span className="text-slate-700 flex-1">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* ─── Task 4-a — بارگذاری lazy پیام‌های قدیمی‌تر ─── */}
            {hasOlder && (
              <div ref={topSentinelRef} className="flex justify-center pb-1">
                <button
                  onClick={loadOlderMessages}
                  className="px-3 py-1.5 rounded-full bg-white/85 border border-orange-100 text-[10px] font-bold text-orange-500 hover:bg-orange-50 transition shadow-sm"
                >
                  پیام‌های قدیمی‌تر
                </button>
              </div>
            )}
            {visibleMessages.map((msg) =>
              msg.id === FOOD_TIP_MESSAGE_ID ? (
                <FoodAssistantTipBubble key={msg.id} />
              ) : (
                <CoachBubble
                  key={msg.id}
                  message={msg}
                  // v90 — اورلی پیشرفت آپلود فقط روی خود حبابِ در-حال-آپلود
                  uploadProgress={msg.id === uploadingTempId ? uploadPct : null}
                />
              )
            )}
            {sending && <CoachTyping />}
          </>
        )}
      </div>

      {/* ورودی */}
      <div className="border-t border-orange-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2 text-center border border-red-200 flex items-center justify-between gap-2">
            <span className="flex-1">خطا در بارگذاری تاریخچه چت</span>
            {/* تلاش مجدد — همان منطق بارگذاری اولیه تاریخچه را اجرا می‌کند */}
            <button
              onClick={loadHistory}
              disabled={loading}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-red-200 text-red-600 font-bold hover:bg-red-50 transition disabled:opacity-50"
              aria-label="تلاش مجدد"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              تلاش مجدد
            </button>
          </div>
        )}

        {/* پیش‌نمایش مدیای انتخاب‌شده */}
        {(selectedImage || selectedVideoFile) && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative inline-block">
              {selectedImage ? (
                <img
                  src={selectedImage}
                  alt="پیش‌نمایش عکس"
                  className="w-16 h-16 object-cover rounded-xl border border-orange-200"
                />
              ) : (
                /* ─── Task 4-a: پیش‌نمایش ویدیو با blob URL + poster کانواسی —
                   فریم اول بلافاصله بعد از انتخاب دیده می‌شود، بدون پلی ─── */
                <video
                  src={selectedVideo ? `${selectedVideo}#t=0.1` : undefined}
                  poster={selectedVideoPoster ?? undefined}
                  className="w-16 h-16 object-cover rounded-xl border border-orange-200 bg-slate-900"
                  muted
                  preload="metadata"
                  playsInline
                />
              )}
              {selectedVideoFile && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-slate-900/85 text-white text-[8px] font-bold whitespace-nowrap" dir="rtl">
                  {formatFileSizeFa(selectedVideoFile.size)}
                </span>
              )}
              <button
                onClick={handleRemoveMedia}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
                aria-label="حذف مدیا"
                title="حذف"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs text-slate-500">آماده ارسال</span>
              {/* v84 — راهنمای حجم ویدیو کنار پیش‌نمایش (دیرکتیو مالک: حداکثر حجم قابل قبول صریح باشد) */}
              {selectedVideoFile && (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-4">
                  حداکثر ۲ گیگابایت — بعد از ارسال خودکار فشرده می‌شود و نسخهٔ فشرده تحلیل و نگهداری می‌شود
                </p>
              )}
            </div>
          </div>
        )}

        {/* ─── v88 — کارت پیشرفت آپلود ویدیو: درصد واقعی + حجم + لغو ─── */}
        {uploadPct !== null && selectedVideoFile && (
          <div
            className="mb-2 rounded-2xl border-2 border-orange-200 bg-gradient-to-l from-orange-50 to-amber-50 p-3 space-y-2"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-orange-700 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                در حال آپلود ویدیو…
              </span>
              <span className="text-sm font-black text-orange-600">
                {toPersianDigits(uploadPct)}٪
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-white/80 overflow-hidden shadow-inner">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, uploadPct)}%` }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-orange-600/80 leading-4">
                {selectedVideoFile.name}
                {" — "}
                {(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} مگابایت — تب را نبند؛ تا ۲ گیگابایت پشتیبانی می‌شود
              </p>
              <button
                onClick={() => uploadXhrRef.current?.abort()}
                className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition shrink-0"
              >
                لغو آپلود
              </button>
            </div>
          </div>
        )}

        {/* ─── ردیف ورودی چت — همه در یک ردیف و هم‌تراز (فیکس مالک: قبلاً items-end باعث می‌شد + و میکروفون و textarea و ارسال هم‌ردیف نباشند) ─── */}
        <div className="flex items-center gap-2 relative">
          {/* دکمه + (باز کردن منوی آپلود) */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowUploadMenu(!showUploadMenu)}
              disabled={sending}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition shrink-0 ${
                showUploadMenu
                  ? "bg-orange-500 text-white"
                  : "bg-orange-50 hover:bg-orange-100 text-orange-500"
              }`}
              title="آپلود فایل"
              aria-label="آپلود فایل"
              aria-expanded={showUploadMenu}
            >
              <Plus className={`w-5 h-5 transition-transform ${showUploadMenu ? "rotate-45" : ""}`} />
            </button>

            {/* منوی بازشدنی — انتخاب عکس/ویدیو */}
            {showUploadMenu && (
              <>
                {/* بستن منو با کلیک خارج */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowUploadMenu(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="absolute bottom-14 right-0 z-50 bg-white rounded-2xl shadow-2xl border border-orange-100 p-1.5 min-w-[160px]"
                >
                  {/* گزینه عکس */}
                  <button
                    onClick={() => {
                      setShowUploadMenu(false);
                      handleImageBtn();
                    }}
                    disabled={!canSendImage || sending}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition text-sm ${
                      canSendImage
                        ? "hover:bg-orange-50 text-slate-700"
                        : "text-slate-300 cursor-not-allowed"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${canSendImage ? "bg-orange-100 text-orange-500" : "bg-slate-100 text-slate-300"}`}>
                      {canSendImage ? <ImageIcon className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xs">عکس</p>
                      {!canSendImage && <p className="text-[9px] text-slate-400">نیازمند پلن پیشرفته</p>}
                    </div>
                  </button>
                  {/* گزینه ویدیو */}
                  <button
                    onClick={() => {
                      setShowUploadMenu(false);
                      handleVideoBtn();
                    }}
                    disabled={!canSendVideo || sending}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition text-sm ${
                      canSendVideo
                        ? "hover:bg-orange-50 text-slate-700"
                        : "text-slate-300 cursor-not-allowed"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${canSendVideo ? "bg-orange-100 text-orange-500" : "bg-slate-100 text-slate-300"}`}>
                      {canSendVideo ? <Video className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xs">ویدیو</p>
                      {canSendVideo ? (
                        // v84 — دیرکتیو مالک: حداکثر حجم قابل قبول باید صریح نوشته شود
                        <p className="text-[9px] text-slate-400">تا ۲ گیگابایت — بعد از ارسال خودکار فشرده و تحلیل می‌شود</p>
                      ) : (
                        // v60 — دیریکتیو مالک: وقتی قفل است، کاربر باید بفهمد
                        // «آنالیز فرم حرکات» همین‌جاست (ارسال ویدیوی اجرای حرکت)
                        <p className="text-[9px] text-amber-500 font-medium">آنالیز فرم حرکات اینجاست — نیازمند پلن حرفه‌ای</p>
                      )}
                    </div>
                  </button>
                </motion.div>
              </>
            )}
          </div>

          {/* دکمه میکروفون — ضبط ویس */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={sending || isProcessing}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition shrink-0 ${
              isRecording
                ? "bg-red-500 text-white animate-pulse"
                : isProcessing
                ? "bg-orange-100 text-orange-500"
                : "bg-orange-50 hover:bg-orange-100 text-orange-500"
            }`}
            title={isRecording ? "توقف ضبط" : "ارسال پیام صوتی"}
            aria-label={isRecording ? "توقف ضبط" : "ارسال پیام صوتی"}
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isRecording ? (
              <Square className="w-5 h-5 fill-white" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* textarea auto-resize */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="سوال تخصصی از فیتاپ..."
              rows={1}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 max-h-[120px] transition"
              disabled={sending || loading}
            />
          </div>

          {/* دکمه ارسال — هنگام آپلود multipart درصد پیشرفت نشان می‌دهد (Task 4-a) */}
          <button
            onClick={() => send()}
            disabled={
              (!input.trim() && !selectedImage && !selectedVideoFile) || sending
            }
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 bg-gradient-to-br from-amber-500 to-orange-600"
            aria-label="ارسال پیام"
          >
            {uploadPct !== null ? (
              <span className="text-[10px] font-bold leading-none" dir="rtl">
                {toPersianDigits(uploadPct)}٪
              </span>
            ) : sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5 -rotate-180" />
            )}
          </button>
        </div>
      </div>

      {/* ─── Task 7-e — مودال راهنمای فیلم‌برداری (فقط بار اول همیشه) ─── */}
      {showVideoGuide && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-guide-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={closeVideoGuide}
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border-2 bg-white"
            style={{ borderColor: "#fdba74" }}
          >
            {/* هدر — هم‌خانوادهٔ حباب سبز دستیار تغذیه، با تم برند (کهربایی/نارنجی) */}
            <div
              className="px-4 py-3 text-white flex items-center gap-2"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Video className="w-4 h-4 shrink-0" aria-hidden="true" />
              <p id="video-guide-title" className="text-xs font-black leading-5">
                🎬 راهنمای فیلم‌برداری برای بهترین تحلیل هوش مصنوعی
              </p>
            </div>
            <div className="px-4 py-3.5">
              <ul className="space-y-2">
                {VIDEO_GUIDE_ITEMS.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 mt-0.5"
                      aria-hidden="true"
                    >
                      <Check className="w-3 h-3" />
                    </span>
                    <span className="text-[11px] leading-relaxed text-slate-600">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={confirmVideoGuide}
                  className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-95 bg-gradient-to-br from-amber-500 to-orange-600"
                  aria-label="متوجه شدم — انتخاب ویدیو"
                >
                  <Video className="w-3.5 h-3.5" aria-hidden="true" />
                  متوجه شدم — انتخاب ویدیو
                </button>
                <button
                  onClick={closeVideoGuide}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-600 text-xs font-bold transition hover:bg-slate-100 active:scale-95"
                  aria-label="بعداً"
                >
                  بعداً
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Task 4-a — بنر سهمیه‌ها (شیشه‌ای، بالای پیام‌ها)
// ═══════════════════════════════════════════════════════════════

function QuotaMiniBar({ pct, tone }: { pct: number; tone: "orange" | "emerald" | "amber" }) {
  const gradients: Record<typeof tone, string> = {
    orange: "from-amber-500 to-orange-600",
    emerald: "from-emerald-500 to-emerald-600",
    amber: "from-amber-400 to-amber-600",
  };
  return (
    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${gradients[tone]}`}
        style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function QuotaChip({
  icon,
  label,
  value,
  pct,
  tone,
  /** v91 — اختیاری؛ اگر ندهی کلیک روی چیپ هیچ پاپ‌آپی باز نمی‌کند
   *  (دیرکتیو مالک: متن «تا ۳۵ ویدیو در این دوره…» حذف شد) */
  tip,
  open,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  /** مقدار سهمیه با ارقام فارسی */
  value: string;
  pct: number;
  tone: "orange" | "emerald" | "amber";
  tip?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-orange-100 bg-white/80 px-2 py-1.5 text-right transition hover:border-orange-300 hover:bg-orange-50/70"
      >
        <span className="w-6 h-6 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="flex flex-col gap-[3px] min-w-[68px]">
          <span className="flex items-center gap-1 leading-none">
            <span className="text-[10px] font-bold text-slate-700">{label}</span>
            {/* v88 — بدون dir="ltr"! مقدار فارسی است (۸۵ از ۹۰)؛ ltr جملهٔ فارسی را
            بریده/واژگون نشان می‌داد (گزارش مالک: «عکس باقیمانده از ۹۰ ۸۵») */}
            <span className="text-[10px] font-medium text-slate-400">{value}</span>
          </span>
          <QuotaMiniBar pct={pct} tone={tone} />
        </span>
      </button>
      {open && tip && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-full mt-1.5 right-0 z-50 w-60 rounded-xl border border-orange-100 bg-white p-2.5 shadow-xl"
          >
            <p className="text-[10px] leading-relaxed text-slate-600">{tip}</p>
          </motion.div>
        </>
      )}
    </div>
  );
}

function CoachQuotaBanner({
  summary,
  planName,
  onUpgrade,
}: {
  summary: QuotaSummary;
  planName: Plan | null;
  onUpgrade: () => void;
}) {
  const [openTip, setOpenTip] = useState<string | null>(null);
  const canSendImage = canAccess(planName, "chatImageUpload");
  const canSendVideo = canAccess(planName, "chatVideoUpload");

  const toggle = (key: string) => setOpenTip((prev) => (prev === key ? null : key));

  const chips: ReactNode[] = [];

  // ─── چیپ عکس چت ───
  // v85 — دیریکتیو مالک: کاربر کلاً ۹۰ عکس در دوره دارد (پیشرفته به بالا)، بدون
  // هیچ سقف روزانه — حتی می‌تواند همه را در یک روز مصرف کند. «تحلیل غذا» سهمیهٔ
  // جدا ندارد و از همین استخر مصرف می‌کند (با دستیار تغذیه سینک است).
  if (canSendImage && summary.chatPhoto.total > 0) {
    const c = summary.chatPhoto;
    chips.push(
      <QuotaChip
        key="chat_photo"
        icon={<ImageIcon className="w-3.5 h-3.5 text-orange-500" />}
        label="عکس"
        // v88 — فرمت خوانا به خواست مالک: «عکس ۸۵ از ۹۰ تا»
        value={`${toPersianDigits(c.remaining)} از ${toPersianDigits(c.total)} تا`}
        pct={c.total > 0 ? (c.used / c.total) * 100 : 0}
        tone="orange"
        tip={`${toPersianDigits(c.total)} عکس در کل دورهٔ پلن — بدون محدودیت روزانه، هر وقت بخواهی مصرف کن${
          c.bonus > 0 ? ` (+${toPersianDigits(c.bonus)} سهمیهٔ هدیه از مدیر)` : ""
        }. تحلیل عکس غذا (در چت و دستیار تغذیه) هم از همین سهمیه مصرف می‌شود. سهمیه فقط بعد از تحلیل موفق کم می‌شود.`}
        open={openTip === "chat_photo"}
        onToggle={() => toggle("chat_photo")}
      />
    );
  }

  // ─── چیپ ویدیو حرکات ───
  // v91 — دیرکتیو مالک: سقف ویدیو = «تعداد حرکات برنامهٔ تمرینی فعال کاربر»
  // (سقف ثابت ۳۵ِ v90 لغو شد). متن راهنمای «تا ۳۵ ویدیو در این دوره…» هم کلاً
  // حذف شد — چیپ بدون تولتیپ است (موجب اسکرول عمودی/افقی بنر سهمیه‌ها بود).
  if (canSendVideo && summary.movementVideo.total > 0) {
    const v = summary.movementVideo;
    chips.push(
      <QuotaChip
        key="movement_video"
        icon={<Video className="w-3.5 h-3.5 text-emerald-600" />}
        label="ویدیو"
        value={`${toPersianDigits(Math.max(0, v.total - v.used))} از ${toPersianDigits(v.total)} تا`}
        pct={v.total > 0 ? (v.used / v.total) * 100 : 0}
        tone="emerald"
        open={openTip === "movement_video"}
        onToggle={() => toggle("movement_video")}
      />
    );
  }

  // ─── v85 — چیپ «تحلیل غذا» حذف شد ───
  // (دیریکتیو مالک: «تحلیل غذا ۴۵ باید برداشته بشه» — سهمیهٔ عکس یک استخر مشترک
  // ۹۰تایی است و چیپ عکس بالا آن را نشان می‌دهد.)

  const hasLockedFeature = !canSendImage || !canSendVideo;
  const lockedChip = (
    <button
      onClick={onUpgrade}
      className="flex items-center gap-1.5 rounded-xl border border-dashed border-orange-200 bg-white/60 px-2.5 py-2 text-[10px] font-bold text-slate-400 hover:bg-orange-50 hover:text-orange-500 transition shrink-0"
      title="ارتقای پلن"
    >
      <Lock className="w-3 h-3" />
      با ارتقای پلن فعال می‌شود
    </button>
  );

  if (chips.length === 0) {
    // هیچ قابلیتی برای پلن فعلی باز نیست — فقط چیپ قفل
    return (
      <div className="shrink-0 px-3 pt-2">
        <div className="flex justify-center rounded-2xl border border-orange-100/70 bg-white/60 backdrop-blur-md px-2 py-1.5">
          {lockedChip}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pt-2">
      {/* v91 — دیرکتیو مالک: نه اسکرول افقی (overflow-x-auto قدیمی حذف شد) نه عمودی —
          چیپ‌ها در فضای کم می‌شکنند و تولتیپ عکس با overflow نمایان بیرون بنر می‌ماند */}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-orange-100/80 bg-white/70 backdrop-blur-md px-2 py-1.5">
        {chips}
        {hasLockedFeature && lockedChip}
      </div>
    </div>
  );
}

/**
 * v57 — حباب اختصاصی «پیشنهاد دستیار تغذیه» — بعد از اولین تحلیل عکس غذا در
 * چت یک‌بار نمایش داده می‌شود. درخواست مالک: «درسته براش تحلیل بکن ولی بهش
 * پیشنهاد بده که از این به بعد از صفحهٔ دستیار تغذیه تحلیل عکس غذا استفاده
 * کنه که در تاریخچهٔ غذایی که خورده ثبت بشه.»
 * استایل هم‌خانوادهٔMealPlanView (سبز زمردی) تا با برند تغذیه یکدست باشد.
 */
function FoodAssistantTipBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-end"
    >
      <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-6 h-6 rounded-full flex items-center justify-center shadow-sm bg-gradient-to-br from-amber-500 to-orange-600 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="text-[10px] text-orange-600 font-medium">فیتاپ</span>
        </div>

        <div
          className="rounded-2xl rounded-br-md overflow-hidden shadow-sm border-2"
          style={{ borderColor: "#a7f3d0", background: "#fff" }}
        >
          <div
            className="px-4 py-3 text-white flex items-center gap-2"
            style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
          >
            <UtensilsCrossed className="w-4 h-4 shrink-0" aria-hidden="true" />
            <p className="text-xs font-black">نکتهٔ تحلیل غذا 🍽</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs leading-6 text-slate-600">
              تحلیل این عکس انجام شد، ولی تحلیل‌های چت در{" "}
              <b className="text-slate-800">تاریخچهٔ غذایی</b> ثبت نمی‌شوند.
              از این به بعد عکس غذات رو از{" "}
              <b className="text-emerald-600">دستیار تغذیه</b> تحلیل کن تا
              کالری‌ش خودکار در تاریخچه ثبت بشه و برنامه‌ات دقیق‌تر پیگیری بشه.
            </p>
            <Button
              onClick={() => useAppStore.getState().setMainTab("nutrition")}
              className="w-full mt-3 rounded-xl h-9 text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
            >
              <UtensilsCrossed className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
              رفتن به دستیار تغذیه
            </Button>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 mt-1 text-right">همین حالا</div>
      </div>
    </motion.div>
  );
}

function CoachBubble({
  message,
  uploadProgress = null,
}: {
  message: ChatMessageDto;
  /** v90 — درصد پیشرفت آپلود ویدیو همین حباب (فقط پیام موقت) — null یعنی آپلود نیست */
  uploadProgress?: number | null;
}) {
  const isUser = message.role === "user";
  const time = formatTime(message.createdAt);
  // ─── v73.4 — placeholder pending: پیام assistant با محتوای خالی یعنی تحلیل
  // مدیا هنوز در پس‌زمینهٔ سرور در جریان است → حباب اسپینر نشان بده ───
  const isPendingAssistant =
    !isUser && message.id !== FOOD_TIP_MESSAGE_ID && message.content === "";
  // ─── v73.4 — پروتکل APPLY_SWAP: خط انتهایی directive → دکمهٔ اعمال ───
  // پیام‌های قدیمی (تاریخچه) هم همین پارس را می‌گیرند.
  const rawText = isPendingAssistant ? "" : isUser ? null : message.content;
  const swap = rawText ? parseApplySwapDirective(rawText) : null;
  // ─── v111 — پروتکل PLAN_CHANGE_PROPOSAL: کارت تایید بازطراحی برنامه ───
  // (mutually exclusive با APPLY_SWAP — هر دو تگ در یک پاسخ معنا ندارد)
  const proposal = !swap && rawText ? parsePlanChangeProposalDirective(rawText) : null;
  // ─── v85 — پاک‌سازی خطوط تزئینی (v86 — پروتکل پیشنهادها حذف شد) ───
  const afterSwap = swap ? swap.remainder : proposal ? proposal.remainder : rawText;
  // ─── Task 7-e — تایپوگرافی فارسی در زمان رندر (فقط پیام دستیار —
  // رندر-تایم فقط؛ متن ذخیره‌شده در هیچ‌جا جهش نمی‌خورد) ───
  const bubbleText = afterSwap
    ? safeFixFaTypography(stripDecorativeLines(afterSwap))
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[85%] sm:max-w-[75%] flex flex-col ${
          isUser ? "items-start" : "items-end"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-full flex items-center justify-center shadow-sm bg-gradient-to-br from-amber-500 to-orange-600 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="text-[10px] text-orange-600 font-medium">
              فیتاپ
            </span>
          </div>
        )}

        {/* نمایش مدیا در بالای متن پیام کاربر */}
        {isUser && message.mediaUrl && (
          <div className="mb-1.5">
            {message.mediaType === "image" ? (
              <img
                src={message.mediaUrl}
                alt="عکس ارسالی"
                className="max-w-[220px] max-h-[220px] w-auto h-auto object-cover rounded-2xl border-2 border-orange-200 shadow-sm"
              />
            ) : message.mediaType === "video" ? (
              /* فیکس v45 (درخواست مالک): خودِ ویدیو + دکمهٔ پلی روی آن —
                 قبلاً video بدون preload بود که فقط جعبهٔ خالی + دکمهٔ کوچک نشان می‌داد
                 v90 — poster تضمینی پیام موقت + اورلی پیشرفت آپلود روی خود ویدیو */
              <div className="relative w-fit max-w-[240px]">
                <InlineVideoPreview
                  src={message.mediaUrl}
                  poster={message.poster ?? undefined}
                  className="w-fit max-w-[240px] rounded-2xl"
                  videoClassName="max-w-[240px] max-h-[260px] w-auto h-auto object-cover rounded-2xl border-2 border-orange-200 shadow-sm"
                />
                {uploadProgress !== null && (
                  <div
                    className="absolute inset-0 rounded-2xl bg-slate-900/55 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 z-10"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                    <span className="text-xs font-black text-white" dir="rtl">
                      آپلود {toPersianDigits(uploadProgress)}٪
                    </span>
                    <div className="w-3/4 h-1.5 rounded-full bg-white/25 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(4, uploadProgress)}%` }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                      />
                    </div>
                    <span className="text-[9px] text-white/85 font-medium">در حال ارسال ویدیو…</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ─── v86 — فال‌بک رسانهٔ منقضی‌شده (سیاست نگهداری ۷۲ ساعتهٔ رسانهٔ چت):
             مدیای پیام پس از ۳ روز از سرور پاک شده ولی تحلیلش محفوظ است —
             به‌جای پیش‌نمایش مدیا، یک نکتهٔ کم‌رنگ فارسی نشان بده ─── */}
        {isUser && message.mediaType && !message.mediaUrl && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>رسانهٔ این پیام پس از ۳ روز حذف شد — تحلیل آن محفوظ است</span>
          </div>
        )}

        {(bubbleText || isUser || isPendingAssistant) && (
          <div
            className={
              isUser
                ? "bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-md"
                : "bg-white border border-orange-100 rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed text-slate-700 shadow-sm"
            }
          >
            {isUser ? (
              message.content
            ) : isPendingAssistant ? (
              /* v73.4 — اسپینر «در حال تحلیل و پاسخ…» تا تکمیل تحلیل پس‌زمینه */
              <div className="flex items-center gap-2 py-0.5">
                <Loader2 className="w-4 h-4 animate-spin text-orange-500 shrink-0" />
                <span className="text-xs text-slate-500 font-medium">
                  در حال تحلیل و پاسخ…
                </span>
              </div>
            ) : (
              // ─── رندر markdown برای پیام‌های فیتاپ ───
              // جدول‌ها، هدرها، لیست‌ها و... به‌صورت مرتب نمایش داده می‌شوند.
              // نکته: در react-markdown v10، override کردن h1/img/a می‌تواند
              // parsing جدول‌ها را خراب کند — این‌ها را override نمی‌کنیم.
              <div className="prose-chat-fa">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  // v85 — اجازهٔ عبور URLهای action: (لینک درون‌برنامه‌ای مربی).
                  // امنیت: کامپوننت a پایین‌تر برای action:* فقط دکمهٔ داخلی می‌سازد و
                  // برای هر href دیگری هرگز <a> واقعی رندر نمی‌کند (فقط متن پررنگ) —
                  // پس حتی javascript: هم هیچ مسیر اجرا ندارد.
                  urlTransform={(url) => url}
                  components={{
                    // جدول‌ها در یک wrapper اسکرول‌پذیر قرار می‌گیرند
                    // استایل واقعی روی CSS .prose-chat-fa table است
                    table: ({ node, ...p }) => (
                      <div className="fitup-table-wrapper" style={{ margin: "0.5rem 0", overflowX: "auto" }}>
                        <table {...p} />
                      </div>
                    ),
                    // ─── v85 — لینک درون‌برنامه‌ای [متن](action:مقصد) ───
                    // کلیک → پرش واقعی به همان بخش فیتاپ (بدون reload). لینک
                    // خارجی/ناشناخته به‌صورت متن ساده رندر می‌شود (بدون خروج از چت).
                    a: ({ node, children, href, ...p }) => {
                      const action =
                        typeof href === "string" && href.startsWith("action:")
                          ? href.slice("action:".length)
                          : null;
                      if (action && COACH_ACTION_TARGETS.has(action.trim())) {
                        return (
                          <button
                            type="button"
                            onClick={() => navigateCoachAction(action)}
                            className="inline-flex items-center gap-1 align-baseline mx-0.5 px-2 py-0.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-600 text-[12px] font-bold hover:bg-orange-100 hover:text-orange-700 transition active:scale-95"
                            title={`رفتن به ${action}`}
                          >
                            {children}
                            <span aria-hidden="true">←</span>
                          </button>
                        );
                      }
                      // لینک غیر action → بدون خروج از چت، به‌صورت متن پررنگ
                      return <span className="text-orange-600 font-bold">{children}</span>;
                    },
                    // بقیه المان‌ها توسط CSS .prose-chat-fa استایل می‌گیرند
                    // نیازی به inline style نیست — CSS کامل است
                  }}
                >
                  {bubbleText}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* v73.4 — دکمهٔ اعمال جایگزینی (پروتکل APPLY_SWAP) */}
        {swap && <ApplySwapButton swap={swap} />}

        {/* v111 — کارت تایید بازطراحی برنامه (پروتکل PLAN_CHANGE_PROPOSAL) */}
        {proposal && <PlanChangeApprovalCard proposal={proposal} />}

        {time && (
          <div
            className={`text-[10px] text-slate-400 mt-1 ${
              isUser ? "text-left" : "text-right"
            }`}
          >
            {time}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  v73.4 — دکمهٔ اعمال جایگزینی (پروتکل APPLY_SWAP — توافق با همکار)
//  کلیک → POST /api/coach/apply-swap → توست موفق + refresh برنامه‌ها در store
//  → دکمهٔ تیک‌خورده/غیرفعال. توست خطا هم دارد (با امکان تلاش مجدد).
// ═══════════════════════════════════════════════════════════════

function ApplySwapButton({ swap }: { swap: ParsedApplySwap }) {
  const [state, setState] = useState<"idle" | "applying" | "done">("idle");

  async function handleApply() {
    if (state !== "idle") return;
    setState("applying");
    try {
      const data = await fetchJsonOrThrow<{ applied?: number; message?: string }>(
        "/api/coach/apply-swap",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: swap.type,
            from: swap.from,
            to: swap.to,
            day: swap.day,
          }),
        },
        "خطا در اعمال جایگزینی"
      );
      const applied = typeof data.applied === "number" ? data.applied : 0;
      // دکمه در هر حالت ۲xx تیک می‌خورد — تلاش دوباره بی‌معنی است
      setState("done");
      if (applied > 0) {
        toast.success("جایگزینی در برنامهٔ تو اعمال شد ✅");
        // refresh برنامه‌ها (fetchJson /api/coach/plan) + به‌روزرسانی store —
        // داشبورد/تمرین/تغذیه بلافاصله برنامهٔ جدید را نشان می‌دهند
        try {
          const { res, data: planData } = await fetchJson<{
            workout?: unknown;
            meal?: unknown;
          }>("/api/coach/plan", { cache: "no-store" });
          if (res.ok) {
            const st = useAppStore.getState();
            if (planData.workout) {
              st.setWorkoutPlan(planData.workout as WorkoutPlanContent);
            }
            if (planData.meal) {
              st.setMealPlan(planData.meal as MealPlanContent);
            }
          }
        } catch {
          // refresh پلن‌ها حیاتی نیست — خودِ viewها در چرخهٔ بعدی تازه می‌کنند
        }
      } else {
        toast.info(
          data.message ||
            "این مورد در برنامهٔ فعلیت پیدا نشد — شاید قبلاً جایگزین شده باشد."
        );
      }
    } catch (e) {
      setState("idle"); // اجازهٔ تلاش مجدد
      toast.error(e instanceof Error ? e.message : "خطا در اعمال جایگزینی");
    }
  }

  if (state === "done") {
    return (
      <div
        className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold"
        role="status"
      >
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        اعمال شد
      </div>
    );
  }

  return (
    <button
      onClick={handleApply}
      disabled={state === "applying"}
      className="mt-1.5 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-br from-amber-500 to-orange-600"
      aria-label="اعمال این جایگزینی در برنامهٔ من"
    >
      {state === "applying" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      اعمال این جایگزینی در برنامهٔ من
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
//  v111 — کارت تایید بازطراحی برنامه (پروتکل PLAN_CHANGE_PROPOSAL — آینهٔ
//  APPLY_SWAP). خلاصهٔ یک‌خطی تغییرات + دو دکمه «تایید و ساخت برنامهٔ جدید» /
//  «انصراف» + نکتهٔ کوچک دربارهٔ جایگزینی برنامه و سهمیهٔ یک‌بارِ اشتراک.
//  وضعیت سهمیه از همان منبعی خوانده می‌شود که view قبلاً استفاده می‌کند
//  (user.planRegen از buildUserDto) — گیت نهایی همیشه سمت سرور است.
//  تایید → POST /api/coach/plan-change/confirm → تولید پس‌زمینه (chat_request)
//  → بعد از اتمام، سرور پیام خلاصهٔ برنامهٔ جدید را در همین چت درج می‌کند؛
//  poll سبکِ ۳۰ثانیه‌ای تا ۱۲ دقیقه پیام تازه را به تاریخچهٔ همین حباب اضافه می‌کند
//  (چت به‌طور دوره‌ای poll نمی‌کند — این پل کوتاهِ همین جریان است).
// ═══════════════════════════════════════════════════════════════

const PLAN_CHANGE_SUMMARY_POLL_MS = 30_000;
const PLAN_CHANGE_SUMMARY_POLL_MAX_TICKS = 24; // ۱۲ دقیقه

function PlanChangeApprovalCard({ proposal }: { proposal: ParsedPlanChangeProposal }) {
  const { user, setChatMessages } = useAppStore();
  const [state, setState] = useState<"idle" | "confirming" | "done" | "cancelled">("idle");
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // وضعیت سهمیهٔ بازطراحی (همان منبعی که کارت پلن استفاده می‌کند)
  const planRegen = user?.planRegen;
  const quotaUsed = !!planRegen?.used;
  const quotaEligible = planRegen ? planRegen.eligible : true; // نامشخص → گیت سمت سرور

  // ─── poll خلاصهٔ برنامهٔ جدید (فقط بعد از تایید موفق) ───
  const summaryPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (summaryPollRef.current) clearTimeout(summaryPollRef.current);
    };
  }, []);

  function startSummaryPoll() {
    if (summaryPollRef.current) return;
    const baselineLen = useAppStore.getState().chatMessages.length;
    let ticks = 0;
    const tick = async () => {
      if (!aliveRef.current) return;
      ticks++;
      try {
        const { res, data } = await fetchJson<{ messages?: ChatMessageDto[] }>(
          "/api/coach/chat",
          { cache: "no-store" }
        );
        if (res.ok && aliveRef.current) {
          const msgs = data.messages || [];
          if (msgs.length > baselineLen) {
            // پیام خلاصهٔ برنامهٔ جدید رسید → تاریخچه تازه شود (همان رفتار loadHistory)
            setChatMessages(msgs);
            return; // پایان poll
          }
        }
      } catch {
        // خطای شبکه موقت — تا سقف تیک ادامه بده
      }
      if (ticks >= PLAN_CHANGE_SUMMARY_POLL_MAX_TICKS) return; // ۱۲ دقیقه گذشت — با بازکردن مجدد چت پیام می‌آید
      summaryPollRef.current = setTimeout(tick, PLAN_CHANGE_SUMMARY_POLL_MS);
    };
    summaryPollRef.current = setTimeout(tick, PLAN_CHANGE_SUMMARY_POLL_MS);
  }

  async function handleConfirm() {
    if (state !== "idle" || quotaUsed) return;
    setState("confirming");
    try {
      const data = await fetchJsonOrThrow<{ ok?: boolean; message?: string }>(
        "/api/coach/plan-change/confirm",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: proposal.summary }),
        },
        "خطا در ثبت تایید بازطراحی برنامه"
      );
      setState("done");
      toast.success(data.message || "درخواست ساخت برنامهٔ جدید ثبت شد ✅");
      // mirror APPLY_SWAP — تازه‌سازی برنامه‌ها در store (فعلاً همان برنامهٔ فعلی؛
      // برنامهٔ جدید خودش با پیام خلاصه/نوتیف آماده می‌شود)
      try {
        const { res, data: planData } = await fetchJson<{
          workout?: unknown;
          meal?: unknown;
        }>("/api/coach/plan", { cache: "no-store" });
        if (res.ok) {
          const st = useAppStore.getState();
          if (planData.workout) st.setWorkoutPlan(planData.workout as WorkoutPlanContent);
          if (planData.meal) st.setMealPlan(planData.meal as MealPlanContent);
        }
      } catch {
        // refresh پلن‌ها حیاتی نیست
      }
      startSummaryPoll();
    } catch (e) {
      setState("idle"); // اجازهٔ تلاش مجدد
      toast.error(e instanceof Error ? e.message : "خطا در ثبت تایید بازطراحی برنامه");
    }
  }

  async function handleCancel() {
    if (state !== "idle") return;
    setState("confirming");
    try {
      const data = await fetchJsonOrThrow<{ ok?: boolean; message?: string }>(
        "/api/coach/plan-change/cancel",
        { method: "POST" },
        "خطا در ثبت انصراف"
      );
      setState("cancelled");
      toast.info(data.message || "انصراف ثبت شد — برنامهٔ فعلی شما سر جای خودش است.");
    } catch (e) {
      setState("idle");
      toast.error(e instanceof Error ? e.message : "خطا در ثبت انصراف");
    }
  }

  // حالت‌های نهایی — جای دکمه‌ها
  if (state === "done") {
    return (
      <div
        className="mt-1.5 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] font-bold text-emerald-700"
        role="status"
      >
        <div className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          درخواست ساخت برنامهٔ جدید ثبت شد
        </div>
        <div className="mt-1 text-[10px] font-medium text-emerald-600">
          وقتی برنامهٔ جدید آماده شد، خلاصهٔ تغییرات همین‌جا نوشته می‌شود و تب «برنامه‌ها» نسخهٔ جدید را نشان می‌دهد.
        </div>
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div
        className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] font-bold text-slate-500"
        role="status"
      >
        بازطراحی برنامه لغو شد — سهمیهٔ شما دست‌نخورده است.
      </div>
    );
  }

  return (
    <div className="mt-1.5 w-full rounded-2xl border border-orange-200 bg-orange-50/70 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-black text-orange-700">
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        کارت تایید بازطراحی برنامه
      </div>
      <p className="mt-1.5 text-[12px] font-bold leading-relaxed text-slate-700" dir="auto">
        {proposal.summary}
      </p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        با تایید، کل برنامهٔ فعلی شما (تمرین + تغذیه + مکمل) با نسخهٔ جدید بر اساس دیتای فعلی‌تان از نو ساخته و
        جایگزین می‌شود — بدون هیچ تغییری در پلن و مدت اشتراک. این قابلیت یکبار در طول اشتراک قابل استفاده است و
        با تایید، سهمیهٔ همین اشتراک مصرف می‌شود.
      </p>
      {quotaUsed && (
        <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-bold leading-relaxed text-amber-700">
          سهمیهٔ بازطراحی برنامه در این اشتراک قبلاً مصرف شده است — برای تغییر برنامه با پشتیبانی در ارتباط باشید.
        </p>
      )}
      {!quotaUsed && !quotaEligible && (
        <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-bold leading-relaxed text-amber-700">
          بازطراحی برنامه از طریق چت فقط برای پلن پیشرفته و حرفه‌ای فعال است.
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={handleConfirm}
          disabled={state === "confirming" || quotaUsed || !quotaEligible}
          className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 bg-gradient-to-br from-amber-500 to-orange-600"
          aria-label="تایید و ساخت برنامهٔ جدید"
        >
          {state === "confirming" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          تایید و ساخت برنامهٔ جدید
        </button>
        <button
          onClick={handleCancel}
          disabled={state === "confirming"}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-600 text-xs font-bold transition hover:bg-slate-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="انصراف از بازطراحی برنامه"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          انصراف
        </button>
      </div>
    </div>
  );
}

function CoachTyping() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex justify-end"
    >
      <div className="flex flex-col items-end">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-6 h-6 rounded-full flex items-center justify-center shadow-sm bg-gradient-to-br from-amber-500 to-orange-600 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="text-[10px] text-orange-600 font-medium">
            فیتاپ
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-4 py-3 bg-white border border-orange-100 rounded-2xl rounded-br-md shadow-sm">
          <span
            className="w-2 h-2 rounded-full bg-orange-400 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-orange-400 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-orange-400 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
