import { NextRequest } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { createNotification } from "@/lib/fitness/notifications";
import { sendTicketSms } from "@/lib/fitness/smsir";

const VALID_STATUSES = ["open", "answered", "closed"];

// شماره مدیر برای پیامک تیکت (هم‌سان با route ساخت تیکت — env-پذیر)
const TICKET_SMS_ADMIN_MOBILE = process.env.SMSIR_TICKET_ADMIN_MOBILE || "09300083803";

interface TicketDto {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  message: string;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
  repliedAt: string | null;
  userId: string;
  user: {
    id: string;
    name: string | null;
    mobile: string;
    planName: string | null;
  };
  replies: Array<{
    id: string;
    role: string;
    message: string;
    createdAt: string;
    user: { id: string; name: string | null; mobile: string };
    attachments: Array<{
      id: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      fileUrl: string;
      uploaderId: string;
      createdAt: string;
    }>;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    fileUrl: string;
    uploaderId: string;
    createdAt: string;
  }>;
  // ─── v73.4 — بج تیکت خوانده‌نشده ادمین (درخواست مالک) ───
  /** آخرین بازدید ادمین از تیکت (adminReadAt) */
  adminReadAt?: string | null;
  /** true = ادمین هنوز آن را ندیده یا کاربر بعد از آخرین بازدیدِ ادمین پاسخ داده */
  unread?: boolean;
}

function serializeTicket(t: any): TicketDto {
  // ─── منطق «خوانده‌نشده» (درخواست مالک): ───
  //   adminReadAt == null → تیکت هرگز دیده نشده → unread
  //   آخرین پاسخِ کاربرِ بعد از adminReadAt → کاربر پاسخ تازه گذاشته → unread
  const adminReadDate = t.adminReadAt ? new Date(t.adminReadAt) : null;
  const lastUserReplyDate = ((t.replies || []) as any[])
    .filter((r: any) => r.role === "user")
    .reduce((latest: Date | null, r: any) => {
      const d = new Date(r.createdAt);
      return !latest || d > latest ? d : latest;
    }, null as Date | null);
  const unread =
    adminReadDate == null ||
    (lastUserReplyDate != null && lastUserReplyDate > adminReadDate);

  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    message: t.message,
    adminReply: t.adminReply,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    repliedAt: t.repliedAt ? t.repliedAt.toISOString() : null,
    userId: t.userId,
    user: {
      id: t.user.id,
      name: t.user.name,
      mobile: t.user.mobile,
      planName: t.user.planName,
    },
    replies: (t.replies || []).map((r: any) => ({
      id: r.id,
      role: r.role,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      user: { id: r.user.id, name: r.user.name, mobile: r.user.mobile },
      attachments: (r.attachments || []).map((a: any) => ({
        id: a.id,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
        fileUrl: a.fileUrl,
        uploaderId: a.uploaderId,
        createdAt: a.createdAt.toISOString(),
      })),
    })),
    attachments: (t.attachments || []).map((a: any) => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      fileSize: a.fileSize,
      fileUrl: a.fileUrl,
      uploaderId: a.uploaderId,
      createdAt: a.createdAt.toISOString(),
    })),
    adminReadAt: adminReadDate ? adminReadDate.toISOString() : null,
    unread,
  };
}

async function loadTicket(id: string) {
  return db.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, mobile: true, planName: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, name: true, mobile: true } },
          attachments: { orderBy: { createdAt: "asc" as const } },
        },
      },
      attachments: { orderBy: { createdAt: "asc" as const } },
    },
  });
}

