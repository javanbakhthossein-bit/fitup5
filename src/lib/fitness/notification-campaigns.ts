/**
 * ─── v178 — موتور کمپین‌های اعلان مدیر (هدف‌گیری + زمان‌بندی) ───
 *
 * دیرکتیو مالک:
 *  «باید بتونم به گروه‌های مختلف با دسته‌بندی‌های مختلف نوتیف مجزا بفرستم؛
 *   نوتیف زمان‌بندی‌شده هم بتونم بفرستم — مثلاً مشخص کنم در چه زمانی چه نوتیفی
 *   بره و به این دسته یا این شخص؛ مثلاً به کاربرانی که از این بازه تا این بازه
 *   فلان کار رو کردن نوتیف بفرستم.»
 *
 * معماری:
 *  - segment: JSON مشخصات هدف‌گیری → buildSegmentWhere() آن را به where کلاوز
 *    Prisma روی مدل User تبدیل می‌کند (یک منبع واحد برای پیش‌نمایش، شمارش و ارسال).
 *  - dispatchCampaign(): ارسال اتمیک با وضعیت sending → sent؛ در صورت کرش
 *    بین راه، اجرای بعدی «ادامه» می‌دهد (کاربرانی که نوتیف کمپین را گرفته‌اند
 *    از remaining حذف می‌شوند — meta.campaignId).
 *  - dispatchDueCampaigns(): جاروی کمپین‌های سررسیده (scheduledAt <= now) —
 *    از instrumentation هر ۶۰ ثانیه + پنل ادمین + crontab اختیاری صدا زده می‌شود.
 *  - ارسال = ردیف Notification (createMany دسته‌ای) + web-push + FCM —
 *    از سقف روزانهٔ push (PUSH_DAILY_CAP) و تایپوگرافی فارسی v56 بهره می‌برد.
 */

import { db } from "@/lib/db";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";

// ─── انواع کمپین ─────────────────────────────────────────────────────────────

export type SegmentKind =
  | "all" // همهٔ کاربران غیرمسدود
  | "active_plan" // پلن فعال (planName و انقضای آینده)
  | "expired_plan" // پلن منقضی‌شده
  | "no_plan" // هرگز پلن نداشته
  | "plan" // پلن مشخص (basic/standard/advanced/ultimate)
  | "source" // منبع ثبت‌نام مشخص (instagram/google/cafebazaar/…)
  | "app" // نصب اپ مشخص (panel/bazaar/pwa)
  | "registered" // ثبت‌نام در بازهٔ زمانی
  | "purchased" // خرید موفق در بازهٔ زمانی
  | "never_purchased" // هرگز خرید موفق نداشته
  | "expiring" // پلنش در بازهٔ زمانی منقضی می‌شود
  | "onboarded" // آنبوردینگ را در بازه کامل کرده
  | "users"; // کاربران مشخص (آیدی‌ها یا موبایل‌ها)

export interface CampaignSegment {
  kind: SegmentKind;
  plan?: string; // kind=plan
  source?: string; // kind=source
  app?: string; // kind=app → panel | bazaar | pwa
  from?: string; // ISO — شروع بازه (registered/purchased/expiring/onboarded)
  to?: string; // ISO — پایان بازه
  ids?: string[]; // kind=users → آیدی
  mobiles?: string[]; // kind=users → موبایل‌ها (۱۱ رقمی)
}

export const CAMPAIGN_TYPES = [
  "welcome",
  "workout_reminder",
  "water_reminder",
  "subscription",
  "achievement",
  "system",
  "upgrade",
  "renewal",
  "re_engagement",
  "checkup",
  "coach",
] as const;

const BATCH = 500;
const PUSH_CONCURRENCY = 20;

// ─── پارس و اعتبارسنجی segment ───────────────────────────────────────────────

export function parseSegment(raw: unknown): CampaignSegment | null {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    const seg = obj as CampaignSegment;
    if (!seg.kind) return null;
    return seg;
  } catch {
    return null;
  }
}

function safeDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** where کلاوز Prisma برای هر segment — منبع واحد حقیقت برای شمارش/پیش‌نمایش/ارسال */
export function buildSegmentWhere(seg: CampaignSegment, now = new Date()): any {
  // پایه مشترک: مسدودها هرگز هدف نیستند
  const base: any = { isBlocked: false };
  const range = (from?: string, to?: string, field: string | any = "createdAt") => {
    const gte = safeDate(from);
    const lte = safeDate(to);
    const w: any = {};
    if (gte) w.gte = gte;
    if (lte) w.lte = lte;
    return Object.keys(w).length ? { [typeof field === "string" ? field : field]: w } : {};
  };

  switch (seg.kind) {
    case "all":
      return base;
    case "active_plan":
      return {
        ...base,
        planName: { not: null },
        OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }],
      };
    case "expired_plan":
      return { ...base, planName: { not: null }, planExpiresAt: { lte: now } };
    case "no_plan":
      return { ...base, planName: null };
    case "plan": {
      const plan = String(seg.plan || "").trim();
      if (!plan) return null;
      return { ...base, planName: plan };
    }
    case "source": {
      const source = String(seg.source || "").trim();
      if (!source) return null;
      return { ...base, signupSource: source };
    }
    case "app": {
      if (seg.app === "pwa") return { ...base, pwaInstalledAt: { not: null } };
      const app = seg.app === "bazaar" ? "bazaar" : "panel";
      return { ...base, appInstallSource: app };
    }
    case "registered": {
      const w = range(seg.from, seg.to, "createdAt");
      return Object.keys(w).length ? { ...base, ...w } : null;
    }
    case "purchased": {
      const gte = safeDate(seg.from);
      const lte = safeDate(seg.to);
      const pw: any = { status: "success", plan: { not: "wallet_topup" } };
      if (gte) pw.createdAt = { ...(pw.createdAt || {}), gte };
      if (lte) pw.createdAt = { ...(pw.createdAt || {}), lte };
      return { ...base, payments: { some: pw } };
    }
    case "never_purchased":
      return { ...base, payments: { none: { status: "success", plan: { not: "wallet_topup" } } } };
    case "expiring": {
      const gte = safeDate(seg.from);
      const lte = safeDate(seg.to);
      const w: any = { ...base, planName: { not: null } };
      const exp: any = {};
      if (gte) exp.gte = gte;
      if (lte) exp.lte = lte;
      if (!Object.keys(exp).length) return null;
      w.planExpiresAt = exp;
      return w;
    }
    case "onboarded": {
      const gte = safeDate(seg.from);
      const lte = safeDate(seg.to);
      const w: any = { ...base, onboardingDone: true };
      const oc: any = {};
      if (gte) oc.gte = gte;
      if (lte) oc.lte = lte;
      // onboardingCompletedAt برای کاربران قدیمی null است — فیلد تاریخ اختیاری
      if (Object.keys(oc).length) w.onboardingCompletedAt = oc;
      return w;
    }
    case "users": {
      const ids = Array.isArray(seg.ids) ? seg.ids.filter(Boolean).slice(0, 5000) : [];
      const mobiles = Array.isArray(seg.mobiles)
        ? seg.mobiles.map((m) => String(m).replace(/\s/g, "")).filter(Boolean).slice(0, 5000)
        : [];
      const or: any[] = [];
      if (ids.length) or.push({ id: { in: ids } });
      if (mobiles.length) or.push({ mobile: { in: mobiles } });
      if (!or.length) return null;
      return { ...base, OR: or };
    }
    default:
      return null;
  }
}

/** برچسب فارسی خوانا برای segment — نمایش در لیست کمپین‌ها */
export function segmentLabel(raw: string | null | undefined): string {
  const seg = parseSegment(raw);
  if (!seg) return "نامشخص";
  const fa = (iso?: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
    } catch {
      return "";
    }
  };
  switch (seg.kind) {
    case "all": return "همهٔ کاربران";
    case "active_plan": return "کاربران با پلن فعال";
    case "expired_plan": return "کاربران با پلن منقضی";
    case "no_plan": return "کاربران بدون پلن";
    case "plan": return `پلن ${seg.plan ?? ""}`;
    case "source": return `ثبت‌نام از ${sourceLabelFa(seg.source || "")}`;
    case "app": return seg.app === "bazaar" ? "کاربران اپ کافه‌بازار" : seg.app === "pwa" ? "کاربران PWA" : "کاربران اپ اختصاصی";
    case "registered": return `ثبت‌نام‌شده ${fa(seg.from) || "…"} تا ${fa(seg.to) || "…"}`;
    case "purchased": return `خریداران ${fa(seg.from) || "…"} تا ${fa(seg.to) || "…"}`;
    case "never_purchased": return "کاربران بدون هیچ خرید";
    case "expiring": return `پلن‌های در حال انقضا ${fa(seg.from) || "…"} تا ${fa(seg.to) || "…"}`;
    case "onboarded": return `تکمیل آنبوردینگ ${fa(seg.from) || "…"} تا ${fa(seg.to) || "…"}`;
    case "users": return `کاربران مشخص (${(seg.ids?.length ?? 0) + (seg.mobiles?.length ?? 0)} نفر)`;
    default: return "نامشخص";
  }
}

