"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  Crown,
  Download,
  Dumbbell,
  ExternalLink,
  Flame,
  Home,
  Lightbulb,
  RotateCcw,
  Sparkles,
  User,
  UserRound,
} from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  FREE_DAYS_HINTS,
  FREE_DAYS_LABELS,
  FREE_GENDER_LABELS,
  FREE_GOAL_LABELS,
  FREE_GOAL_META,
  FREE_GOAL_SHORT,
  getFreeProgram,
  getFreeProgramById,
  type FreeDays,
  type FreeGender,
  type FreeGoal,
  type FreeProgram,
} from "@/lib/fitness/free-programs-data";

/**
 * ─── v246-free-programs — انتخاب‌گر و نمایش‌گر «برنامه‌های بدنسازی رایگان» ───
 *
 * قیف جذب کاربر (/free-programs): کاربر بدون ثبت‌نام جنسیت ← هدف ← تعداد روز را
 * انتخاب می‌کند و برنامهٔ کامل (دترمینیستیک از کاتالوگ کیوریت‌شدهٔ
 * free-programs-data) با جدول ست/تکرار/استراحت، نکات تغذیه و دکمهٔ
 * «دانلود عکس برنامه» (کانواس خالص — الگوی route-snapshot، بدون html2canvas)
 * می‌گیرد. هیچ فراخوانی احراز هویت یا API ندارد و کاملاً logged-out کار می‌کند.
 *
 * CTAها: «دریافت برنامهٔ اختصاصی حرفه‌ای» → /?screen=auth (همان مسیر ورود/
 * آنبوردینگ که CTAهای لندینگ استفاده می‌کنند) و «مشاهدهٔ پلن‌های اشتراک» →
 * /#pricing (سکشن پلن‌های صفحهٔ اصلی — دیرکتیو مالک v247).
 */

// ═══════════════════════════════════════════════════════════════════
//  کانواس — دانلود عکس برنامه (۱۰۸۰×N) با متن فارسی وزیرمتن
// ═══════════════════════════════════════════════════════════════════

/**
 * بارگذاری فونت وزیرمتن برای کانواس. فونت سایت با next/font/local لود می‌شود و
 * نام خانوادهٔ واقعی آن هش‌دار است — پس خانوادهٔ محاسبه‌شدهٔ body را می‌خوانیم و
 * با document.fonts.load صریح لودش می‌کنیم. هر شکستی غیرمرگبار است: فال‌بک
 * سیستم (Tahoma) هم متن فارسی را کامل رندر می‌کند.
 */
async function loadCanvasFont(): Promise<string> {
  // v246-free-programs — آماده‌سازی فونت کانواس
  try {
    const computed =
      typeof document !== "undefined" && document.body
        ? getComputedStyle(document.body).fontFamily
        : "";
    const candidates = [computed, "Vazirmatn"].filter(Boolean) as string[];
    for (const fam of candidates) {
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load(`400 32px ${fam}`),
            document.fonts.load(`700 32px ${fam}`),
            document.fonts.load(`900 32px ${fam}`),
          ]),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
        if (document.fonts.check(`700 32px ${fam}`)) return fam;
      } catch {
        // فونت بعدی را امتحان کن
      }
    }
  } catch {
    // محیط بدون FontFaceSet — فال‌بک
  }
  return "Tahoma, sans-serif";
}

