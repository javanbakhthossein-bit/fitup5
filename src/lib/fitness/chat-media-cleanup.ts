/**
 * v86 — پاک‌سازی دوره‌ای رسانه‌های «چت با فیتاپ» (دیرکتیو جدید مالک — جایگزین
 * سیاست همیشگی v53 فقط برای رسانهٔ چت):
 *
 *   «عکس‌ها و ویدیوهایی که کاربر در چت با فیتاپ ارسال می‌کند بعد از سه روز
 *    نسخهٔ کم‌حجمش پاک شود ... ولی تحلیل‌هاش نگه داشته شود.»
 *
 * سیاست (retention = ۷۲ ساعت):
 *  ۱) فقط فایل‌های مستقیمِ uploads/chat/ با پیشوند شناخته‌شدهٔ رسانهٔ چت
 *     (chat-image-* / chat-video-* / chat-vframe-* / chat-frame-*) که mtime
 *     آن‌ها قدیمی‌تر از ۷۲ ساعت است حذف می‌شوند.
 *  ۲) زیرپوشه‌ها (مثل chat/tts — صوت پاسخ AI با سیاست نگهداری خودش) و هر
 *     پیشوند دیگری هرگز دست نمی‌خورند.
 *  ۳) بروزرسانی دیتابیس بعد از حذف هر فایل:
 *     - ردیف‌هایی که mediaUrlشان دقیقاً همان فایل بود → mediaUrl = null
 *     - ردیف‌هایی که آرایهٔ mediaFramesشان آن URL را داشت → URL از آرایه حذف
 *       می‌شود (آرایهٔ خالی → null)
 *     - mediaType ، content و بخصوص mediaAnalysis (تحلیل بینایی) دست‌نخورده
 *       می‌مانند — دیرکتیو صریح مالک: «ولی تحلیل‌هاش نگه داشته شود».
 *  ۴) کمربند و بند: فقط مسیرهایی که با /uploads/chat/ شروع می‌شوند لمس
 *     می‌شوند؛ مسیر نهایی قبل از unlink با resolve دوباره چک می‌شود.
 *
 * ردیف‌های کاندید دیتابیس با پنجرهٔ createdAt < مهلت ۷۲ ساعت خوانده می‌شوند
 * (نه اسکن کامل جدول) — هر ردیفی که به فایلی ارجاع دارد لاجرم قدیمی‌تر از
 * همین مهلت ساخته شده است.
 *
 * این منطق از فایل route جدا شده تا در تست (bun) هم مستقیم قابل فراخوانی باشد.
 */
import path from "path";
import { readdir, stat, unlink } from "fs/promises";
import { UPLOADS_ROOT } from "./uploads-config";
import { db } from "@/lib/db";

/** مهلت نگهداری رسانهٔ چت — ۷۲ ساعت (۳ روز — دیرکتیو مالک) */
export const CHAT_MEDIA_RETENTION_MS = 72 * 60 * 60 * 1000;

/** پیشوند URL رسانهٔ چت — کمربند و بند: خارج از این پیشوند هیچ‌چیز لمس نمی‌شود */
const CHAT_MEDIA_URL_PREFIX = "/uploads/chat/";

/**
 * پیشوندهای نام فایلِ رسانهٔ چت (هم‌خوان با نام‌گذاری در chat/route.ts و
 * chat/upload/route.ts): عکس (chat-image-)، ویدیو (chat-video- — مسیر base64
 * و multipart) و فریم‌های استخراج‌شدهٔ ویدیو (chat-vframe-؛ chat-frame- هم
 * برای سازگاری با فرمت نام‌گذاری مستند سیاست پذیرفته می‌شود).
 */
const CHAT_MEDIA_FILE_PREFIXES = [
  "chat-image-",
  "chat-video-",
  "chat-vframe-",
  "chat-frame-",
] as const;

/** خلاصهٔ اجرای یک چرخهٔ پاک‌سازی (خروجی route و تست) */
export interface ChatMediaCleanupSummary {
  ok: boolean;
  runAt: string;
  policy: "chat-media-72h";
  cutoffIso: string;
  scannedFiles: number;
  deletedFiles: number;
  updatedMessages: number;
  errors: number;
}

/**
 * اجرای یک چرخهٔ کامل پاک‌سازی رسانهٔ چت. هیچ‌جا throw نمی‌کند — خطاها در
 * summary.errors شمرده می‌شوند تا جاروی دوره‌ای هرگز کرش نکند.
 */