export function sourceLabelFa(s: string | null | undefined): string {
  switch (s) {
    case "instagram": return "اینستاگرام";
    case "google": return "گوگل";
    case "cafebazaar": return "کافه‌بازار";
    case "app_panel": return "اپ اختصاصی";
    case "web": return "وب‌سایت (مستقیم)";
    case "other": return "سایر";
    default: return "نامشخص";
  }
}

// ─── شمارش/پیش‌نمایش گیرندگان ────────────────────────────────────────────────

export async function countSegment(seg: CampaignSegment): Promise<number> {
  const where = buildSegmentWhere(seg);
  if (!where) return 0;
  return db.user.count({ where });
}

export async function sampleSegmentUsers(seg: CampaignSegment, take = 5) {
  const where = buildSegmentWhere(seg);
  if (!where) return [];
  return db.user.findMany({
    where,
    take,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mobile: true },
  });
}

// ─── dispatch ────────────────────────────────────────────────────────────────

export interface DispatchResult {
  ok: boolean;
  total: number;
  sent: number;
  pushed: number;
  error?: string;
}

/**
 * ارسال یک کمپین به کل گیرندگان segment.
 * اتمیک با فلگ status: draft/scheduled → sending → sent|failed.
 * اگر پروسه بین راه بمیرد، کمپین در وضعیت sending می‌ماند؛ اجرای بعدی از
 * همان‌جا ادامه می‌دهد (کاربرانی که نوتیفشان ساخته شده با meta.campaignId
 * چک و از فهرست ارسال حذف می‌شوند).
 */
export async function dispatchCampaign(campaignId: string): Promise<DispatchResult> {
  const campaign = await db.notificationCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { ok: false, total: 0, sent: 0, pushed: 0, error: "کمپین یافت نشد." };
  if (["sent", "sending", "canceled"].includes(campaign.status)) {
    // sending = احتمالاً کرش قبلی؛ dispatchDue خودش ادامه می‌دهد
    if (campaign.status === "sent" || campaign.status === "canceled") {
      return { ok: true, total: campaign.totalTargets, sent: campaign.sentCount, pushed: campaign.pushCount };
    }
  }

  await db.notificationCampaign.update({
    where: { id: campaignId },
    data: { status: "sending", error: null },
  });

  try {
    const seg = parseSegment(campaign.segment);
    if (!seg) throw new Error("segment نامعتبر است");
    const where = buildSegmentWhere(seg);
    if (!where) throw new Error("segment خالی/نامعتبر است");

    const totalTargets = await db.user.count({ where });

    // ادامهٔ کمپین نیمه‌کاره: هر کسی قبلاً نوتیف این کمپین را گرفته، دوباره نمی‌گیرد
    const existing = await db.notification.findMany({
      where: { meta: { contains: campaignId } },
      select: { userId: true },
    });
    const doneIds = new Set(existing.map((n) => n.userId));

    const title = fixPersianTypography(campaign.title).slice(0, 200);
    const body = fixPersianTypography(campaign.body).slice(0, 2000);
    const link = campaign.link ? campaign.link.slice(0, 500) : null;
    const metaJson = JSON.stringify({ from: "admin_campaign", campaignId });

    // فهرست گیرندگان (فقط id — دسته‌های ۵۰۰تایی)
    let sentBefore = campaign.sentCount || 0;
    let sentNow = 0;
    const recipients = await db.user.findMany({ where, select: { id: true } });
    const pending = recipients.filter((u) => !doneIds.has(u.id));

    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      const res = await db.notification.createMany({
        data: slice.map((u) => ({
          userId: u.id,
          type: CAMPAIGN_TYPES.includes(campaign.type as any) ? campaign.type : "system",
          title,
          body,
          link,
          meta: metaJson,
          read: false,
        })),
      });
      sentNow += res.count || 0;
      // checkpoint هر دسته — کرش حداکثر یک دسته دوباره می‌فرستد (dedupe ۶۰دقیقه‌ای createNotification اینجا اعمال نیست؛
      // ولی createMany مستقیم است — پس checkpoint مهم است)
      await db.notificationCampaign.update({
        where: { id: campaignId },
        data: { sentCount: sentBefore + sentNow, totalTargets },
      }).catch(() => {});
    }

    // ─── push best-effort (web-push + FCM کاربران) ───
    // FCM: از DeviceToken (اپ اندروید) — همان مسیر lib/fcm؛ وب: PushSubscription
    const pushed = await pushCampaign(
      pending.map((u) => u.id),
      title,
      body,
      link
    );

    const final = await db.notificationCampaign.update({
      where: { id: campaignId },
      data: {
        status: "sent",
        sentAt: new Date(),
        totalTargets,
        sentCount: sentBefore + sentNow,
        pushCount: pushed,
        error: null,
      },
    });

    return { ok: true, total: final.totalTargets, sent: final.sentCount, pushed: final.pushCount };
  } catch (err: any) {
    await db.notificationCampaign.update({
      where: { id: campaignId },
      data: { status: "failed", error: String(err?.message || err).slice(0, 500) },
    }).catch(() => {});
    return { ok: false, total: 0, sent: 0, pushed: 0, error: String(err?.message || err) };
  }
}

