import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat, rename, unlink } from "fs/promises";
import path from "path";

/**
 * فشرده‌سازی ویدیوهای آپلودی کاربر (v53)
 * قانون مالک: هیچ سقفی روی حجم آپلود نیست؛ بعد از آپلود، نسخهٔ کم‌حجم ساخته می‌شود،
 * تحلیل روی نسخهٔ فشرده انجام می‌شود و نسخهٔ اصلی حذف می‌گردد (نسخهٔ فشرده همیشه می‌ماند).
 *
 * ایمنی: این ماژول هرگز throw نمی‌کند — در هر شکست نسخهٔ اصلی دست‌نخورده می‌ماند
 * و ok:false برگردانده می‌شود تا جریان آپلود/تحلیل هرگز به‌خاطر فشرده‌سازی نشکند.
 */

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
  codec?: string;
}

export interface CompressVideoResult {
  ok: boolean;
  compressed: boolean; // آیا فایل جایگزین شد
  skipped?: "too_small" | "not_smaller" | "probe_failed" | "ffmpeg_missing" | "error";
  sizeBefore: number;
  sizeAfter: number;
  info?: VideoInfo;
}

/** خواندن مشخصات ویدیو با ffprobe — در خطا null */
export async function probeVideoFile(filePath: string): Promise<VideoInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        filePath,
      ],
      { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
      }>;
    };
    const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
    if (!videoStream) return null;
    return {
      durationSec: Number(parsed.format?.duration || 0) || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      sizeBytes: Number(parsed.format?.size || 0) || 0,
      codec: videoStream.codec_name,
    };
  } catch {
    return null;
  }
}

/**
 * فشرده‌سازی درجا: خروجی MP4 با H.264 + faststart، حداکثر ارتفاع maxHeight،
 * فقط وقتی حداقل ۱۰٪ کوچک‌تر شود جایگزین می‌کند؛ وگرنه نسخهٔ اصلی می‌ماند.
 */
export async function compressVideoFileInPlace(
  filePath: string,
  opts?: {
    maxHeight?: number; // پیش‌فرض ۷۲۰
    crf?: number; // پیش‌فرض ۲۸ (کیفیت خوب، حجم کم)
    audioBitrate?: string; // پیش‌فرض 96k
    timeoutMs?: number; // پیش‌فرض ۵ دقیقه
    minSizeBytes?: number; // زیر این حجم فشرده نشود (پیش‌فرض ۲MB)
  }
): Promise<CompressVideoResult> {
  const maxHeight = Math.max(240, Math.min(1080, opts?.maxHeight ?? 720));
  const crf = Math.max(18, Math.min(34, opts?.crf ?? 28));
  const audioBitrate = opts?.audioBitrate ?? "96k";
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
  const minSizeBytes = opts?.minSizeBytes ?? 2 * 1024 * 1024;

  const base: CompressVideoResult = { ok: false, compressed: false, sizeBefore: 0, sizeAfter: 0 };

  try {
    const st = await stat(filePath).catch(() => null);
    if (!st || !st.isFile()) return { ...base, skipped: "error" };
    base.sizeBefore = st.size;

    const info = await probeVideoFile(filePath);
    if (!info || info.durationSec <= 0) return { ...base, skipped: "probe_failed" };
    base.info = info;

    if (st.size <= minSizeBytes) return { ...base, ok: true, skipped: "too_small" };

    const tmpOut = path.join(
      path.dirname(filePath),
      `.cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
    );

    try {
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i", filePath,
          "-vf", `scale=-2:'min(ih,${maxHeight})'`,
          "-c:v", "libx264",
          "-crf", String(crf),
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", audioBitrate,
          "-movflags", "+faststart",
          tmpOut,
        ],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch {
      await unlink(tmpOut).catch(() => {});
      return { ...base, skipped: "ffmpeg_missing" };
    }

    const outSt = await stat(tmpOut).catch(() => null);
    if (!outSt || !outSt.isFile() || outSt.size === 0) {
      await unlink(tmpOut).catch(() => {});
      return { ...base, skipped: "error" };
    }

    // اعتبارسنجی خروجی قبل از جایگزینی — هیچ‌وقت فایل سالم را خراب نمی‌کنیم
    const outInfo = await probeVideoFile(tmpOut);
    if (!outInfo || outInfo.durationSec <= 0) {
      await unlink(tmpOut).catch(() => {});
      return { ...base, skipped: "probe_failed" };
    }

    // فقط اگر واقعاً کوچک‌تر شد (حداقل ۱۰٪) جایگزین کن
    if (outSt.size >= st.size * 0.9) {
      await unlink(tmpOut).catch(() => {});
      return { ...base, ok: true, compressed: false, sizeAfter: st.size, skipped: "not_smaller", info: outInfo };
    }

    await rename(tmpOut, filePath);
    return { ok: true, compressed: true, sizeBefore: st.size, sizeAfter: outSt.size, info: outInfo };
  } catch {
    return { ...base, skipped: "error" };
  }
}

/** قالب خوانا برای لاگ/پیام */
export function formatBytes(n: number): string {
  if (!n || n <= 0) return "۰";
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  return `${Math.round(n / 1024)}KB`;
}
