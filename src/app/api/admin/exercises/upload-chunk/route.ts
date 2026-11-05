import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  isChunkedTarget,
  isValidUploadId,
  saveChunk,
  CHUNKED_MAX_CHUNK_BYTES,
} from "@/lib/fitness/chunked-upload";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/admin/exercises/upload-chunk — یک چانک از آپلود ویدیوی اختصاصی
 * حرکت (v112 — آینهٔ /api/coach/upload-chunk با گیت ادمین به‌جای گیت پلن)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * چرا چانکی؟ آپلود تک‌درخواستیِ ویدیوی بزرگ روی گیت‌وی تولیدی (~۱۲۰s قطع)
 * قابل‌اعتماد نیست — همان فیکس ریشه‌ای v90 چت/تحلیل بدن، برای بانک حرکات.
 *
 * هدرها:
 *   x-upload-id      — شناسهٔ یکتای آپلود (الگوی [A-Za-z0-9_-]{8,64})
 *   x-upload-target  — فقط "exercise-videos" (رسانهٔ عمومی — آموزش حرکت)
 *   x-chunk-index    — ایندکس چانک (۰-based)
 * بدنه: بایت‌های خام (application/octet-stream)
 *
 * مقصد نهایی فایل: uploads/exercise-videos/<ex-{exerciseId}-{ts}.{ext}>
 * (در upload-complete سرهم + فشرده + پوستر + ثبت در ExerciseLibrary می‌شود)
 */

const REQUIRED_TARGET = "exercise-videos";

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManagePrograms");

    const uploadId = req.headers.get("x-upload-id");
    const target = req.headers.get("x-upload-target");
    const chunkIndexRaw = req.headers.get("x-chunk-index");

    if (!isValidUploadId(uploadId)) {
      return Response.json({ error: "شناسهٔ آپلود نامعتبر است.", code: "INVALID_UPLOAD_ID" }, { status: 400 });
    }
    if (!isChunkedTarget(target) || target !== REQUIRED_TARGET) {
      return Response.json({ error: "مقصد آپلود نامعتبر است.", code: "INVALID_TARGET" }, { status: 400 });
    }
    const chunkIndex = Number(chunkIndexRaw);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return Response.json({ error: "شمارهٔ چانک نامعتبر است.", code: "INVALID_INDEX" }, { status: 400 });
    }

    // محدودیت نرخ — ۲۴۰ چانک در دقیقه (≈۱GB/min — سخاوتمندانه، ضد سوءاستفاده)
    const rl = rateLimit(`admin-ex-upload-chunk:${admin.id}`, 240, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = await req.arrayBuffer();
    if (body.byteLength > CHUNKED_MAX_CHUNK_BYTES) {
      return Response.json({ error: "چانک بزرگ‌تر از حد مجاز است.", code: "CHUNK_TOO_LARGE" }, { status: 413 });
    }

    const result = await saveChunk(target, uploadId, chunkIndex, body);
    if (!result.ok) {
      return Response.json({ error: result.error, code: result.code }, { status: result.status });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
