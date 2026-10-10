/**
 * ─── v79 — پردازش امن تصویر (sharp) با فال‌بک HEIF/HEIC ───
 *
 * خطای گزارش‌شدهٔ مالک (لاگ مدیر، کاربر «میلاد بحری»):
 *   Input buffer has corrupt header: heif: Invalid input: Security limit exceeded:
 *   ipma box wants to define properties for 50 items, but the security limit has
 *   been set to 16 items (2.1000)
 *
 * ریشه: libheif داخل sharp روی بعضی عکس‌های HEIC/HEIF آیفون به «سقف امنیتی»
 * می‌خورد و decode شکست می‌خورد — فایل واقعاً خراب نیست، فقط سخت‌گیرِ دکودر است.
 * قبلاً این خطا کل درخواست را ۵۰۰ می‌کرد؛ حالا:
 *   ۱) تلاش استاندارد sharp (با failOn:"none" — سخت‌گیری کمتر روی ورودی)
 *   ۲) اگر شکست خورد و فایل از خانوادهٔ HEIF/HEIC بود → نسخهٔ خام به VLM می‌رود
 *      (Gemini به‌طور رسمی از image/heic و image/heif پشتیبانی می‌کند) و همان
 *      خام با پسوند درست ذخیره می‌شود — دیگر هیچ عکسی تحلیل را می‌بُرد.
 *
 * همهٔ مسیرهای آپلود عکس باید از این helper استفاده کنند تا رفتار یکسان باشد.
 */

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  /** پسوند فایل برای ذخیره‌سازی — همیشه با mimeType هم‌خوان است */
  fileExtension: string;
  /** false = فال‌بک (خام پاس داده شد) */
  optimized: boolean;
}

export interface ProcessImageOptions {
  /** بزرگ‌ترین بُعد مجاز (پیش‌فرض 1024) */
  maxDim?: number;
  /** کیفیت WebP (پیش‌فرض 75) */
  quality?: number;
  /** auto-orient از EXIF (برای عکس‌های گوشی — قبل از resize) */
  rotate?: boolean;
  /** سقف پیکسل ورودی sharp (ضد OOM) */
  limitInputPixels?: number;
  /** سقف حجم پاس‌دادن خام به VLM/ذخیره‌سازی (پیش‌فرض 12MB) */
  maxRawBytes?: number;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
};

/** تشخیص MIME واقعی از بایت‌های اول فایل (browser گاهی type خالی/اشتباه می‌دهد) */
export function detectImageMime(buf: Buffer): string | null {
  if (!buf || buf.length < 12) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // GIF
  if (buf.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  // WEBP: RIFF....WEBP
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  // ISO-BMFF (HEIF/HEIC/AVIF): بایت‌های 4..8 == 'ftyp'، برند در 8..12
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "heim", "heis", "heif", "mif1", "msf1", "hehm", "hevx"].includes(brand)) {
      // hevc/msf1 معمولاً HEIF استاندارد است؛ heic/heix/hevx → HEIC آیفون
      return brand.startsWith("he") && brand !== "heif" ? "image/heic" : "image/heif";
    }
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/** آیا این MIME از خانوادهٔ HEIF/HEIC است (فایل سالم ولی سخت‌گیر دکودر sharp)؟ */
export function isHeifFamilyMime(mime: string | null | undefined): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

/**
 * پردازش امن تصویر:
 *  ۱) sharp → resize + WebP (مسیر بهینهٔ عادی)
 *  ۲) فال‌بک HEIF/HEIC → خام با MIME واقعی (VLM می‌خواند؛ مرورگر سرو می‌کند)
 *
 * خروجی null یعنی هیچ‌کدام ممکن نشد (ورودی واقعاً خراب/بزرگ‌تر از سقف خام) —
 * فراخوان باید پیام خطای فارسیِ دوستانه بدهد نه 500 خام.
 */
export async function processImageSafe(
  rawBuffer: Buffer,
  originalMime: string | null | undefined,
  opts: ProcessImageOptions = {}
): Promise<ProcessedImage | null> {
  const { maxDim = 1024, quality = 75, rotate = false, limitInputPixels, maxRawBytes = 12 * 1024 * 1024 } = opts;

  // ─── مسیر ۱: sharp (بهینه‌سازی عادی) ───
  try {
    const sharp = (await import("sharp")).default;
    let pipeline = sharp(rawBuffer, {
      // failOn:"none" → سخت‌گیری کمتر روی ورودی‌های ناقص (قبل از فال‌بک)
      ...(limitInputPixels ? { limitInputPixels } : {}),
      failOn: "none",
    });
    if (rotate) pipeline = pipeline.rotate(); // auto-orient از EXIF — قبل از resize
    const processed = await pipeline
      .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    return { buffer: processed, mimeType: "image/webp", fileExtension: ".webp", optimized: true };
  } catch (sharpErr) {
    const msg = sharpErr instanceof Error ? sharpErr.message : String(sharpErr);
    console.error("[image-process] sharp failed → fallback path:", msg);

    // ─── مسیر ۲: فال‌بک — خام پاس بده اگر خانوادهٔ HEIF است و حجمش منطقی است ───
    const sniffed = detectImageMime(rawBuffer) ?? (((originalMime || "").split(";")[0].trim()) || null);
    if (isHeifFamilyMime(sniffed) && rawBuffer.length <= maxRawBytes) {
      // فایل HEIC آیفون سالم است — sharp/libheif فقط سقف امنیتی‌اش پر شده.
      // Gemini (مدل بینایی) image/heic و image/heif را مستقیم می‌خواند.
      console.warn(
        `[image-process] HEIF fallback active — raw passthrough (${sniffed}, ${rawBuffer.length} bytes)`
      );
      return {
        buffer: rawBuffer,
        mimeType: sniffed!,
        fileExtension: EXT_BY_MIME[sniffed!] ?? ".heic",
        optimized: false,
      };
    }
    return null;
  }
}
