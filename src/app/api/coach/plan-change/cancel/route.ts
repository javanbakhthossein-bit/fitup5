import { NextRequest } from "next/server";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { applyPlanChangeRequest, getPlanRegenState } from "@/lib/fitness/plan-change-intent";

// ═══════════════════════════════════════════════════════════════
//  POST /api/coach/plan-change/cancel — v111 (دیرکتیو مالک)
//
//  انصراف از «کارت پیشنهاد بازطراحی برنامه» در چت با فیتاپ — هم‌ادغام با
//  smart-coach-chat-view (دکمهٔ «انصراف» کارت [PLAN_CHANGE_PROPOSAL]).
//    body: بدون بدنه
//    خروجی: { ok: true, message }
//
//  جریان: گیت پلن مثل route چت (aiChat) → اگر بازطراحی در انتظار تایید بود،
//  «همان مسیر انصراف متنی» با پیام مصنوعی «انصراف» از طریق applyPlanChangeRequest
//  اجرا می‌شود (planRegenPending=false؛ سهمیهٔ یک‌بارِ اشتراک دست‌نخورده می‌ماند).
//  اگر چیزی در انتظار تایید نبود → ۲۰۰ با ok=true و وضعیت بی‌اثر (idempotent —
//  کاربر نباید برای دوبار کلیک روی «انصراف» خطا ببیند).
// ═══════════════════════════════════════════════════════════════

/** پیام انصراف مصنوعی — با تشخیص‌گر انصرافِ plan-change-intent مچ می‌شود */
const SYNTHETIC_CANCEL_MESSAGE = "انصراف";

export async function POST(_req: NextRequest) {
  try {
    // گیت پلن — دقیقاً همان گیت مسیر چت
    const { userId } = await requirePlanCapability("aiChat");

    // محدودیت نرخ ملایم
    const rl = rateLimit(`plan-change-cancel:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const state = await getPlanRegenState(userId);
    if (!state.pending) {
      // idempotent — چیزی برای لغو نیست؛ خطا تولید نکن (دکمهٔ انصراف دوبار)
      return Response.json({
        ok: true,
        cancelled: false,
        message: "درخواست بازطراحی فعالی در انتظار تایید نیست.",
      });
    }

    // همان مسیر انصراف متنی (مسیر (e) ماشین وضعیت) — سهمیه دست‌نخورده می‌ماند
    await applyPlanChangeRequest(userId, SYNTHETIC_CANCEL_MESSAGE);

    return Response.json({
      ok: true,
      cancelled: true,
      message:
        "انصراف ثبت شد. فرایند بازطراحی برنامه لغو شد و سهمیهٔ یک‌بارِ اشتراک شما دست‌نخورده باقی می‌ماند.",
    });
  } catch (e) {
    return apiError(e);
  }
}
