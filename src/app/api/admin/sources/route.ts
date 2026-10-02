import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { sourceLabelFa } from "@/lib/fitness/notification-campaigns";

/**
 * ─── v178 — داشبورد «منبع کاربران و فروش» ───
 *
 * GET /api/admin/sources?days=30   (7|30|90|365|0=all)
 *
 * دیرکتیو مالک:
 *  «باید در داشبورد ببینم ثبت‌نام‌کنندگان به ترتیب از اینستاگرام یا گوگل یا
 *   کافه‌بازار کجا آمده‌اند؛ و در مالی/تراکنش‌ها کدام کاربر از کدام منبع
 *   خرید کرده.»
 *
 * خروجی:
 *  - registrants per source (ثبت‌نام‌ها) — کل + بازه
 *  - buyers/revenue per source (خرید موفق غیر-شارژ-کیف) — کل + بازه
 *  - نرخ تبدیل (خریدار ÷ ثبت‌نام) هر منبع
 *  - referredCount: کاربران واردشده با لینک معرفی (سیستم رفرال دوستان)
 *
 * نکته: کاربرانی که قبل از v178 ثبت‌نام شده‌اند signupSource=null دارند →
 * «نامشخص». بعد از اجرای اسکریپت prod-sync-content-v178.mjs بخشی از آن‌ها
 * (اپ بازار/اپ اختصاصی/اینستا) backfill می‌شوند.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewFinance");

    const { searchParams } = new URL(req.url);
    const rawDays = Number(searchParams.get("days"));
    const days = rawDays === 0 ? 0 : [7, 30, 90, 365].includes(rawDays) ? rawDays : 30;
    const since = days > 0 ? new Date(Date.now() - days * DAY_MS) : new Date(0);

    // ─── ۱) ثبت‌نام‌ها per source ───
    const [totalBySource, rangeBySource, referredTotal, referredRange, paymentsWithUser] =
      await Promise.all([
        db.user.groupBy({ by: ["signupSource"], _count: { _all: true } }),
        db.user.groupBy({
          by: ["signupSource"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        db.user.count({ where: { referredById: { not: null } } }),
        db.user.count({
          where: { referredById: { not: null }, createdAt: { gte: since } },
        }),
        // ─── ۲) خریدها per source (پرداخت‌ها کم‌اند — تجمیع در حافظه امن است) ───
        db.payment.findMany({
          where: { status: "success", plan: { not: "wallet_topup" } },
          select: {
            userId: true,
            amount: true,
            createdAt: true,
            user: { select: { signupSource: true } },
          },
        }),
      ]);

    const aggAll = new Map<string, { buyers: Set<string>; revenue: number; count: number }>();
    const aggRange = new Map<string, { buyers: Set<string>; revenue: number; count: number }>();
    for (const p of paymentsWithUser) {
      const key = p.user?.signupSource ?? "unknown";
      let a = aggAll.get(key);
      if (!a) {
        a = { buyers: new Set(), revenue: 0, count: 0 };
        aggAll.set(key, a);
      }
      a.buyers.add(p.userId);
      a.revenue += p.amount;
      a.count += 1;
      if (p.createdAt >= since) {
        let r = aggRange.get(key);
        if (!r) {
          r = { buyers: new Set(), revenue: 0, count: 0 };
          aggRange.set(key, r);
        }
        r.buyers.add(p.userId);
        r.revenue += p.amount;
        r.count += 1;
      }
    }

    // ─── ۳) ترکیب ───
    const order = ["instagram", "google", "cafebazaar", "app_panel", "web", "other"];
    const srcKeys = new Set<string>(order);
    for (const row of totalBySource) if (row.signupSource) srcKeys.add(row.signupSource);
    for (const key of aggAll.keys()) srcKeys.add(key);

    const rows: {
      source: string;
      label: string;
      registrants: number;
      registrantsRange: number;
      buyers: number;
      buyersRange: number;
      revenue: number;
      revenueRange: number;
      purchases: number;
      purchasesRange: number;
      convPct: number;
    }[] = [];

    let unknownRegistrants = 0;
    let unknownRegistrantsRange = 0;

    for (const key of srcKeys) {
      const t = totalBySource.find((r) => r.signupSource === key);
      const rg = rangeBySource.find((r) => r.signupSource === key);
      const a = aggAll.get(key);
      const r = aggRange.get(key);
      const registrants = key === "unknown" ? 0 : t?._count._all ?? 0;
      const registrantsRange = key === "unknown" ? 0 : rg?._count._all ?? 0;
      const buyers = a?.buyers.size ?? 0;
      const buyersRange = r?.buyers.size ?? 0;
      rows.push({
        source: key,
        label: key === "unknown" ? "نامشخص (قبل از v178)" : sourceLabelFa(key),
        registrants,
        registrantsRange,
        buyers,
        buyersRange,
        revenue: a?.revenue ?? 0,
        revenueRange: r?.revenue ?? 0,
        purchases: a?.count ?? 0,
        purchasesRange: r?.count ?? 0,
        convPct: registrants > 0 ? Math.round(((a?.buyers.size ?? 0) / registrants) * 1000) / 10 : 0,
      });
      if (key === "unknown") {
        unknownRegistrants = t?._count._all ?? 0;
        unknownRegistrantsRange = rg?._count._all ?? 0;
      }
    }

    // مرتب‌سازی: ثبت‌نام کل نزولی
    rows.sort((x, y) => y.registrants - x.registrants || y.revenue - x.revenue);

    const totalRegistrants = rows.reduce((s, r) => s + r.registrants, 0) + unknownRegistrants;
    const totalBuyers = rows.reduce((s, r) => s + r.buyers, 0);

    return Response.json({
      ok: true,
      range: { days: days === 0 ? "all" : days, since: since.toISOString() },
      rows,
      totals: {
        registrants: totalRegistrants,
        registrantsRange:
          rows.reduce((s, r) => s + r.registrantsRange, 0) + unknownRegistrantsRange,
        unknownRegistrants,
        unknownRegistrantsRange,
        buyers: totalBuyers,
        revenue: rows.reduce((s, r) => s + r.revenue, 0),
        revenueRange: rows.reduce((s, r) => s + r.revenueRange, 0),
        referredTotal,
        referredRange,
        convPctAll: totalRegistrants > 0 ? Math.round((totalBuyers / totalRegistrants) * 1000) / 10 : 0,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
