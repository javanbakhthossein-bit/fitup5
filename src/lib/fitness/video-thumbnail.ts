"use client";

/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 4-a — ساخت تصویر بندانگشتی (poster) از فریم اول ویدیو
 * ═══════════════════════════════════════════════════════════════
 *
 *  چرا: `<video preload="metadata">` در موبایل/WebView تا لحظهٔ پلی فقط
 *  جعبهٔ سیاه نشان می‌دهد (باگ مالک: «پری‌ویو ویدیو فقط آیکون پلی/فریم سیاه»).
 *  فرگمنت `#t=0.1` در خیلی از مرورگرها کار می‌کند ولی تضمینی نیست؛ poster
 *  ساخته‌شده با canvas تضمینی است — فریم اول واقعی رندر می‌شود بدون پلی.
 *
 *  ورودی می‌تواند هر URL هم‌مبدأ باشد: blob: (فایل انتخاب‌شده)، data:
 *  (پیش‌نمایش موقت) یا مسیر سرور /uploads/… (هم‌مبدأ → canvas آلوده نمی‌شود).
 *
 *  هرگز throw نمی‌کند — در هر شکست null برمی‌گرداند (caller به #t=0.1 برمی‌گردد).
 * ═══════════════════════════════════════════════════════════════
 */

function captureThumb(video: HTMLVideoElement, maxWidth: number): string | null {
  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return null;
  }
}

/**
 * ساخت poster از src ویدیو — seek به ~۰.۱ ثانیه و کشیدن فریم روی canvas.
 * timeoutMs: اگر ویدیو در این بازه آماده نشد، تلاش می‌کند از فریمِ decode‌شدهٔ
 * فعلی thumbnail بسازد (وگرنه null).
 */
export function createVideoThumbnail(
  src: string,
  opts?: { maxWidth?: number; timeoutMs?: number }
): Promise<string | null> {
  const maxWidth = opts?.maxWidth ?? 480;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  return new Promise((resolve) => {
    if (!src || typeof document === "undefined") {
      resolve(null);
      return;
    }

    let settled = false;
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
      } catch {}
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      // fallback: اگر seeked هرگز fire نشد، از فریم decode‌شدهٔ فعلی بگیر
      finish(captureThumb(video, maxWidth));
    }, timeoutMs);

    video.onloadedmetadata = () => {
      try {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        // فریم اول: ۰.۱ ثانیه (یا ~۱۰٪ ابتدای ویدیوهای کوتاه) — نه فریم سیاهِ لبه
        const target = duration > 0.5 ? Math.min(duration * 0.1, 0.2) : 0.1;
        video.currentTime = target || 0.1;
      } catch {
        finish(captureThumb(video, maxWidth));
      }
    };
    video.onseeked = () => finish(captureThumb(video, maxWidth));
    video.onerror = () => finish(null);

    video.src = src;
    try {
      video.load();
    } catch {
      finish(null);
    }
  });
}
