import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { checkQuota } from "@/lib/fitness/quota";
import {
  isChunkedTarget,
  isValidUploadId,
  saveChunk,
  CHUNKED_MAX_CHUNK_BYTES,
  type ChunkedUploadTarget,
} from "@/lib/fitness/chunked-upload";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/coach/upload-chunk — یک چانک از آپلود چانکی ویدیو (v90)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * فیکس ریشه‌ای «ویدیوی ۸۶ مگابایتی آپلود نمی‌شود» (گزارش مالک): آپلود
 * تک‌درخواستیِ فایل بزرگ روی گیت‌وی تولیدی (~۱۲۰s قطع) برای اتصال موبایل ایران
 * به‌طور قابل‌اعتماد شکست می‌خورد. چانک‌های کوچک (۴ مگابایت) هر کدام یک
 * درخواست چندثانیه‌ای مستقل‌اند — عملاً هیچ سقف/تایم‌اوتی نمی‌بینند.
 *
 * هدرها:
 *   x-upload-id      — شناسهٔ یکتای آپلود (الگوی [A-Za-z0-9_-]{8,64})
 *   x-upload-target  — "chat" | "videos"
 *   x-chunk-index    — ایندکس چانک (۰-based)
 * بدنه: بایت‌های خام (application/octet-stream)
 *
 * پاسخ: { ok: true } یا خطای ساختارمند فارسی.
 */

const ALLOWED_TARGETS: Record<ChunkedUploadTarget, { capability: string }> = {
  chat: { capability: "chatVideoUpload" },
  videos: { capability: "videoBodyAnalysis" },
  // v111 — ویدیوی حرکات فقط از مسیر ادمین (/api/admin/exercises/upload-chunk)
  // آپلود می‌شود؛ این قابلیت به هیچ پلنی داده نمی‌شود → این مسیر همیشه ۴۰۳ می‌دهد.
  "exercise-videos": { capability: "__admin_only_exercise_video__" },
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const userId = user.id;

    const uploadId = req.headers.get("x-upload-id");
    const target = req.headers.get("x-upload-target");
    const chunkIndexRaw = req.headers.get("x-chunk-index");

    if (!isValidUploadId(uploadId)) {
      return Response.json({ error: "شناسهٔ آپلود نامعتبر است.", code: "INVALID_UPLOAD_ID" }, { status: 400 });
    }
    if (!isChunkedTarget(target)) {
      return Response.json({ error: "مقصد آپلود نامعتبر است.", code: "INVALID_TARGET" }, { status: 400 });
    }
    const chunkIndex = Number(chunkIndexRaw);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return Response.json({ error: "شمارهٔ چانک نامعتبر است.", code: "INVALID_INDEX" }, { status: 400 });
    }

    // گیت پلن هر چانک — ارزان است (کوئری DB) و فایل نیمه‌مجاز ذخیره نمی‌شود
    const gate = ALLOWED_TARGETS[target];
    await requirePlanCapability(gate.capability);

    // سهمیهٔ ویدیوی چت — فقط روی چانک اول fail-fast (مصرف واقعی بعد از تحلیل موفق)
    if (target === "chat" && chunkIndex === 0) {
      const quota = await checkQuota(userId, "movement_video");
      if (!quota.allowed) {
        return Response.json(
          { error: quota.messageFa ?? "سهمیهٔ ارسال ویدیو تمام شده است.", code: quota.code },
          { status: 429 }
        );
      }
    }

    // محدودیت نرخ سخاوتمندانه — ۲۴۰ چانک در دقیقه (≈۱GB/min — ضد سوءاستفاده)
    const rl = rateLimit(`upload-chunk:${userId}`, 240, 60_000);
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
