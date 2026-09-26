"use client";

import { recoverPendingPayments } from "@/lib/fitness/recover-payments-client";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dumbbell,
  Phone,
  ShieldCheck,
  ChevronLeft,
  RefreshCw,
  MessageSquare,
  Timer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// ⚠️ InputOTP (کتابخانه input-otp) عمداً استفاده نمی‌شود: input واقعی آن کتابخانه
// یک proxy نامرئی است و Android autofill/Gboard/WebOTP نمی‌توانند فیلد مخفی را
// هدف بگیرند → کد اتو-پر نمی‌شد و پیشنهاد کد بالای کیبورد هم نمی‌آمد.
// (فایل src/components/ui/input-otp.tsx دست‌نخورده ماند — فقط این import حذف شد.)
import { useAppStore } from "@/lib/fitness/store";

import { toast } from "sonner";
import { replaceScreen, pushScreen, navigateToTerms} from "@/lib/fitness/navigation";
import { startNativeOtpRetriever, getNativeOtpBridgeKey } from "@/lib/fitness/app-bridge";

type Step = "mobile" | "otp";

const RESEND_COOLDOWN_SEC = 90;
// اعتبار پیش‌فرض کد (ثانیه) — سرور expiresIn می‌فرستد؛ این fallback است
const OTP_VALIDITY_FALLBACK_SEC = 600;

// ۰۹:۵۹ → "۹:۵۹" فارسی — شمارش معکوس اعتبار کد
function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// FIX: تبدیل ارقام فارسی (۰-۹) و عربی (٠-٩) به لاتین قبل از فیلتر.
// regex \d فقط ارقام ASCII را می‌گیرد و قبلاً ارقام فارسی (کیبورد فارسی)
// بی‌صدا حذف می‌شدند — کاربر نمی‌توانست شماره/کد را تایپ کند.
function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ۰-۹
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // ٠-٩
}

// استخراج کد OTP از هر ورودی خام (تایپ، پیست، WebOTP، autofill):
// ارقام فارسی/عربی → لاتین، حذف غیررقمی؛ اگر بیش از ۴ رقم بود «آخرین ۴ رقم» —
// چون در متن پیامک (فرمت @دامنه #کد) کد در انتهاست.
function extractOtpDigits(raw: string): string {
  const digits = normalizeDigits(String(raw ?? "")).replace(/\D/g, "");
  return digits.length > 4 ? digits.slice(-4) : digits;
}

// Validate Iranian mobile format (09XXXXXXXXX)
function isValidIranMobile(mobile: string): boolean {
  return /^09\d{9}$/.test(mobile.replace(/\s/g, ""));
}

