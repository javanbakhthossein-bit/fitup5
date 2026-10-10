import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { sourceLabelFa } from "@/lib/fitness/notification-campaigns";
import * as XLSX from "xlsx";

/**
 * ─── v178 — خروجی اکسل کامل کاربران ───
 *
 * دیرکتیو مالک:
 *  «فایل اکسل اطلاعات کاربران سالم و دقیق دانلود بشه و همهٔ اطلاعات توش باشه؛
 *   قابلیت‌های زیادی برای دانلود — با گروه‌ها و دسته‌بندی‌های مختلف جدا اکسل
 *   بگیرم؛ در زمان‌بندی‌های مختلف جدا اکسل بگیرم.»
 *
 * ستون‌ها (۲۱): ردیف، نام، موبایل، نقش، پلن، شروع پلن، انقضای پلن، اشتراک فعال،
 * کیف پول، آنبوردینگ، مسدود، تاریخ ثبت‌نام، منبع ثبت‌نام، جزئیات منبع، نصب اپ،
 * کد معرفی (خود کاربر)، واردشده با معرفی، آخرین فعالیت، مجموع خرید، تعداد خرید،
 * اولین/آخرین خرید.
 *
 * فیلترها (همه اختیاری — ترکیب‌پذیر):
 *   search, role, plan, onboarding (قبلی) +
 *   source=instagram|google|cafebazaar|app_panel|web|other|unknown
 *   appSource=panel|bazaar|none
 *   purchaseStatus=purchased|never
 *   registeredFrom/registeredTo=ISO
 *   purchaseFrom/purchaseTo=ISO (خرید موفق در بازه)
 *   blocked=active|blocked
 *   mobiles=09...،09... (لیست صریح)
 */

const PLAN_LABELS: Record<string, string> = {
  basic: "اقتصادی",
  standard: "استاندارد",
  advanced: "پیشرفته",
  ultimate: "حرفه‌ای",
};

const APP_SOURCE_LABELS: Record<string, string> = {
  panel: "اپ اختصاصی",
  bazaar: "اپ کافه‌بازار",
  pwa: "PWA",
};

function toJalali(iso: string | Date | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
  } catch {
    return "";
  }
}

