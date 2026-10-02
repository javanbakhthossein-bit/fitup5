"use client";

import { useEffect, useMemo, useState } from "react";
import { createVideoThumbnail } from "@/lib/fitness/video-thumbnail";

/**
 * پیش‌نمایش ویدیوی درون‌خطی — v48 (دیریکتیو صریح مالک) + به‌روزرسانی Task 4-a
 *
 * «پری‌ویو ویدیو در چت فیتاپ و در آنالیز هوشمند ویدیو باید خود ویدیو باشه نه
 *  آرم پلی داخل عکس»
 *
 * v45 دکمهٔ پلی بزرگ روی ویدیو گذاشته بود — مالک آن را پس زد. حالا:
 *   • هیچ overlay/آرم پلی روی ویدیو نیست — خود ویدیو با فریم اول نمایش داده می‌شود
 *   • `#t=0.1` (media fragment) + preload="metadata" → مرورگر فریم اول را
 *     واقعاً رندر می‌کند (در موبایل/WebView بدون این ترفند فقط جعبهٔ سیاه دیده می‌شد —
 *     دقیقاً اسکرین‌شات مالک)
 *   • کنترل‌های نیتیو (پلی/صدا/جلو-عقب) خود مرورگر/اپ — آشنا و سریع
 *   • playsInline → تمام‌صفحهٔ ناگهانی در iOS/اندروید نمی‌شود
 *
 * ─── Task 4-a (فیکس «فقط آیکون پلی/فریم سیاه») ───
 *   • برای srcهای محلی (blob:/data:) یک poster کانواسی از فریم اول ساخته می‌شود —
 *     poster تضمینی است؛ حتی جایی که media fragment پشتیبانی نمی‌شود فریم اول
 *     دیده می‌شود (باگ چیپ پیش‌نمایش draft چت — همین الگو)
 *   • فرگمنت #t=0.1 حالا برای blob: هم اعمال می‌شود (data: دست‌نخورده می‌ماند)
 *   • srcهای سروری (/uploads/… با احراز هویت کوکی) دقیقاً مثل قبل — هیچ تغییری
 *
 * ─── v90 (فیکس «حین آپلود صفحهٔ سیاه» — گزارش مالک) ───
 *   • prop اختیاری poster: اگر caller از قبل poster کانواسی دارد (ساخته‌شده در
 *     لحظهٔ انتخاب فایل)، همان بلافاصله نشان داده می‌شود — بدون هیچ انتظار برای
 *     decode ویدیو؛ برای ویدیوهای حجیم (۸۶MB+) تفاوت سیاه/فریم اول همین‌جاست.
 *   • پس‌زمینهٔ تیرهٔ یکدست پشت ویدیو (جعبهٔ سیاه تصادفی نیست — بوم عمدی است).
 *
 * ⚠️ فقط نمایش (presentation layer) — هیچ تغییری در منطق آپلود/تحلیل ویدیو.
 */
export function InlineVideoPreview({
  src,
  className = "",
  videoClassName = "",
  poster: posterProp,
}: {
  src: string;
  /** کلاس Container بیرونی (اندازه/فاصله) */
  className?: string;
  /** کلاس خود <video> (اندازه/گوشه/حاشیه) */
  videoClassName?: string;
  /** v90 — poster تضمینی از caller (به‌ترتیب اولویت قبل از تولید داخلی) */
  poster?: string | null;
}) {
  const isLocalSrc = !!src && (src.startsWith("data:") || src.startsWith("blob:"));
  const [posterState, setPosterState] = useState<{ src: string; data: string } | null>(null);

  // poster کانواسی فقط برای srcهای محلی (پیام موقت قبل از ثبت سرور) —
  // پیام‌های ثبت‌شده URL سروری دارند که خودش فریم اول را با #t=0.1 رندر می‌کند
  useEffect(() => {
    if (posterProp || !isLocalSrc || !src) return;
    let alive = true;
    createVideoThumbnail(src).then((thumb) => {
      if (alive && thumb) setPosterState({ src, data: thumb });
    });
    return () => {
      alive = false;
    };
  }, [src, isLocalSrc, posterProp]);

  // poster فقط وقتی به src جاری تعلق دارد — تغییر src بدون setState هم‌زمان
  const poster = posterProp || (posterState && posterState.src === src ? posterState.data : undefined);

  const previewSrc = useMemo(() => {
    if (!src || src.includes("#")) return src;
    // data: URL فرگمنت نمی‌گیرد (کل رشته data است) — poster جایگزین تضمینی است
    if (src.startsWith("data:")) return src;
    // blob: هم فرگمنت را می‌پذیرد (کروم/اندروید) + poster تضمین رندر است
    return `${src}#t=0.1`;
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-slate-900 ${className}`}>
      <video
        src={previewSrc}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        className={videoClassName}
      />
    </div>
  );
}
