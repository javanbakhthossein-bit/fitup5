/**
 * انتشار اپ اندروید اختصاصی فیتاپ در DB + کپی فایل در uploads/apk
 *
 * اجرا (سندباکس یا سرور — idempotent):
 *   bun scripts/publish-own-app.ts [versionName] [versionCode]
 *
 * منبع APK به این ترتیب جستجو می‌شود (اولین مورد موجود):
 *   ۱. fitup-app/app/build/outputs/apk/release/app-release.apk  (خروجی gradle)
 *   ۲. public/downloads/fitup-own-v{version}.apk                (فایل همراه دیپلوی)
 *   ۳. download/fitup-own-v{version}.apk                        (پوشه دانلود)
 *
 * اگر نسخه‌ای با همین versionCode از قبل active باشد، چیزی ایجاد نمی‌شود
 * (اجرای دوباره امن است — deploy.sh هم همین اسکریپت را صدا می‌زند).
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, copyFileSync, statSync, existsSync } from "fs";
import path from "path";

const db = new PrismaClient();

/** تغییرات هر نسخه — نمایش در مودال «نسخه جدید» کاربران قدیمی */
const CHANGELOGS: Record<string, string[]> = {
  "1.0.0": [
    "نسخه اول اپ اختصاصی فیتاپ — دانلود فقط از خود سایت",
    "پنل کاربری کامل: داشبورد، برنامه‌ها، تمرین‌ها، تغذیه، پیشرفت و چت",
    "ورود سریع با OTP + خواندن خودکار کد پیامک (با اجازه شما)",
    "پرداخت امن از درگاه رسمی خود سایت (زرین‌پال)",
    "اعلان‌های هوشمند یادآوری تمرین و تغذیه",
    "اسکرول نرم و روان در همه بخش‌ها + pull-to-refresh هوشمند",
    "به‌روزرسانی خودکار از داخل برنامه بدون نیاز به فروشگاه",
  ],
  "1.1.0": [
    "دسترسی‌ها (اعلان، گالری، دوربین، میکروفون) با مودال زیبا و انیمه‌دار، دقیقاً در زمان خودش گرفته می‌شوند",
    "اعلان‌های سیستم اندروید کامل و اصولی شد — یادآوری تمرین، تغذیه و پیام مربی",
    "حذف دیالوگ تکراری اجازهٔ دوربین/میکروفون (فقط دیالوگ سیستمی اندروید)",
    "رفع باگ قواعد R8 برای پل جاوااسکریپت (پایداری آپدیت/اعلان/OTP خودکار)",
    "پایداری و نرمی اسکرول بیشتر",
  ],
  "1.2.0": [
    "دکمهٔ بازگشت هوشمند شد: هرجا به‌جز داشبورد باشید، یک بار بزنید → داشبورد؛ بار دوم → تأیید خروج از برنامه",
    "رفع بریده‌شدن متن مودال‌های دسترسی (اعلان/گالری/دوربین/میکروفون) — دیگر چیزی زیر نوار رنگی مخفی نمی‌شود",
    "سرعت و روانی بیشتر در باز کردن منو و جابه‌جایی بین بخش‌ها (حذف افکت‌های سنگین اسکرول)",
    "دریافت خودکار کد پیامک (OTP) و اعلان‌ها پایدارتر شد",
    "نمایش درست عکس‌های پیشرفت (رفع چرخش اشتباه عکس‌های عمودی)",
    "جزئیات کامل برنامهٔ تمرینی و غذایی در پنل مدیر + امکان اضافه‌کردن روز به پلن کاربر",
  ],
  "1.2.1": [
    "رفع کامل دیالوگ ترسناک «App was denied access» — اپ دیگر هیچ درخواست دسترسی پیامک ندارد",
    "ورود خودکار کد OTP بدون هیچ دسترسی اضافه: پیشنهاد هوشمند کد توسط خود اندروید/کیبورد",
    "اگر کد را کپی کنید، بلافاصله بعد از برگشتن به اپ خودش درج می‌شود",
    "حذف کارت درخواست «ورود خودکار با پیامک» — صفحه ورود تمیزتر و سریع‌تر",
  ],
  "1.2.2": [
    "رفع کامل مشکل دانلود نشدن نسخه جدید در گوشی‌های اندروید ۱۴ و بالاتر — پنجرهٔ نصب همیشه باز می‌شود",
    "پایان دانلود حتی با بستن و باز کردن دوبارهٔ اپ از دست نمی‌رود — برگردید به اپ، نصب را تأیید کنید",
    "اگر دانلود به مشکل بخورد، خودش می‌پرسد: تلاش دوباره یا دانلود با مرورگر — دیگر هیچ‌وقت بی‌صدا نمی‌ماند",
    "پیام‌های دقیق‌تر: «شروع شد» فقط وقتی نمایش داده می‌شود که دانلود واقعاً شروع شده باشد",
  ],
};

function findApkSource(versionName: string): string | null {
  const root = process.cwd();
  const candidates = [
    path.join(root, "fitup-app", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    path.join(root, "public", "downloads", `fitup-own-v${versionName}.apk`),
    path.join(root, "download", `fitup-own-v${versionName}.apk`),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).size > 10_000) return c;
    } catch {}
  }
  return null;
}

async function main() {
  const versionName = process.argv[2] || "1.1.0";
  const versionCode = Number(process.argv[3] || 2);

  // ─── idempotent: اگر همین نسخه فعال است، دوباره منتشر نکن ───
  const alreadyActive = await db.ownAppRelease.findFirst({
    where: { versionCode, isActive: true },
  });
  if (alreadyActive) {
    console.log("ALREADY_PUBLISHED", {
      versionName: alreadyActive.versionName,
      versionCode: alreadyActive.versionCode,
      fileName: alreadyActive.fileName,
    });
    return;
  }

  const source = findApkSource(versionName);
  if (!source) {
    console.error(`APK_NOT_FOUND — fitup-own-v${versionName}.apk پیدا نشد`);
    process.exit(1);
  }

  const apkDir = path.join(process.cwd(), "uploads", "apk");
  mkdirSync(apkDir, { recursive: true });
  const fileName = `fitup-own-v${versionName}-${Date.now()}.apk`;
  const dest = path.join(apkDir, fileName);
  copyFileSync(source, dest);
  const size = statSync(dest).size;

  // غیرفعال کردن نسخه‌های قبلی
  await db.ownAppRelease.updateMany({ where: { isActive: true }, data: { isActive: false } });

  const release = await db.ownAppRelease.create({
    data: {
      versionName,
      versionCode,
      changelog: (CHANGELOGS[versionName] || CHANGELOGS["1.1.0"]).join("\n"),
      fileName,
      fileSize: size,
      forceUpdate: false,
      isActive: true,
    },
  });

  console.log("RELEASE_PUBLISHED", {
    id: release.id,
    versionName: release.versionName,
    versionCode: release.versionCode,
    fileName: release.fileName,
    fileSize: release.fileSize,
    source,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