/** شکستن متن فارسی به خط‌های هم‌عرض — برای تیترها و نکات */
function wrapFaText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** بریدن متن با «…» اگر از عرض مجاز بیرون زد */
function ellipsisFa(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

// v246-free-programs — رندر پوستر برنامه (الگوی route-snapshot: خروجی Blob یا null، بدون throw)
/**
 * v252 — export برای استفادهٔ مشترک: دکمهٔ «دانلود عکس برنامه» در صفحهٔ
 * اختصاصی هر برنامه (/free-programs/[slug] — درخواست مالک) هم از همین
 * رندرکنندهٔ کانواس استفاده می‌کند تا عکس هر دو مسیر کاملاً یکسان باشد.
 */
export async function renderProgramImage(program: FreeProgram): Promise<Blob | null> {
  try {
    const W = 1080;
    const PAD = 56;

    const fam = await loadCanvasFont();
    const fa = (weight: number, size: number) => `${weight} ${size}px ${fam}`;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.direction = "rtl";

    // ── فاز ۱: اندازه‌گیری ارتفاع کل (قبل از تنظیم height — تنظیم height ریست می‌کند) ──
    // هدر داینامیک است: اگر تیتر برنامه ۲ خط شد، ارتفاع هدر رشد می‌کند تا خط
    // متادیتا هرگز از قاب بیرون نزند (ممیزی v246-free-programs)
    ctx.font = fa(900, 52);
    const titleLineCount = Math.min(wrapFaText(ctx, program.title, W - PAD * 2).length, 2);
    const HEADER_H = 208 + 68 * titleLineCount + 26 + 52;
    const DAY_HEADER_H = 88;
    const ROW_H = 66;
    const ROW_H_NOTE = 94;
    // v247 — فوتر بلندتر: CTA خرید برنامهٔ اختصاصی + آدرس سایت (دیرکتیو مالک)
    const FOOTER_H = 186;

    let totalH = HEADER_H + FOOTER_H;
    const dayRowHeights: number[][] = program.split.map((day) =>
      day.exercises.map((ex) => (ex.note ? ROW_H_NOTE : ROW_H))
    );
    for (const rows of dayRowHeights) {
      totalH += DAY_HEADER_H + rows.reduce((a, b) => a + b, 0);
    }

    // نکات — با شکست خط اندازه‌گیری می‌شود
    const tipsInnerW = W - PAD * 2 - 96;
    ctx.font = fa(400, 26);
    const tipLines: string[][] = program.tips.map((t) => wrapFaText(ctx, t, tipsInnerW));
    const tipLineCount = tipLines.reduce((a, l) => a + l.length, 0);
    const TIPS_H = 130 + tipLineCount * 42 + (program.tips.length - 1) * 16;
    totalH += TIPS_H + 56;

    canvas.height = totalH; // ریست کانتکست — همهٔ استایل‌ها از اینجا دوباره ست می‌شوند
    ctx.direction = "rtl";
    ctx.textBaseline = "alphabetic";

    // ── فاز ۲: رسم ──

    // پس‌زمینه
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, totalH);

    // هدر برند (گرادیان تیرهٔ فیتاپ + هالهٔ نارنجی)
    const hg = ctx.createLinearGradient(0, 0, W, HEADER_H);
    hg.addColorStop(0, "#0f172a");
    hg.addColorStop(1, "#1e293b");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, HEADER_H);
    const glow = ctx.createRadialGradient(W * 0.18, 0, 0, W * 0.18, 0, 320);
    glow.addColorStop(0, "rgba(249,115,22,0.35)");
    glow.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, HEADER_H);

    ctx.textAlign = "right";
    ctx.font = fa(900, 40);
    ctx.fillStyle = "#fb923c";
    ctx.fillText("فیتاپ", W - PAD, 88);
    ctx.font = fa(700, 24);
    ctx.fillStyle = "rgba(226,232,240,0.8)";
    ctx.fillText("برنامه‌های بدنسازی رایگان", W - PAD, 128);

    // v247 — آدرس سایت در هدر (سمت چپ)
    ctx.textAlign = "left";
    ctx.font = fa(900, 30);
    ctx.fillStyle = "#fb923c";
    ctx.fillText("fittup.ir", PAD, 88);
    ctx.font = fa(400, 20);
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.fillText("دریافت برنامهٔ اختصاصی", PAD, 122);

    // تیتر برنامه (حداکثر ۲ خط)
    ctx.font = fa(900, 52);
    ctx.fillStyle = "#ffffff";
    const titleLines = wrapFaText(ctx, program.title, W - PAD * 2).slice(0, 2);
    let ty = 208;
    for (const line of titleLines) {
      ctx.fillText(line, W - PAD, ty);
      ty += 68;
    }

    // خط متادیتا — همیشه داخل قاب هدر (HEADER_H داینامیک)
    ctx.font = fa(700, 27);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(
      `${FREE_GENDER_LABELS[program.gender]} • ${FREE_GOAL_LABELS[program.goal]} • ${FREE_DAYS_LABELS[program.days]} در هفته • سطح: ${program.level}`,
      W - PAD,
      Math.min(ty + 26, HEADER_H - 40)
    );

    // نوار نارنجی زیر هدر
    const accent = ctx.createLinearGradient(0, 0, W, 0);
    accent.addColorStop(0, "#f97316");
    accent.addColorStop(1, "#f59e0b");
    ctx.fillStyle = accent;
    ctx.fillRect(0, HEADER_H - 8, W, 8);

    // ── روزها ──
    let y = HEADER_H;
    program.split.forEach((day, dayIdx) => {
      // سربرگ روز
      const dg = ctx.createLinearGradient(0, y, W, y + DAY_HEADER_H);
      dg.addColorStop(0, "#f59e0b");
      dg.addColorStop(1, "#f97316");
      ctx.fillStyle = dg;
      ctx.fillRect(0, y, W, DAY_HEADER_H);

      // شمارهٔ روز (چپ، محو)
      ctx.textAlign = "center";
      ctx.font = fa(900, 64);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(toPersianDigits(dayIdx + 1), PAD + 44, y + DAY_HEADER_H - 24);

      // تیتر روز (راست)
      ctx.textAlign = "right";
      ctx.font = fa(900, 34);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(ellipsisFa(ctx, day.title, W - PAD * 2 - 140), W - PAD, y + 56);
      y += DAY_HEADER_H;

      // ردیف حرکات
      day.exercises.forEach((ex, i) => {
        const rh = dayRowHeights[dayIdx][i];
        ctx.fillStyle = i % 2 === 1 ? "#fff8f1" : "#ffffff";
        ctx.fillRect(0, y, W, rh);

        const midY = y + rh / 2;

        // ستون‌های چپ: استراحت / تکرار / ست
        const cols: Array<{ x: number; label: string; value: string }> = [
          { x: PAD + 60, label: "استراحت", value: ex.rest },
          { x: PAD + 250, label: "تکرار", value: ex.reps },
          { x: PAD + 440, label: "ست", value: ex.sets },
        ];
        const colLabelY = rh >= ROW_H_NOTE ? midY - 20 : midY - 8;
        const colValueY = rh >= ROW_H_NOTE ? midY + 24 : midY + 22;
        for (const c of cols) {
          ctx.textAlign = "center";
          ctx.font = fa(400, 20);
          ctx.fillStyle = "#94a3b8";
          ctx.fillText(c.label, c.x, colLabelY);
          ctx.font = fa(700, 27);
          ctx.fillStyle = "#334155";
          ctx.fillText(ellipsisFa(ctx, c.value, 170), c.x, colValueY);
        }

        // شمارهٔ ردیف (دایرهٔ نارنجی روشن)
        const circleY = ex.note ? midY - 12 : midY;
        ctx.beginPath();
        ctx.arc(W - PAD - 22, circleY, 21, 0, Math.PI * 2);
        ctx.fillStyle = "#ffedd5";
        ctx.fill();
        ctx.textAlign = "center";
        ctx.font = fa(700, 24);
        ctx.fillStyle = "#c2410c";
        ctx.fillText(toPersianDigits(i + 1), W - PAD - 22, circleY + 9);

        // نام حرکت (راست)
        ctx.textAlign = "right";
        ctx.font = fa(700, 29);
        ctx.fillStyle = "#0f172a";
        const nameY = ex.note ? midY - 12 : midY + 10;
        ctx.fillText(ellipsisFa(ctx, ex.name, 360), W - PAD - 60, nameY);

        // یادداشت (زیر نام)
        if (ex.note) {
          ctx.font = fa(400, 23);
          ctx.fillStyle = "#64748b";
          ctx.fillText(ellipsisFa(ctx, ex.note, 380), W - PAD - 60, midY + 26);
        }

        // خط جداکننده
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y + rh);
        ctx.lineTo(W, y + rh);
        ctx.stroke();

        y += rh;
      });
    });

    // ── نکات تغذیه و استراحت ──
    y += 28;
    const bx = PAD;
    const bw = W - PAD * 2;
    ctx.fillStyle = "#fff7ed";
    ctx.strokeStyle = "#fed7aa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    // roundRect دستی — برای WebViewهای قدیمی که ctx.roundRect ندارند
    const r = 26;
    ctx.moveTo(bx + r, y);
    ctx.arcTo(bx + bw, y, bx + bw, y + TIPS_H, r);
    ctx.arcTo(bx + bw, y + TIPS_H, bx, y + TIPS_H, r);
    ctx.arcTo(bx, y + TIPS_H, bx, y, r);
    ctx.arcTo(bx, y, bx + bw, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.font = fa(900, 30);
    ctx.fillStyle = "#c2410c";
    ctx.fillText("نکات مهم برنامه (تغذیه و استراحت)", W - PAD - 44, y + 58);

    let ly = y + 108;
    for (const lines of tipLines) {
      // گلولهٔ نارنجی
      ctx.beginPath();
      ctx.arc(W - PAD - 52, ly - 10, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
      ctx.font = fa(400, 26);
      ctx.fillStyle = "#7c2d12";
      for (const line of lines) {
        ctx.fillText(line, W - PAD - 78, ly);
        ly += 42;
      }
      ly += 16;
    }
    y += TIPS_H + 28;

    // ── فوتر برند + CTA (v247 — دیرکتیو مالک: هدر فیتاپ + آدرس سایت + CTA خرید برنامهٔ اختصاصی) ──
    const fg = ctx.createLinearGradient(0, totalH - FOOTER_H, 0, totalH);
    fg.addColorStop(0, "#1e293b");
    fg.addColorStop(1, "#0f172a");
    ctx.fillStyle = fg;
    ctx.fillRect(0, totalH - FOOTER_H, W, FOOTER_H);

    // هالهٔ نارنجی از پایین
    const fglow = ctx.createRadialGradient(W / 2, totalH, 0, W / 2, totalH, 460);
    fglow.addColorStop(0, "rgba(249,115,22,0.30)");
    fglow.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = fglow;
    ctx.fillRect(0, totalH - FOOTER_H, W, FOOTER_H);

    // خط ۱ — دعوت
    ctx.textAlign = "center";
    ctx.font = fa(900, 30);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("می‌خواهی برنامه‌ات دقیقاً برای بدن خودت ساخته شود؟", W / 2, totalH - FOOTER_H + 54);

    // خط ۲ — دکمهٔ CTA (پیل گرادیان نارنجی)
    const ctaText = "دریافت برنامهٔ اختصاصی از fittup.ir";
    ctx.font = fa(900, 31);
    const ctaW = Math.min(ctx.measureText(ctaText).width + 104, W - PAD * 2);
    const ctaH = 70;
    const ctaX = (W - ctaW) / 2;
    const ctaY = totalH - FOOTER_H + 80;
    const ctaGrad = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY + ctaH);
    ctaGrad.addColorStop(0, "#f59e0b");
    ctaGrad.addColorStop(1, "#f97316");
    ctx.fillStyle = ctaGrad;
    // roundRect دستی — سازگار با WebViewهای قدیمی
    const cr = 35;
    ctx.beginPath();
    ctx.moveTo(ctaX + cr, ctaY);
    ctx.arcTo(ctaX + ctaW, ctaY, ctaX + ctaW, ctaY + ctaH, cr);
    ctx.arcTo(ctaX + ctaW, ctaY + ctaH, ctaX, ctaY + ctaH, cr);
    ctx.arcTo(ctaX, ctaY + ctaH, ctaX, ctaY, cr);
    ctx.arcTo(ctaX, ctaY, ctaX + ctaW, ctaY, cr);
    ctx.closePath();
    ctx.fill();
    // سایهٔ متن دکمه
    ctx.fillStyle = "rgba(124,45,18,0.35)";
    ctx.fillText(ctaText, W / 2, ctaY + ctaH / 2 + 12);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ctaText, W / 2, ctaY + ctaH / 2 + 11);

    // خط ۳ — آدرس سایت + برند
    ctx.font = fa(700, 24);
    ctx.fillStyle = "rgba(226,232,240,0.9)";
    ctx.fillText("fittup.ir  •  برنامه‌های بدنسازی رایگان فیتاپ", W / 2, totalH - 18);

    // ── خروجی PNG ──
    return await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), "image/png", 0.92);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  کامپوننت کلاینت
