import { NextRequest } from "next/server";
import { notifyProgramReadySms } from "@/lib/fitness/sms-flows";
import { createNotification } from "@/lib/fitness/notifications";
import { startProgramGenerationInBackground } from "@/lib/fitness/program-generation";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "";

    const where: any = {};
    if (status && ["pending", "generating", "ready", "failed"].includes(status)) {
      where.status = status;
    }

    const programs = await db.programRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, mobile: true, planName: true },
        },
      },
    });

    return Response.json({
      programs: programs.map((p) => ({
        id: p.id,
        userId: p.userId,
        userName: p.user?.name || "",
        userMobile: p.user?.mobile || "",
        plan: p.plan,
        billingPeriod: p.billingPeriod,
        status: p.status,
        paymentId: p.paymentId,
        // v38 — خطای واقعی + شمارش تلاش‌ها برای نمایش در صف ادمین
        lastError: p.lastError ?? null,
        attempts: p.attempts,
        lastAttemptAt: p.lastAttemptAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// Update program status (approve/reject/ready)
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { programId, status } = await req.json();
    if (!["pending", "generating", "ready", "failed"].includes(status)) {
      return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
    }

    const updated = await db.programRequest.update({
      where: { id: programId },
      data: { status },
    });

    // If approved (ready), trigger notification
    if (status === "ready") {
      // v37: createNotification = رکورد نوتیف + وب‌پوش همزمان (قبلاً فقط رکورد
      // ساخته می‌شد و پوش نمی‌رفت — درخواست مالک: پیامک ↔ نوتیف/پوش جفت باشند)
      // v63 — متنِ یکسان با مسیر تولید عادی تا dedupeِ ۶۰دقیقه‌ای createNotification
      // تکرارِ هم‌رویداد را هم رد کند (قبلاً متن متفاوت بود → نوتیف دوباره می‌رفت).
      await createNotification(
        updated.userId,
        "achievement",
        "برنامه شما آماده شد! 🎯",
        "برنامه تمرینی و غذایی شخصی‌سازی‌شده شما توسط فیتاپ هوشمند ساخته شد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.",
        "?tab=programs"
      );
      // v32: پیامک همزمان «برنامه آماده شد» (قالب 663678)
      // v66: دداپ بر چرخهٔ تولید — هر تولید مجدد ادمین هم یک پیامک دارد
      notifyProgramReadySms(updated.userId, updated.id);
    }

    // v38 فیکس باگ قدیمی: قبلاً «شروع تولید» ادمین فقط status را generating
    // می‌کرد و هیچ تولیدی شروع نمی‌شد (وضعیت جعلی برای همیشه می‌ماند). حالا
    // تولید پس‌زمینه واقعاً kick می‌شود.
    if (status === "generating") {
      const result = await startProgramGenerationInBackground(updated.userId);
      if (!result.started) {
        return Response.json({
          ok: true,
          program: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
          warning:
            result.reason === "prerequisites_incomplete"
              ? `تولید شروع نشد: ${result.blockingReason ?? "پیش‌نیازها ناقص است"}`
              : "تولید شروع نشد (درخواست دیگری در جریان است یا پروفایل ناقص است).",
        });
      }
      return Response.json({
        ok: true,
        program: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        started: true,
      });
    }

    return Response.json({ ok: true, program: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * v38 — دکمهٔ «ساخت مجدد» برای درخواست‌های ناموفق (درخواست مالک).
 *
 * POST { programId } | { userId }
 *
 * v75 — حالت جدید «بازنویسی برنامه» (درخواست مالک):
 * «مدیر باید بتونه برنامه یک کاربر رو بازنویسی بکنه بدون تغییر در مدت اشتراک و
 * تغییر پلن و بازنویسی باید مجدد همه مسائل آخرین پرونده ورزشی و آخرین عکس‌ها و
 * ویدیوهای آپلودشده کاربر رو تحلیل کنه و بسازه»:
 *  • با { userId } از پنل جزئیات کاربر فراخوانی می‌شود (حتی وقتی برنامهٔ ready دارد)
 *  • سورس admin_rewrite: گارد برنامهٔ تازه و سقف روزانه دور زده می‌شود و
 *    activatePendingSubscription اجرا نمی‌شود (هیچ تغییری در اشتراک/پلن)
 *  • موتور تولید خودش آخرین پرونده ورزشی (تحلیل عکس بدن/ویدیو/آزمایش خون) را
 *    تازه می‌خواند (buildGenerationExtras) — پس بازنویسی همیشه با آخرین داده‌هاست
 *  • برای فراخوانی userId-محور، درخواست generatingِ قبلی به‌اجبار آزاد می‌شود
 *    (ادمین عمداً بازنویسی می‌خواهد؛ «already_generating» مانع کار انسان نمی‌شود)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { programId?: string; userId?: string };

    // ─── v75: بازنویسی برنامه از پنل جزئیات کاربر (userId-محور) ───
    if (body.userId) {
      const targetUser = await db.user.findUnique({
        where: { id: body.userId },
        select: { id: true },
      });
      if (!targetUser) {
        return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
      }

      // آزادسازی اجباری claim قبلی (admin عمداً بازنویسی می‌خواهد)
      await db.programRequest.updateMany({
        where: { userId: body.userId, status: "generating" },
        data: { status: "failed", lastError: "بازنویسی دستی توسط مدیر — تولید قبلی لغو شد" },
      });

      const result = await startProgramGenerationInBackground(body.userId, { source: "admin_rewrite" });
      return Response.json({
        ok: true,
        started: result.started,
        reason: result.reason ?? null,
        blockingReason: result.blockingReason ?? null,
        message: result.started
          ? "بازنویسی برنامه شروع شد — تمرین و غذا با آخرین پرونده ورزشی، عکس‌ها و ویدیوهای کاربر از نو ساخته می‌شوند. اشتراک و پلن دست‌نخورده می‌ماند."
          : result.reason === "prerequisites_incomplete"
            ? `بازنویسی شروع نشد: ${result.blockingReason ?? "پیش‌نیازها ناقص است"}`
            : result.reason === "no_plan"
              ? "کاربر پلن فعالی ندارد."
              : result.reason === "no_profile"
                ? "پروفایل آنبوردینگ برای این کاربر ثبت نشده است."
                : "بازنویسی شروع نشد — چند لحظه بعد دوباره تلاش کنید.",
      });
    }

    if (!body.programId) {
      return Response.json({ error: "شناسه درخواست الزامی است." }, { status: 400 });
    }

    const program = await db.programRequest.findUnique({
      where: { id: body.programId },
      select: { id: true, userId: true, status: true, plan: true },
    });
    if (!program) {
      return Response.json({ error: "درخواست برنامه یافت نشد." }, { status: 404 });
    }
    if (program.status === "ready") {
      // v75 — برای برنامهٔ ready هم دکمهٔ بازنویسی از همین مسیر کار می‌کند
      // (admin_rewrite گارد ready را دور می‌زند) — دیگر لازم نیست ادمین اول
      // وضعیت را دستی «ناموفق» کند.
      const result = await startProgramGenerationInBackground(program.userId, { source: "admin_rewrite" });
      return Response.json({
        ok: true,
        started: result.started,
        reason: result.reason ?? null,
        blockingReason: result.blockingReason ?? null,
        message: result.started
          ? "بازنویسی برنامه شروع شد — برنامهٔ جدید جایگزین برنامهٔ فعلی می‌شود (بدون تغییر اشتراک/پلن)."
          : "بازنویسی شروع نشد — چند لحظه بعد دوباره تلاش کنید.",
      });
    }

    // آزادسازی نرم claim — هر وضعیتی (حتی generatingِ یتیم) به failed می‌رود تا
    // claim جدید با attempts+1 شروع شود (شمارش تلاش‌ها حفظ می‌شود)
    await db.programRequest.update({
      where: { id: program.id },
      data: { status: "failed", lastError: null },
    });

    const result = await startProgramGenerationInBackground(program.userId, { source: "admin_rewrite" });
    return Response.json({
      ok: true,
      started: result.started,
      reason: result.reason ?? null,
      blockingReason: result.blockingReason ?? null,
      message: result.started
        ? "تولید برنامه دوباره شروع شد — وضعیت در همین صفحه به‌روز می‌شود."
        : result.reason === "prerequisites_incomplete"
          ? `تولید شروع نشد: ${result.blockingReason ?? "پیش‌نیازها ناقص است"}`
          : "تولید شروع نشد — چند لحظه بعد دوباره تلاش کنید.",
    });
  } catch (e) {
    return apiError(e);
  }
}
