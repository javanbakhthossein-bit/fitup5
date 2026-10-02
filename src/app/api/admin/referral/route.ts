import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { getReferralRewardAmount } from "@/lib/fitness/referral";

/**
 * GET /api/admin/referral — تب «معرفی به دوستان» پنل ادمین
 *
 * سه حالت با همان GET (بر اساس query):
 *  ۱) بدون userId → { summary, list, total, page, pageSize }  (لیست معرف‌ها + خلاصه کلی)
 *  ۲) ?userId=    → { detail }  (جزئیات یک معرف + همهٔ دعوت‌شده‌هایش)
 *
 * گارد: requireAdmin + چک AdminPermission (canViewFinance یا canManageUsers؛
 * ادمین بدون رکورد پرمیشن = دسترسی کامل، مطابق الگوی permissions/route.ts).
 *
 * ——— قرارداد summary ———
 * {
 *   totalReferrers:       تعداد کاربرانی که حداقل ۱ دعوت‌شده دارند
 *   totalInvited:         تعداد کل دعوت‌شده‌ها (referredById != null)
 *   totalPurchasers:      دعوت‌شده‌هایی که حداقل ۱ پرداخت موفق (status="success") دارند
 *   revenueFromReferred:  جمع مبلغ Payment موفقِ دعوت‌شده‌ها (تومان)
 *   rewardsPaidTotal:     جمع WalletTransaction(type="bonus") معرفی — description شامل
 *                         «هدیه دعوت‌کننده» یا «هدیه دعوت‌شونده» (رشتهٔ دقیق processReferralReward
 *                         در src/lib/fitness/referral.ts). fallback: تعداد referralRewardPaid=true × نرخ فعلی
 *   rewardsPaidFallbackUsed: boolean — آیا fallback استفاده شد
 *   rewardsPendingCount:  دعوت‌شدهٔ خریدکرده که referralRewardPaid=false
 *   rewardsPendingAmount: rewardsPendingCount × نرخ فعلی (getReferralRewardAmount)
 *   conversionRate:       purchasers/invited ٪ (یک رقم اعشار)
 *   rewardPerReferral:    نرخ فعلی پاداش معرف (تومان)
 * }
 *
 * ——— قرارداد list (مرتب بر revenue desc) ———
 * { userId, name, mobileMasked, avatarUrl, code, invitedCount, purchaserCount,
 *   revenue, rewardPaidAmount, rewardPendingCount, firstInviteAt, lastInviteAt }
 * + { total, page, pageSize }
 *
 * ——— قرارداد detail ———
 * { detail: { referrer: {...row + createdAt}, invitees: [{ userId, name, mobileMasked,
 *   avatarUrl, joinedAt, hasPurchase, planName, amount, paidAt,
 *   rewardStatus: "paid"|"pending"|"none" }], inviteesTotal, truncated, cap } }
 */

// شماره موبایل سوپرادمین — همان ثابت permissions/route.ts و users/route.ts
const SUPER_ADMIN_MOBILE = "09300083803";

// رشته‌های دقیق description تراکنش‌های bonus معرفی (از processReferralReward در referral.ts)
const REFERRER_BONUS_PHRASE = "هدیه دعوت‌کننده"; // به کیف معرف
const INVITEE_BONUS_PHRASE = "هدیه دعوت‌شونده"; // به کیف خریدارِ دعوت‌شده

// سقف نمایش دعوت‌شده‌ها در جزئیات یک معرف (با پیام ادامه‌دار)
const DETAIL_INVITEE_CAP = 500;

/** تبدیل ارقام فارسی/عربی به انگلیسی (جستجوی موبایل از کیبورد فارسی) */
function toEnglishDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** ماسک موبایل — الگوی رایج پنل (referral/code/route.ts): ۰۹۳****اب */
function maskMobile(mobile: string): string {
  if (!mobile || mobile.length < 8) return "۰۹*******";
  return `${mobile.slice(0, 3)}****${mobile.slice(-2)}`;
}

/**
 * چک پرمیشن ادمین — مالی (canViewFinance) یا کاربران (canManageUsers).
 * ادمین بدون رکورد AdminPermission (سوپرادمین/ادمین قدیمی) = دسترسی کامل.
 */