/**
 * push کمپین به هر دو کانال (وب + FCM) — best-effort و بدون مسدودسازی نتیجه.
 * برخلاف createNotification (تک‌کاربره با سقف روزانه)، اینجا ارسال گروهی است و
 * endpointهای مرده پاک‌سازی می‌شوند.
 */
async function pushCampaign(userIds: string[], title: string, body: string, link: string | null): Promise<number> {
  let pushed = 0;
  if (userIds.length === 0) return 0;
  try {
    const webpush = (await import("web-push")).default;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const payload = JSON.stringify({
      title,
      body,
      url: link || "/",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "fa",
      vibrate: [100, 50, 100],
      tag: "fitup-campaign",
    });

    // ─── ۱) وب‌پوش (PWA) ───
    if (publicKey && privateKey) {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/^https?:\/\//, "");
      webpush.setVapidDetails(`mailto:support@${siteUrl}`, publicKey, privateKey);
      const subs = await db.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      const deadEndpoints: string[] = [];
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY);
        await Promise.all(
          batch.map(async (sub) => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
              );
              pushed += 1;
            } catch (err: any) {
              if (err?.statusCode === 410 || err?.statusCode === 404) deadEndpoints.push(sub.endpoint);
            }
          })
        );
      }
      if (deadEndpoints.length) {
        await db.pushSubscription.deleteMany({ where: { endpoint: { in: deadEndpoints } } }).catch(() => {});
      }
    }

    // ─── ۲) FCM (اپ اندروید — حتی وقتی بسته است) ───
    try {
      const { sendFcmToUser } = await import("@/lib/fitness/fcm");
      // دسته‌های ۵۰تایی موازی — هر کاربر DeviceTokenهای خودش را دارد
      for (let i = 0; i < userIds.length; i += 50) {
        const batch = userIds.slice(i, i + 50);
        const results = await Promise.allSettled(
          batch.map((uid) => sendFcmToUser(uid, { title, body, link, type: "system" }))
        );
        for (const r of results) {
          if (r.status === "fulfilled") pushed += 1;
        }
      }
    } catch {
      // FCM اختیاری است
    }
  } catch (err) {
    console.error("[dispatchCampaign] push failed (non-fatal):", err);
  }
  return pushed;
}

/** جاروی کمپین‌های زمان‌بندی‌شدهٔ سررسیده — هر ۶۰ ثانیه از instrumentation */
export async function dispatchDueCampaigns(): Promise<{ dispatched: number; results: DispatchResult[] }> {
  const now = new Date();
  const due = await db.notificationCampaign.findMany({
    where: { status: { in: ["scheduled", "sending"] }, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  const results: DispatchResult[] = [];
  for (const c of due) {
    // کمپین‌های sending فقط اگر بیش از ۵ دقیقه در همان وضعیت مانده‌اند ادامه یابند
    // (کرش احتمالی) —Sending تازه = کمپین دیگری در حال اجراست
    if (c.status === "sending") {
      const stuckFor = now.getTime() - (c.updatedAt?.getTime() ?? 0);
      if (stuckFor < 5 * 60 * 1000) continue;
    }
    results.push(await dispatchCampaign(c.id));
  }
  return { dispatched: results.length, results };
}
