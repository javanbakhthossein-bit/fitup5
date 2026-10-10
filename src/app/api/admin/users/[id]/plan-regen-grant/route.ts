import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { createNotification } from "@/lib/fitness/notifications";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * v150 — افزودن «تعداد انتخابی» درخواست تغییر برنامه از چت (بازطراحی برنامه)
 * به کاربر — دیرکتیو مالک:
 * «در پنل مدیر برای هر کاربر پیشرفته و حرفه‌ای باید امکان این رو داشته باشم
 *  که بتونم تعداد انتخابی درخواست تغییر برنامه از چت اضافه کنم»
 *
 * POST { amount } → به `Subscription.planRegenExtra` اشتراکِ حامل سهمیه
 * (active اول، بعد pending — همان ترتیب getPlanRegenState) += amount
 * و نوتیفیکیشن + پوش به کاربر.
 *
 * پاسخ: { ok, planRegen: { eligible, used, pending, extra } }
 *   used همیشه با احتساب extra محاسبه می‌شود (تا وقتی extra>0، «در دسترس»).
 */

/** holder = active اول، بعد pending — دقیقاً همان ترتیب getPlanRegenState */
async function findRegenHolder(userId: string) {
  const now = new Date();
  const activeSub = await db.subscription.findFirst({
    where: { userId, status: "active", endDate: { gt: now } },
    orderBy: { endDate: "desc" },
  });
  if (activeSub) return activeSub;
  const pendingSub = await db.subscription.findFirst({
    where: {
      userId,
      status: "pending",
      OR: [{ endDate: null }, { endDate: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  return pendingSub ?? null;
}

interface RegenHolderFields {
  plan: string;
  planRegenUsed: boolean;
  planRegenPending: boolean;
  planRegenExtra: number;
}

async function planRegenStateOf(holder: RegenHolderFields | null) {
  const plan = (holder?.plan as string | null) ?? null;
  const eligible = plan === "advanced" || plan === "ultimate";
  return {
    eligible,
    used: (holder?.planRegenUsed ?? false) && (holder?.planRegenExtra ?? 0) <= 0,
    pending: holder?.planRegenPending ?? false,
    extra: holder?.planRegenExtra ?? 0,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, mobile: true },
    });
    if (!user) return Response.json({ error: "کاربر یافت نشد" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
    const amount = Math.floor(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > 50) {
      return Response.json({ error: "تعداد باید عددی بین ۱ تا ۵۰ باشد" }, { status: 400 });
    }

    const holder = await findRegenHolder(id);
    if (!holder) {
      return Response.json(
        { error: "اشتراک فعالی برای این کاربر یافت نشد — سهمیهٔ بازطراحی به اشتراک تعلق می‌گیرد." },
        { status: 409 }
      );
    }

    const updated = await db.subscription.update({
      where: { id: holder.id },
      data: { planRegenExtra: { increment: amount } },
    });

    // نوتیفیکیشن + پوش — کاربر باید بداند سهمیهٔ تازه دارد (مثل بونوس سهمیهٔ رسانه)
    await createNotification(
      id,
      "plan_regen_bonus",
      "سهمیهٔ تغییر برنامه فعال شد 🎯",
      `${toPersianDigits(amount)} درخواست تغییر برنامه از «چت با فیتاپ» به‌صورت هدیه از پشتیبانی به حساب شما اضافه شد. کافیست در چت با فیتاپ درخواست تغییر برنامهٔ خود را بنویسید.`,
      undefined,
      { amount, subscriptionId: holder.id, source: "admin_grant" }
    );

    const planRegen = await planRegenStateOf({
      plan: updated.plan,
      planRegenUsed: updated.planRegenUsed,
      planRegenPending: updated.planRegenPending,
      planRegenExtra: updated.planRegenExtra,
    });
    return Response.json({ ok: true, planRegen });
  } catch (e) {
    return apiError(e);
  }
}

/** GET — وضعیت فعلی سهمیهٔ بازطراحی (برای رفرش بدون details کامل) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const holder = await findRegenHolder(id);
    const planRegen = await planRegenStateOf(
      holder
        ? {
            plan: holder.plan,
            planRegenUsed: holder.planRegenUsed,
            planRegenPending: holder.planRegenPending,
            planRegenExtra: holder.planRegenExtra,
          }
        : null
    );
    return Response.json({ ok: true, planRegen });
  } catch (e) {
    return apiError(e);
  }
}
