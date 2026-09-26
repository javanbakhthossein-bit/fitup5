import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaVersion: string | undefined
}

// Bump this version whenever Prisma schema changes during dev — forces a new client.
const SCHEMA_VERSION = 'v72-sqlite-hardening'

// Detect stale client (missing new models) so we always rebuild after a schema change.
// v61: کاملاً ساکت — لاگ شلوغ «[db] new client checkup? ...» در خروجی بیلد مالک
// ده‌ها خط می‌ساخت و ارزش دیباگی نداشت (لیست کامل مدل‌ها خودش گارد کافی است).
function isStaleClient(c: PrismaClient | undefined): boolean {
  if (!c) return true;
  return !(c as any).siteSetting || !(c as any).article || !(c as any).termsVersion || !(c as any).headCode || !(c as any).checkup || !(c as any).userDiscountCode || !(c as any).otpCode || !(c as any).adminPermission || !(c as any).supportTicket || !(c as any).ticketReply || !(c as any).seoStrategy || !(c as any).seoArticlePlan || !(c as any).seoAgentRun || !(c as any).onboardingProfile || !(c as any).analysisResult || !(c as any).errorLog || !(c as any).feedback || !(c as any).pushSubscription;
}

/**
 * v72 — پایدارسازی SQLite در پروداکشن (لاگ خطاهای مالک):
 * خطای «prisma.walletTransaction.findMany() — Socket timeout (the database
 * failed to respond within the configured timeout)» دو ریشه دارد:
 *   ۱) پیش‌فرض Prisma برای SQLite «socket_timeout=5s» است و زیر بار/لاکِ
 *      موقتِ فایل، کوئری همان‌جا می‌میرد.
 *   ۲) چند اتصال همزمان روی یک فایل SQLite بدون WAL → رقابت قفل (SQLITE_BUSY).
 *
 * راه‌حل (بدون هیچ تغییر .env روی سرور — چون PROGRAMMATIC است):
 *   • connection_limit=1 → کل ترافیک یک پروسه از «یک» اتصال می‌گذرد؛
 *     دیگر هیچ دو کوئری‌ای سرِ قفل فایل نمی‌جنگند (تجویز استاندارد Prisma برای SQLite).
 *   • socket_timeout=15s → حتی کوئری سنگینِ گذرا هم می‌میرد نه timeout می‌خورد.
 *   • pool_timeout=30s → صف درخواست‌های همزمان هرگز pool را نمی‌بُرد.
 * اگر سرور قبلاً همین پارامترها را در DATABASE_URL گذاشته باشد، دست نمی‌زنیم.
 */
function sqliteUrlWithParams(url: string): string {
  if (!url || !url.startsWith("file:")) return url;
  if (url.includes("connection_limit=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connection_limit=1&socket_timeout=15&pool_timeout=30`;
}

export const db = (() => {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaVersion === SCHEMA_VERSION &&
    !isStaleClient(globalForPrisma.prisma)
  ) {
    return globalForPrisma.prisma;
  }
  // ─── v61 — دو فیکس نسبت به نسخهٔ قبل (لاگ‌های بیلد مالک) ───
  // ۱) log:['query'] حذف شد: در build پروداکشن (تولید ۱۴۲ صفحهٔ استاتیک +
  //    کوئری‌های HeadCode برای هر صفحه) صدها خط «prisma:query» در لاگ می‌ریخت.
  //    خطاها/هشدارها همچنان طبق رفتار پیش‌فرض Prisma دیده می‌شوند.
  // ۲) کش globalThis حالا در «همهٔ» محیط‌ها فعال است — قبلاً فقط dev بود؛
  //    در build/production هر instance جدا از ماژول (چانک‌های مجزای وبپک)
  //    کلاینتِ جدید و سنگین می‌ساخت («creating NEW PrismaClient in 1.58s»
  //    تکراری). با کش سراسری در هر پروسه فقط یک کلاینت ساخته می‌شود.
  const dsUrl = sqliteUrlWithParams(process.env.DATABASE_URL ?? "");
  const client = dsUrl
    ? new PrismaClient({ datasources: { db: { url: dsUrl } } })
    : new PrismaClient();

  // v72 — فعال‌سازی WAL (یک‌بار برای هر پروسه، best-effort):
  // journal_mode=WAL پایدار است (در فایل می‌ماند) و خواندن/نوشتن را موازی می‌کند؛
  // busy_timeout هم به اتصال اصلی اجازه می‌دهد به‌جای خطای فوری، صبر کند.
  try {
    void client.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
    void client.$queryRawUnsafe("PRAGMA busy_timeout=8000;").catch(() => {});
  } catch {}

  globalForPrisma.prisma = client;
  globalForPrisma.prismaVersion = SCHEMA_VERSION;
  return client;
})();
