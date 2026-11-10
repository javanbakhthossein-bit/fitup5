/**
 * تست عملی v265 — بلاک «تحلیل عکس‌های بدن قبلی» در buildGenerationExtras
 * اجرا: bun scripts/test-v265-renewal-context.ts
 */
import { db } from "../src/lib/db";
import { buildGenerationExtras } from "../src/lib/fitness/program-generation";

async function main() {
  // کاربرانی که بیش از یک تحلیل عکس بدن معتبر دارند
  const users = await db.$queryRawUnsafe<{ userId: string; c: number }[]>(`
    SELECT userId, COUNT(*) as c FROM AnalysisResult
    WHERE type='body_photo'
    GROUP BY userId HAVING c >= 2 ORDER BY c DESC LIMIT 3
  `);
  console.log("کاربران با ≥۲ تحلیل عکس بدن:", users);
  if (users.length === 0) {
    console.log("⚠️ هیچ کاربری با ۲ تحلیل عکس بدن پیدا نشد — تست روی یک کاربر با ۱ تحلیل برای ساختار:");
    const any = await db.analysisResult.findFirst({ where: { type: "body_photo" }, select: { userId: true } });
    if (!any) { console.log("هیچ تحلیل عکس بدنی در DB نیست — تست ساختاری رد شد"); process.exit(0); }
    const extras = await buildGenerationExtras(any.userId);
    console.log("renewalContext شامل عکس قبلی؟", extras.renewalContext?.includes("عکس‌های بدن قبلی") ? "بله" : "خیر (درست — فقط یک تحلیل دارد)");
    console.log("bodyPhotoAnalysis موجود؟", !!extras.bodyPhotoAnalysis);
    process.exit(0);
  }
  for (const u of users) {
    const extras = await buildGenerationExtras(u.userId);
    const hasPrev = extras.renewalContext?.includes("تحلیل عکس‌های بدن قبلی کاربر");
    console.log(`\n── کاربر ${u.userId} (${u.c} تحلیل):`);
    console.log("  بلاک عکس‌های قبلی:", hasPrev ? "✓ تزریق شد" : "✗ نبود");
    if (hasPrev) {
      const idx = extras.renewalContext!.indexOf("تحلیل عکس‌های بدن قبلی");
      console.log("  نمونه:", extras.renewalContext!.slice(idx, idx + 300).replace(/\n/g, " | ").slice(0, 280));
    }
    console.log("  weakPoints:", extras.weakPoints?.length ?? 0);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