// ═══════════════════════════════════════════════════════════════════

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

const GOAL_ICONS: Record<FreeGoal, typeof Dumbbell> = {
  "muscle-gain": Dumbbell,
  "fat-loss": Flame,
  glutes: Sparkles,
  home: Home,
};

const ALL_GOALS: FreeGoal[] = ["muscle-gain", "fat-loss", "glutes", "home"];
const ALL_GENDERS: FreeGender[] = ["male", "female"];
// v247 — چهار طول برنامه: ۳/۴/۵/۶ روز (۳۲ برنامهٔ کاتالوگ)
const ALL_DAYS: FreeDays[] = [3, 4, 5, 6];

export function FreeProgramsClient() {
  // ─── انتخاب‌های قیف (بدون پیش‌فرض — کاربر خودش انتخاب می‌کند) ───
  const [gender, setGender] = useState<FreeGender | null>(null);
  const [goal, setGoal] = useState<FreeGoal | null>(null);
  const [days, setDays] = useState<FreeDays | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  // برنامهٔ زنده — دترمینیستیک از کاتالوگ
  const program: FreeProgram | null = useMemo(
    () => (gender && goal && days ? getFreeProgram(goal, gender, days) : null),
    [gender, goal, days]
  );

  // اسکرول نرم به نمایش‌گر پس از تغییر انتخاب (فقط وقتی برنامه عوض می‌شود)
  const scrollToViewer = useCallback(() => {
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // v247-fix (بازخورد TEST-B) — اسکرول خودکار فقط وقتی انتخاب «برای اولین بار»
  // کامل می‌شود، نه هنگام تغییرِ یک گزینه در انتخابِ ازقبل-کامل: اسکرول انیمیشنی
  // وسط تعامل کاربر با انتخاب‌گر، کلیک بعدی را قربانی می‌کرد (فرود روی دکمهٔ اشتباه).
  const wasCompleteRef = useRef(false);
  useEffect(() => {
    const complete = !!(gender && goal && days);
    if (complete && !wasCompleteRef.current) {
      Promise.resolve().then(() => scrollToViewer());
    }
    wasCompleteRef.current = complete;
  }, [gender, goal, days, scrollToViewer]);

  // v246-free-programs — دیپ‌لینک #p=<id> (از کارت‌های سکشن‌های هدف)
  useEffect(() => {
    function applyHash(scroll: boolean) {
      try {
        const m = /^#p=([\w-]+)$/.exec(window.location.hash || "");
        if (!m) return;
        const p = getFreeProgramById(m[1]);
        if (!p) return;
        setGender(p.gender);
        setGoal(p.goal);
        setDays(p.days);
        if (scroll) {
          Promise.resolve().then(() => scrollToViewer());
        }
      } catch {}
    }
    applyHash(true);
    const onHash = () => applyHash(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [scrollToViewer]);

  // هم‌گام‌کردن هش با انتخاب فعلی (بدون پرش اسکرول — replaceState)
  useEffect(() => {
    if (typeof window === "undefined" || !program) return;
    try {
      window.history.replaceState(null, "", `#p=${program.id}`);
    } catch {}
  }, [program]);

  // دانلود عکس برنامه — کانواس خالص (بدون html2canvas)
  const handleDownload = useCallback(async () => {
    if (!program || downloading) return;
    setDownloading(true);
    try {
      const blob = await renderProgramImage(program);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fittup-${program.id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 3000);
      }
    } finally {
      setDownloading(false);
    }
  }, [program, downloading]);

  const reset = () => {
    setGender(null);
    setGoal(null);
    setDays(null);
  };

  return (
    // v247-fix (بازخورد TEST-B) — pb-24 موبایل: نوار CTA چسبان پایین صفحه
    // (~۷۳px + safe-area) دیگر روی محتوای انتهایی/دکمه‌های انتخاب‌گر نمی‌افتد
    <div className="space-y-10 pb-24 md:pb-0">
      {/* ═══ انتخاب‌گر ۳ مرحله‌ای ═══ */}
      <section aria-label="ساخت برنامهٔ رایگان" className="space-y-6">
        {/* مرحله ۱ — جنسیت */}
        <div>
          <StepTitle n={1} label="جنسیت" done={!!gender} />
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {ALL_GENDERS.map((g) => {
              const Icon = g === "male" ? User : UserRound;
              const active = gender === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setGender(g);
                  }}
                  aria-pressed={active}
                  className={`relative flex flex-col items-center gap-2 rounded-3xl border-2 p-5 sm:p-6 transition-all min-h-[96px] ${
                    active
                      ? "border-orange-400 bg-orange-50 shadow-lg shadow-orange-500/10 scale-[1.01]"
                      : "border-orange-100 bg-white hover:border-orange-300 hover:shadow-md"
                  }`}
                >
                  {active && (
                    <span className="absolute top-3 left-3 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: goldGradient }}>
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                  <Icon className={`w-8 h-8 ${active ? "text-orange-500" : "text-slate-400"}`} strokeWidth={2.2} />
                  <span className={`font-black text-base sm:text-lg ${active ? "text-orange-600" : "text-slate-700"}`}>
                    {FREE_GENDER_LABELS[g]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* مرحله ۲ — هدف */}
        <div>
          <StepTitle n={2} label="هدف" done={!!goal} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {ALL_GOALS.map((g) => {
              const Icon = GOAL_ICONS[g];
              const active = goal === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setGoal(g);
                  }}
                  aria-pressed={active}
                  className={`relative group rounded-3xl border-2 overflow-hidden text-right transition-all ${
                    active
                      ? "border-orange-400 shadow-lg shadow-orange-500/10 scale-[1.01]"
                      : "border-orange-100 bg-white hover:border-orange-300 hover:shadow-md"
                  }`}
                >
                  <div className="relative h-24 sm:h-28 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={FREE_GOAL_META[g].imageDefault}
                      alt={FREE_GOAL_META[g].imageAlt}
                      loading="lazy"
                      className={`w-full h-full object-cover transition-transform duration-300 ${active ? "scale-105" : "group-hover:scale-105"}`}
                    />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(15,23,42,0) 30%, rgba(15,23,42,0.55))" }} />
                    {active && (
                      <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full flex items-center justify-center text-white shadow-md" style={{ background: goldGradient }}>
                        <Check className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                  <div className="p-3.5 sm:p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-5 h-5 shrink-0 ${active ? "text-orange-500" : "text-slate-400"}`} />
                      <span className={`font-black text-sm sm:text-base leading-snug ${active ? "text-orange-600" : "text-slate-800"}`}>
                        {FREE_GOAL_LABELS[g]}
                      </span>
                    </div>
                    <p className="hidden sm:block text-[11px] text-slate-500 leading-relaxed">{FREE_GOAL_META[g].shortPitch}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* مرحله ۳ — تعداد روز (v247: چهار گزینهٔ ۳/۴/۵/۶ روزه) */}
        <div>
          <StepTitle n={3} label="تعداد روز تمرین در هفته" done={!!days} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-2xl">
            {ALL_DAYS.map((d) => {
              const active = days === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDays(d);
                  }}
                  aria-pressed={active}
                  className={`relative flex flex-col items-center gap-1.5 rounded-3xl border-2 p-5 transition-all min-h-[96px] ${
                    active
                      ? "border-orange-400 bg-orange-50 shadow-lg shadow-orange-500/10 scale-[1.01]"
                      : "border-orange-100 bg-white hover:border-orange-300 hover:shadow-md"
                  }`}
                >
                  {active && (
                    <span className="absolute top-3 left-3 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: goldGradient }}>
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                  <span className={`font-black text-2xl ${active ? "text-orange-600" : "text-slate-800"}`}>
                    {FREE_DAYS_LABELS[d]}
                  </span>
                  <span className="text-[11px] text-slate-500 text-center leading-snug">{FREE_DAYS_HINTS[d]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ریست */}
        {(gender || goal || days) && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-orange-600 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            شروع دوبارهٔ انتخاب‌ها
          </button>
        )}
      </section>

      {/* ═══ نمایش‌گر برنامه ═══ */}
      <section ref={viewerRef} id="program-viewer" aria-label="برنامهٔ تمرینی انتخابی" className="scroll-mt-24">
        {!program ? (
          // حالت خالی — دعوت به انتخاب
          <div className="rounded-3xl border-2 border-dashed border-orange-200 bg-orange-50/40 p-8 sm:p-12 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: goldGradient }}>
              <Dumbbell className="w-8 h-8 text-white" />
            </div>
            <h3 className="font-black text-lg text-slate-800 mb-2">برنامه‌ات را بساز</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              سه مرحلهٔ بالا را کامل کن تا برنامهٔ کامل تمرینی با ست، تکرار و استراحت دقیق هر حرکت همین‌جا نمایش داده شود — کاملاً رایگان و بدون ثبت‌نام.
            </p>
          </div>
        ) : (
          <article className="space-y-6">
            {/* سربرگ برنامه با تصویر هدف */}
            <div className="relative rounded-3xl overflow-hidden border-2 border-orange-100">
              <div className="relative h-44 sm:h-56">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={program.image} alt={program.imageAlt} className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(15,23,42,0.15) 0%, rgba(15,23,42,0.82) 100%)" }} />
                <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 text-white">
                  <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full mb-2 font-bold" style={{ background: goldGradient }}>
                    <Sparkles className="w-3.5 h-3.5" />
                    برنامهٔ رایگان فیتاپ
                  </span>
                  <h3 className="text-xl sm:text-2xl font-black mb-1 leading-snug">{program.title}</h3>
                  <p className="text-xs sm:text-sm text-white/85 leading-relaxed max-w-2xl">{program.description}</p>
                </div>
              </div>
              {/* بج‌های متادیتا */}
              <div className="flex flex-wrap items-center gap-2 p-4 bg-white">
                <MetaBadge label="جنسیت" value={FREE_GENDER_LABELS[program.gender]} />
                <MetaBadge label="هدف" value={FREE_GOAL_LABELS[program.goal]} />
                <MetaBadge label="روزها" value={`${FREE_DAYS_LABELS[program.days]} در هفته`} />
                <MetaBadge label="سطح" value={program.level} />
                <MetaBadge label="جلسات" value={`${toPersianDigits(program.split.length)} جلسهٔ هفتگی`} />
                {/* v250 — لینک داخلی سئو به صفحهٔ اختصاصی همین برنامه (/free-programs/<id>) */}
                <Link
                  href={`/free-programs/${program.id}`}
                  className="mr-auto inline-flex items-center gap-1 text-[11px] font-black text-orange-600 hover:text-orange-700 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  صفحهٔ اختصاصی برنامه
                </Link>
              </div>
            </div>

            {/* روزها — جدول ست/تکرار/استراحت (v247: برنامه‌های ۴ روز و بیشتر دو ستونه) */}
            <div className={`grid gap-4 ${program.days >= 4 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
              {program.split.map((day, di) => (
                <div key={day.title} className="rounded-2xl border border-orange-100 bg-white overflow-hidden flex flex-col">
                  <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: goldGradient }}>
                    <span className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-xs font-black shrink-0">
                      {toPersianDigits(di + 1)}
                    </span>
                    <h4 className="font-black text-sm leading-snug">{day.title}</h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="text-slate-400 text-[10px] border-b border-orange-50">
                          <th scope="col" className="px-3 py-2 font-bold">حرکت</th>
                          <th scope="col" className="px-2 py-2 font-bold text-center w-12">ست</th>
                          <th scope="col" className="px-2 py-2 font-bold text-center w-16">تکرار</th>
                          <th scope="col" className="px-2 py-2 font-bold text-center w-20">استراحت</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.exercises.map((ex, i) => (
                          <tr key={`${ex.name}-${i}`} className={i % 2 === 1 ? "bg-orange-50/40" : "bg-white"}>
                            <td className="px-3 py-2.5">
                              <span className="font-bold text-slate-800 leading-snug">{ex.name}</span>
                              {ex.note && <span className="block text-[10px] text-slate-500 mt-0.5 leading-relaxed">{ex.note}</span>}
                            </td>
                            <td className="px-2 py-2.5 text-center font-black text-orange-600">{ex.sets}</td>
                            <td className="px-2 py-2.5 text-center font-bold text-slate-700">{ex.reps}</td>
                            <td className="px-2 py-2.5 text-center text-slate-500">{ex.rest}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {/* نکات برنامه */}
            <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: goldGradient }}>
                  <Lightbulb className="w-5 h-5 text-white" />
                </span>
                <h4 className="font-black text-sm text-orange-700">نکات مهم برنامه (تغذیه و استراحت)</h4>
              </div>
              <ul className="space-y-2">
                {program.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: goldGradient }} />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* اکشن‌ها: دانلود عکس + CTAها */}
            <div className="rounded-2xl border-2 border-orange-100 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-bold text-sm text-white transition hover:scale-[1.02] active:scale-95 disabled:opacity-70 shadow-lg"
                  style={{ background: goldGradient, boxShadow: "0 10px 22px -8px rgba(249,115,22,0.45)" }}
                  aria-label="دانلود عکس برنامه"
                >
                  {downloaded ? <Check className="w-5 h-5" /> : <Download className="w-5 h-5" />}
                  {downloading ? "در حال ساخت تصویر…" : downloaded ? "دانلود شد!" : "دانلود عکس برنامه"}
                </button>
                <p className="text-[11px] text-slate-500 leading-relaxed sm:flex-1">
                  عکس برنامه با هدر برند فیتاپ ساخته می‌شود — عالی برای ذخیره در گالری یا اشتراک‌گذاری با دوستانت سر تمرین.
                </p>
              </div>

              <div className="h-px bg-orange-100" />

              {/* CTA قیف تبدیل — برنامهٔ اختصاصی و پلن‌ها */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/?screen=auth"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-5 font-black text-sm text-white transition hover:scale-[1.01] active:scale-95 shadow-lg"
                  style={{ background: goldGradient, boxShadow: "0 10px 22px -8px rgba(249,115,22,0.45)" }}
                >
                  <Sparkles className="w-5 h-5" />
                  دریافت برنامهٔ اختصاصی حرفه‌ای
                  <ChevronLeft className="w-4 h-4" />
                </Link>
                <Link
                  href="/#pricing"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-5 font-bold text-sm text-orange-600 bg-orange-50 hover:bg-orange-100 border-2 border-orange-200 transition"
                >
                  <Crown className="w-5 h-5" />
                  مشاهدهٔ پلن‌های اشتراک
                </Link>
              </div>
              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                برنامهٔ اختصاصی فیتاپ بر اساس قد، وزن، سابقه و آسیب‌های تو با هوش مصنوعی ساخته می‌شود — با پیشرفت هفتگی، برنامهٔ غذایی و پشتیبانی مربی.
              </p>
            </div>
          </article>
        )}
      </section>

      {/* ═══ نوار CTA چسبان موبایل ═══ */}
      <div
        className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-orange-100 bg-white/95 backdrop-blur-md px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        aria-label="دریافت برنامهٔ اختصاصی"
      >
        <Link
          href="/?screen=auth"
          className="flex items-center justify-center gap-2 rounded-2xl h-12 font-black text-sm text-white shadow-lg"
          style={{ background: goldGradient, boxShadow: "0 10px 22px -8px rgba(249,115,22,0.45)" }}
        >
          <Sparkles className="w-5 h-5" />
          دریافت برنامهٔ اختصاصی حرفه‌ای
        </Link>
      </div>
    </div>
  );
}

// ─── اجزای کوچک ───

/** تیتر مرحلهٔ انتخاب با شماره و تیک */
function StepTitle({ n, label, done }: { n: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
        style={{ background: done ? goldGradient : "#e2e8f0" }}
      >
        {done ? <Check className="w-4 h-4" /> : toPersianDigits(n)}
      </span>
      <h3 className="font-black text-base text-slate-800">
        <span className="sr-only">مرحلهٔ {toPersianDigits(n)}: </span>
        {label}
      </h3>
    </div>
  );
}

/** بج متادیتای برنامه */
function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full bg-orange-50 text-orange-700 border border-orange-100 font-bold">
      <span className="text-slate-400 font-medium">{label}:</span>
      {value}
    </span>
  );
}
