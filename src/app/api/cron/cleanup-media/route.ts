import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readdir, stat, unlink } from "fs/promises";
import path from "path";

/**
 * GET /api/cron/cleanup-media?secret=CRON_SECRET
 *
 * پاک‌سازی خودکار مدیای قدیمی — اجرای روزانه (cron job).
 *
 * این endpoint سه کار انجام می‌دهد:
 *
 * ۱) حذف فایل‌های قدیمی از public/uploads/ بر اساس زمان نگهداری هر دسته:
 *    - public/uploads/chat/          → ۳۰ روز (عکس/ویدیوی چت)
 *    - public/uploads/chat/tts/      → ۷  روز (صوت TTS)
 *    - public/uploads/body-photos/   → ۹۰ روز (عکس بدن)
 *    - public/uploads/body-analysis/ → ۹۰ روز (عکس بدن — مسیر فعلی)
 *    - public/uploads/blood-tests/   → ۹۰ روز (آزمایش خون)
 *    - public/uploads/videos/        → ۳۰ روز (ویدیوی آنالیز)
 *    - public/uploads/meal-analysis/ → ۷  روز (عکس غذا)
 *
 * ۲) حذف رکوردهای قدیمی AnalysisResult بر اساس type:
 *    - food_photo      → ۷  روز
 *    - body_photo      → ۹۰ روز
 *    - video_analysis  → ۳۰ روز
 *    - blood_test      → ۹۰ روز
 *
 * ۳) پاک‌سازی ChatMessageهای قدیمی با mediaUrl:
 *    - فقط فیلد mediaUrl و mediaType را null می‌کنیم (متن پیام نگه داشته می‌شود)
 *    - بعد از ۳۰ روز
 *
 * نکات:
 *  - قبل از حذف هر فایل، وجود آن بررسی می‌شود (stat)
 *  - اگر دایرکتوری وجود نداشت، no-op است (readdir خطا می‌دهد → رد می‌شود)
 *  - لاگ می‌گذارد چه تعداد فایل/رکورد حذف شد
 *  - محافظت با CRON_SECRET (مشابه cron/behavioral)
 */

// ─── تنظیمات زمان نگهداری فایل‌ها ───
// هر آیتم: مسیر نسبی از public/uploads + تعداد روز
const FILE_RETENTION: Array<{ dir: string; days: number; label: string }> = [
  { dir: "chat",          days: 30, label: "chat-media"     },
  { dir: "chat/tts",      days: 7,  label: "chat-tts"       },
  { dir: "body-photos",   days: 90, label: "body-photos"    },
  { dir: "body-analysis", days: 90, label: "body-analysis"  },
  { dir: "blood-tests",   days: 90, label: "blood-tests"    },
  { dir: "videos",        days: 30, label: "videos"         },
  { dir: "meal-analysis", days: 7,  label: "meal-analysis"  },
];

// ─── تنظیمات زمان نگهداری رکوردهای AnalysisResult ───
const ANALYSIS_RESULT_RETENTION: Array<{ type: string; days: number }> = [
  { type: "food_photo",     days: 7  },
  { type: "body_photo",     days: 90 },
  { type: "video_analysis", days: 30 },
  { type: "blood_test",     days: 90 },
];

// زمان نگهداری mediaUrl در ChatMessage (متن پیام نگه داشته می‌شود)
const CHAT_MESSAGE_MEDIA_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * پاک‌سازی یک دایرکتوری: فایل‌هایی قدیمی‌تر از `cutoffMs` حذف می‌شوند.
 * اگر دایرکتوری وجود نداشته باشد، no-op برمی‌گردد.
 * فقط فایل‌های مستقیم (سطح بالا) بررسی می‌شوند — زیردایرکتوری‌ها را دست نمی‌زنیم،
 * چون هر زیردایرکتوری (مثل chat/tts) در همان لیست جداگانه آورده شده.
 */
