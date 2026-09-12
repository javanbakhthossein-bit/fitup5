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
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
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
  SERVER_UNREACHABLE_MESSAGE,
} from "@/lib/fitness/fetch-json";
import { createVideoThumbnail } from "@/lib/fitness/video-thumbnail";
import { downscaleImage } from "@/lib/fitness/client-image";
import { useQuotaSummary, type QuotaSummary } from "@/lib/fitness/use-quota-summary";
import { toast } from "sonner";

const QUICK_PROMPTS = [
  { icon: Dumbbell, text: "یکی از حرکات امروز را سخت‌تر کن" },
  { icon: Salad, text: "یک میان‌وعده کم‌کالری پیشنهاد بده" },
  { icon: RotateCcw, text: "جایگزینی برای اسکوات بده" },
];

/** آستانهٔ ارسال ویدیو: بالاتر از این → مسیر multipart بدون محدودیت حجم (Task 4-a) */
const VIDEO_MULTIPART_THRESHOLD = 12 * 1024 * 1024;
/**
 * گارد فنی سمت کلاینت (۲ گیگابایت) — سقف کاربر-پسند حذف شد (دیرکتیو مالک:
 * «کاربر محدودیتی در حجم نداشته باشد؛ خودمان فشرده می‌کنیم»). این گارد فقط
 * جلوی درخواست‌های غیرمعقول را می‌گیرد و با سقف فنی سرور (۲GB) هم‌خوان است.
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

/** پارامترهای poll پیام‌های pending (تحلیل مدیا در پس‌زمینه — v73.4) */
const PENDING_POLL_INTERVAL_MS = 4_000;
const PENDING_POLL_MAX_MS = 5 * 60_000; // حداکثر ۵ دقیقه

/**
 * v57 — شناسهٔ حباب «پیشنهاد دستیار تغذیه» — بعد از اولین تحلیل عکس غذا در چت،
 * یک‌بار در هر سشن به‌صورت حباب اختصاصی (با دکمهٔ رفتن به دستیار) نشان داده
 * می‌شود تا کاربر بداند تحلیلِ تاریخچه‌دار از کجا انجام می‌شود (درخواست مالک).
 */
const FOOD_TIP_MESSAGE_ID = "fitup-food-assistant-tip";
const FOOD_TIP_SESSION_FLAG = "fitup_food_tip_shown_v1";

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

/**
 * آپلود ویدیو با XMLHttpRequest — برای دریافت درصد پیشرفت واقعی آپلود
 * (fetch هنوز upload progress قابل‌اعتماد ندارد). مسیر نسبی — بدون پورت.
 */
