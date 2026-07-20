/**
 * مسیر ریشه ذخیره‌سازی تصاویر — در ریشه پروژه (نه در public).
 *
 * مهم: این فایل جداگانه است تا `sharp` import نشود. فایل‌های API route
 * (مثل /api/serve-upload) فقط به مسیر نیاز دارند و نباید sharp را بارگذاری
 * کنند، چون sharp یک native module است و در standalone ممکن است مشکل داشته
 * باشد (libvips موجود نیست).
 */
import path from "path";

/**
 * مسیر ریشه ذخیره‌سازی تصاویر — در ریشه پروژه (نه در public).
 *
 * این مسیر در زمان `next build` کپی نمی‌شود، پس تصاویر runtime (مثل مقالات
 * سئوی تولیدشده در production) از بین نمی‌روند.
 */
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/**
 * مسیر ذخیره‌سازی تصاویر مقالات.
 */
export function getArticlesDir(): string {
  return path.join(UPLOADS_ROOT, "articles");
}
