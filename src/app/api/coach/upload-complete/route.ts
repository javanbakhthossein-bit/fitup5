import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { checkQuota } from "@/lib/fitness/quota";
import {
  isChunkedTarget,
  isValidUploadId,
  assembleChunks,
  safeExtFromFileName,
  type ChunkedUploadTarget,
} from "@/lib/fitness/chunked-upload";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/fitness/types";
import { startVideoBodyAnalysis } from "@/lib/fitness/video-body-analysis";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/coach/upload-complete — پایان آپلود چانکی: سرهم‌کردن چانک‌ها (v90)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * بدنه (JSON): { uploadId, target, fileName, fileType, size, totalChunks }
 *
 *  • target=chat    → فایل در uploads/chat/chat-video-{uid}-… ذخیره می‌شود
 *                     (دقیقاً همان الگویی که validateChatVideoUrl در POST چت
 *                     می‌پذیرد) و { mediaUrl, size } برمی‌گردد — کلاینت همان
 *                     mediaUrl را در POST /api/coach/chat می‌فرستد.
 *  • target=videos  → فایل در uploads/videos/video-{uid}-… ذخیره، وضعیت
 *                     videoStatus="analyzing" ثبت و تحلیل پس‌زمینهٔ فرم بدن
 *                     شروع می‌شود (همان منطق POST /api/coach/analyze-video —
 *                     کد مشترک در video-body-analysis.ts) — { mediaUrl, size,
 *                     started, status } برمی‌گردد.
 */

const ALLOWED_EXTS = ["mp4", "webm", "mov", "m4v", "mkv"];

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const userId = user.id;

    const rl = rateLimit(`upload-complete:${userId}`, 20, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "درخواست نامعتبر است.", code: "INVALID_BODY" }, { status: 400 });
    }

    const { uploadId, target, fileName, fileType, size, totalChunks } = body as Record<string, unknown>;

    if (!isValidUploadId(uploadId)) {
      return Response.json({ error: "شناسهٔ آپلود نامعتبر است.", code: "INVALID_UPLOAD_ID" }, { status: 400 });
    }
    if (!isChunkedTarget(target)) {
      return Response.json({ error: "مقصد آپلود نامعتبر است.", code: "INVALID_TARGET" }, { status: 400 });
    }
    // اعتبارسنجی نوع ویدیو — video/* یا پسوند لیست سفید (برای octet-stream کلاینت)
    const isVideoMime = typeof fileType === "string" && fileType.startsWith("video/");
    const ext = safeExtFromFileName(fileName, ALLOWED_EXTS);
    if (!isVideoMime && !ext) {
      return Response.json({ error: "فقط فایل ویدیویی مجاز است.", code: "INVALID_TYPE" }, { status: 400 });
    }
    const finalExt = ext || (isVideoMime ? mimeToExt(String(fileType)) : null);
    if (!finalExt) {
      return Response.json({ error: "فرمت ویدیو پشتیبانی نمی‌شود.", code: "INVALID_FORMAT" }, { status: 400 });
    }
    if (typeof size !== "number" || size <= 0) {
      return Response.json({ error: "حجم فایل نامعتبر است.", code: "INVALID_SIZE" }, { status: 400 });
    }

    // ─── گیت‌های نهایی هر مقصد (قبل از سرهم‌کردن) ───
    if (target === "chat") {
      await requirePlanCapability("chatVideoUpload");
      // دومین لایهٔ سهمیه (اولی روی چانک ۰؛ مصرف واقعی بعد از تحلیل موفق)
      const vQuota = await checkQuota(userId, "movement_video");
      if (!vQuota.allowed) {
        return Response.json(
          { error: vQuota.messageFa ?? "سهمیهٔ ارسال ویدیو تمام شده است.", code: vQuota.code },
          { status: 429 }
        );
      }
    } else {
      // videos — گیت پلن + سقف استفاده (همان قواعد POST /api/coach/analyze-video)
      const { planName } = await requirePlanCapability("videoBodyAnalysis");
      const limit = getCapabilities(planName).videoAnalysisLimit;
      const dbUser = await db.user.findUnique({ where: { id: userId }, select: { videoAnalysisUsed: true } });
      const used = dbUser?.videoAnalysisUsed ?? 0;
      if (limit > 0 && used >= limit) {
        return Response.json(
          { error: "سقف استفاده از این قابلیت پر شده است.", code: "LIMIT_REACHED" },
          { status: 403 }
        );
      }
      // ─── ممیزی 1-b#10 — همان پنجرهٔ «یک شروع تحلیل در دقیقه» (کلید مشترک با
      // analyze-video): دو آپلود/تحلیل موازی روی یک شمارنده دیگر ممکن نیست ───
      const startRl = rateLimit(`video-body-analysis-start:${userId}`, 1, 60_000);
      if (!startRl.ok) {
        return rateLimitResponse(
          startRl.retryAfterSec,
          "تحلیل قبلی هنوز در جریان است؛ چند لحظه بعد دوباره تلاش کنید."
        );
      }
    }

    const assembled = await assembleChunks({
      target,
      uploadId,
      totalChunks: Number(totalChunks),
      extForAssembly: finalExt,
      fileNameBuilder: (e) =>
        target === "chat"
          ? `chat-video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${e}`
          : `video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${e}`,
    });

    if (!assembled.ok) {
      return Response.json({ error: assembled.error, code: assembled.code }, { status: assembled.status });
    }

    console.log(`[upload-complete] assembled: target=${target} url=${assembled.url} size=${assembled.size}`);

    // ─── مقصد آنالیز ویدیویی بدن — شروع تحلیل پس‌زمینه (کد مشترک با POST قبلی) ───
    if (target === "videos") {
      const { absolutePathForUploadUrl } = await import("@/lib/fitness/private-media");
      await db.user.update({
        where: { id: userId },
        data: { videoStatus: "analyzing" },
      });
      startVideoBodyAnalysis({
        userId,
        filePath: absolutePathForUploadUrl(assembled.url),
        fileUrl: assembled.url,
        userContext: typeof body.userContext === "string" ? body.userContext : undefined,
      });
      return Response.json({
        mediaUrl: assembled.url,
        size: assembled.size,
        started: true,
        status: "analyzing",
      });
    }

    // ─── مقصد چت — فقط mediaUrl؛ بقیهٔ پردازش در POST /api/coach/chat ───
    return Response.json({ mediaUrl: assembled.url, size: assembled.size });
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