export function AuthScreen() {
  const { setUser, setScreen, setOverlay } = useAppStore();

  // ---- State ----
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  // ── شمارش معکوس «اعتبار کد» ──
  // مشکل گزارش‌شده کاربران: «پیامک بعد از تموم شدن زمان میاد» — تایمر قبلی فقط
  // مال «ارسال مجدد» بود (۶۰ ثانیه) و کاربر فکر می‌کرد کد بعدش بی‌اعتبار است؛
  // پیامک می‌رسید، کد را می‌زد و (قبل از این فیکس) چون ریسند کرده بود کد اول
  // باطل شده بود. حالا: اعتبار واقعی (۱۰ دقیقه) شمرده و نمایش داده می‌شود تا
  // کاربر بداند پیامک دیررسیده هم هنوز معتبر است و شتاب‌زده ریسند نکند.
  // null = هنوز کدی نفرستاده‌ایم/نمی‌دانیم → چیزی نمایش نده؛ ۰ = واقعاً منقضی.
  const [validityIn, setValidityIn] = useState<number | null>(null);
  // شمارندهٔ «دورِ ارسال کد» — بعد از هر ارسال/ارسال‌مجدد موفق +۱ می‌شود تا
  // listener وب‌OTP خاتمه یافته (abort) و برای پیامک جدید دوباره arm شود.
  const [otpNonce, setOtpNonce] = useState(0);
  // ref مستقیم روی input واقعی کد — هدف فوکوس بعد از ارسال/ریسند کد
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  // ⛔ کارت «ورود خودکار با پیامک» و پل requestSmsAutoRead حذف شدند.
  // علت ریشه‌ای: پرمیشن RECEIVE_SMS از اندروید ۱۳+ برای اپ‌های خارج از گوگل‌پلی
  // «محدود» است؛ سیستم اجازهٔ اعطا را می‌بندد و دیالوگ ترسناک
  // «App was denied access» نشان می‌داد (درخواست مالک برای حذف ریشه‌ای).
  // ورود خودکار کد حالا بدون هیچ پرمیشنی:
  // ۱) ورودی کد autoComplete="one-time-code" دارد → پیشنهاد سیستم/کیبورد
  // ۲) اپ در onResume کلیپ‌بورد را چک می‌کند و کد کپی‌شده را اتو-درج می‌کند

  // NOTE: The "new terms" modal is rendered globally by `GlobalNewTermsModal`
  // (mounted in layout.tsx) whenever the `termsUpdateRequired` flag is set in
  // the store. The auth screen does NOT need to manage its own modal — the
  // global one overlays whatever screen the user is on (including this one).

  // ---- Resend cooldown ticker ----
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // ---- Code validity countdown ticker ----
  useEffect(() => {
    if (validityIn == null || validityIn <= 0) return;
    const t = setTimeout(() => setValidityIn((v) => (v == null ? null : Math.max(0, v - 1))), 1000);
    return () => clearTimeout(t);
  }, [validityIn]);

  // ---- Auto-focus OTP input when entering step 2 ----
  // بعد از ارسال کد (و ریسند) فوکوس روی خودِ فیلد کد می‌رود — کیبورد باز می‌شود
  // و پیشنهاد one-time-code بالای کیبورد ظاهر می‌شود.
  useEffect(() => {
    if (step === "otp") {
      // small delay to ensure DOM is ready
      const t = setTimeout(() => {
        otpInputRef.current?.focus();
      }, 80);
      return () => clearTimeout(t);
    }
  }, [step]);

  // ══════════════════════════════════════════════════════════════════════
  // FIX (v112) — ماشین‌حالت «یکتا و قطعی» کیبورد برای صفحهٔ ورود/OTP
  // ══════════════════════════════════════════════════════════════════════
  // گزارش مکرر مالک (چند بار تکرار شده و فیکس‌های قبلی پابرجا نمانده بود):
  //  ۱) با باز/بسته شدن کیبورد، صفحهٔ OTP می‌پرد و می‌لرزد؛
  //  ۲) بعد از بستن کیبورد، صفحه به حالت قبل برنمی‌گردد و بالا اسکرول‌شده می‌ماند؛
  //  ۳) با باز شدن کیبورد، لوگو و متن «فیتاپ» زیر کیبورد پنهان می‌شود.
  //
  // ریشهٔ واقعی: «سه» مکانیزمِ موازی با baseline و آستانهٔ مستقل با هم می‌جنگیدند —
  //  • v50: افکت visualViewport (ریست اسکرول روی رشد ≥۸۰px + scrollIntoView
  //    مرکزچینِ بی‌شرط با تأخیر ۱۵۰ms روی هر resize)
  //  • v93: focusin/focusout برای فشرده‌سازی هدر + دوبار ریست اسکرول در focusout
  //  • v95: پول ۳۵۰ms با baseline و آستانهٔ مستقل خودش
  // هر کدام در لحظه‌ای متفاوت window/اسکرولر داخلی را جابه‌جا می‌کرد → پن دوگانه،
  // فلپ هدر و برگشت‌نکردن اسکرول. (لایهٔ سراسری KeyboardFix هم چهارمین بازیگر
  // بود — از v112 با data-auth-screen از این صفحه به‌کلردست کشیده شده و این
  // صفحه خودش را مدیریت می‌کند.)
  //
  // معماری v112 — فقط «یک» ماشین‌حالت:
  //  • وضعیت یکتا: kbCompact (نشست کیبورد باز است) + آینهٔ kbOpenRef برای
  //    هندلرها/تایمرها (بدون استال‌کلژور).
  //  • baseline یکتا: baseHeightRef = بیشینهٔ ارتفاع ویوپورتِ دیده‌شده — فقط
  //    رشد می‌کند؛ با focusoutِ واقعی به ارتفاع لحظه‌ای ریست می‌شود.
  //  • دو منبع ارتفاعی که هر دو به «همان» applyViewport می‌ریزند:
  //      رویدادهای resize/scroll ویوپورت بصری + پول ۳۵۰ms (برای WebViewهای
  //      بی‌رویداد مثل اینستاگرام).  open = base − ارتفاع‌فعلی ≥ ۱۲۰px
  //      (گارد zoom: اگر vv.scale>۱ باشد کوچک‌شدگی از زوم است نه کیبورد).
  //  • focusin روی ورودی داخل همین صفحه هم نشست را باز می‌کند — فقط وقتی فوکوس
  //    «ناشی از تپِ مستقیم کاربر» باشد (v134): یعنی کیبورد واقعاً باز می‌شود.
  //    فوکوسِ برنامه‌ای (autoFocus اولیه/گذار مرحله/WebOTP) باز نمی‌کند تا
  //    هرگز «صفحهٔ بالا با کیبورد بسته» نداشته باشیم (دو فیکس مالک با هم).
  //  • گذار OPEN (بسته→باز): compact=true + لغو یک‌بارهٔ پن بومی با
  //    window.scrollTo(0,0) + بالا آوردن ورودیِ فعال «فقط اگر واقعاً پوشیده
  //    باشد و فقط داخل اسکرولر auth» در ۱۸۰ms و ۵۰۰ms (اسکرولِ مرکزچینِ
  //    بی‌شرطِ v50 خودش منبع پرش بود — حذف شد).
  //  • گذار CLOSE (باز→بسته): compact=false + بازگردانی idempotent به حالت
  //    طبیعی — همین‌جا + ۲۵۰ms + ۷۰۰ms (فقط اگر هنوز بسته است) → صفحه
  //    «همیشه» به جای قبل برمی‌گردد (شکایت اصلی مالک).
  //  • گارد گذارها: گذار OPEN فقط وقتی معتبر است که document.activeElement یک
  //    input/textarea «داخل همین صفحه» باشد (مثبت‌کاذبِ نوار آدرس/چرخش گوشی
  //    رد می‌شود). گذار CLOSE عمداً بدون گاردِ فوکوس اجرا می‌شود — اندروید با
  //    دکمهٔ Back کیبورد را می‌بندد بدون این‌که blur بدهد؛ دقیقاً همان‌جاست
  //    که بازگردانی لازم است (بازگردانی idempotent است و ضرری ندارد).
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  const [kbCompact, setKbCompact] = useState(false);
  // تشخیص اپ نیتیو (FitUpNative) — دکمهٔ «بازگشت» بالای صفحه فقط در وب دیده می‌شود
  const [isNativeApp, setIsNativeApp] = useState(false);
  // اسکرولر داخلی صفحهٔ احراز هویت — تنها جایی که ماشین‌حالت مجاز به اسکرول است
  const authScrollRef = useRef<HTMLDivElement | null>(null);
  // ریشهٔ صفحهٔ auth — مرز «ورودی‌های این صفحه» برای گارد گذارها + data-auth-screen
  const authRootRef = useRef<HTMLDivElement | null>(null);
  // آینهٔ وضعیت کیبورد برای هندلرها/تایمرها (بدون استال‌کلژور)
  const kbOpenRef = useRef(false);
  // آیا کوچک‌شدن ≥۱۲۰px واقعاً دیده شده؟ گذار CLOSEِ ارتفاعی فقط بعد از آن
  // معنا دارد — وگرنه فاصلهٔ «فوکوس تا پایان انیمیشن کیبورد» CLOSE کاذب می‌زد
  const kbPhysicallyOpenRef = useRef(false);
  // baseline ارتفاع ویوپورت — بیشینهٔ دیده‌شده (فقط رشد می‌کند)
  const baseHeightRef = useRef<number | null>(null);
  // تایمرها — همگی برای cleanup ردگیری می‌شوند
  const openScrollTimersRef = useRef<number[]>([]);
  const closeResetTimersRef = useRef<number[]>([]);
  const focusOutTimerRef = useRef<number>(0);
  // v134 — آخرین تپ واقعی کاربر (هدف + زمان) — مبنای تشخیص «فوکوسِ ناشی از تپ»
  const lastTapRef = useRef<{ el: EventTarget | null; at: number }>({ el: null, at: 0 });

  // بازگردانی اسکرول به جای طبیعی — idempotent (چند بار صدا شدن بی‌ضرر است)
  const resetScrollToNatural = useCallback(() => {
    try {
      window.scrollTo(0, 0);
      document.scrollingElement?.scrollTo?.(0, 0);
      if (authScrollRef.current) authScrollRef.current.scrollTop = 0;
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    // ── تشخیص اپ نیتیو، یک‌بار در mount (دکمهٔ «بازگشت» در اپ رندر نمی‌شود) ──
    setIsNativeApp(!!(window as any).FitUpNative);

    const vv = window.visualViewport;

    const isTextInputEl = (el: Element | null) =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable === true);

    /** ورودی فعالِ «داخل همین صفحه» — منبع حقیقتِ گارد گذارها */
    const activeInputInAuth = (): HTMLElement | null => {
      const el = document.activeElement;
      if (!isTextInputEl(el) || !(el instanceof HTMLElement)) return null;
      if ((el as HTMLInputElement).readOnly) return null;
      const root = authRootRef.current;
      if (!root || !root.contains(el)) return null;
      return el;
    };

    /** ارتفاع لحظه‌ای ویوپورت — تنها نقطهٔ خواندن (رویداد و پول هر دو اینجا) */
    const currentVvHeight = (): number => Math.round(vv?.height ?? window.innerHeight);

    /** ورودی فعال را — فقط اگر واقعاً پوشیده باشد — «فقط داخل اسکرولر auth»
     *  به‌اندازهٔ حداقلِ لازم بالا می‌آورد. نه مرکزچینِ بی‌شرط (منبع پرشِ v50)
     *  و نه هیچ اسکرولی روی window (فقط drift جابه‌جاشده خنثی می‌شود). */
    const ensureFocusedInputVisible = () => {
      const el = activeInputInAuth();
      const sc = authScrollRef.current;
      if (!el || !sc) return;
      try {
        const rect = el.getBoundingClientRect();
        const scRect = sc.getBoundingClientRect();
        const visBottom = (vv?.height ?? window.innerHeight) + (vv?.offsetTop ?? 0);
        const margin = 8;
        // مرز پایین مؤثر = کف اسکرولر یا کف ناحیهٔ دیدنی — هرکدام بالاتر است
        const effBottom = Math.min(scRect.bottom, visBottom) - margin;
        const effTop = Math.max(scRect.top, 0) + margin;
        if (rect.bottom > effBottom) {
          sc.scrollTop += rect.bottom - effBottom;
        } else if (rect.top < effTop) {
          sc.scrollTop -= effTop - rect.top;
        }
        // drift آی‌او‌اس: اگر ویوپورت بصری نسبت به چیدمان جابه‌جا مانده، صفرش کن
        if ((vv?.offsetTop ?? 0) > 1) {
          window.scrollTo(0, 0);
        }
      } catch {
        // noop
      }
    };

    /** گذار OPEN (بسته → باز) — تنها نقطهٔ ورود به حالت کیبورد */
    const doOpen = () => {
      kbOpenRef.current = true;
      setKbCompact(true);
      // لغو یک‌بارهٔ پن بومی (adjustPan) — هدر فشرده، فرم را بالای کیبورد می‌برد
      try {
        window.scrollTo(0, 0);
      } catch {
        // noop
      }
      for (const t of openScrollTimersRef.current) window.clearTimeout(t);
      openScrollTimersRef.current = [
        window.setTimeout(ensureFocusedInputVisible, 180), // میانهٔ انیمیشن کیبورد
        window.setTimeout(ensureFocusedInputVisible, 500), // پس از جاافتادن چیدمان
      ];
    };

    /** گذار CLOSE (باز → بسته) — بازگردانی idempotent: حالا + ۲۵۰ms + ۷۰۰ms */
    const doClose = () => {
      kbOpenRef.current = false;
      kbPhysicallyOpenRef.current = false;
      setKbCompact(false);
      resetScrollToNatural();
      for (const t of closeResetTimersRef.current) window.clearTimeout(t);
      closeResetTimersRef.current = [250, 700].map((delay) =>
        window.setTimeout(() => {
          if (kbOpenRef.current) return; // کیبورد دوباره باز شده — دست نزن
          resetScrollToNatural();
        }, delay)
      );
    };

    /** تنهٔ ماشین‌حالت — «تنها» ورودیِ ارتفاعی؛ رویدادها و پول هر دو همین‌جا */
    const applyViewport = () => {
      const h = currentVvHeight();
      // اتصال ارتفاع ریشه (کیبورد باز → صفحه کوتاه می‌شود؛ کیبورد روی محتوا نمی‌افتد)
      setVvHeight(h);
      // baseline فقط رشد می‌کند — بسته شدن کیبورد/نوار آدرس baseline را پایین نمی‌برد
      if (baseHeightRef.current == null || h > baseHeightRef.current) {
        baseHeightRef.current = h;
      }
      const base = baseHeightRef.current;
      if (base == null) return;
      // زومِ صفحه (pinch) هم ویوپورت را کوچک می‌کند — کیبورد نیست، نادیده بگیر
      const zoomed = (vv?.scale ?? 1) > 1.05;
      const heightOpen = !zoomed && base - h >= 120;

      if (heightOpen) {
        if (activeInputInAuth()) {
          // کوچک‌شدن واقعی ویوپورت + فوکوس روی ورودی این صفحه = کیبورد باز شد
          kbPhysicallyOpenRef.current = true;
          if (!kbOpenRef.current) doOpen();
        }
        // بدون فوکوسِ ورودی این صفحه: مثبت‌کاذب (نوار آدرس/چرخش) — هیچ گذاری
      } else if (kbOpenRef.current && (kbPhysicallyOpenRef.current || !activeInputInAuth())) {
        // کیبورد بسته شد — حتی اگر فوکوس روی ورودی مانده باشد (Back اندروید)؛
        // v134: در WebViewهای بی‌کوچک‌شدگی هم اگر دیگر ورودی‌ای فوکوس ندارد،
        // نشست کیبورد بسته تلقی می‌شود (بازگردانی idempotent — بی‌ضرر).
        doClose();
      }
    };

    /** آیا تپ روی خود ورودی یا پیوندش بوده؟ (والد/فرزند/لیبل متصل با htmlFor)
     *  v134 — بازگردانی داینامیک مالک: تپِ مستقیم روی ورودی = کیبورد می‌آید →
     *  همان لحظه صفحه جمع/بالا برود (رفتار v93 که مالک «قشنگ» می‌خواست).
     *  اما فوکوسِ برنامه‌ای (autoFocus اولیه، گذار شماره→کد، WebOTP/autofill)
     *  تپِ روی ورودی ندارد → کیبورد باز نمی‌شود → صفحه پایین بماند
     *  (فیکس «بالا با کیبورد بسته» مالک هم پابرجا می‌ماند). */
    const tapTargetsInput = (tapEl: Element, input: HTMLElement): boolean => {
      if (tapEl === input || tapEl.contains(input) || input.contains(tapEl)) return true;
      // تپ روی لیبلِ متصل به ورودی (htmlFor یا label.control)
      const tapLabel =
        tapEl instanceof HTMLLabelElement ? tapEl : (tapEl.closest?.("label") as HTMLLabelElement | null);
      if (tapLabel) {
        if (tapLabel.htmlFor && tapLabel.htmlFor === (input as HTMLInputElement).id) return true;
        if (tapLabel.control === input) return true;
      }
      // مسیر معکوس: لیبلی که این ورودی به آن تعلق دارد
      const labels = (input as HTMLInputElement).labels;
      const inputLabel = labels && labels.length > 0 ? labels[0] : null;
      if (inputLabel && (inputLabel === tapEl || inputLabel.contains(tapEl))) return true;
      return false;
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !isTextInputEl(t)) return;
      if ((t as HTMLInputElement).readOnly) return;
      if (!authRootRef.current?.contains(t)) return;
      window.clearTimeout(focusOutTimerRef.current);
      // v134 — تپِ مستقیم کاربر روی ورودی (تا ۱.۵ث قبل از focusin) = کیبورد باز
      // می‌شود → همان لحظه نشست را باز کن (صفحه بالا؛ رفتار داینامیک مالک).
      // WebViewهایی که ویوپورت را کوچک نمی‌کنند (adjustPan) هم پوشش داده می‌شوند
      // — همان جایی که مسیر ارتفاعیِ v133 هیچ‌وقت آتش نمی‌شد و صفحه بالا نمی‌رفت.
      const tap = lastTapRef.current;
      if (Date.now() - tap.at < 1500 && tap.el instanceof Element && tapTargetsInput(tap.el, t)) {
        doOpen();
      }
      ensureFocusedInputVisible();
    };

    const onFocusOut = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!authRootRef.current?.contains(t)) return;
      // تأخیر کوتاه — جابه‌جایی فوکوس بین ورودی‌ها (شماره → کد) نباید فلپ بدهد
      window.clearTimeout(focusOutTimerRef.current);
      focusOutTimerRef.current = window.setTimeout(() => {
        if (activeInputInAuth()) return; // فوکوس به ورودی دیگری از همین صفحه رفته
        // پایان نشست — baseline به ارتفاع لحظه‌ای ریست می‌شود (طبق مشخصهٔ v112)
        baseHeightRef.current = currentVvHeight();
        if (kbOpenRef.current) doClose();
      }, 200);
    };

    // منبع ۰: ثبت تپ واقعی کاربر (capture) — مبنای «فوکوسِ ناشی از تپ» در focusin
    const markTap = (e: Event) => {
      lastTapRef.current = { el: e.target, at: Date.now() };
    };
    window.addEventListener("pointerdown", markTap, true);
    window.addEventListener("touchstart", markTap, true);
    // منبع ۰٫۵ — v134 (فیکس رگرسیون): ثبت دوبارهٔ focusin/focusout.
    // ریشهٔ گزارش مالک ("با باز شدن کیبورد صفحه بالا نمی‌رود"): بازسازی v133
    // بدنهٔ هندلرها را بازنویسی کرد ولی ثبتشان هم حذف شده بود — یعنی در
    // WebViewهایی که ویوپورت را کوچک نمی‌کنند (اپ نیتیو/adjustPan) هیچ مسیری
    // برای باز کردن نشست کیبورد نمی‌ماند. حالا: تپِ مستقیم روی ورودی → doOpen؛
    // خروج فوکوس از ورودی‌های صفحه → doClose (بازگردانی به پایین).
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    // منبع ۱: رویدادهای ویوپورت بصری (کروم/iOS/WebViewهای مدرن)
    vv?.addEventListener("resize", applyViewport);
    vv?.addEventListener("scroll", applyViewport);
    // منبع ۲: پول ۳۵۰ms — WebViewهای بی‌رویداد (اینستاگرام/اپ) + حالت
    // «فوکوس مانده و کیبورد دوباره باز شده بدون focusin تازه» (تپ دوباره)
    const pollId = window.setInterval(applyViewport, 350);
    // مقدار اولیه: baseline و اتصال ارتفاع ریشه از همان اول درست باشند
    applyViewport();
    // v133/v134 — حالت اولیه هرگز با فوکوسِ خودکار جمع نمی‌شود: autoFocus کیبورد
    // باز نمی‌کند و تپِ روی ورودی هم ندارد → صفحه «پایین» می‌ماند (کیبورد بسته =
    // صفحه پایین — خواستهٔ مالک). به‌محض تپ کاربر روی ورودی (focusin + گارد تپ)
    // یا کوچک‌شدن واقعی ویوپورت (applyViewport) نشست باز و صفحه بالا می‌رود؛ و
    // با بسته‌شدن کیبورد هم با doClose دوباره پایین برمی‌گردد.

    return () => {
      window.removeEventListener("pointerdown", markTap, true);
      window.removeEventListener("touchstart", markTap, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", applyViewport);
      vv?.removeEventListener("scroll", applyViewport);
      window.clearInterval(pollId);
      for (const t of openScrollTimersRef.current) window.clearTimeout(t);
      for (const t of closeResetTimersRef.current) window.clearTimeout(t);
      window.clearTimeout(focusOutTimerRef.current);
      // اگر وسط نشست کیبورد صفحه عوض شد، همه‌چیز به حالت طبیعی برگردد
      resetScrollToNatural();
    };
  }, [resetScrollToNatural]);

  // ---- Auto-fill OTP via Web OTP API (Android Chrome) ----
  // و autocomplete="one-time-code" برای iOS/Android system autofill
  // چرخهٔ حیات listener (گاردهای abort):
  // • خروج از مرحلهٔ کد (step تغییر کند) → cleanup → abort ✓
  // • unmount کامپوننت → cleanup → abort ✓
  // • ارسال مجدد کد → otpNonce عوض می‌شود → cleanup قبلی + arm تازه ✓
  //   (listener قبلی یا هنوز منتظر است که abort می‌شود، یا resolve شده که
  //   abort دیگر اثری ندارد — در هر دو حالت promise معلق‌ای نمی‌ماند.)
  useEffect(() => {
    if (step !== "otp") return;
    if (typeof navigator === "undefined") return;

    // Web OTP API — فقط در Android Chrome
    // بررسی دقیق‌تر: بعضی مرورگرها "credentials" دارند اما "OTPCredential" ندارند
    if ("credentials" in navigator && (window as any).OTPCredential) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 120000); // 2min timeout

      (navigator as any).credentials
        .get({
          otp: { transport: ["sms"] },
          signal: abortController.signal,
        })
        .then((otp: any) => {
          clearTimeout(timeout);
          if (otp?.code) {
            // نرمال‌سازی ارقام (فارسی/عربی → لاتین)؛ اگر طولانی‌تر بود،
            // آخرین ۴ رقم (فرمت @origin #code — کد در انتهاست)
            const cleanedCode = extractOtpDigits(otp.code);
            if (cleanedCode.length === 4) {
              setCode(cleanedCode);
            }
          }
        })
        .catch(() => {
          clearTimeout(timeout);
          // User dismissed, timed out, or not supported — ignore
        });

      return () => {
        clearTimeout(timeout);
        abortController.abort();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, otpNonce]);

  // ---- درج خودکار کد از اپ اندروید (SMS Retriever + کلیپ‌بورد — بدون پرمیشن) ----
  // اپ کد را از دو مسیر بدون پرمیشن می‌گیرد و از طریق window.__fitupNativeSmsCode
  // به سایت می‌دهد: ۱) SMS Retriever رسمی گوگل (پیامک با هش اپ امضا شده باشد —
  // ارسال خام sms.ir با SMSIR_LINE)، ۲) کلیپ‌بورد در onResume.
  // v55 — هندلر مقاوم‌تر شد: فقط کدِ خالص نیست؛ متن کامل پیامک هم پذیرفته
  // می‌شود (استخراج آخرین گروه مستقل ۴-رقمی) — بعد از درج، auto-verify
  // (اثر پایین) بلافاصله وارد پنل می‌کند. خواندن مستقیم پیامک (RECEIVE_SMS)
  // عمداً حذف شد — پرمیشن محدودِ اندروید ۱۳+ بود و دیالوگ ترسناک می‌آورد.
  useEffect(() => {
    if (step !== "otp") return;
    (window as any).__fitupNativeSmsCode = (raw: unknown) => {
      try {
        const text = normalizeDigits(String(raw ?? ""));
        // ۱) کد خالص ۴-رقمی
        if (/^\d{4}$/.test(text)) {
          setCode(text);
          setError("");
          return;
        }
        // ۲) گروه مستقل ۴-رقمی داخل متن کامل (متن پیامک/کپی کلیپ‌بورد)
        const matches = text.match(/(?<!\d)\d{4}(?!\d)/g);
        if (matches && matches.length >= 1) {
          setCode(matches[matches.length - 1]);
          setError("");
        }
      } catch {}
    };
    // v31: فعال‌سازی SMS Retriever نیتیو (بدون پرمیشن) — وقتی سرور پیامک را
    // با هش اپ امضا کند (ارسال خام sms.ir)، کد بدون کاربر اتو-درج می‌شود
    startNativeOtpRetriever();
    return () => {
      try {
        delete (window as any).__fitupNativeSmsCode;
      } catch {}
    };
  }, [step]);

  // ---- v56: دکمهٔ «جای‌گذاری کد از کلیپ‌بورد» حذف شد (درخواست مالک) ----
  // گزارش مالک: «هیچ دکمهٔ اضافی نمی‌خوام — کد باید خودکار از پیامک خوانده بشه».
  // مسیرهای اتو-فیل بدون هیچ دکمه‌ای فعال‌اند: SMS Retriever نیتیو (اپ)،
  // WebOTP + Gboard (کروم) و autocomplete="one-time-code" (iOS). پیست دستی
  // داخل خود input هم همچنان کار می‌کند (onPaste زیر).

  // ---- Auto-verify when code is complete (4 digits) ----
  useEffect(() => {
    if (step === "otp" && code.length === 4 && !loading) {
      // Small delay to ensure UI updates before verification
      const t = setTimeout(() => handleVerify(), 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  // ---- Send OTP ----
  async function handleSendOtp(e?: React.FormEvent) {
    e?.preventDefault();
    // گارد تک‌ارسال: Enter در فرم یا دابل‌کلیک نباید دو درخواست بفرستد
    if (sending) return;
    setError("");

    if (!isValidIranMobile(mobile)) {
      setError("شماره موبایل نامعتبر است. مثال: 09123456789");
      toast.error("شماره موبایل نامعتبر است.");
      return;
    }

    setSending(true);
    // 🩹 v45: timeout ۱۲ثانیه‌ای — سمت سرور حالا ≤ ~۹ثانیه جواب می‌دهد؛
    // اگر شبکه قطع شد به‌جای «failed to fetch» خام، پیام فارسی واضح
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      // v57 — کلید bridge اپ (فقط داخل اپ نیتیو مقدار دارد): سرور با تطبیقش
      // کد را در همان پاسخ برمی‌گرداند (bridgeCode) → ورود خودکار از سرور.
      // v63 — کلید هم در هدر و هم در body می‌رود (فال‌بک ضد حذف‌شدن هدر توسط
      // واسط‌های شبکه) + تشخیص APK قدیمی برای لاگ سمت سرور.
      const bridgeKey = getNativeOtpBridgeKey();
      const isNativeApp = !!(window as any).FitUpNative;
      if (isNativeApp && !bridgeKey) {
        // اپ هست ولی کلید bridge ندارد → APK قدیمی قبل از v1.3.0/v1.5.8
        // سرور با لاگ "app بدون کلید bridge" همین را نشان می‌دهد.
        console.warn("[auth] FitUpNative موجود است ولی getOtpBridgeKey ندارد — APK قدیمی");
      }
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bridgeKey ? { "x-fitup-otp-bridge": bridgeKey } : {}),
        },
        body: JSON.stringify({
          mobile,
          ...(bridgeKey ? { otpBridgeKey: bridgeKey } : {}),
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "ارسال کد با خطا مواجه شد.";
        setError(msg);
        toast.error(msg);
        // If resend-too-soon, jump to OTP step anyway and apply the wait time
        if (data?.code === "RESEND_TOO_SOON" && typeof data.waitSeconds === "number") {
          setStep("otp");
          setResendIn(Math.min(RESEND_COOLDOWN_SEC, Math.max(1, data.waitSeconds)));
          // کد قبلی هنوز در راه است — تایمر اعتبارش را هم شروع کن
          setValidityIn(OTP_VALIDITY_FALLBACK_SEC);
        }
        return;
      }
      toast.success("کد ۴ رقمی به شماره شما ارسال شد.");
      setStep("otp");
      setResendIn(RESEND_COOLDOWN_SEC);
      setValidityIn(
        typeof data?.expiresIn === "number" ? data.expiresIn : OTP_VALIDITY_FALLBACK_SEC
      );
      // دور تازهٔ پیامک → listener وب‌OTP برای کد جدید دوباره arm می‌شود
      setOtpNonce((n) => n + 1);
      // v57 — ورود خودکار از سرور (فقط داخل اپ): کد از پاسخ می‌آید، جا می‌افتد
      // و اثر اتو-وریفای بالایی خودش verify می‌کند → کاربر مستقیم وارد پنل می‌شود.
      // setCode بعد از setStep تا اثر auto-verify با step="otp" فعال شود.
      if (typeof data?.bridgeCode === "string" && /^\d{4}$/.test(data.bridgeCode)) {
        setCode(data.bridgeCode);
      } else {
        setCode("");
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "ارسال کد بیش از حد طول کشید. لطفاً اتصال اینترنت را بررسی و دوباره تلاش کنید."
          : err instanceof TypeError
            ? "ارتباط با سرور برقرار نشد. لطفاً اتصال اینترنت را بررسی و دوباره تلاش کنید."
            : err instanceof Error
              ? err.message
              : "خطای ناشناخته";
      setError(msg);
      toast.error(msg);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  // ─── باز کردن اسناد حقوقی (قوانین / حریم خصوصی) از لینک‌های پایین فرم ورود ───
  // v106: URL واقعی — /terms یا /terms?doc=privacy (قبلاً ?screen=terms&doc=…)
  function openLegalDoc(doc: "terms" | "privacy") {
    // v119 — مسیر واقعی SSR /terms (بارگذاری کامل — تک‌نسخه‌سازی)
    window.location.assign(doc === "privacy" ? "/terms?doc=privacy" : "/terms");
  }

  // ---- Resend OTP ----
  async function handleResend() {
    if (resendIn > 0) return;
    setError("");
    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      // v57 — کلید bridge اپ برای ورود خودکار (فقط داخل اپ مقدار دارد)
      // v63 — هم‌چنین در body (فال‌بک ضد حذف هدر)
      const bridgeKey = getNativeOtpBridgeKey();
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bridgeKey ? { "x-fitup-otp-bridge": bridgeKey } : {}),
        },
        body: JSON.stringify({
          mobile,
          ...(bridgeKey ? { otpBridgeKey: bridgeKey } : {}),
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "ارسال مجدد با خطا مواجه شد.";
        if (data?.code === "RESEND_TOO_SOON" && typeof data.waitSeconds === "number") {
          setResendIn(Math.min(RESEND_COOLDOWN_SEC, Math.max(1, data.waitSeconds)));
          toast.error(msg);
          return;
        }
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("کد جدید ارسال شد.");
      setResendIn(RESEND_COOLDOWN_SEC);
      setValidityIn(
        typeof data?.expiresIn === "number" ? data.expiresIn : OTP_VALIDITY_FALLBACK_SEC
      );
      // دور تازهٔ پیامک → listener وب‌OTP برای کد جدید دوباره arm می‌شود
      setOtpNonce((n) => n + 1);
      // v57 — ورود خودکار از سرور در ریسند هم (فقط داخل اپ)
      if (typeof data?.bridgeCode === "string" && /^\d{4}$/.test(data.bridgeCode)) {
        setCode(data.bridgeCode);
      } else {
        setCode("");
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "ارسال کد بیش از حد طول کشید. لطفاً دوباره تلاش کنید."
          : err instanceof TypeError
            ? "ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید."
            : err instanceof Error
              ? err.message
              : "خطای ناشناخته";
      setError(msg);
      toast.error(msg);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  // ---- Verify OTP ----
  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault();
    // گارد تک‌ارسال: Enter/دابل‌کلیک وقتی تأیید در جریان است دوباره نفرستد
    if (loading) return;
    setError("");

    if (code.length !== 4) {
      setError("کد ۴ رقمی را وارد کنید.");
      return;
    }

    setLoading(true);
    try {
      // --- ارسال کد معرفی ذخیره‌شده در localStorage (در صورت وجود) ---
      // این کد در زمان ورود با لینک ?ref=CODE ذخیره شده است.
      let referralCode: string | undefined;
      try {
        const stored = window.localStorage.getItem("fitap_referral_code");
        if (stored) referralCode = stored.trim().toUpperCase();
      } catch {
        // localStorage may be unavailable — silently ignore
      }

      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, code, referralCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "تأیید کد با خطا مواجه شد.";
        setError(msg);
        toast.error(msg);
        setCode(""); // clear OTP on error so user re-types
        return;
      }

      setUser(data);
      toast.success("خوش آمدید! 💪");
      // ─── FIX (بازیابی پرداخت معلق در همان لحظه‌ی لاگین) ───
      // کاربری که در درگاه پرداخت کرده ولی پلنش فعال نشده، معمولاً دوباره
      // لاگین می‌کند «تا ببیند چرا فعال نشده» — همین‌جا استعلام و تحویل خودکار
      // انجام می‌شود (قبلاً این نقطه وجود نداشت و بازیابی به رفرش بعدی می‌افتاد).
      recoverPendingPayments();
      // پاک کردن کد معرفی از localStorage پس از ثبت‌نام موفق
      try {
        window.localStorage.removeItem("fitap_referral_code");
      } catch {}
      // پاک کردن query params (?screen=auth) پس از ورود موفق
      // تا هنگام رفرش، صفحه OTP نمایش داده نشود
      try {
        // URL را به ?screen=panel تغییر بده برای رفرش
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("screen", "panel");
          window.history.replaceState({}, "", url.toString());
        } catch {}
      } catch {}
      // Admin users go directly to the admin panel (skip onboarding + main app)
      if (data.role === "ADMIN") {
        setScreen("admin");
      } else {
        setScreen(data.onboardingDone ? "main" : "onboarding");
        // ─── کاربر با لینک تمدید آمده بود → بعد از لاگین صفحه تمدید باز شود ───
        if (data.onboardingDone) {
          try {
            if (window.sessionStorage.getItem("fitap_open_renewal") === "1") {
              window.sessionStorage.removeItem("fitap_open_renewal");
              setOverlay("renewal");
            }
          } catch {}
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای ناشناخته";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    // FIX (v50/v112): ارتفاع ریشه = ارتفاع لحظه‌ای visualViewport — با باز شدن
    // کیبورد صفحه کوتاه می‌شود و فرم پشت کیبورد گم نمی‌شود (گزارش مالک:
    // ورود از اینستاگرام). در رندر اول ۱۰۰dvh و بعد از mount دقیق می‌شود.
    // v112: data-auth-screen + authRootRef → KeyboardFix سراسری از این صفحه
    // به‌کلردست می‌کشد و ماشین‌حالت v112 همین‌جا همه‌چیز را مدیریت می‌کند.
    <div
      ref={authRootRef}
      data-auth-screen="1"
      className="flex flex-col bg-white relative overflow-hidden"
      style={{ height: vvHeight ? `${vvHeight}px` : "100dvh" }}
    >
      {/* Subtle gold background accents */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute -top-32 -right-24 w-80 h-80 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-72 h-72 rounded-full bg-orange-200/30 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full bg-amber-100/40 blur-3xl" />
      </div>

      {/* بازگشت — خارج از ناحیهٔ اسکرول تا همیشه بالای صفحه بماند.
          v112: در اپ نیتیو (FitUpNative) نمایش داده نمی‌شود (درخواست مالک)؛
          در وب همان رفتار قبل. */}
      {!isNativeApp && (
        <motion.button
          type="button"
          onClick={() => { setScreen("landing"); replaceScreen("landing"); }}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-5 right-5 z-20 flex items-center gap-1 text-slate-500 hover:text-slate-900 transition text-sm"
        >
          بازگشت
          <ChevronLeft className="w-4 h-4" />
        </motion.button>
      )}

      {/* FIX (v112): ناحیهٔ اسکرول داخلی — هدر برند هنگام باز بودن کیبورد
          فشرده می‌شود (kbCompact) و اگر باز هم جا نبود، ماشین‌حالت v112
          ورودیِ فعال را فقط داخل همین اسکرولر و به‌اندازهٔ حداقلِ لازم
          جابه‌جا می‌کند تا هیچ پرش/دوپنشی رخ ندهد. با بستن کیبورد اسکرول
          دقیقاً به حالت طبیعی (بالا) بازگردانی می‌شود. */}
      <div ref={authScrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {/* Brand header — v112: هنگام باز بودن کیبورد (kbCompact از ماشین‌حالت v112)
          فشرده می‌شود تا فرم بالای کیبورد بماند و لوگو/عنوان «فیتاپ» زیر کیبورد نرود */}
      <div
        className={
          kbCompact
            ? "flex-none overflow-hidden flex flex-col items-center justify-center px-6 pt-4 pb-2"
            : "flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center px-6 pt-12 pb-6"
        }
      >

        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className={kbCompact ? "relative mb-2" : "relative mb-5"}
        >
          <div className="absolute inset-0 bg-amber-300/40 blur-2xl rounded-full" />
          <div
            className={
              kbCompact
                ? "relative w-11 h-11 rounded-xl flex items-center justify-center shadow-md overflow-hidden"
                : "relative w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl overflow-hidden"
            }
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={
            kbCompact
              ? "text-xl font-black text-slate-900 text-center mb-0.5"
              : "text-4xl font-black text-slate-900 text-center mb-2"
          }
        >
          فیتاپ
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={
            kbCompact
              ? "hidden"
              : "text-slate-500 text-center text-sm max-w-xs"
          }
        >
          هر بدنی فیتاپ میخواد
        </motion.p>
      </div>

      {/* Form card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="shrink-0 bg-white rounded-t-[2rem] border-2 border-orange-200 shadow-2xl shadow-orange-500/10 px-6 pt-6 pb-10 mx-3 mb-3"
      >
        <AnimatePresence mode="wait">
          {step === "mobile" ? (
            <motion.form
              key="mobile-step"
              onSubmit={handleSendOtp}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-400 mb-2">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px]">
                  ۱
                </span>
                <span>شماره موبایل</span>
                <span className="w-8 h-px bg-slate-200" />
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-[11px]">
                  ۲
                </span>
                <span>تأیید کد</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mobile" className="text-sm font-medium text-slate-700">
                  شماره موبایل
                </Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-orange-400" />
                  {/* v135 — autoFocus این فیلد عمداً حذف شد (دیرکتیو مالک):
                      فوکوسِ برنامه‌ایِ اولیه، اولین تپ واقعی کاربر را «فوکوسِ تکراری»
                      می‌کرد → focusin آتش نمی‌شد → هم فلش «کیبورد باز و بسته شدن»
                      در دفعهٔ اول (اپ + سایت) و هم ماندن فیلد زیر کیبورد در
                      مرورگر اینستاگرام. حالا اولین تپ = focusin واقعی → ماشین‌حالت
                      v134 صفحه را جمع می‌کند و کیبورد باز می‌ماند. */}
                  <Input
                    id="mobile"
                    value={mobile}
                    onChange={(e) =>
                      setMobile(normalizeDigits(e.target.value).replace(/[^\d]/g, "").slice(0, 11))
                    }
                    placeholder="09123456789"
                    inputMode="numeric"
                    dir="ltr"
                    className="pr-11 h-14 rounded-xl text-left bg-white border-2 border-orange-100 focus-visible:border-orange-400 focus-visible:ring-orange-300/40 text-slate-900 placeholder:text-slate-400 text-lg tracking-wider"
                    autoComplete="tel"
                    required
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  aria-live="polite"
                  className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-center"
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={sending || !isValidIranMobile(mobile)}
                className="w-full h-14 rounded-2xl text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-orange-500/40 disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    در حال ارسال...
                  </span>
                ) : (
                  <>
                    <MessageSquare className="w-4 h-4" />
                    ارسال کد
                  </>
                )}
              </button>

              <div className="flex items-center gap-2 justify-center text-xs text-slate-500 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />
                <span>کد ۴ رقمی از طریق پیامک برای شما ارسال می‌شود</span>
              </div>
            </motion.form>
          ) : (
            <motion.form
              key="otp-step"
              onSubmit={handleVerify}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-400 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep("mobile");
                    setCode("");
                    setError("");
                    setResendIn(0);
                  }}
                  className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] hover:bg-orange-600 transition"
                  aria-label="بازگشت به مرحله شماره موبایل"
                >
                  ۱
                </button>
                <span>شماره موبایل</span>
                <span className="w-8 h-px bg-orange-200" />
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px]">
                  ۲
                </span>
                <span className="text-slate-700">تأیید کد</span>
              </div>

              <div className="space-y-3 text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-medium">
                  <Phone className="w-3.5 h-3.5" />
                  <span dir="ltr" className="tracking-wider">
                    {mobile}
                  </span>
                </div>
                <p className="text-sm text-slate-600">
                  کد ۴ رقمی ارسال‌شده به شماره بالا را وارد کنید
                </p>
              </div>

              {/* ─── OTP: یک input واقعی، مرئی و مستقل ───
                  ریشهٔ «کد اتو-پر نمی‌شود و Gboard هم پیشنهاد نمی‌دهد» همین بود:
                  InputOTP (کتابخانه input-otp) چهار خانهٔ نمایشی می‌سازد ولی input
                  واقعی‌اش یک proxy نامرئی است — Android autofill/Gboard/WebOTP
                  نمی‌توانند فیلد مخفی را هدف بگیرند. حالا یک input استانداردِ
                  واقعی و مرئی است؛ با autoComplete="one-time-code" هر سه مسیر
                  بدون هیچ پرمیشنی فعال می‌شوند:
                  • Gboard/کیبورد سامسونگ: نوار پیشنهاد «کد» بالای کیبورد
                  • Android Chrome: WebOTP (اثر پایین) + autofill یک‌لمسی
                  • iOS: نوار QuickType «از پیام‌ها» */}
              <div className="flex justify-center py-2" dir="ltr">
                <label htmlFor="otp-input" className="sr-only">
                  کد پیامک‌شده
                </label>
                <input
                  ref={otpInputRef}
                  id="otp-input"
                  name="otp"
                  type="text"
                  dir="ltr"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(extractOtpDigits(e.target.value))}
                  onPaste={(e) => {
                    // پیست کل متن پیامک هم کار می‌کند: ارقام استخراج و
                    // «آخرین ۴ رقم» برداشته می‌شود (کد در انتهای متن پیامک است)
                    e.preventDefault();
                    const digits = extractOtpDigits(e.clipboardData?.getData("text") ?? "");
                    if (digits) setCode(digits);
                  }}
                  disabled={loading}
                  placeholder="••••"
                  className="w-44 h-16 text-2xl font-black text-center tracking-[0.6em] indent-[0.6em] rounded-xl border-2 border-orange-100 bg-white text-slate-900 placeholder:text-slate-300 focus:border-orange-400 focus:outline-none focus:ring-4 focus:ring-orange-300/30 disabled:opacity-60 transition-colors"
                />
              </div>

              {/* ── v56: دکمهٔ جای‌گذاری از کلیپ‌بورد حذف شد (درخواست مالک) —
                  اتو-فیل مسیرهای خودکار فعال است و پیست دستی داخل input کار می‌کند ── */}

              {/* ── شمارش معکوس اعتبار کد (۱۰ دقیقه) ──
                  کاربر می‌بیند کد هنوز معتبر است حتی وقتی پیامک دیر رسید؛
                  و وقتی تمام شد پیام واضح «منقضی شد» + راهنمای ریسند. */}
              {step === "otp" && validityIn != null && validityIn > 0 && (
                <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-orange-500" />
                  کد تا
                  <span dir="ltr" className="font-black text-slate-700 tabular-nums">
                    {formatCountdown(validityIn)}
                  </span>
                  دیگر معتبر است
                </p>
              )}
              {step === "otp" && validityIn === 0 && (
                <p className="text-center text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  ⏰ اعتبار کد به پایان رسید — دکمه «ارسال مجدد کد» را بزنید
                </p>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  aria-live="polite"
                  className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-center"
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full h-14 rounded-2xl text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-orange-500/40 disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    در حال تأیید...
                  </span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    تأیید و ورود
                  </>
                )}
              </button>

              {/* Resend + change number */}
              <div className="flex flex-col items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendIn > 0 || sending}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700 disabled:text-slate-400 disabled:cursor-not-allowed transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${sending ? "animate-spin" : ""}`} />
                  {resendIn > 0
                    ? `ارسال مجدد کد (${resendIn} ثانیه)`
                    : "ارسال مجدد کد"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("mobile");
                    setCode("");
                    setError("");
                    setResendIn(0);
                    setValidityIn(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 transition"
                >
                  تغییر شماره موبایل
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="shrink-0 px-6 pb-6 text-center text-xs text-slate-400 leading-relaxed">
        ورود شما به معنای پذیرش{" "}
        <button
          onClick={() => openLegalDoc("terms")}
          className="font-bold text-orange-600 hover:text-orange-700 underline underline-offset-2 transition"
        >
          شرایط و قوانین
        </button>{" "}
        و{" "}
        <button
          onClick={() => openLegalDoc("privacy")}
          className="font-bold text-orange-600 hover:text-orange-700 underline underline-offset-2 transition"
        >
          سیاست حفظ حریم خصوصی
        </button>{" "}
        فیتاپ است.
      </div>
      </div>
    </div>
  );
}
