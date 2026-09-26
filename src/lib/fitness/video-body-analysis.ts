import "server-only";
import { db } from "@/lib/db";
import { analyzeVideoFromPath } from "@/lib/fitness/ai";
import { compressVideoFileInPlace, formatBytes } from "@/lib/fitness/media-compress";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v90 — موتور مشترک تحلیل پس‌زمینهٔ ویدیوی فرم بدن
 * ═══════════════════════════════════════════════════════════════════════════
 * قبلاً همین منطق inline داخل POST /api/coach/analyze-video بود؛ با آمدن
 * مسیر آپلود چانکی (/api/coach/upload-complete با target=videos) باید از
 * «دو» نقطه اجرا شود — پس استخراج شد تا دو کپی ناهم‌راستا ساخته نشود.
 * الگوی اثبات‌شدهٔ v74: fire-and-forget — بستن صفحه/قطع HTTP بی‌اثر است؛
 * نتیجه در DB می‌ماند و کلاینت با poll روی GET برمی‌دارد.
 */

export async function startVideoBodyAnalysis(opts: {
  userId: string;
  /** مسیر مطلق فایل ویدیو روی دیسک */
  filePath: string;
  /** URL نسبی رسانه برای ذخیره در AnalysisResult */
  fileUrl: string;
  userContext?: string;
}): Promise<void> {
  const userContextStr = opts.userContext?.trim() || "تحلیل فرم بدن و تکنیک حرکات ورزشی";
  void (async () => {
    try {
      // فشرده‌سازی درجا (v53) — نسخهٔ فشردهٔ سالم جایگزین فایل اصلی می‌شود
      // (استثنای واحد حذف فایل). تحلیل AI روی همان مسیر انجام می‌شود؛
      // فریم‌های سبک‌تر = تحلیل سریع‌تر.
      const compressResult = await compressVideoFileInPlace(opts.filePath, { maxHeight: 720, crf: 28 });
      console.log(
        `[analyze-video] compress: ${formatBytes(compressResult.sizeBefore)} → ${formatBytes(compressResult.sizeAfter)}` +
          ` (compressed=${compressResult.compressed}${compressResult.skipped ? `, skipped=${compressResult.skipped}` : ""})`
      );

      // تحلیل ویدیو (با استخراج فریم ffmpeg — دو استراتژی v90)
      const result = await analyzeVideoFromPath(opts.filePath, userContextStr);

      // ذخیره نتیجه در DB + افزایش شمارنده استفاده
      await db.$transaction([
        db.analysisResult.create({
          data: {
            userId: opts.userId,
            type: "video_analysis",
            result: JSON.stringify(result),
            mediaUrl: opts.fileUrl,
          },
        }),
        db.user.update({
          where: { id: opts.userId },
          data: { videoAnalysisUsed: { increment: 1 } },
        }),
      ]);

      // پایان موفق — پیش‌نیاز ویدیو تعیین تکلیف شده حساب می‌شود
      await db.user.update({
        where: { id: opts.userId },
        data: { videoStatus: "uploaded" },
      });
      console.log(`[analyze-video] background analysis completed for user ${opts.userId}`);
    } catch (bgErr) {
      console.error("[analyze-video] background analysis failed:", bgErr);
      // videoStatus به "uploaded" برمی‌گردد تا کاربر بتواند دوباره تلاش کند
      // (فایل آپلود شده و سهمیه مصرف نشده — retry آزاد است؛ GET هم
      // analyzing=false می‌دهد و UI خطا + دکمهٔ تلاش مجدد نشان می‌دهد.)
      await db.user
        .update({ where: { id: opts.userId }, data: { videoStatus: "uploaded" } })
        .catch((stErr) => {
          console.error("[analyze-video] failed to reset videoStatus after error:", stErr);
        });
    }
  })();
}
