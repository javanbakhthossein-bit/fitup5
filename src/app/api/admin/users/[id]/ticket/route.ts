import { NextRequest, after } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
// v37 — createNotification = رکورد نوتیف + وب‌پوش همزمان (همان الگوی پاسخ تیکت)
import { createNotification } from "@/lib/fitness/notifications";
// v172 — رویداد زندهٔ «پیام جدید» (SSE پنل کاربر — بخش پیام‌ها بدون رفرش به‌روز می‌شود)
import { publishPanelEvent } from "@/lib/realtime/panel-hub";
import { sendTicketSms } from "@/lib/fitness/smsir";

/**
 * POST /api/admin/users/[id]/ticket — Task 3-d
 *
 * «ارسال تیکت» از مودال پروفایل کاربر در پنل مدیر:
 * ادمین برای کاربر یک تیکت پشتیبانی ایجاد می‌کند (پیام پشتیبانی به کاربر).
 *
 * ساختار داده دقیقاً همان چیزی است که نمای پشتیبانی سمت کاربر
 * (support-view → GET /api/support/tickets) و نمای ادمین
 * (AdminTicketDetail) انتظار دارند:
 *   - SupportTicket { userId, subject, status: "answered", message, adminReply, repliedById, repliedAt, adminReadAt }
 *   - اولین TicketReply { userId: admin.id, role: "admin", message }
 *     → فلگ unreadForUser (بج خوانده‌نشده سمت کاربر) از همین پاسخ ساخته می‌شود.
 *
 * وضعیت «answered» = هم‌الگوی POST /api/support/tickets/[id] وقتی ادمین پاسخ
 * می‌دهد (status → answered). تیکت برای کاربر در لیست پشتیبانی‌اش ظاهر می‌شود
 * (GET support/tickets همهٔ تیکت‌های userId خودش را برمی‌گرداند — مستقل از status)
 * و چون adminReadAt همین حالا ست شده، در لیست تیکت‌های ادمین خوانده‌نشده (نقطهٔ
 * قرمز کاذب) نشان داده نمی‌شود — ادمین خودش نویسندهٔ آن است.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    await requireAdminPerm("canManageTickets");

    const body = await req.json().catch(() => ({}));
    const subject = String(body?.subject || "").trim();
    const message = String(body?.message || "").trim();

    if (subject.length < 3) {
      return Response.json({ error: "موضوع باید حداقل ۳ کاراکتر باشد." }, { status: 400 });
    }
    if (message.length < 1) {
      return Response.json({ error: "متن پیام خالی است." }, { status: 400 });
    }

    // کاربر هدف باید واقعاً وجود داشته باشد
    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, mobile: true },
    });
    if (!target) {
      return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
    }

    const now = new Date();

    // تیکت + اولین پاسخ ادمین — در یک تراکنش (هر دو یا هیچ‌کدام)
    const ticket = await db.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          userId: target.id,
          subject,
          category: "general",
          priority: "normal",
          status: "answered",
          message,
          adminReply: message,
          repliedById: admin.id,
          repliedAt: now,
          // ادمین نویسندهٔ تیکت است — در لیست خودش «خوانده‌نشده» کاذب نسازد
          adminReadAt: now,
          // userReadAt عمداً null می‌ماند → بج خوانده‌نشده سمت کاربر روشن می‌شود
        },
      });
      await tx.ticketReply.create({
        data: {
          ticketId: created.id,
          userId: admin.id,
          role: "admin",
          message,
        },
      });
      return created;
    });

    // رویداد زندهٔ پنل — بخش پیام‌های کاربر بدون رفرش به‌روز می‌شود (هم‌الگوی پاسخ تیکت)
    publishPanelEvent(target.id, "new_message", {
      ticketId: ticket.id,
      subject: ticket.subject,
      section: "messages",
    });

    // نوتیفیکیشن برای کاربر (رکورد + وب‌پوش) — هم‌الگوی پاسخ ادمین در tickets/[id]
    await createNotification(
      target.id,
      "system",
      "پشتیبانی به شما تیکت ارسال کرد 💬",
      `«${subject}»: ${message.slice(0, 100)}`,
      "?tab=support"
    );

    // ─── پیامک «تیکت» برای کاربر — دقیقاً هم‌الگوی پاسخ ادمین در tickets/[id] ───
    // after() → خارج از جریان پاسخ؛ خطای پیامک هرگز جریان ساخت تیکت را نمی‌شکند.
    after(async () => {
      try {
        // v221 — نام خالی → «ورزشکار» (فال‌بک داخل sendTicketSms)
        const targetName = (target.name && target.name.trim()) || "";
        const res = await sendTicketSms(target.mobile, targetName);
        console.log(
          `[admin-ticket] ticket=${ticket.id} → user=${target.mobile} (${targetName || "ورزشکار"}) → ${res.success ? "sent ✓" : `failed: ${res.error}`}`
        );
      } catch (e) {
        console.error("[admin-ticket] sms unexpected:", e);
      }
    });

    return Response.json({
      ok: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        message: ticket.message,
        createdAt: ticket.createdAt.toISOString(),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