function uploadVideoWithProgress(
  file: File,
  onProgress: (pct: number) => void
): Promise<{ mediaUrl: string; frames: string[] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/coach/chat/upload");
    xhr.responseType = "json";
    xhr.timeout = 10 * 60_000; // آپلود فایل‌های بزرگ — ۱۰ دقیقه
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      const data = xhr.response as
        | { mediaUrl?: string; frames?: string[]; error?: string }
        | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.mediaUrl) {
        onProgress(100);
        resolve({
          mediaUrl: data.mediaUrl,
          frames: Array.isArray(data.frames) ? data.frames : [],
        });
      } else {
        reject(
          new Error(
            (data && data.error) ||
              "آپلود ویدیو ناموفق بود. دوباره تلاش کن."
          )
        );
      }
    };
    xhr.onerror = () => reject(new Error(SERVER_UNREACHABLE_MESSAGE));
    xhr.ontimeout = () =>
      reject(new Error("آپلود ویدیو بیش از حد طول کشید. دوباره تلاش کن."));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // پیش‌نمایش مدیای انتخاب‌شده قبل از ارسال
  const [selectedImage, setSelectedImage] = useState<string | null>(null); // data URL
  // ─── Task 4-a: ویدیو با blob URL + File + poster کانواسی ───
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null); // blob URL (پیش‌نمایش فوری)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [selectedVideoPoster, setSelectedVideoPoster] = useState<string | null>(null);
  const selectedVideoUrlRef = useRef<string | null>(null);
  const videoSelectionSeqRef = useRef(0); // نسل انتخاب — جلوگیری از overwrite poster قدیمی
  // درصد پیشرفت آپلود multipart (null = در حال آپلود نیستیم)
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // ─── منوی بازشدنی دکمه + (انتخاب عکس/ویدیو) ───
  const [showUploadMenu, setShowUploadMenu] = useState(false);

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

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
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

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
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
      imageInputRef.current?.click();
    } else {
      toast.info("برای ارسال عکس باید پلن خود را به پیشرفته ارتقا دهید");
      setOverlay("subscription");
    }
  }

  function handleVideoBtn() {
    if (canAccess(planName, "chatVideoUpload")) {
      videoInputRef.current?.click();
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
    // (ویدیو با blob URL + poster فوراً فریم اول را نشان می‌دهد — Task 4-a)
    const tempUserMsg: ChatMessageDto = {
      id: tempId("temp"),
      role: "user",
      content:
        message ||
        (selectedImage ? "📷 عکس" : videoFile ? "🎬 ویدیو" : ""),
      mediaUrl: selectedImage ?? videoPreviewUrl,
      mediaType: selectedImage ? "image" : videoFile ? "video" : null,
      createdAt: new Date().toISOString(),
    };
    addChatMessage(tempUserMsg);

    setSelectedImage(null);
    clearVideoDraft();

    try {
      let videoBase64: string | undefined;
      let uploadedVideoUrl: string | undefined;
      let uploadedFrames: string[] | undefined;

      if (videoFile) {
        if (videoFile.size > VIDEO_MULTIPART_THRESHOLD) {
          // ─── Task 4-a: ویدیوهای بزرگ → مسیر multipart بدون محدودیت حجم ───
          // ابتدا آپلود (ذخیره + فشرده‌سازی + استخراج فریم + مصرف سهمیه)،
          // سپس POST چت با videoUrl/videoFrames.
          setUploadPct(0);
          try {
            const up = await uploadVideoWithProgress(videoFile, (p) =>
              setUploadPct(p)
            );
            uploadedVideoUrl = up.mediaUrl;
            uploadedFrames = up.frames;
          } finally {
            setUploadPct(null);
          }
        } else {
          // مسیر قدیمی base64 (<۱۲MB) — دست‌نخورده
          videoBase64 = await fileToDataUrl(videoFile);
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
            videoBase64,
            videoUrl: uploadedVideoUrl,
            videoFrames: uploadedFrames,
            isVoice: lastWasVoiceRef.current, // آیا پیام از طریق ویس بود؟
          }),
        },
        "خطا در ارتباط با سرور"
      );

      // ─── v57: حباب پیشنهاد «دستیار تغذیه» — درخواست مالک ───
      // تحلیل غذا در چت انجام می‌شود ولی در تاریخچهٔ غذایی ثبت نمی‌شود؛ کاربر
      // بعد از اولین تحلیل عکس غذا، یک‌بار در سشن، پیشنهاد اختصاصی می‌گیرد.
      // v59 — گارد storage: getItem در حالت خصوصی می‌تواند throw کند
      let foodTipShown = false;
      try {
        foodTipShown = !!window.sessionStorage.getItem(FOOD_TIP_SESSION_FLAG);
      } catch {}
      const shouldPushFoodTip =
        !!imageData && !videoFile && typeof window !== "undefined" && !foodTipShown;
      if (shouldPushFoodTip) {
        try {
          window.sessionStorage.setItem(FOOD_TIP_SESSION_FLAG, "1");
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
        if (data.userMessage) next.push(data.userMessage as ChatMessageDto);
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

      // ─── v56/v73.4 — راهنمایی کاربر به «دستیار تغذیه» بعد از ارسال عکس غذا ───
      // (تحلیل خودِ عکس حالا در پس‌زمینه انجام می‌شود و نتیجه در حباب pending می‌آید)
      if (imageData && !videoFile) {
        toast.info("عکس دریافت شد — تحلیل در جریان است ⏳", {
          description:
            "از این به بعد تحلیل عکس غذا را از «دستیار تغذیه» انجام بده تا در تاریخچهٔ غذایی‌ات ثبت شود و برنامه‌ات دقیق‌تر پیگیری بشه 🍽",
          action: {
            label: "رفتن به دستیار تغذیه",
            onClick: () => useAppStore.getState().setMainTab("nutrition"),
          },
          duration: 10000,
        });
      }

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
      // پیام سهمیه (۴۲۹) در toast هم نمایش داده می‌شود تا فوری دیده شود
      if (e instanceof ApiError && e.status === 429) {
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
      : "flex flex-col h-[calc(100dvh-4rem)] max-w-2xl lg:max-w-4xl mx-auto bg-white";

  return (
    <div
      className={containerClass}
      dir="rtl"
    >
      {/* فایل‌های مخفی برای انتخاب عکس/ویدیو */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoSelect}
      />

      {/* هدر فیتاپ — تم سفید حرفه‌ای */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-orange-100 bg-white/95 backdrop-blur-md sticky top-0 z-10">
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
          <p className="text-[11px] text-emerald-600 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            آنلاین — دسترسی کامل به پرونده شما
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
                <CoachBubble key={msg.id} message={msg} />
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
            <span className="text-xs text-slate-500">آماده ارسال</span>
          </div>
        )}

        {/* ─── ردیزاین input چت — دکمه + (آپلود) + میکروفون + textarea + ارسال ─── */}
        <div className="flex items-end gap-2 relative">
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
                        <p className="text-[9px] text-slate-400">بدون محدودیت حجم — خودکار فشرده می‌شود</p>
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
  dailyValue,
  pct,
  tone,
  tip,
  open,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  /** مقدار «مصرف/سقف» با ارقام فارسی */
  value: string;
  /** متن اختیاری روزانه — فقط عکس چت */
  dailyValue?: string;
  pct: number;
  tone: "orange" | "emerald" | "amber";
  tip: string;
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
            <span className="text-[10px] font-medium text-slate-400" dir="ltr">
              {value}
            </span>
          </span>
          {dailyValue && (
            <span className="text-[8px] text-slate-400 leading-none">{dailyValue}</span>
          )}
          <QuotaMiniBar pct={pct} tone={tone} />
        </span>
      </button>
      {open && (
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
  const canMealPhoto = canAccess(planName, "mealPhotoAnalysis");
  const planLabel = planName ? PLAN_LABELS[planName] : "";

  const toggle = (key: string) => setOpenTip((prev) => (prev === key ? null : key));

  const chips: ReactNode[] = [];

  // ─── چیپ عکس چت ───
  if (canSendImage && summary.chatPhoto.total > 0) {
    const c = summary.chatPhoto;
    chips.push(
      <QuotaChip
        key="chat_photo"
        icon={<ImageIcon className="w-3.5 h-3.5 text-orange-500" />}
        label="عکس"
        value={`${toPersianDigits(c.used)}/${toPersianDigits(c.total)}`}
        dailyValue={
          c.dailyTotal > 0
            ? `روزانه ${toPersianDigits(c.dailyUsed)}/${toPersianDigits(c.dailyTotal)}`
            : undefined
        }
        pct={c.total > 0 ? (c.used / c.total) * 100 : 0}
        tone="orange"
        tip={`${toPersianDigits(c.baseTotal)} عکس در دوره + حداکثر ${toPersianDigits(c.dailyTotal)} در روز${
          c.bonus > 0 ? ` (+${toPersianDigits(c.bonus)} سهمیهٔ هدیه از مدیر)` : ""
        }`}
        open={openTip === "chat_photo"}
        onToggle={() => toggle("chat_photo")}
      />
    );
  }

  // ─── چیپ ویدیو حرکات ───
  if (canSendVideo && summary.movementVideo.total > 0) {
    const v = summary.movementVideo;
    const tip =
      summary.workoutExerciseCount > 0
        ? `بر اساس پلن ${planLabel} جاری شما تا ${toPersianDigits(v.total)} ویدیو (به تعداد حرکات برنامه‌ات)${
            v.bonus > 0 ? ` (+${toPersianDigits(v.bonus)} هدیه)` : ""
          }`
        : `تا ${toPersianDigits(v.total)} ویدیو در این دوره — وقتی برنامهٔ تمرینی فعالی بسازی، سقف به تعداد حرکات برنامه‌ات تغییر می‌کند`;
    chips.push(
      <QuotaChip
        key="movement_video"
        icon={<Video className="w-3.5 h-3.5 text-emerald-600" />}
        label="ویدیو حرکات"
        value={`${toPersianDigits(v.used)}/${toPersianDigits(v.total)}`}
        pct={v.total > 0 ? (v.used / v.total) * 100 : 0}
        tone="emerald"
        tip={tip}
        open={openTip === "movement_video"}
        onToggle={() => toggle("movement_video")}
      />
    );
  }

  // ─── چیپ تحلیل غذا ───
  if (canMealPhoto && summary.mealPhoto.total > 0) {
    const m = summary.mealPhoto;
    chips.push(
      <QuotaChip
        key="meal_photo"
        icon={<Salad className="w-3.5 h-3.5 text-amber-600" />}
        label="تحلیل غذا"
        value={`${toPersianDigits(m.used)}/${toPersianDigits(m.total)}`}
        pct={m.total > 0 ? (m.used / m.total) * 100 : 0}
        tone="amber"
        tip={`${toPersianDigits(m.baseTotal)} عکس غذا = روزهای پلنت${
          m.bonus > 0 ? ` (+${toPersianDigits(m.bonus)} سهمیهٔ هدیه از مدیر)` : ""
        }`}
        open={openTip === "meal_photo"}
        onToggle={() => toggle("meal_photo")}
      />
    );
  }

  const hasLockedFeature = !canSendImage || !canSendVideo || !canMealPhoto;
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
      <div className="flex items-center gap-2 rounded-2xl border border-orange-100/80 bg-white/70 backdrop-blur-md px-2 py-1.5 overflow-x-auto custom-scrollbar">
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

function CoachBubble({ message }: { message: ChatMessageDto }) {
  const isUser = message.role === "user";
  const time = formatTime(message.createdAt);
  // ─── v73.4 — placeholder pending: پیام assistant با محتوای خالی یعنی تحلیل
  // مدیا هنوز در پس‌زمینهٔ سرور در جریان است → حباب اسپینر نشان بده ───
  const isPendingAssistant =
    !isUser && message.id !== FOOD_TIP_MESSAGE_ID && message.content === "";
  // ─── v73.4 — پروتکل APPLY_SWAP: خط انتهایی directive → دکمهٔ اعمال ───
  // پیام‌های قدیمی (تاریخچه) هم همین پارس را می‌گیرند.
  const swap = isPendingAssistant ? null : isUser ? null : parseApplySwapDirective(message.content);
  const bubbleText = swap ? swap.remainder : message.content;

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
                 قبلاً video بدون preload بود که فقط جعبهٔ خالی + دکمهٔ کوچک نشان می‌داد */
              <InlineVideoPreview
                src={message.mediaUrl}
                className="w-fit max-w-[240px]"
                videoClassName="max-w-[240px] max-h-[260px] w-auto h-auto object-cover rounded-2xl border-2 border-orange-200 shadow-sm"
              />
            ) : null}
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
                  components={{
                    // جدول‌ها در یک wrapper اسکرول‌پذیر قرار می‌گیرند
                    // استایل واقعی روی CSS .prose-chat-fa table است
                    table: ({ node, ...p }) => (
                      <div className="fitup-table-wrapper" style={{ margin: "0.5rem 0", overflowX: "auto" }}>
                        <table {...p} />
                      </div>
                    ),
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
