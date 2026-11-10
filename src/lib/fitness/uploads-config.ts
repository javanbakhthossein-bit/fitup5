/**
 * مسیر ریشه ذخیره‌سازی تصاویر — در ریشه پروژه (نه در public).
 *
 * مهم: این فایل جداگانه است تا `sharp` import نشود. فایل‌های API route
 * (مثل /api/serve-upload) فقط به مسیر نیاز دارند و نباید sharp را بارگذاری
 * کنند، چون sharp یک native module است و در standalone ممکن است مشکل داشته
 * باشد (libvips موجود نیست).
 */
import path from "path";
import { existsSync, statSync } from "fs";

/**
 * یافتن مسیر واقعی پوشه `uploads`.
 *
 * مشکل: در حالت standalone (`node .next/standalone/server.js`) ممکن است
 * process.cwd() داخل `.next/standalone` باشد، در حالی که پوشه uploads در
 * ریشه پروژه است. اگر مسیر فقط بر اساس cwd ساخته شود، همه تصاویر 404
 * می‌شوند (نه کاورها نمایش داده می‌شوند، نه تصاویر inline).
 *
 * 🚨 v77 — باگ بحرانی از دست رفتن داده (اثبات‌شده در سندباکس):
 * سرور standalone خودش process.chdir(__dirname) می‌کند → cwd = …/.next/standalone.
 * اگر آن‌جا پوشه uploads وجود داشته باشد (که بعد از اولین نوشتن ساخته می‌شد)،
 * قاعدهٔ ۲ همان را برمی‌گرداند و «همهٔ رسانه‌های کاربران داخل .next/standalone
 * نوشته می‌شد» → هر `next build` پوشهٔ standalone را از نو می‌سازد و عکس‌های
 * بدن/چت/گالری/پیوست تیکت کاربران برای همیشه پاک می‌شد!
 *
 * راه‌حل — به این ترتیب جستجو می‌کنیم (اولین مورد موجود برنده است):
 *   ۱. متغیر محیطی UPLOADS_DIR (override صریح — مسیر مطلق)
 *   ۲. اگر cwd داخل مسیر `.next` است (سرور standalone) → ریشهٔ واقعی پروژه
 *      (پیش از `.next`) + /uploads — هرگز و به هیچ شکلی داخل build نمی‌نویسیم
 *   ۳. process.cwd()/uploads (رفتار قبلی برای اجرای غیر-standalone)
 *   ۴. بالا رفتن تا ۴ سطح از cwd تا پیدا شدن پوشه uploads موجود
 *   ۵. fallback: process.cwd()/uploads (نمونه قبلی — نوشتن‌ها همان‌جا mkdir می‌کنند)
 */
function resolveUploadsRoot(): string {
  // ۱) override صریح با env
  const envDir = process.env.UPLOADS_DIR;
  if (envDir && path.isAbsolute(envDir)) {
    return envDir;
  }

  const isUploadsDir = (p: string): boolean => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  const cwd = process.cwd();

  // ۲) 🚨 v77 — cwd داخل build (.next/standalone)؟ → ریشهٔ واقعی پروژه.
  // الگو: <project>/.next/standalone[/…] → <project>/uploads
  // (نکته: server.js استندالون خودش chdir می‌کند؛ حتی اگر اجرا از ریشه پروژه
  // انجام شود cwd نهایی داخل .next است.)
  const nextIdx = cwd.split(path.sep).indexOf(".next");
  if (nextIdx > 0) {
    const projectRoot = cwd.split(path.sep).slice(0, nextIdx).join(path.sep);
    const projectUploads = path.join(projectRoot, "uploads");
    // حتی اگر هنوز موجود نیست، همین مسیر مبناست (mkdir در اولین نوشتن) —
    // هرگز به مسیر داخل .next برنمی‌گردیم.
    return projectUploads;
  }

  // ۳) cwd/uploads (رفتار پیش‌فرض قبلی — اجرای غیر standalone)
  const cwdUploads = path.join(cwd, "uploads");
  if (isUploadsDir(cwdUploads)) {
    return cwdUploads;
  }

  // ۴) بالا رفتن از cwd تا ۴ سطح والد
  try {
    let dir = cwd;
    for (let i = 0; i < 4; i++) {
      dir = path.dirname(dir);
      const candidate = path.join(dir, "uploads");
      if (isUploadsDir(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore — به fallback می‌رسیم
  }

  // ۵) fallback — همان رفتار قبلی (پوشه موقع اولین نوشتن ساخته می‌شود)
  return cwdUploads;
}

/**
 * مسیر ریشه ذخیره‌سازی تصاویر — در ریشه پروژه (نه در public).
 *
 * این مسیر در زمان `next build` کپی نمی‌شود، پس تصاویر runtime (مثل مقالات
 * سئوی تولیدشده در production) از بین نمی‌روند.
 */
export const UPLOADS_ROOT = resolveUploadsRoot();

/**
 * مسیر ذخیره‌سازی تصاویر مقالات.
 */
export function getArticlesDir(): string {
  return path.join(UPLOADS_ROOT, "articles");
}