async function cleanupDirectory(
  relDir: string,
  cutoffMs: number
): Promise<{ scanned: number; deleted: number; errors: number }> {
  const absDir = path.join(process.cwd(), "public", "uploads", relDir);
  let scanned = 0;
  let deleted = 0;
  let errors = 0;

  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    // دایرکتوری وجود ندارد — no-op
    return { scanned: 0, deleted: 0, errors: 0 };
  }

  for (const name of entries) {
    const fullPath = path.join(absDir, name);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      // فایل حذف شده یا دسترسی ندارد — رد کن
      continue;
    }
    // فقط فایل‌های عادی را پاک کن — دایرکتوری‌ها را دست نمی‌زنیم
    if (!s.isFile()) continue;
    scanned++;

    // mtime فایل را با cutoff مقایسه کن
    if (s.mtimeMs < cutoffMs) {
      try {
        await unlink(fullPath);
        deleted++;
      } catch (err) {
        console.error(`[cleanup-media] failed to delete ${relDir}/${name}:`, err);
        errors++;
      }
    }
  }

  return { scanned, deleted, errors };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET || "fitup-cron-secret-2025";

  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const summary: {
    runAt: string;
    files: Array<{ dir: string; label: string; scanned: number; deleted: number; errors: number }>;
    analysisResults: Array<{ type: string; deleted: number }>;
    chatMessagesCleared: number;
    totalFilesDeleted: number;
    totalRecordsDeleted: number;
    errors: string[];
  } = {
    runAt: new Date(now).toISOString(),
    files: [],
    analysisResults: [],
    chatMessagesCleared: 0,
    totalFilesDeleted: 0,
    totalRecordsDeleted: 0,
    errors: [],
  };

  // ─── ۱) پاک‌سازی فایل‌ها ───
  for (const cfg of FILE_RETENTION) {
    const cutoffMs = now - cfg.days * DAY_MS;
    try {
      const res = await cleanupDirectory(cfg.dir, cutoffMs);
      summary.files.push({ dir: cfg.dir, label: cfg.label, ...res });
      summary.totalFilesDeleted += res.deleted;
    } catch (err) {
      console.error(`[cleanup-media] directory ${cfg.dir} failed:`, err);
      summary.errors.push(`dir:${cfg.dir} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── ۲) پاک‌سازی رکوردهای AnalysisResult ───
  for (const cfg of ANALYSIS_RESULT_RETENTION) {
    const cutoffDate = new Date(now - cfg.days * DAY_MS);
    try {
      // ابتدا تعداد رکوردهایی که قرار است حذف شوند را بشمار (برای لاگ)
      const count = await db.analysisResult.count({
        where: { type: cfg.type, createdAt: { lt: cutoffDate } },
      });
      if (count > 0) {
        await db.analysisResult.deleteMany({
          where: { type: cfg.type, createdAt: { lt: cutoffDate } },
        });
      }
      summary.analysisResults.push({ type: cfg.type, deleted: count });
      summary.totalRecordsDeleted += count;
    } catch (err) {
      console.error(`[cleanup-media] AnalysisResult ${cfg.type} cleanup failed:`, err);
      summary.errors.push(
        `AnalysisResult:${cfg.type} - ${err instanceof Error ? err.message : String(err)}`
      );
      summary.analysisResults.push({ type: cfg.type, deleted: 0 });
    }
  }

  // ─── ۳) پاک‌سازی mediaUrl در ChatMessageها (متن نگه داشته می‌شود) ───
  try {
    const cutoffDate = new Date(now - CHAT_MESSAGE_MEDIA_RETENTION_DAYS * DAY_MS);
    const count = await db.chatMessage.count({
      where: {
        mediaUrl: { not: null },
        createdAt: { lt: cutoffDate },
      },
    });
    if (count > 0) {
      await db.chatMessage.updateMany({
        where: {
          mediaUrl: { not: null },
          createdAt: { lt: cutoffDate },
        },
        data: { mediaUrl: null, mediaType: null },
      });
    }
    summary.chatMessagesCleared = count;
    summary.totalRecordsDeleted += count;
  } catch (err) {
    console.error("[cleanup-media] ChatMessage media cleanup failed:", err);
    summary.errors.push(
      `ChatMessage - ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ─── لاگ نهایی ───
  console.log(
    `[cleanup-media] run @ ${summary.runAt}: ` +
      `files deleted=${summary.totalFilesDeleted}, ` +
      `records deleted=${summary.totalRecordsDeleted}, ` +
      `chatMessages cleared=${summary.chatMessagesCleared}, ` +
      `errors=${summary.errors.length}`
  );

  return Response.json({ ok: true, ...summary });
}
