"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v252 — دکمهٔ «دانلود عکس برنامه» برای صفحهٔ اختصاصی هر برنامهٔ رایگان
 * (/free-programs/[slug] — درخواست مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * صفحهٔ [slug] کاملاً SSR است (سئو) — این دکمه تنها جزء کلاینتی آن است و
 * دقیقاً همان رندرکنندهٔ کانواس مشترک (renderProgramImage از
 * free-programs-client) را استفاده می‌کند تا عکس هر دو مسیر (هاب و صفحهٔ
 * اختصاصی) بایت‌به‌بایت یکسان باشد: هدر برند فیتاپ + نام برنامه + جدول کامل.
 *
 * ایمنی: دانلود شکست خورد (فونت لود نشد/حافظه) → پیام تُستِ شفاف؛ دکمه هرگز
 * قفل نمی‌ماند (finally) و در هر حالت صفحه کار می‌کند.
 */

import { useCallback, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { FreeProgram } from "@/lib/fitness/free-programs-data";
import { renderProgramImage } from "./free-programs-client";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

export function FreeProgramDownloadButton({ program }: { program: FreeProgram }) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
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
        toast.success("عکس برنامه ذخیره شد — آمادهٔ گالری یا اشتراک‌گذاری 🎉");
        setTimeout(() => setDownloaded(false), 3000);
      } else {
        toast.error("ساخت تصویر برنامه ناموفق بود — دوباره تلاش کنید.");
      }
    } catch {
      toast.error("ساخت تصویر برنامه ناموفق بود — دوباره تلاش کنید.");
    } finally {
      setDownloading(false);
    }
  }, [program, downloading]);

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-black text-sm text-white transition hover:scale-[1.02] active:scale-95 disabled:opacity-70 shadow-lg"
      style={{ background: goldGradient, boxShadow: "0 10px 22px -8px rgba(249,115,22,0.55)" }}
      aria-label="دانلود عکس برنامه"
    >
      {downloading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : downloaded ? (
        <Check className="w-5 h-5" />
      ) : (
        <Download className="w-5 h-5" />
      )}
      {downloading ? "در حال ساخت تصویر…" : downloaded ? "دانلود شد!" : "دانلود عکس برنامه"}
    </button>
  );
}
