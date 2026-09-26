import { NextRequest } from "next/server";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeBodyPhoto } from "@/lib/fitness/ai";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requirePlanCapability("bodyPhotoAnalysis");

    // ─── M6: محدودیت نرخ — ۲۰ آنالیز در ساعت برای هر کاربر (کال VLM)
    const rl = rateLimit(`analyze-body:${userId}`, 20, 60 * 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const { base64Image, mimeType, userContext } = await req.json();
    if (!base64Image) return Response.json({ error: "تصویر ارسال نشده." }, { status: 400 });

    // ─── ممیزی 1-b#11 — گارد فنی حجم base64 (۲۰۰MB — هم‌تای analyze-blood؛
    // قبلاً بدون هیچ سقفی Buffer می‌شد و به VLM می‌رفت — ضد OOM/درخواست مخرب) ───
    const MAX_BASE64_CHARS = 200 * 1024 * 1024;
    if (typeof base64Image === "string" && base64Image.length > MAX_BASE64_CHARS) {
      return Response.json({ error: "فایل تصویر بسیار بزرگ است." }, { status: 413 });
    }

    const result = await analyzeBodyPhoto(base64Image, mimeType || "image/jpeg", userContext || "");
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
