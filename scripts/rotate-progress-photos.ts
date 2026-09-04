/**
 * ─── scripts/rotate-progress-photos.ts — اصلاح یک‌بارهٔ عکس‌های چرخیدهٔ گالری پیشرفت ───
 *
 * زمینه (گزارش مالک): عکس‌های بدن گالری پیشرفت ۹۰ درجه چرخیده نمایش داده می‌شدند.
 * ریشه: آپلود قدیمی با sharp بدون .rotate() انجام می‌شد → پیکسل خام حسگر + حذف EXIF
 * → عکس عمودی به‌صورت افقیِ چرخیده ذخیره شده بود. آپلود جدید (v12.6+) خودکار درست است.
 *
 * این اسکریپت عکس‌های «موجود» uploads/progress را ۹۰ درجه به راست می‌چرخاند.
 *
 * ⚠️ فقط برای عکس‌های قدیمی که واقعاً چرخیده نمایش داده می‌شوند! عکس‌هایی که از
 * اول درست ذخیره شده‌اند (افقی/لامدسنج) با این اسکریپت غلط می‌شوند — اول DRY-RUN
 * بگیرید، خروجی را چک کنید و بعد --apply بزنید.
 *
 * مصرف:
 *   bun run scripts/rotate-progress-photos.ts            ← DRY-RUN (فقط گزارش)
 *   bun run scripts/rotate-progress-photos.ts --apply    ← چرخش ۹۰° به راست (ثبت در مارکر)
 *   bun run scripts/rotate-progress-photos.ts --apply --ccw  ← چرخش ۹۰° به چپ
 *
 * ایمنی دو-لایه:
 *   ۱. مارکر uploads/progress/.rotated-90.json — اگر با همان جهت قبلاً اجرا شده،
 *      دوباره اجرا نمی‌شود (جلوگیری از چرخش دوبله در دیپلوی/اجرای مجدد).
 *   ۲. فایل‌های با عرض>ارتفاع (افقی) را به‌طور پیش‌فرض دست نمی‌زند مگر --force
 *      (عکس عمودیِ خراب = ذخیرهٔ افقی؛ عکس افقیِ سالم را جلوتر رد شو).
 */

import { readdir, readFile, writeFile, stat } from "fs/promises";
import path from "path";

const PROGRESS_DIR = path.join(process.cwd(), "uploads", "progress");
const MARKER = path.join(PROGRESS_DIR, ".rotated-90.json");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CCW = args.includes("--ccw");
const FORCE = args.includes("--force");
const DEGREES = CCW ? -90 : 90;

async function main() {
  // ── چک مارکر (جلوگیری از اجرای دوباره با همان جهت)
  try {
    const prev = JSON.parse(await readFile(MARKER, "utf8"));
    if (prev.degrees === DEGREES && prev.applied) {
      console.log(
        `ℹ️ این اسکریپت قبلاً با جهت ${DEGREES}° اجرا و ثبت شده است (${prev.date}).` +
          `\n   برای جلوگیری از چرخش دوبله، اجرای مجدد مسدود شد.`
      );
      return;
    }
  } catch {
    /* مارکر نیست — اولین اجرا */
  }

  let entries: string[] = [];
  try {
    entries = await readdir(PROGRESS_DIR);
  } catch {
    console.log(`ℹ️ پوشه ${PROGRESS_DIR} وجود ندارد — چیزی برای اصلاح نیست.`);
    return;
  }

  const files = entries.filter((f) => f.toLowerCase().endsWith(".webp"));
  if (files.length === 0) {
    console.log("ℹ️ هیچ فایل .webp در uploads/progress نیست.");
    return;
  }

  console.log(
    `🔍 بررسی ${files.length} فایل در uploads/progress — جهت: ${DEGREES}° ${CCW ? "(چپ)" : "(راست)"} — حالت: ${APPLY ? "APPLY ✂️" : "DRY-RUN (فقط گزارش)"}`
  );

  const sharp = (await import("sharp")).default;
  let rotated = 0;
  let skippedLandscape = 0;
  let failed = 0;

  for (const f of files) {
    const abs = path.join(PROGRESS_DIR, f);
    try {
      const st = await stat(abs);
      if (!st.isFile()) continue;
      const meta = await sharp(abs).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      // عکس عمودیِ خراب = روی دیسک افقی است (عرض>ارتفاع) → باید چرخد.
      // عکس افقی سالم را (عرض>ارتفاع ولی واقعاً افقی گرفته شده) بدون --force دست نمی‌زنیم.
      const isLandscapeOnDisk = w > h;
      if (isLandscapeOnDisk && !FORCE) {
        skippedLandscape++;
        continue;
      }
      if (w === 1 && h === 1) continue; // فایل تست ۱×۱
      if (!APPLY) {
        rotated++;
        console.log(`  ↻ ${f} (${w}×${h}) → چرخش ${DEGREES}°`);
        continue;
      }
      const buf = await readFile(abs);
      const out = await sharp(buf).rotate(DEGREES).webp({ quality: 80 }).toBuffer();
      await writeFile(abs, out);
      rotated++;
      console.log(`  ✂️ ${f} (${w}×${h}) → چرخید ${DEGREES}°`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(
    `\n📊 نتیجه: ${rotated} فایل ${APPLY ? "چرخید" : "باید بچرخد"} | ${skippedLandscape} افقی رد شد (بدون --force) | ${failed} خطا`
  );

  if (APPLY && rotated > 0) {
    await writeFile(
      MARKER,
      JSON.stringify({ degrees: DEGREES, applied: true, date: new Date().toISOString(), count: rotated }, null, 2)
    );
    console.log(`🔒 مارکر ثبت شد: ${MARKER}`);
  } else if (!APPLY) {
    console.log(`\nبرای اجرای واقعی: bun run scripts/rotate-progress-photos.ts --apply ${CCW ? "--ccw " : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
