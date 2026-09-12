import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { grantQuotaBonus, getUserQuotaSummary, QUOTA_CATEGORIES, type QuotaCategory } from "@/lib/fitness/quota";
import { createNotification } from "@/lib/fitness/notifications";

/**
 * v53 — مدیریت سهمیه‌های رسانهٔ کاربر توسط ادمین
 *
 * GET  → خلاصهٔ سهمیه‌ها (chat_photo / meal_photo / movement_video + بونوس)
 * POST {category, amount} → افزودن سهمیهٔ بونوس + نوتیفیکیشن + پوش به کاربر
 *   category ∈ chat_photo | meal_photo | movement_video
 *   amount: ۱ تا ۵۰۰ (سرور هم clamp می‌کند)
 */

const CATEGORY_LABELS: Record<QuotaCategory, string> = {
  chat_photo: "عکس چت با فیتاپ",
  meal_photo: "تحلیل عکس غذا",
  movement_video: "آنالیز ویدیو حرکات",
};

async function resolveUser(id: string) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, name: true, mobile: true, planName: true, planExpiresAt: true },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const user = await resolveUser(id);
    if (!user) return Response.json({ error: "کاربر یافت نشد" }, { status: 404 });
    const summary = await getUserQuotaSummary(id);
    return Response.json({ summary });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const user = await resolveUser(id);
    if (!user) return Response.json({ error: "کاربر یافت نشد" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const category = String(body?.category || "") as QuotaCategory;
    const amount = Number(body?.amount);

    if (!QUOTA_CATEGORIES.includes(category)) {
      return Response.json({ error: "دستهٔ سهمیه نامعتبر است." }, { status: 400 });
    }

    const res = await grantQuotaBonus(id, category, amount);
    if (!res.ok) {
      return Response.json({ error: res.error }, { status: 400 });
    }

    // نوتیف + پوش به کاربر — «با اضافه شدنش به کاربر نوتیف بره» (درخواست مالک v53)
    const label = CATEGORY_LABELS[category];
    await createNotification(
      id,
      "quota_bonus",
      "🎁 سهمیهٔ جدید برای شما فعال شد",
      `سهمیهٔ «${label}» شما ${new Intl.NumberFormat("fa-IR").format(Math.round(amount))} عدد افزایش یافت — هم‌اکنون می‌توانی استفاده کنی.`,
      undefined,
      { category, amount }
    ).catch(() => null);

    const summary = await getUserQuotaSummary(id);
    return Response.json({ ok: true, summary });
  } catch (e) {
    return apiError(e);
  }
}
