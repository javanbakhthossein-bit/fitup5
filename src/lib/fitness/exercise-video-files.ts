import "server-only";
import path from "path";
import { stat, unlink, mkdir } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { UPLOADS_ROOT } from "./uploads-config";
import { absolutePathForUploadUrl } from "./private-media";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v112 — ابزار فایل ویدیوی اختصاصی حرکات (بانک حرکات — پنل ادمین)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * فایل‌ها در `uploads/exercise-videos/` (خارج از public) ذخیره می‌شوند؛ چون
 * این دسته در PRIVATE_MEDIA_DIRS نیست، route سرو (/uploads/... با HTTP
 * Range/206) آن‌ها را «عمومی» با کش immutable سرو می‌کند — ویدیوی آموزشی
 * حرکت محتوای عمومی سایت است (هم‌خانوادهٔ /uploads/articles).
 *
 * هرگز throw نمی‌کند — caller خطا را به پاسخ فارسی تبدیل می‌کند.
 */

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

/** پوشهٔ امن ویدیوهای اختصاصی — هر عملیات نوشتن/حذف فقط داخل همین‌جا مجاز است */
export const EXERCISE_VIDEOS_DIR = path.resolve(UPLOADS_ROOT, "exercise-videos");

/** الگوی امن شناسهٔ حرکت در نام فایل (cuid) — ضد traversal */
const SAFE_ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function isSafeExerciseFileId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ENTITY_ID_RE.test(id);
}

/** مسیر مطلق امن یک URL نسبیِ /uploads/exercise-videos/… — نامعتبر = null */
export function safeExerciseVideoAbsolutePath(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/uploads/exercise-videos/")) return null;
  const abs = path.resolve(absolutePathForUploadUrl(url));
  // گارد نهایی traversal — فایل حتماً باید داخل uploads/exercise-videos/ باشد
  if (!abs.startsWith(EXERCISE_VIDEOS_DIR + path.sep)) return null;
  return abs;
}

/**
 * حذف امن فایل ویدیو/پوستر قدیمی — فقط URLهای داخل uploads/exercise-videos/.
 * فایل‌های مسیرهای دیگر (یا نامعتبر) عمداً نادیده گرفته می‌شوند.
 */
export async function removeExerciseVideoFile(url: unknown): Promise<boolean> {
  const abs = safeExerciseVideoAbsolutePath(url);
  if (!abs) return false;
  try {
    await unlink(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * ساخت فریم شاخص (poster) با ffmpeg:
 *   ffmpeg -ss 0.1 -i <video> -frames:v 1 -vf scale=640:-2 -q:v 3 <poster.jpg>
 * اگر ffmpeg در دسترس نباشد/شکست بخورد → false (URL پوستر خالی می‌ماند — degrade graceful)
 */
export async function generateExerciseVideoPoster(
  videoAbsPath: string,
  posterAbsPath: string
): Promise<boolean> {
  try {
    await mkdir(path.dirname(posterAbsPath), { recursive: true });
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-ss", "0.1",
        "-i", videoAbsPath,
        "-frames:v", "1",
        "-vf", "scale=640:-2",
        "-q:v", "3",
        posterAbsPath,
      ],
      { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const st = await stat(posterAbsPath).catch(() => null);
    return !!st && st.isFile() && st.size > 0;
  } catch {
    await unlink(posterAbsPath).catch(() => {});
    return false;
  }
}
