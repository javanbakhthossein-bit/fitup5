import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";

/**
 * v174 — GET /api/admin/instagram-funnel?days=30
 *
 * قیف کامل «پرداخت امن اینستاگرام» (دیرکتیو مالک): چند نفر روی «ارسال لینک
 * پرداخت امن» کلیک کرده‌اند، چند نفر لینک را باز کرده‌اند و چند نفر واقعاً
 * خریده‌اند — با نرخ تبدیل، درآمد، نمودار روزانه و جدول رصدهای اخیر.
 *
 * تعریف دقیق هر مرحله (از کدبیس):
 *  • ارسال   = هر ردیف PaymentToken با kind="sms_link" (هر بار کلیک دکمهٔ
 *             «ارسال پیامک پرداخت امن» یا «ارسال مجدد» یک پیامک واقعی با
 *             قالب 744490 رفته و یک توکن ساخته شده — سقف ۵ پیامک/پرداخت)
 *  • بازکردن = توکن با clickCount > 0 (کلیک روی /enter?token=… در
 *             recordTokenClick ثبت می‌شود؛ usedAt = اولین کلیک)
 *  • خرید    = پرداختِ گره‌خورده به توکن (paymentId) با status="success"
 *             (مبلغ از Payment.amount — بدون دوبارشماری؛ هر توکن یک پرداخت)
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOKENS = 3000; // سقف ایمنی حافظه — بالاتر از آن فلگ truncated می‌گیرد
const RECENT_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewFinance");

    const { searchParams } = new URL(req.url);
    const rawDays = Number(searchParams.get("days"));
    // 0 = همهٔ زمان‌ها؛ بقیه فقط از بین گزینه‌های مجاز
    const days = rawDays === 0 ? 0 : [7, 30, 90, 365].includes(rawDays) ? rawDays : 30;
    const since = days > 0 ? new Date(Date.now() - days * DAY_MS) : new Date(0);

    const tokens = await db.paymentToken.findMany({
      where: { kind: "sms_link", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_TOKENS,
      select: {
        id: true,
        userId: true,
        paymentId: true,
        clickCount: true,
        usedAt: true,
        expiresAt: true,
        createdAt: true,
        amount: true,
        payment: { select: { status: true, amount: true, plan: true, verifiedAt: true } },
        user: { select: { name: true, mobile: true } },
      },
    });
    const truncated = tokens.length >= MAX_TOKENS;

    // ─── تجمیع‌ها ───
    const sentUsers = new Set<string>();
    const openedUsers = new Set<string>();
    const buyers = new Set<string>();
    const purchasedPaymentIds = new Set<string>();
    let opened = 0;
    let clicksTotal = 0;
    let revenue = 0;

    for (const t of tokens) {
      sentUsers.add(t.userId);
      clicksTotal += t.clickCount;
      const isPurchased = t.payment?.status === "success";
      if (t.clickCount > 0) {
        opened += 1;
        openedUsers.add(t.userId);
      }
      if (isPurchased && t.paymentId) {
        if (!purchasedPaymentIds.has(t.paymentId)) {
          purchasedPaymentIds.add(t.paymentId);
          revenue += t.payment?.amount ?? t.amount ?? 0;
          buyers.add(t.userId);
        }
      }
    }

    const sends = tokens.length;
    const notOpened = Math.max(0, sends - opened);
    const purchased = purchasedPaymentIds.size;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

    // ─── باکت روزانه (حداکثر ۳۰ روز آخرِ بازه برای خوانایی) ───
    const bucketDays = days === 0 || days > 30 ? 30 : days;
    const dayMap = new Map<string, { sends: number; opened: number; purchased: number }>();
    const dayKey = (d: Date) => {
      // کلید YYYY-MM-DD به وقت تهران (UTC+3:30) تا مرز روزها با تجربهٔ کاربر یکی باشد
      const t = new Date(d.getTime() + 3.5 * 60 * 60 * 1000);
      return t.toISOString().slice(0, 10);
    };
    for (let i = bucketDays - 1; i >= 0; i--) {
      dayMap.set(dayKey(new Date(Date.now() - i * DAY_MS)), { sends: 0, opened: 0, purchased: 0 });
    }
    for (const t of tokens) {
      const k = dayKey(t.createdAt);
      const bucket = dayMap.get(k);
      if (!bucket) continue;
      bucket.sends += 1;
      if (t.clickCount > 0) bucket.opened += 1;
      if (t.payment?.status === "success") bucket.purchased += 1;
    }
    const perDay = Array.from(dayMap.entries()).map(([day, v]) => ({ day, ...v }));

    // ─── رصدهای اخیر ───
    const now = Date.now();
    const recent = tokens.slice(0, RECENT_LIMIT).map((t) => {
      const isPurchased = t.payment?.status === "success";
      const tokenState = isPurchased
        ? "purchased"
        : t.clickCount > 0
          ? "opened"
          : t.expiresAt.getTime() < now
            ? "expired"
            : "sent";
      return {
        id: t.id,
        createdAt: t.createdAt.toISOString(),
        userName: t.user?.name || "",
        userMobile: t.user?.mobile || "",
        plan: t.payment?.plan || "",
        amount: t.payment?.amount ?? t.amount ?? 0,
        clickCount: t.clickCount,
        tokenState, // sent | opened | expired | purchased
        paymentStatus: t.payment?.status || null,
        purchasedAt: t.payment?.verifiedAt?.toISOString() || null,
      };
    });

    return Response.json({
      ok: true,
      range: { days: days === 0 ? "all" : days, since: since.toISOString() },
      totals: {
        sends,
        sentUsers: sentUsers.size,
        opened,
        openedUsers: openedUsers.size,
        notOpened,
        expiredTokens: tokens.filter((t) => t.clickCount === 0 && t.expiresAt.getTime() < now && t.payment?.status !== "success").length,
        purchased,
        purchaseUsers: buyers.size,
        revenue,
        avgClicksPerOpened: opened > 0 ? Math.round((clicksTotal / opened) * 10) / 10 : 0,
        openRatePct: pct(opened, sends),
        purchaseRateFromSendsPct: pct(purchased, sends),
        purchaseRateFromOpenedPct: pct(purchased, opened),
      },
      perDay,
      recent,
      truncated,
    });
  } catch (e) {
    return apiError(e);
  }
}
