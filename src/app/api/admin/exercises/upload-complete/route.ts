import { NextRequest } from "next/server";
import { stat } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  isChunkedTarget,
  isValidUploadId,
  assembleChunks,
  safeExtFromFileName,
} from "@/lib/fitness/chunked-upload";
import {
  compressVideoFileInPlace,
} from "@/lib/fitness/media-compress";
import {
  isSafeExerciseFileId,
  safeExerciseVideoAbsolutePath,
  removeExerciseVideoFile,
  generateExerciseVideoPoster,
  EXERCISE_VIDEOS_DIR,
} from "@/lib/fitness/exercise-video-files";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/admin/exercises/upload-complete — پایان آپلود ویدیوی اختصاصی حرکت
 * (v112 — سرهم‌کردن چانک‌ها + فشرده‌سازی + پوستر + ثبت در ExerciseLibrary)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * بدنه (JSON): { uploadId, exerciseId, totalChunks, filename, mime }
 * (+ فیلدهای استاندارد کلاینت چانکی: target/fileName/fileType/size — سازگار)
 *
 * جریان:
 *  ۱) گیت requireAdmin + اعتبارسنجی حرکت/پسوند (mp4|webm|mov|m4v|mkv)
 *  ۲) سرهم‌کردن چانک‌ها → uploads/exercise-videos/ex-{exerciseId}-{ts}.{ext}
 *  ۳) ffprobe → فشرده‌سازی درجا (libx264 crf 20 / preset medium / ≤1080p /
 *     aac 128k / +faststart) — فقط اگر ≥۱۰٪ کوچک‌تر شود؛ ffmpeg نبود/شکست =
 *     نگه‌داشتن فایل اصلی (compressed:false — degrade graceful)
 *  ۴) پوستر: ffmpeg -ss 0.1 -frames:v 1 -vf scale=640:-2 → posters/ex-…-{ts}.jpg
 *  ۵) حذف امن ویدیو/پوستر قبلیِ همان حرکت (فقط داخل uploads/exercise-videos/)
 *  ۶) آپدیت ExerciseLibrary: videoUrl / videoSizeBytes / videoPosterUrl
 *
 * پاسخ: { ok, videoUrl, videoPosterUrl, sizeBefore, sizeAfter, compressed }
 */

