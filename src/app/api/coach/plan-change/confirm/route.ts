import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  applyPlanChangeRequest,
  getPlanRegenState,
  sanitizePlanChangeSummary,
} from "@/lib/fitness/plan-change-intent";

// ═══════════════════════════════════════════════════════════════
//  POST /api/coach/plan-change/confirm — v111 (دیرکتیو مالک)
//
//  تایید «کارت پیشنهاد بازطراحی برنامه» در چت با فیتاپ — پروتکل هم‌ادغام با
//  smart-coach-chat-view (پارس [PLAN_CHANGE_PROPOSAL summary="..."] — آینهٔ
//  پروتکل [APPLY_SWAP …]):
//    body: { summary?: string }  ← خلاصهٔ تغییرات توافق‌شده (اختیاری)
//    خروجی: { ok, started, programRequestId?, message }
//
//  جریان: گیت پلن دقیقاً مثل route چت (aiChat) → گیت‌های سهمیهٔ بازطراحی
//  (getPlanRegenState) → اجرای «همان مسیر تایید متنی» با پیام تایید مصنوعیِ
//  «تایید نهایی» از طریق applyPlanChangeRequest (صفر تکرار منطق ماشین وضعیت؛
//  گارد انصراف/سقف روزانه/قفل سهمیه همه همان‌هاست) → شروع تولید پس‌زمینه با
//  source=chat_request + changeSummary = خلاصهٔ پروپوزال (یا ارسالی کلاینت).
//  پیام خلاصهٔ برنامهٔ جدید بعد از اتمام تولید، خودکار در همین چت درج می‌شود
//  (program-generation → postChatPlanSummaryMessage).
// ═══════════════════════════════════════════════════════════════

/** پیام تایید مصنوعی — با تشخیص‌گر تاییدِ plan-change-intent مچ می‌شود */
const SYNTHETIC_CONFIRM_MESSAGE = "تایید نهایی";

export async function POST(req: NextRequest) {
  try {
    // گیت پلن — دقیقاً همان گیت مسیر چت (بازطراحی از چت فقط پیشرفته/حرفه‌ای)
    const { userId } = await requirePlanCapability("aiChat");

    // محدودیت نرخ ملایم — ضد سوءاستفاده (تاییدهای مکرر بی‌معنی‌اند)
    const rl = rateLimit(`plan-change-confirm:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = await req.json().catch(() => null);
    const summary = sanitizePlanChangeSummary(
      body && typeof body === "object" ? (body as { summary?: unknown }).summary : null
    );

    // ═══ گیت‌های سهمیه — پاسخ‌های دوستانه و دقیق (هم‌منطق یادداشت‌های چت) ═══
    const state = await getPlanRegenState(userId);
    if (!state.eligible) {
      return Response.json(
        {
          ok: false,
          error:
            "بازطراحی برنامه از طریق چت فقط برای پلن پیشرفته و حرفه‌ای فعال است. برنامهٔ فعلی شما دست‌نخورده می‌ماند.",
        },
        { status: 403 }
      );
    }
    if (state.used) {
      return Response.json(
        {
          ok: false,
          error:
            "این قابلیت در طول هر اشتراک فقط یکبار قابل استفاده است و سهمیهٔ شما مصرف شده. برای تغییر برنامه با پشتیبانی در ارتباط باشید.",
        },
        { status: 409 }
      );
    }
    if (!state.pending) {
      return Response.json(
        {
          ok: false,
          error:
            "درخواست بازطراحی فعالی برای تایید وجود ندارد. اول در چت با فیتاپ درخواست بازطراحی برنامه را ثبت کنید.",
        },
        { status: 409 }
      );
    }

    // ═══ اجرای همان مسیر تایید متنی (صفر تکرار منطق) ═══
    // پیام مصنوعی «تایید نهایی» با RE_PLAN_REGEN_CONFIRM مچ می‌شود → مسیر (d)
    // ماشین وضعیت: ذخیرهٔ نکات + شروع تولید + قفل سهمیه (فقط اگر واقعاً شروع شد).
    const result = await applyPlanChangeRequest(userId, SYNTHETIC_CONFIRM_MESSAGE, {
      changeSummary: summary,
    });

    // بعد از apply — وضعیت تازه را بخوان تا پاسخ دقیق باشد
    const after = result.regenState ?? (await getPlanRegenState(userId));
    const started = !!(after.used && !after.pending);

    if (!result.handled || !started) {
      // شروع نشد (سقف روزانه / خطای دیگر) — سهمیهٔ کاربر نسوخته (منطق مسیر چت)
      return Response.json(
        {
          ok: false,
          error:
            "تایید شما ثبت شد اما شروع خودکار بازتولید در این لحظه ممکن نشد (احتمالاً سقف روزانهٔ بازتولید پر است). سهمیهٔ شما دست‌نخورده است — کمی بعد در همین چت بنویسید «تایید نهایی» یا از پشتیبانی بخواهید بازتولید دستی بزنند.",
        },
        { status: 503 }
      );
    }

    // شناسهٔ درخواست برنامهٔ در جریان (برای پیگیری UI) — best-effort
    let programRequestId: string | null = null;
    try {
      const latestReq = await db.programRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (latestReq?.status === "generating") programRequestId = latestReq.id;
    } catch {
      /* غیرحیاتی */
    }

    return Response.json({
      ok: true,
      started: true,
      programRequestId,
      message:
        "درخواست ساخت برنامهٔ جدید ثبت شد. برنامهٔ جدید طی چند دقیقه جایگزین برنامهٔ فعلی می‌شود و خلاصهٔ تغییرات در همین چت نوشته می‌شود.",
    });
  } catch (e) {
    return apiError(e);
  }
}