async function requireReferralPerm(adminId: string, adminMobile: string) {
  if (adminMobile === SUPER_ADMIN_MOBILE) return;
  const perm = await db.adminPermission.findUnique({ where: { userId: adminId } });
  if (!perm) return; // ادمین قدیمی/بدون محدودیت — الگوی permissions/route.ts
  if (!perm.canViewFinance && !perm.canManageUsers) {
    throw new Error("REFERRAL_PERM_DENIED");
  }
}

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    await requireReferralPerm(admin.id, admin.mobile);

    const { searchParams } = new URL(req.url);
    const detailUserId = searchParams.get("userId");

    // ─────────────────────────── حالت جزئیات یک معرف ───────────────────────────
    if (detailUserId) {
      const referrer = await db.user.findUnique({
        where: { id: detailUserId },
        select: {
          id: true,
          name: true,
          mobile: true,
          avatarUrl: true,
          referralCode: true,
          createdAt: true,
        },
      });
      if (!referrer) {
        return Response.json({ error: "معرف موردنظر پیدا نشد." }, { status: 404 });
      }

      const [inviteesTotal, inviteeRows] = await Promise.all([
        db.user.count({ where: { referredById: detailUserId } }),
        db.user.findMany({
          where: { referredById: detailUserId },
          select: {
            id: true,
            name: true,
            mobile: true,
            avatarUrl: true,
            referralRewardPaid: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: DETAIL_INVITEE_CAP,
        }),
      ]);

      const inviteeIds = inviteeRows.map((r) => r.id);

      // پرداخت‌های موفق دعوت‌شده‌ها — جدیدترین اول؛ برای هر کاربر اولینِ لیست = آخرین خرید
      const pays = inviteeIds.length
        ? await db.payment.findMany({
            where: { userId: { in: inviteeIds }, status: "success" },
            select: { userId: true, amount: true, plan: true, createdAt: true, verifiedAt: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
      const lastPayMap = new Map<string, { amount: number; plan: string; paidAt: string }>();
      for (const p of pays) {
        if (!lastPayMap.has(p.userId)) {
          lastPayMap.set(p.userId, {
            amount: p.amount,
            plan: p.plan,
            paidAt: (p.verifiedAt ?? p.createdAt).toISOString(),
          });
        }
      }

      // آخرین Subscription هر دعوت‌شده (fallback نام پلن وقتی پرداخت موفقی در Payment نیست)
      const subs = inviteeIds.length
        ? await db.subscription.findMany({
            where: { userId: { in: inviteeIds } },
            select: { userId: true, plan: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
      const lastSubMap = new Map<string, string>();
      for (const s of subs) {
        if (!lastSubMap.has(s.userId)) lastSubMap.set(s.userId, s.plan);
      }

      // پاداش پرداخت‌شده به خود معرف (سمت دعوت‌کننده)
      const rewardAgg = await db.walletTransaction.aggregate({
        _sum: { amount: true },
        where: {
          userId: detailUserId,
          type: "bonus",
          description: { contains: REFERRER_BONUS_PHRASE },
        },
      });

      let purchaserCount = 0;
      let pendingCount = 0;
      let revenue = 0;
      for (const r of inviteeRows) {
        const pay = lastPayMap.get(r.id);
        if (!pay) continue;
        purchaserCount++;
        revenue += pay.amount;
        if (!r.referralRewardPaid) pendingCount++;
      }

      const invitees = inviteeRows.map((r) => {
        const pay = lastPayMap.get(r.id);
        const hasPurchase = !!pay;
        return {
          userId: r.id,
          name: r.name,
          mobileMasked: maskMobile(r.mobile),
          avatarUrl: r.avatarUrl ?? null,
          joinedAt: r.createdAt.toISOString(),
          hasPurchase,
          planName: pay?.plan ?? lastSubMap.get(r.id) ?? null,
          amount: pay?.amount ?? null,
          paidAt: pay?.paidAt ?? null,
          rewardStatus: hasPurchase ? (r.referralRewardPaid ? "paid" : "pending") : "none",
        };
      });

      return Response.json({
        detail: {
          referrer: {
            userId: referrer.id,
            name: referrer.name,
            mobileMasked: maskMobile(referrer.mobile),
            avatarUrl: referrer.avatarUrl ?? null,
            code: referrer.referralCode,
            createdAt: referrer.createdAt.toISOString(),
            invitedCount: inviteesTotal,
            purchaserCount,
            revenue,
            rewardPaidAmount: rewardAgg._sum.amount ?? 0,
            rewardPendingCount: pendingCount,
          },
          invitees,
          inviteesTotal,
          truncated: inviteesTotal > inviteeRows.length,
          cap: DETAIL_INVITEE_CAP,
        },
      });
    }

    // ─────────────────────────── حالت لیست + خلاصه ───────────────────────────
    // پارس امن صفحه‌بندی — Number(abc) → NaN → skip/take نامعتبر (الگوی users/route.ts)
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || 1) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(searchParams.get("pageSize") || 20) || 20))
    );
    const qRaw = (searchParams.get("q") || "").trim();
    const q = qRaw.slice(0, 60);
    const qEn = toEnglishDigits(q);

    const rewardRate = await getReferralRewardAmount();

    // ۱) aggregate دعوت‌شدگان — یک ردیف SQL به‌ازای هر معرف (هرگز fetch-all کل کاربران)
    const inviteAgg = await db.user.groupBy({
      by: ["referredById"],
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      where: { referredById: { not: null } },
    });
    const referrerIds = inviteAgg
      .map((r) => r.referredById)
      .filter((id): id is string => !!id);

    // ۲) پرداخت‌های موفق دعوت‌شده‌ها — گروه‌بندی بر پرداخت‌کننده (SQL)
    const payAgg = await db.payment.groupBy({
      by: ["userId"],
      _sum: { amount: true },
      _count: { _all: true },
      where: { status: "success", user: { referredById: { not: null } } },
    });
    const purchaserIds = payAgg.map((p) => p.userId);

    // نگاشت پرداخت‌کننده → معرف + وضعیت پاداش (تعداد purchasers محدود است)
    const purchaserRows = purchaserIds.length
      ? await db.user.findMany({
          where: { id: { in: purchaserIds } },
          select: { id: true, referredById: true, referralRewardPaid: true },
        })
      : [];
    const purchaserById = new Map(purchaserRows.map((u) => [u.id, u]));

    // ۳) پاداش پرداخت‌شده به معرف‌ها — فقط رشتهٔ «هدیه دعوت‌کننده» (SQL)
    const rewardAgg = referrerIds.length
      ? await db.walletTransaction.groupBy({
          by: ["userId"],
          _sum: { amount: true },
          where: {
            userId: { in: referrerIds },
            type: "bonus",
            description: { contains: REFERRER_BONUS_PHRASE },
          },
        })
      : [];

    // ─── summary (همه SQL aggregate) ───
    const [totalInvited, paidTxnAgg, paidFlagCount] = await Promise.all([
      db.user.count({ where: { referredById: { not: null } } }),
      db.walletTransaction.aggregate({
        _sum: { amount: true },
        where: {
          type: "bonus",
          OR: [
            { description: { contains: REFERRER_BONUS_PHRASE } },
            { description: { contains: INVITEE_BONUS_PHRASE } },
          ],
        },
      }),
      db.user.count({ where: { referralRewardPaid: true, referredById: { not: null } } }),
    ]);

    const revenueFromReferred = payAgg.reduce((s, p) => s + (p._sum.amount ?? 0), 0);
    const totalPurchasers = payAgg.length;
    const paidFromTxns = paidTxnAgg._sum.amount;
    const rewardsPaidFallbackUsed = paidFromTxns === null || paidFromTxns === undefined;
    const rewardsPaidTotal = rewardsPaidFallbackUsed ? paidFlagCount * rewardRate : paidFromTxns;

    const rewardsPendingCount = purchaserRows.filter((p) => !p.referralRewardPaid).length;

    const summary = {
      totalReferrers: referrerIds.length,
      totalInvited,
      totalPurchasers,
      revenueFromReferred,
      rewardsPaidTotal,
      rewardsPaidFallbackUsed,
      rewardsPendingCount,
      rewardsPendingAmount: rewardsPendingCount * rewardRate,
      conversionRate:
        totalInvited > 0 ? Math.round((totalPurchasers / totalInvited) * 1000) / 10 : 0,
      rewardPerReferral: rewardRate,
    };

    // ─── ترکیب ردیف‌های معرف‌ها (یک ردیف به‌ازای هر معرف — سقف = تعداد معرف‌ها) ───
    type Row = {
      userId: string;
      invitedCount: number;
      purchaserCount: number;
      revenue: number;
      rewardPaidAmount: number;
      rewardPendingCount: number;
      firstInviteAt: string | null;
      lastInviteAt: string | null;
    };
    const rowMap = new Map<string, Row>();
    for (const agg of inviteAgg) {
      if (!agg.referredById) continue;
      rowMap.set(agg.referredById, {
        userId: agg.referredById,
        invitedCount: agg._count._all,
        purchaserCount: 0,
        revenue: 0,
        rewardPaidAmount: 0,
        rewardPendingCount: 0,
        firstInviteAt: agg._min.createdAt?.toISOString() ?? null,
        lastInviteAt: agg._max.createdAt?.toISOString() ?? null,
      });
    }
    for (const p of purchaserRows) {
      if (!p.referredById) continue;
      const row = rowMap.get(p.referredById);
      if (!row) continue;
      row.purchaserCount++;
      if (!p.referralRewardPaid) row.rewardPendingCount++;
    }
    for (const p of payAgg) {
      const referredById = purchaserById.get(p.userId)?.referredById;
      if (!referredById) continue;
      const row = rowMap.get(referredById);
      if (!row) continue;
      row.revenue += p._sum.amount ?? 0;
    }
    for (const w of rewardAgg) {
      const row = rowMap.get(w.userId);
      if (!row) continue;
      row.rewardPaidAmount = w._sum.amount ?? 0;
    }

    // ─── جستجو (نام/موبایل/کد معرفِ خود معرف) — SQL-side ───
    let filteredIds: string[];
    if (q) {
      const matched = await db.user.findMany({
        where: {
          id: { in: Array.from(rowMap.keys()) },
          OR: [
            { name: { contains: q } },
            { mobile: { contains: qEn } },
            { referralCode: { contains: q } },
            { referralCode: { contains: q.toUpperCase() } },
          ],
        },
        select: { id: true },
      });
      filteredIds = matched.map((m) => m.id);
    } else {
      filteredIds = Array.from(rowMap.keys());
    }

    // مرتب بر درآمد نزولی (تثبیت: دعوت‌شده بیشتر، سپس آخرین دعوت)
    const sorted = filteredIds
      .map((id) => rowMap.get(id)!)
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.invitedCount !== a.invitedCount) return b.invitedCount - a.invitedCount;
        return (b.lastInviteAt ?? "").localeCompare(a.lastInviteAt ?? "");
      });

    const total = sorted.length;
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const pageIds = pageRows.map((r) => r.userId);

    // اطلاعات نمایشی فقط برای معرف‌های همین صفحه
    const pageUsers = pageIds.length
      ? await db.user.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, name: true, mobile: true, avatarUrl: true, referralCode: true },
        })
      : [];
    const userInfoMap = new Map(pageUsers.map((u) => [u.id, u]));

    const list = pageRows.map((r) => {
      const u = userInfoMap.get(r.userId);
      return {
        userId: r.userId,
        name: u?.name ?? null,
        mobileMasked: u ? maskMobile(u.mobile) : "—",
        avatarUrl: u?.avatarUrl ?? null,
        code: u?.referralCode ?? null,
        invitedCount: r.invitedCount,
        purchaserCount: r.purchaserCount,
        revenue: r.revenue,
        rewardPaidAmount: r.rewardPaidAmount,
        rewardPendingCount: r.rewardPendingCount,
        firstInviteAt: r.firstInviteAt,
        lastInviteAt: r.lastInviteAt,
      };
    });

    return Response.json({ summary, list, total, page, pageSize });
  } catch (e) {
    if (e instanceof Error && e.message === "REFERRAL_PERM_DENIED") {
      return Response.json(
        { error: "شما به بخش «معرفی به دوستان» دسترسی ندارید." },
        { status: 403 }
      );
    }
    return apiError(e);
  }
}
