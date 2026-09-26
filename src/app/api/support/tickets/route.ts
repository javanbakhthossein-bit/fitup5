import { NextRequest } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { sendTicketSms } from "@/lib/fitness/smsir";

const VALID_CATEGORIES = ["general", "technical", "payment", "program", "bug"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

// شماره مدیر برای پیامک «تیکت جدید» (قابل تغییر از env — پیش‌فرض: سوپرادمین)
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
    attachments: TicketAttachmentDto[];
  }>;
  attachments: TicketAttachmentDto[];
  // ─── v73.4 — بج تیکت خوانده‌نشده ادمین (درخواست مالک) ───
  /** آخرین بازدید ادمین از تیکت (adminReadAt) */
  adminReadAt?: string | null;
  /** true = ادمین هنوز آن را ندیده یا کاربر بعد از آخرین بازدیدِ ادمین پاسخ داده */
  unread?: boolean;
  // ─── v79 — بج خوانده‌نشده سمت کاربر (قرینهٔ ادمین) ───
  userReadAt?: string | null;
  /** true = مالک هنوز پاسخِ جدید ادمین را ندیده */
  unreadForUser?: boolean;
}

/** v77 — پیوست تیکت (عکس/ویدیو/فایل) */
export interface TicketAttachmentDto {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  uploaderId: string;
  createdAt: string;
}

function serializeAttachment(a: any): TicketAttachmentDto {
  return {
    id: a.id,
    fileName: a.fileName,
    fileType: a.fileType,
    fileSize: a.fileSize,
    fileUrl: a.fileUrl,
    uploaderId: a.uploaderId,
    createdAt: a.createdAt.toISOString(),
  };
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

  // ─── v79 — خوانده‌نشده سمت کاربر (قرینهٔ ادمین): ───
  //   فقط وقتی «پاسخ ادمین» وجود دارد که معنا داشته باشد؛ تیکتِ تازهٔ خود کاربر
  //   (بدون پاسخ ادمین) برای خودش خوانده‌شده است.
  //   userReadAt == null و پاسخ ادمین داریم → کاربر هنوز باز نکرده → unread
  //   آخرین پاسخِ ادمین بعد از userReadAt → پاسخ تازه → unread
  const userReadDate = t.userReadAt ? new Date(t.userReadAt) : null;
  const lastAdminReplyDate = ((t.replies || []) as any[])
    .filter((r: any) => r.role === "admin")
    .reduce((latest: Date | null, r: any) => {
      const d = new Date(r.createdAt);
      return !latest || d > latest ? d : latest;
    }, null as Date | null);
  const unreadForUser =
    lastAdminReplyDate != null &&
    (userReadDate == null || lastAdminReplyDate > userReadDate);

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
      attachments: (r.attachments || []).map(serializeAttachment),
    })),
    attachments: (t.attachments || []).map(serializeAttachment),
    adminReadAt: adminReadDate ? adminReadDate.toISOString() : null,
    unread,
    // v79 — سمت کاربر (ادمین این فلگ را نمی‌خواند)
    userReadAt: userReadDate ? userReadDate.toISOString() : null,
    unreadForUser,
  };
}