/**
 * GET /api/support/tickets/[id]
 *  - regular user → can only read their own ticket
 *  - admin → can read any ticket
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const isAdmin = user.role === "ADMIN";

    const ticket = await loadTicket(id);
    if (!ticket) {
      return Response.json({ error: "تیکت یافت نشد." }, { status: 404 });
    }
    if (!isAdmin && ticket.userId !== user.id) {
      return Response.json({ error: "دسترسی غیرمجاز." }, { status: 403 });
    }

    return Response.json({ ticket: serializeTicket(ticket) });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/support/tickets/[id] — reply to a ticket
 *  - body: { message }
 *  - admin: status -> "answered", notify the ticket owner
 *  - user: status -> "open" (re-open), notify all admins
 *    اگر تیکت بسته باشد، پاسخ مالک تیکت را دوباره باز می‌کند (auto-reopen) —
 *    PATCH فقط برای ادمین است و بدون این، مالک در بن‌بست کامل قرار می‌گرفت.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const isAdmin = user.role === "ADMIN";

    const ticket = await loadTicket(id);
    if (!ticket) {
      return Response.json({ error: "تیکت یافت نشد." }, { status: 404 });
    }
    if (!isAdmin && ticket.userId !== user.id) {
      return Response.json({ error: "دسترسی غیرمجاز." }, { status: 403 });
    }
    // پاسخ مالک تیکتِ بسته = بازگشایی خودکار تیکت (FIX: بن‌بست reopen).
    // PATCH status برای غیرادمین مجاز نیست؛ پس ارسال پیام روی تیکت بسته،
    // تیکت را reopen می‌کند و در ادامه نوتیفیکیشن ادمین‌ها «بازگشایی» را ذکر می‌کند.
    const reopenedByOwner = !isAdmin && ticket.status === "closed";

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    if (message.length < 1) {
      return Response.json({ error: "متن پاسخ خالی است." }, { status: 400 });
    }

    // v77 — پیوست‌های پاسخ (آپلودشده از /api/support/attachments) — حداکثر ۸ فایل
    const attachmentIds: string[] = Array.isArray(body?.attachmentIds)
      ? body.attachmentIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 8)
      : [];

    const now = new Date();

    // ایجاد پاسخ
    const reply = await db.ticketReply.create({
      data: {
        ticketId: id,
        userId: user.id,
        role: isAdmin ? "admin" : "user",
        message,
      },
    });

    // اتصال پیوست‌های standalone فرستنده به پاسخ (فقط آپلود خودش + بدون اتصال قبلی)
    if (attachmentIds.length > 0) {
      await db.ticketAttachment.updateMany({
        where: { id: { in: attachmentIds }, uploaderId: user.id, ticketId: null, replyId: null },
        data: { ticketId: id, replyId: reply.id },
      }).catch((e) => console.error("[ticket-reply] failed to link attachments:", e));
    }

    // به‌روزرسانی وضعیت تیکت
    const newStatus = isAdmin ? "answered" : "open";
    await db.supportTicket.update({
      where: { id },
      data: isAdmin
        ? {
            status: newStatus,
            adminReply: message,
            repliedById: user.id,
            repliedAt: now,
          }
        : {
            status: newStatus,
          },
    });

    // نوتیفیکیشن به طرف مقابل — v37: createNotification = رکورد + وب‌پوش همزمان
    // (درخواست مالک: پیامک‌ها نوتیف همزمان در سایت/اپ‌ها/وب‌اپ داشته باشند)
    if (isAdmin) {
      // ادمین پاسخ داده → مالک تیکت را خبردار کن
      await createNotification(
        ticket.userId,
        "system",
        "پاسخ جدید به تیکت شما 💬",
        `پاسخ پشتیبانی به «${ticket.subject}»: ${message.slice(0, 100)}`,
        "?tab=support"
      );
    } else {
      // کاربر پاسخ داده → همه ادمین‌ها را خبردار کن
      const admins = await db.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      for (const a of admins) {
        await createNotification(
          a.id,
          "system",
          reopenedByOwner ? "تیکت بسته بازگشایی شد 🎫" : "پاسخ جدید به تیکت 🎫",
          reopenedByOwner
            ? `${user.name || user.mobile} به تیکت بسته‌شده «${ticket.subject}» پاسخ داد و آن را دوباره باز کرد`
            : `${user.name || user.mobile} به تیکت «${ticket.subject}» پاسخ داد`,
          "?tab=support"
        );
      }
    }

    // ─── پیامک تیکت روی پاسخ‌ها (درخواست مالک — قالب ۹۴۲۷۶۳ متغیر #NAME#) ───
    // مدیر پاسخ داد → پیامک برای «کاربر» با نام خودِ کاربر:
    // «{نام کاربر} عزیز. تیکت جدید داری.»
    // کاربر پیام گذاشت → پیامک برای «مدیر» با نام خودِ مدیر.
    // after() → خارج از جریان پاسخ‌دهی؛ خطای پیامک هرگز جریان را نمی‌شکند.
    after(async () => {
      try {
        let targetMobile: string;
        let targetName: string;
        if (isAdmin) {
          targetMobile = ticket.user.mobile;
          // v42 — دیریکتیو مالک: بدونِ نام، پیامک با نام جعلی/موبایل نمی‌رود؛
          // رشتهٔ خالی → گارد sendTicketSms ارسال را skip می‌کند (non-blocking)
          targetName = (ticket.user.name && ticket.user.name.trim()) || "";
        } else {
          targetMobile = TICKET_SMS_ADMIN_MOBILE;
          const adminRow = await db.user.findFirst({
            where: { mobile: TICKET_SMS_ADMIN_MOBILE },
            select: { name: true },
          });
          targetName = (adminRow?.name && adminRow.name.trim()) || "مدیر";
        }
        const res = await sendTicketSms(targetMobile, targetName);
        console.log(
          `[ticket-sms] reply ticket=${ticket.id} → ${isAdmin ? "user" : "admin"}=${targetMobile} (${targetName}) → ${res.success ? "sent ✓" : `failed: ${res.error}`}`
        );
      } catch (e) {
        console.error("[ticket-sms] reply unexpected:", e);
      }
    });

    const fresh = await loadTicket(id);
    return Response.json({ ticket: serializeTicket(fresh), replyId: reply.id });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * PATCH /api/support/tickets/[id] — تغییر وضعیت تیکت (فقط ادمین)
 *  - body: { status: "open" | "answered" | "closed" }
 *  - body: { action: "mark_read" } → فقط adminReadAt را به‌روز می‌کند
 *    (v73.4 — درخواست مالک: وقتی ادمین جزئیات تیکت را باز می‌کند، تیکت
 *    «خوانده‌شده» می‌شود و بج/نقطهٔ قرمز حذف می‌شود. بدون تغییر وضعیت و
 *    بدون نوتیفیکیشن — گارد ادمین بالای همین تابع موجود است.)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    if (user.role !== "ADMIN") {
      return Response.json({ error: "دسترسی غیرمجاز." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // ─── action === "mark_read" → علامت‌گذاری خوانده‌شده (بدون تغییر وضعیت/نوتیف) ───
    if (body?.action === "mark_read") {
      const ticket = await db.supportTicket.findUnique({ where: { id } });
      if (!ticket) {
        return Response.json({ error: "تیکت یافت نشد." }, { status: 404 });
      }
      await db.supportTicket.update({
        where: { id },
        data: { adminReadAt: new Date() },
      });
      const fresh = await loadTicket(id);
      return Response.json({ ticket: serializeTicket(fresh) });
    }

    const status = String(body?.status || "").toLowerCase();
    if (!VALID_STATUSES.includes(status)) {
      return Response.json(
        { error: "وضعیت نامعتبر است. باید یکی از باز/پاسخ‌داده‌شده/بسته باشد." },
        { status: 400 }
      );
    }

    const ticket = await db.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      return Response.json({ error: "تیکت یافت نشد." }, { status: 404 });
    }

    await db.supportTicket.update({
      where: { id },
      data: { status },
    });

    // Notify the ticket owner about the status change
    const statusLabel =
      status === "open" ? "باز شد" : status === "answered" ? "پاسخ داده شد" : "بسته شد";
    await db.notification.create({
      data: {
        userId: ticket.userId,
        type: "system",
        title: `تیکت شما ${statusLabel}`,
        body: `وضعیت تیکت «${ticket.subject}» به ${statusLabel} تغییر یافت.`,
        read: false,
      },
    });

    const fresh = await loadTicket(id);
    return Response.json({ ticket: serializeTicket(fresh) });
  } catch (e) {
    return apiError(e);
  }
}