export async function runChatMediaCleanup(): Promise<ChatMediaCleanupSummary> {
  const runAtDate = new Date();
  const cutoff = new Date(runAtDate.getTime() - CHAT_MEDIA_RETENTION_MS);
  const summary: ChatMediaCleanupSummary = {
    ok: true,
    runAt: runAtDate.toISOString(),
    policy: "chat-media-72h",
    cutoffIso: cutoff.toISOString(),
    scannedFiles: 0,
    deletedFiles: 0,
    updatedMessages: 0,
    errors: 0,
  };

  const chatDir = path.resolve(UPLOADS_ROOT, "chat");

  // ─── مرحلهٔ ۱: یافتن فایل‌های رسانهٔ چت کهنسال روی دیسک ───
  const expiredFiles: { url: string; filePath: string }[] = [];
  try {
    const entries = await readdir(chatDir, { withFileTypes: true });
    for (const entry of entries) {
      // فقط فایل‌های مستقیم پوشهٔ chat — زیرپوشه‌ها (chat/tts و …) دست‌نخورده‌اند
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!CHAT_MEDIA_FILE_PREFIXES.some((p) => name.startsWith(p))) continue;

      const filePath = path.join(chatDir, name);
      // گارد کمربند و بند: مسیر نهایی حتماً باید داخل پوشهٔ chat بماند
      if (!filePath.startsWith(chatDir + path.sep)) continue;

      summary.scannedFiles++;
      try {
        const st = await stat(filePath);
        if (!st.isFile() || st.mtimeMs >= cutoff.getTime()) continue; // هنوز داخل مهلت
        expiredFiles.push({ url: CHAT_MEDIA_URL_PREFIX + name, filePath });
      } catch {
        // فایل حین اسکن حذف/جابه‌جا شده — بی‌خطر
      }
    }
  } catch (err) {
    // پوشهٔ chat وجود ندارد یا خوانده نشد — چرخهٔ بی‌عملیات امن
    console.error("[chat-media-cleanup] پوشهٔ رسانهٔ چت خوانده نشد:", err);
    summary.errors++;
    return summary;
  }

  if (expiredFiles.length === 0) {
    return summary; // چیزی برای پاک‌کردن نیست
  }

  // ─── مرحلهٔ ۲: ردیف‌های کاندید دیتابیس (فقط پیام‌های قدیمی‌تر از مهلت) ───
  // ردیفی که به فایل کهنسال ارجاع می‌دهد لاجرم قبل از مهلت ساخته شده است.
  let candidates: { id: string; mediaUrl: string | null; mediaFrames: string | null }[] = [];
  try {
    candidates = await db.chatMessage.findMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ mediaUrl: { not: null } }, { mediaFrames: { not: null } }],
      },
      select: { id: true, mediaUrl: true, mediaFrames: true },
    });
  } catch (err) {
    console.error("[chat-media-cleanup] خواندن ردیف‌های کاندید شکست خورد:", err);
    summary.errors++;
    // بدون ردیف‌ها ادامه نمی‌دهیم — حذف فایل بدون nullکردن ارجاع، پیام شکسته می‌سازد
    return summary;
  }

  const deletedUrls = new Set(expiredFiles.map((f) => f.url));

  // ─── مرحلهٔ ۳: حذف فایل‌ها (فقط مسیرهای /uploads/chat/) ───
  for (const file of expiredFiles) {
    // کمربند و بند نهایی: URL باید با پیشوند مجاز شروع شود
    if (!file.url.startsWith(CHAT_MEDIA_URL_PREFIX)) continue;
    try {
      await unlink(file.filePath);
      summary.deletedFiles++;
    } catch (err) {
      // ENOENT یعنی قبلاً حذف شده — خطا نیست؛ بقیهٔ خطاها شمرده می‌شوند
      if ((err as { code?: string }).code !== "ENOENT") {
        console.error(`[chat-media-cleanup] حذف فایل ناموفق: ${file.url}`, err);
        summary.errors++;
        deletedUrls.delete(file.url); // حذف نشده → ارجاعش نباید null شود
      }
    }
  }

  if (deletedUrls.size === 0) {
    return summary;
  }

  // ─── مرحلهٔ ۴: بروزرسانی ردیف‌های ارجاع‌دهنده (mediaAnalysis و content حفظ می‌شوند) ───
  try {
    // ۴-الف) mediaUrl دقیقاً برابر URL فایل حذف‌شده → null
    const res = await db.chatMessage.updateMany({
      where: { mediaUrl: { in: Array.from(deletedUrls) } },
      data: { mediaUrl: null },
      // mediaType/content/mediaAnalysis دست‌نخورده می‌مانند (فقط mediaUrl null می‌شود)
    });
    summary.updatedMessages += res.count;
  } catch (err) {
    console.error("[chat-media-cleanup] nullکردن mediaUrl شکست خورد:", err);
    summary.errors++;
  }

  // ۴-ب) فریم‌ها: ردیف‌هایی که mediaFramesشان URL حذف‌شده را داشت → URL از آرایه
  // حذف شود (آرایهٔ خالی → null). فقط ردیف‌های کاندید مرحلهٔ ۲ چک می‌شوند.
  for (const row of candidates) {
    if (!row.mediaFrames) continue;
    let frames: string[] = [];
    try {
      const parsed = JSON.parse(row.mediaFrames);
      if (Array.isArray(parsed)) {
        frames = parsed.filter((u: unknown): u is string => typeof u === "string");
      }
    } catch {
      continue; // JSON خراب — ربطی به پاک‌سازی ما ندارد
    }
    if (!frames.some((u) => deletedUrls.has(u))) continue;
    const remaining = frames.filter((u) => !deletedUrls.has(u));
    try {
      await db.chatMessage.update({
        where: { id: row.id },
        data: { mediaFrames: remaining.length > 0 ? JSON.stringify(remaining) : null },
      });
      summary.updatedMessages++;
    } catch (err) {
      console.error(`[chat-media-cleanup] بروزرسانی mediaFrames ردیف ${row.id} ناموفق:`, err);
      summary.errors++;
    }
  }

  console.log(
    `[chat-media-cleanup] policy=chat-media-72h — deletedFiles=${summary.deletedFiles} updatedMessages=${summary.updatedMessages} errors=${summary.errors} (cutoff=${summary.cutoffIso})`
  );
  return summary;
}