function toJalaliDateTime(iso: Date | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const plan = searchParams.get("plan") || "";
    const onboarding = searchParams.get("onboarding") || "";
    const source = searchParams.get("source") || "";
    const appSource = searchParams.get("appSource") || "";
    const purchaseStatus = searchParams.get("purchaseStatus") || "";
    const registeredFrom = searchParams.get("registeredFrom") || "";
    const registeredTo = searchParams.get("registeredTo") || "";
    const purchaseFrom = searchParams.get("purchaseFrom") || "";
    const purchaseTo = searchParams.get("purchaseTo") || "";
    const blocked = searchParams.get("blocked") || "";
    const mobilesParam = (searchParams.get("mobiles") || "")
      .split(",")
      .map((m) => m.replace(/[^\d]/g, ""))
      .filter((m) => /^09\d{9}$/.test(m))
      .slice(0, 5000);
    const now = new Date();

    const where: any = {};
    if (search) {
      where.OR = [{ mobile: { contains: search } }, { name: { contains: search } }];
    }
    if (role && role !== "all") where.role = role;
    if (plan && plan !== "all") {
      where.planName = plan === "none" ? null : plan;
    }
    if (onboarding === "done") where.onboardingDone = true;
    if (onboarding === "pending") where.onboardingDone = false;
    if (source && source !== "all") {
      where.signupSource = source === "unknown" ? null : source;
    }
    if (appSource && appSource !== "all") {
      where.appInstallSource = appSource === "none" ? null : appSource;
    }
    if (blocked === "active") where.isBlocked = false;
    if (blocked === "blocked") where.isBlocked = true;
    const regRange: any = {};
    if (registeredFrom) regRange.gte = new Date(registeredFrom);
    if (registeredTo) {
      const d = new Date(registeredTo);
      d.setHours(23, 59, 59, 999);
      regRange.lte = d;
    }
    if (Object.keys(regRange).length) where.createdAt = regRange;
    if (mobilesParam.length) {
      where.mobile = { in: mobilesParam };
    }

    // فیلتر خرید: purchased / never / بازه
    const successPaymentWhere: any = { status: "success", plan: { not: "wallet_topup" } };
    if (purchaseFrom || purchaseTo) {
      const pr: any = {};
      if (purchaseFrom) pr.gte = new Date(purchaseFrom);
      if (purchaseTo) {
        const d = new Date(purchaseTo);
        d.setHours(23, 59, 59, 999);
        pr.lte = d;
      }
      successPaymentWhere.createdAt = pr;
    }
    if (purchaseStatus === "purchased") {
      where.payments = { some: successPaymentWhere };
    } else if (purchaseStatus === "never") {
      where.payments = { none: { status: "success", plan: { not: "wallet_topup" } } };
    }

    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        mobile: true,
        name: true,
        role: true,
        isBlocked: true,
        onboardingDone: true,
        createdAt: true,
        planName: true,
        planStartedAt: true,
        planExpiresAt: true,
        walletBalance: true,
        signupSource: true,
        signupSourceDetail: true,
        appInstallSource: true,
        pwaInstalledAt: true,
        referralCode: true,
        referredById: true,
        lastActiveAt: true,
      },
    });

    const userIds = users.map((u) => u.id);
    const [subs, referredIds, payAgg] = await Promise.all([
      db.subscription.findMany({
        where: { userId: { in: userIds }, status: "active", endDate: { gt: now } },
        select: { userId: true },
      }),
      // واردشده با لینک معرفی
      db.user.findMany({
        where: { id: { in: userIds }, referredById: { not: null } },
        select: { id: true },
      }),
      // تجمیع خریدهای موفق (غیر شارژ کیف پول) per user
      db.payment.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, status: "success", plan: { not: "wallet_topup" } },
        _sum: { amount: true },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);

    const subSet = new Set(subs.map((s) => s.userId));
    const referredSet = new Set(referredIds.map((u) => u.id));
    const payMap = new Map(payAgg.map((p) => [p.userId, p]));

    const rows = users.map((u, i) => {
      const pay = payMap.get(u.id);
      return {
        "ردیف": i + 1,
        "نام": u.name || "بدون نام",
        "شماره موبایل": u.mobile,
        "نقش": u.role === "ADMIN" ? "ادمین" : "ورزشکار",
        "پلن": u.planName ? (PLAN_LABELS[u.planName] || u.planName) : "بدون پلن",
        "شروع پلن": toJalali(u.planStartedAt),
        "انقضای پلن": toJalali(u.planExpiresAt),
        "اشتراک فعال": subSet.has(u.id) ? "بله" : "خیر",
        "کیف پول (تومان)": u.walletBalance || 0,
        "آنبوردینگ": u.onboardingDone ? "انجام شده" : "انجام نشده",
        "مسدود": u.isBlocked ? "بله" : "خیر",
        "تاریخ ثبت‌نام": toJalali(u.createdAt.toISOString()),
        "منبع ثبت‌نام": u.signupSource ? sourceLabelFa(u.signupSource) : "نامشخص",
        "جزئیات منبع": u.signupSourceDetail || "",
        "اپ نصب‌شده": APP_SOURCE_LABELS[u.appInstallSource || ""] || (u.pwaInstalledAt ? "PWA" : "—"),
        "کد معرفی کاربر": u.referralCode || "",
        "واردشده با معرفی": referredSet.has(u.id) ? "بله" : "خیر",
        "آخرین فعالیت": toJalaliDateTime(u.lastActiveAt),
        "مجموع خرید (تومان)": pay?._sum.amount ?? 0,
        "تعداد خرید": pay?._count._all ?? 0,
        "اولین خرید": toJalaliDateTime(pay?._min.createdAt ?? null),
        "آخرین خرید": toJalaliDateTime(pay?._max.createdAt ?? null),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 6 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
      { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 },
      { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 18 },
    ];
    ws["!views"] = [{ RTL: true }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "کاربران");
    if (!wb.Props) wb.Props = {};
    (wb.Props as Record<string, unknown>).Creator = "فیتاپ";

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `fitap-users-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
