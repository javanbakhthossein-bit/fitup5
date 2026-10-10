/**
 * make-challenge-thumbs.mjs — تامب‌نیل سبک تصاویر چالش‌ها (v189)
 *
 * دیرکتیو مالک: صفحهٔ چالش‌ها و کاروسل داشبورد به‌خاطر حجم بالای عکس‌ها (864×1152)
 * لگ دارد → نسخهٔ کوچک WebP برای همهٔ کارت‌ها می‌سازیم:
 *   - کارت‌ها (34): عرض 480، WebP q80 → public/images/challenges/thumbs/<name>.webp
 *   - بنرهای hero (2): عرض 960، WebP q82 → public/images/challenges/thumbs/<name>.webp
 * کاور کامل فقط در صفحهٔ جزئیات چالش استفاده می‌شود (یک عکس — مشکلی ندارد).
 *
 * اجرا: node scripts/make-challenge-thumbs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = "/home/z/my-project";
const DIRS = [
  path.join(ROOT, "public/images/challenges/men"),
  path.join(ROOT, "public/images/challenges/women"),
];
const OUT = path.join(ROOT, "public/images/challenges/thumbs");
fs.mkdirSync(OUT, { recursive: true });

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => /\.(jpg|jpeg|png)$/i.test(x))) {
    const src = path.join(dir, f);
    const base = f.replace(/\.(jpg|jpeg|png)$/i, "");
    const dst = path.join(OUT, `${base}.webp`);
    const isHero = /-hero$/i.test(base);
    const width = isHero ? 960 : 480;
    const quality = isHero ? 82 : 80;
    const st = fs.statSync(src);
    // skip اگر خروجی تازه‌تر از مبدأ است
    if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= st.mtimeMs) continue;
    await sharp(src)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toFile(dst);
    const outSize = fs.statSync(dst).size;
    console.log(
      `${base}: ${(st.size / 1024).toFixed(0)}KB → ${(outSize / 1024).toFixed(0)}KB (${width}w)`
    );
  }
}
console.log("🏁 تامب‌نیل‌ها آماده شدند:", OUT);
