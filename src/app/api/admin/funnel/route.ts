import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { FUNNEL_EVENTS } from "@/lib/analytics/funnel";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v198 — GET /api/admin/funnel?days=N — داشبورد قیف فروش (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * «تمام مراحل خرید رو در همه جا رویداد گذاری کنی و در پنل مدیر برام بیاری»
 * + پاسخ به سؤالی که Clarity نتوانست بدهد: «کاربران دقیقاً در کدام مرحله و
 * به چه دلیلِ فنی، خرید را رها کرده‌اند؟»
 *
 * خروجی:
 *   • funnel  — خط اصلی قیف (شمارش سشن/کاربر یکتا در هر مرحله + درصد تبدیل)
 *   • branches— دو شاخهٔ تحویل: پیامک امن اینستاگرام vs درگاه
 *   • side    — رویدادهای شکست/جانبی (بن‌بست، خطای شبکه، کد رد‌شده و…)
 *   • daily   — سری روزانهٔ مراحل کلیدی (نمودار روند)
 *   • jsErrors— خطاهای واقعی جاوااسکریپت از ErrorLog (با صفحه/تعداد/آخرین زمان)
 *   • breakdown — تفکیک منبع ورود/دستگاه/پلن برای باز شدن مدال تا موفقیت
 *   • payments— حقیقت جدول Payment (درآمد/تعداد موفق — کنترل صحت قیف)
 *   • recent  — ۳۰ رویداد آخر با کاربر (رصد زنده)
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 60_000; // سقف ایمنی حافظه — بالاتر از رشد فعلی

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewFinance");

    const { searchParams } = new URL(req.url);
    const rawDays = Number(searchParams.get("days"));
    // 0 = همهٔ زمان‌ها؛ بقیه فقط از گزینه‌های مجاز
    const days = rawDays === 0 ? 0 : [1, 3, 7, 30].includes(rawDays) ? rawDays : 3;
    const since = days > 0 ? new Date(Date.now() - days * DAY_MS) : new Date(0);

    const events = await db.funnelEvent.findMany({
      where: { kind: "funnel", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_EVENTS,
      select: {
        event: true,
        userId: true,
        sessionId: true,
        path: true,
        planId: true,
        amount: true,
        source: true,
        device: true,
        createdAt: true,
        user: { select: { name: true, mobile: true } },
      },
    });
    const truncated = events.length >= MAX_EVENTS;

    // ─── تجمیع خط قیف: سشن/کاربر یکتا در هر مرحله ───
    const sessionsByEvent = new Map<string, Set<string>>();
    const usersByEvent = new Map<string, Set<string>>();
    const countByEvent = new Map<string, number>();
    for (const ev of events) {
      if (!sessionsByEvent.has(ev.event)) {
        sessionsByEvent.set(ev.event, new Set());
        usersByEvent.set(ev.event, new Set());
        countByEvent.set(ev.event, 0);
      }
      sessionsByEvent.get(ev.event)!.add(ev.sessionId || ev.userId || `anon:${ev.sessionId}`);
      if (ev.userId) usersByEvent.get(ev.event)!.add(ev.userId);
      countByEvent.set(ev.event, countByEvent.get(ev.event)! + 1);
    }

    const mainSteps = Object.entries(FUNNEL_EVENTS)
      .filter(([, def]) => def.step > 0)
      .sort((a, b) => a[1].step - b[1].step);
    const firstSessions = sessionsByEvent.get(mainSteps[0]?.[0] ?? "")?.size ?? 0;

    let prevSessions: number | null = null;
    const funnel = mainSteps.map(([event, def]) => {
      const sessions = sessionsByEvent.get(event)?.size ?? 0;
      const users = usersByEvent.get(event)?.size ?? 0;
      const row = {
        event,
        label: def.label,
        step: def.step,
        sessions,
        users,
        total: countByEvent.get(event) ?? 0,
        pctOfFirst: firstSessions > 0 ? Math.round((sessions / firstSessions) * 100) : 0,
        pctOfPrev: prevSessions && prevSessions > 0 ? Math.round((sessions / prevSessions) * 100) : null,
      };
      prevSessions = sessions;
      return row;
    });

    // ─── شاخه‌های تحویل (پیامک امن vs درگاه) ───
    const branches = {
      sms: {
        sessions: sessionsByEvent.get("payment_link_sms_sent")?.size ?? 0,
        users: usersByEvent.get("payment_link_sms_sent")?.size ?? 0,
      },
      gateway: {
        sessions: sessionsByEvent.get("gateway_redirecting")?.size ?? 0,
        users: usersByEvent.get("gateway_redirecting")?.size ?? 0,
      },
    };

    // ─── رویدادهای جانبی/شکست ───
    const side = Object.entries(FUNNEL_EVENTS)
      .filter(([, def]) => def.step < 0)
      .map(([event, def]) => ({
        event,
        label: def.label,
        total: countByEvent.get(event) ?? 0,
        sessions: sessionsByEvent.get(event)?.size ?? 0,
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

    // ─── سری روزانهٔ مراحل کلیدی ───
    const KEY_EVENTS = [
      "purchase_modal_opened",
      "checkout_created",
      "gateway_redirecting",
      "payment_link_sms_sent",
      "pay_page_viewed",
      "payment_succeeded",
    ];
    const dayBuckets = new Map<string, Map<string, number>>();
    for (const ev of events) {
      if (!KEY_EVENTS.includes(ev.event)) continue;
      const d = new Date(ev.createdAt.getTime() + 3.5 * 3600_000); // ≈ تهران UTC+3:30
      const key = d.toISOString().slice(0, 10);
      if (!dayBuckets.has(key)) dayBuckets.set(key, new Map());
      const m = dayBuckets.get(key)!;
      m.set(ev.event, (m.get(ev.event) ?? 0) + 1);
    }
    const daily = [...dayBuckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({ date, counts: Object.fromEntries(counts) }));

    // ─── تفکیک منبع/دستگاه/پلن: باز شدن مدال → ایجاد پرداخت → موفقیت ───
    const mkBreak = () => new Map<string, { opens: number; created: number; success: number }>();
    const bySource = mkBreak();
    const byDevice = mkBreak();
    const byPlan = mkBreak();
    const bump = (
      map: Map<string, { opens: number; created: number; success: number }>,
      key: string,
      ev: (typeof events)[number]
    ) => {
      const k = key || "unknown";
      if (!map.has(k)) map.set(k, { opens: 0, created: 0, success: 0 });
      const row = map.get(k)!;
      if (ev.event === "purchase_modal_opened") row.opens++;
      else if (ev.event === "checkout_created") row.created++;
      else if (ev.event === "payment_succeeded") row.success++;
    };
    for (const ev of events) {
      bump(bySource, ev.source ?? "unknown", ev);
      bump(byDevice, ev.device ?? "unknown", ev);
      bump(byPlan, ev.planId ?? "-", ev);
    }
    const arr = (m: typeof bySource) =>
      [...m.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.opens + b.success - (a.opens + a.success))
        .slice(0, 8);

    // ─── حقیقت جدول Payment (کنترل صحت قیف + درآمد) ───
    // v202 ممیزی — سقف سخت take برای days=0 (هم‌سقف events بالا، جدیدترین‌ها نگه
    // داشته می‌شوند)؛ در بازه‌های معمول زیر سقف، اعداد داشبورد دقیقاً یکسان می‌مانند.
    // select فقط ستون‌های مصرفی (مبلغ/منبع/پلن) است.
    const successPayments = await db.payment.findMany({
      where: { status: "success", createdAt: { gte: since }, plan: { not: "wallet_topup" } },
      orderBy: { createdAt: "desc" },
      take: MAX_EVENTS,
      select: { amount: true, source: true, plan: true },
    });
    const successAmount = successPayments.reduce((s, p) => s + p.amount, 0);
    const successBySource = new Map<string, number>();
    for (const p of successPayments) {
      const k = p.source || "unknown";
      successBySource.set(k, (successBySource.get(k) ?? 0) + 1);
    }

    // ─── خطاهای واقعی JS از ErrorLog (پاسخ به سؤال Clarity) ───
    const errLogs = await db.errorLog.findMany({
      where: { source: "client", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 4000,
      select: { message: true, url: true, createdAt: true, userAgent: true },
    });
    const errMap = new Map<string, { count: number; urls: Map<string, number>; lastAt: Date; uas: Set<string> }>();
    for (const e of errLogs) {
      const msg = (e.message || "خطای نامشخص").slice(0, 160);
      if (!errMap.has(msg)) errMap.set(msg, { count: 0, urls: new Map(), lastAt: e.createdAt, uas: new Set() });
      const row = errMap.get(msg)!;
      row.count++;
      if (e.createdAt > row.lastAt) row.lastAt = e.createdAt;
      const u = (e.url || "-").slice(0, 120);
      row.urls.set(u, (row.urls.get(u) ?? 0) + 1);
      const uaTail = (e.userAgent || "").slice(-40);
      if (uaTail) row.uas.add(uaTail);
    }
    const jsErrors = [...errMap.entries()]
      .map(([message, v]) => ({
        message,
        count: v.count,
        topUrl: [...v.urls.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-",
        lastAt: v.lastAt,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // ─── رصد زنده: ۳۰ رویداد آخر ───
    const recent = events.slice(0, 30).map((ev) => ({
      event: ev.event,
      label: FUNNEL_EVENTS[ev.event]?.label ?? ev.event,
      createdAt: ev.createdAt,
      path: ev.path,
      planId: ev.planId,
      amount: ev.amount,
      source: ev.source,
      device: ev.device,
      user: ev.user,
    }));

    // ─── بینش خودکار: بزرگ‌ترین افت خط قیف ───
    let dropOffInsight: string | null = null;
    let worstDrop = 0;
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].sessions;
      const cur = funnel[i].sessions;
      if (prev >= 5) {
        const drop = 1 - cur / prev;
        if (drop > worstDrop) {
          worstDrop = drop;
          dropOffInsight = `بزرگ‌ترین ریزش بین «${funnel[i - 1].label}» (${prev.toLocaleString("fa-IR")}) و «${funnel[i].label}» (${cur.toLocaleString("fa-IR")}) است — ${Math.round(drop * 100)}٪ ریزش.`;
        }
      }
    }

    return Response.json({
      ok: true,
      days,
      since: since.toISOString(),
      truncated,
      funnel,
      branches,
      side,
      daily,
      breakdown: { sources: arr(bySource), devices: arr(byDevice), plans: arr(byPlan) },
      payments: {
        successCount: successPayments.length,
        successAmount,
        bySource: Object.fromEntries(successBySource),
      },
      jsErrors,
      recent,
      dropOffInsight,
    });
  } catch (e) {
    return apiError(e);
  }
}
