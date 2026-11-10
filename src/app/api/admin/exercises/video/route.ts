import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { isSafeExerciseFileId, removeExerciseVideoFile } from "@/lib/fitness/exercise-video-files";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELETE /api/admin/exercises/video?exerciseId=… — حذف ویدیوی اختصاصی حرکت
 * (v112 — پنل ادمین، بانک حرکات)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * فایل ویدیو + پوستر از دیسک حذف می‌شوند (گارد مسیر: فقط داخل
 * uploads/exercise-videos/) و فیلدهای videoUrl/videoSizeBytes/videoPosterUrl
 * رکورد ریست می‌شوند. youtubeUrl دست‌نخورده می‌ماند (فال‌بک طبیعی).
 * نبودن ویدیو روی حرکتی خطا نیست — idempotent.
 */

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManagePrograms");

    const exerciseId = new URL(req.url).searchParams.get("exerciseId");
    if (!isSafeExerciseFileId(exerciseId)) {
      return Response.json({ error: "شناسهٔ حرکت نامعتبر است.", code: "INVALID_EXERCISE_ID" }, { status: 400 });
    }

    const exercise = await db.exerciseLibrary.findUnique({
      where: { id: exerciseId },
      select: { id: true, videoUrl: true, videoPosterUrl: true },
    });
    if (!exercise) {
      return Response.json({ error: "حرکت یافت نشد.", code: "NOT_FOUND" }, { status: 404 });
    }

    // حذف امن فایل‌ها — مسیر نامعتبر/خارج از پوشه نادیده گرفته می‌شود
    const removedVideo = await removeExerciseVideoFile(exercise.videoUrl);
    const removedPoster = await removeExerciseVideoFile(exercise.videoPosterUrl);

    await db.exerciseLibrary.update({
      where: { id: exerciseId },
      data: {
        videoUrl: "",
        videoSizeBytes: 0,
        videoPosterUrl: "",
      },
    });

    console.log(
      `[admin-ex-video] deleted: exercise=${exerciseId} video=${removedVideo} poster=${removedPoster} by=${admin.id}`
    );

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
