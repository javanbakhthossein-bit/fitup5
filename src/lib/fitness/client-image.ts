/**
 * ─── فشرده‌سازی/کوچک‌سازی تصویر در سمت کلاینت (t10) ───
 *
 * چرا: قبلاً فایل اصلی (تا ۸ مگابایت) خام آپلود می‌شد و سرور با sharp به
 * ۳۲۰×۳۲۰ webp تبدیل می‌کرد — روی اینترنت موبایل/WebView آپلود چند ثانیه
 * طول می‌کشید و UI هم منتظرش می‌ماند. حالا قبل از آپلود، عکس با canvas
 * مرورگر به حداکثر ۶۴۰px کوچک و webp (fallback jpeg) می‌شود — معمولاً
 * از ۸MB به زیر ۱۰۰KB می‌رسد و آپلود چند برابر سریع‌تر است.
 *
 * ضمانت رفتار: هر خطایی (مرورگر قدیمی، canvas ناموجود، فرمت عجیب) → فایل
 * اصلی برگردانده می‌شود تا آپلود مثل قبل کار کند. SSR-safe هم هست.
 */

/** گارد SSR/محیط‌های بدون DOM — فایل اصلی بدون تغییر */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export async function downscaleImage(
  file: File,
  maxDim = 640,
  quality = 0.85
): Promise<File> {
  if (!isBrowser()) return file;
  try {
    // createImageBitmap — همه‌ی مرورگرهای مدرن + WebView اندروید مدرن
    if (typeof createImageBitmap !== "function") return file;

    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);

      // ترجیح webp (سرور هم webp تحویل می‌دهد)؛ fallback jpeg
      const toBlob = (type: string) =>
        new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality)
        );

      let blob = await toBlob("image/webp");
      let type = "image/webp";
      if (!blob || blob.size === 0) {
        blob = await toBlob("image/jpeg");
        type = "image/jpeg";
      }
      if (!blob || blob.size === 0) return file; // هیچ خروجی‌ای نشد — فایل اصلی

      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      const ext = type === "image/webp" ? ".webp" : ".jpg";
      return new File([blob], `${baseName}${ext}`, { type });
    } finally {
      // آزادسازی حافظه‌ی بیت‌مپ (در مرورگرهای قدیمی متد وجود ندارد)
      bitmap.close?.();
    }
  } catch {
    // هر خطایی → فایل اصلی (رفتار قبلی آپلود)
    return file;
  }
}