/**
 * GET /api/support/tickets
 *  - regular user → only their own tickets
 *  - admin → all tickets + فلگ unread هر تیکت + unreadCount (بج خوانده‌نشده)
 *
 * v79 — مرتب‌سازی جدید (درخواست مالک):
 *  «اول پیام‌های خوانده‌نشده در بالا به ترتیب زمان از آخرین به اول؛ بعد از
 *  خوانده‌نشده‌ها بقیه به ترتیب تاریخ»:
 *   ۱) خوانده‌نشده‌ها اول — بر اساس آخرین فعالیت (جدیدترین بالا)
 *   ۲) سپس خوانده‌شده‌ها — بر اساس تاریخ (جدیدترین بالا)
 *  خوانده‌نشده برای ادمین: adminReadAt null / پاسخ کاربر بعد از آخرین بازدید.
 *  خوانده‌نشده برای کاربر: userReadAt null / پاسخ ادمین بعد از آخرین بازدید.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const isAdmin = user.role === "ADMIN";

    const tickets = await db.supportTicket.findMany({
      where: isAdmin ? undefined : { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, mobile: true, planName: true },
        },
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

    const serialized = tickets.map(serializeTicket);

    // ─── v79 — مرتب‌سازی: خوانده‌نشده اول (آخرین فعالیت: جدید → قدیم)، سپس خوانده‌شده (تاریخ: جدید → قدیم) ───
    // فلگ خوانده‌نشده «از دید بیننده» است: ادمین → unread (adminReadAt)،
    // کاربر → unreadForUser (userReadAt) — هر شاخه فلگ خودش را می‌بیند.
    const lastActivityOf = (t: TicketDto) => {
      let latest = new Date(t.createdAt).getTime();
      for (const r of t.replies || []) {
        const d = new Date(r.createdAt).getTime();
        if (d > latest) latest = d;
      }
      return latest;
    };
    serialized.sort((a, b) => {
      const ua = (isAdmin ? a.unread : a.unreadForUser) ? 1 : 0;
      const ub = (isAdmin ? b.unread : b.unreadForUser) ? 1 : 0;
      if (ua !== ub) return ub - ua; // خوانده‌نشده اول
      // داخل هر گروه: آخرین فعالیت/تاریخ، جدیدترین اول
      return lastActivityOf(b) - lastActivityOf(a);
    });

    // شاخهٔ ادمین: تعداد تیکت‌های خوانده‌نشده برای بج تب «تیکت‌ها» (درخواست مالک)
    if (isAdmin) {
      const unreadCount = serialized.filter((t) => t.unread).length;
      return Response.json({ tickets: serialized, unreadCount });
    }

    return Response.json({ tickets: serialized });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/support/tickets
 *  - body: { subject, category, priority, message }
 *  - creates a new ticket + notifies all admins
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const subject = String(body?.subject || "").trim();
    const category = VALID_CATEGORIES.includes(body?.category)
      ? body.category
      : "general";
    const priority = VALID_PRIORITIES.includes(body?.priority)
      ? body.priority
      : "normal";
    const message = String(body?.message || "").trim();

    if (subject.length < 3) {
      return Response.json({ error: "موضوع باید حداقل ۳ کاراکتر باشد." }, { status: 400 });
    }
    if (message.length < 5) {
      return Response.json({ error: "متن پیام باید حداقل ۵ کاراکتر باشد." }, { status: 400 });
    }

    // v77 — پیوست‌ها (آپلودشده از /api/support/attachments) — حداکثر ۸ فایل
    const attachmentIds: string[] = Array.isArray(body?.attachmentIds)
      ? body.attachmentIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 8)
      : [];

    const ticket = await db.supportTicket.create({
      data: {
        userId: user.id,
        subject,
        category,
        priority,
        status: "open",
        message,
      },
    });

    // اتصال پیوست‌های standalone کاربر به تیکت (فقط آپلود خودِ کاربر + بدون اتصال قبلی)
    if (attachmentIds.length > 0) {
      await db.ticketAttachment.updateMany({
        where: { id: { in: attachmentIds }, uploaderId: user.id, ticketId: null, replyId: null },
        data: { ticketId: ticket.id },
      }).catch((e) => console.error("[tickets] failed to link attachments:", e));
    }

    const fullTicket = await db.supportTicket.findUnique({
      where: { id: ticket.id },
      include: {
        user: { select: { id: true, name: true, mobile: true, planName: true } },
        replies: {
          include: {
            user: { select: { id: true, name: true, mobile: true } },
            attachments: true,
          },
        },
        attachments: true,
      },
    });

    // Notify all admins (users with role ADMIN) about the new ticket
    const admins = await db.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: "system",
          title: "تیکت پشتیبانی جدید 🎫",
          body: `${user.name || user.mobile}: ${subject}`,
          read: false,
        })),
      });
    }

    // ─── پیامک «تیکت جدید» فقط برای مدیر — با نام خودِ مدیر (قالب ۹۴۲۷۶۳ — متغیر #NAME#) ───
    // درخواست مالک: هر وقت کاربر تیکت گذاشت، پیامک برای «مدیر» می‌رود و در متن،
    // نام «مدیر» جایگزین #NAME# می‌شود (نه نام کاربر!):
    // «حسین جوان عزیز. تیکت جدید داری.»
    // سابقاً اشتباهی به کاربر هم با نام خودش ارسال می‌شد — حذف شد.
    // after() → بعد از ارسال پاسخ اجرا می‌شود؛ خطای پیامک هرگز جریان تیکت را
    // نمی‌شکند. جایگزینی #NAME# سمت sms.ir انجام می‌شود (پارامتر NAME).
    after(async () => {
      try {
        const adminRow = await db.user.findFirst({
          where: { mobile: TICKET_SMS_ADMIN_MOBILE },
          select: { name: true },
        });
        const adminSmsName = (adminRow?.name && adminRow.name.trim()) || "مدیر";
        const adminSms = await sendTicketSms(TICKET_SMS_ADMIN_MOBILE, adminSmsName);
        const fmt = (r: Awaited<ReturnType<typeof sendTicketSms>>) =>
          r.success ? "sent ✓" : `failed: ${r.error}`;
        console.log(
          `[ticket-sms] ticket=${ticket.id} (create) → admin=${TICKET_SMS_ADMIN_MOBILE} (${adminSmsName}) → ${fmt(adminSms)}`
        );
      } catch (e) {
        console.error("[ticket-sms] unexpected:", e);
      }
    });

    return Response.json({ ticket: serializeTicket(fullTicket!) });
  } catch (e) {
    return apiError(e);
  }
}
