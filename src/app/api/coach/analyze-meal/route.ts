import { NextRequest } from "next/server";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeMealPhoto } from "@/lib/fitness/ai";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { checkQuota, consumeQuotaAtomically } from "@/lib/fitness/quota";
import { processImageSafe } from "@/lib/fitness/image-process";

/**
 * POST /api/coach/analyze-meal
 *
 * آنالیز عکس غذا با ورودی base64 (با mimeType).
 * این مسیر توسط فراخوانی‌های JSON مستقیم استفاده می‌شود (نه فرم آپلود).
 * برای آپلود از طریق فرم، از /api/coach/meal-photo-analysis استفاده کنید.
 *
 * بهینه‌سازی: عکس قبل از ارسال به AI با sharp فشرده می‌شود
 * (resize حداکثر 1024px + WebP quality 75) → حجم کمتر، تحلیل سریع‌تر.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requirePlanCapability("mealPhotoAnalysis");

    // ─── M6: محدودیت نرخ — ۲۰ آنالیز در ساعت برای هر کاربر (کال VLM + sharp)
    const rl = rateLimit(`analyze-meal:${userId}`, 20, 60 * 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    // ─── v85 — سهمیهٔ عکس (استخر مشترک ۹۰تایی چت + تحلیل غذا — بدون سقف روزانه) ───
    const quota = await checkQuota(userId, "chat_photo");
    if (!quota.allowed) {
      return Response.json(
        { error: quota.messageFa ?? "سهمیهٔ تحلیل عکس غذا تمام شده است.", code: quota.code },
        { status: 429 }
      );
    }

    const { base64Image, mimeType, userContext } = await req.json();
    if (!base64Image) {
      return Response.json({ error: "تصویر ارسال نشده." }, { status: 400 });
    }

    // ─── بهینه‌سازی تصویر قبل از ارسال به AI ───
    // حتی اگر کاربر عکس بزرگی را base64 کرده باشد، قبل از ارسال به VLM آن را فشرده می‌کنیم
    // تا سرعت بالا رود و هزینه‌ی token کم شود.
    // v79 — helper مشترک + فال‌بک HEIF/HEIC (خام به VLM — Gemini پشتیبانی رسمی دارد)
    const buf = Buffer.from(base64Image, "base64");
    const processedImage = await processImageSafe(buf, mimeType || "image/jpeg", { maxDim: 1024, quality: 75, rotate: true });
    const finalBase64 = processedImage
      ? processedImage.buffer.toString("base64")
      : base64Image; // آخرین فال‌بک: همان ورودی خام
    const finalMime = processedImage ? processedImage.mimeType : (mimeType || "image/jpeg");

    const result = await analyzeMealPhoto(finalBase64, finalMime, userContext || "");
    // مصرف سهمیه — تحلیل موفق انجام شد (استخر مشترک v85 با چت فیتاپ)
    // ممیزی 1-b#1 — مصرف اتمیک شرطی (رقابت درخواست‌های موازی دیگر از سقف عبور نمی‌کند)
    const consumed = await consumeQuotaAtomically(userId, "chat_photo");
    if (!consumed) {
      console.warn("[analyze-meal] atomic quota consume refused (exhausted in race window)");
    }
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