const REQUIRED_TARGET = "exercise-videos";
const ALLOWED_EXTS = ["mp4", "webm", "mov", "m4v", "mkv"];

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManagePrograms");

    const rl = rateLimit(`admin-ex-upload-complete:${admin.id}`, 20, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "درخواست نامعتبر است.", code: "INVALID_BODY" }, { status: 400 });
    }

    const { uploadId, target, totalChunks } = body as Record<string, unknown>;
    // filename/mime (قرارداد این endpoint) با fileName/fileType (پیش‌فرض کلاینت) سازگارند
    const fileName =
      typeof body.filename === "string" && body.filename
        ? body.filename
        : typeof body.fileName === "string"
          ? body.fileName
          : "";
    const mime =
      typeof body.mime === "string" && body.mime
        ? body.mime
        : typeof body.fileType === "string"
          ? body.fileType
          : "";

    if (!isValidUploadId(uploadId)) {
      return Response.json({ error: "شناسهٔ آپلود نامعتبر است.", code: "INVALID_UPLOAD_ID" }, { status: 400 });
    }
    if (!isChunkedTarget(target) || target !== REQUIRED_TARGET) {
      return Response.json({ error: "مقصد آپلود نامعتبر است.", code: "INVALID_TARGET" }, { status: 400 });
    }
    if (!isSafeExerciseFileId(body.exerciseId)) {
      return Response.json({ error: "شناسهٔ حرکت نامعتبر است.", code: "INVALID_EXERCISE_ID" }, { status: 400 });
    }
    const exerciseId = body.exerciseId;

    // پسوند: از نام فایل (لیست سفید) — فال‌بک به mime استاندارد ویدیو
    const ext = safeExtFromFileName(fileName, ALLOWED_EXTS);
    const finalExt = ext || mimeToExt(String(mime || ""));
    if (!finalExt) {
      return Response.json(
        { error: "فقط فایل ویدیویی با فرمت mp4/webm/mov/m4v/mkv مجاز است.", code: "INVALID_FORMAT" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(Number(totalChunks)) || Number(totalChunks) < 1) {
      return Response.json({ error: "تعداد چانک نامعتبر است.", code: "INVALID_TOTAL" }, { status: 400 });
    }

    // حرکت باید واقعاً وجود داشته باشد (و ویدیوی قبلی برای حذف امن خوانده شود)
    const exercise = await db.exerciseLibrary.findUnique({
      where: { id: exerciseId },
      select: { id: true, videoUrl: true, videoPosterUrl: true },
    });
    if (!exercise) {
      return Response.json({ error: "حرکت یافت نشد.", code: "NOT_FOUND" }, { status: 404 });
    }

    // ─── ۱) سرهم‌کردن چانک‌ها → uploads/exercise-videos/ ───
    const ts = Date.now();
    const assembled = await assembleChunks({
      target: REQUIRED_TARGET,
      uploadId,
      totalChunks: Number(totalChunks),
      extForAssembly: finalExt,
      fileNameBuilder: (e) => `ex-${exerciseId}-${ts}.${e}`,
    });
    if (!assembled.ok) {
      return Response.json({ error: assembled.error, code: assembled.code }, { status: assembled.status });
    }

    const finalAbs = safeExerciseVideoAbsolutePath(assembled.url);
    if (!finalAbs) {
      return Response.json(
        { error: "مسیر فایل نهایی نامعتبر است.", code: "INVALID_PATH" },
        { status: 500 }
      );
    }
    const sizeBefore = assembled.size;

    // ─── ۲) فشرده‌سازی درجا — ffmpeg نبود → فایل اصلی می‌ماند (compressed:false) ───
    // timeout زیر سقف ~۱۲۰s گیت‌وی نگه شده تا پاسخ به کلاینت نرسد به قطع شدن
    const compressResult = await compressVideoFileInPlace(finalAbs, {
      crf: 20,
      preset: "medium",
      maxHeight: 1080,
      audioBitrate: "128k",
      timeoutMs: 110_000,
    });
    console.log(
      `[admin-ex-video] compress: exercise=${exerciseId} compressed=${compressResult.compressed} skipped=${compressResult.skipped ?? "-"} sizeBefore=${sizeBefore} resultAfter=${compressResult.sizeAfter}`
    );

    const finalSt = await stat(finalAbs).catch(() => null);
    const sizeAfter = finalSt?.size ?? sizeBefore;

    // ─── ۳) پوستر — فریم شاخص ۶۴۰px (ffmpeg نبود → خالی) ───
    const posterName = `ex-${exerciseId}-${ts}.jpg`;
    const posterFinalAbs = path.join(EXERCISE_VIDEOS_DIR, "posters", posterName);
    const posterOk = await generateExerciseVideoPoster(finalAbs, posterFinalAbs);
    const posterUrl = posterOk
      ? `/uploads/exercise-videos/posters/${posterName}`
      : "";

    // ─── ۴) حذف امن فایل‌های قبلی (فقط داخل uploads/exercise-videos/) ───
    await removeExerciseVideoFile(exercise.videoUrl);
    await removeExerciseVideoFile(exercise.videoPosterUrl);

    // ─── ۵) ثبت در ExerciseLibrary ───
    await db.exerciseLibrary.update({
      where: { id: exerciseId },
      data: {
        videoUrl: assembled.url,
        videoSizeBytes: sizeAfter,
        videoPosterUrl: posterUrl,
      },
    });

    return Response.json({
      ok: true,
      videoUrl: assembled.url,
      videoPosterUrl: posterUrl,
      sizeBefore,
      sizeAfter,
      compressed: compressResult.compressed === true,
    });
  } catch (e) {
    return apiError(e);
  }
}

function mimeToExt(mime: string): string | null {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
    "video/x-matroska": "mkv",
  };
  return map[mime.toLowerCase()] || null;
}
