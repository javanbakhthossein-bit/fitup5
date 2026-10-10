/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v171 — پل امن پرداخت چندمنبعی (سند بازطراحی جریان پرداخت)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * سه مسیر ورود به درگاه که این ماژول تغذیه می‌کند:
 *
 *  ① اینستاگرام (بخش ۲ سند): دکمهٔ «ارسال پیامک پرداخت امن» → توکن یک‌بارمصرف
 *     ۲۰دقیقه‌ای گره‌خورده به موبایل → پیامک قالب 744490 با لینک کوتاه
 *     r/XXXXXXXX → /enter?token=… → سشن + ریدایرکت مستقیم به زرین‌پال.
 *     کاربر وب هرگز این مسیر را نمی‌بیند و اپ کافه‌بازار مستثناست.
 *
 *  ② اپ اختصاصی اندروید (بخش ۳ سند): WebView سشن دارد ولی Chrome Custom Tabs
 *     ندارد → پل ۵دقیقه‌ای app_bridge → /pay/start?order=…&t=… → ریدایرکت درگاه.
 *     کال‌بک با ret=app_android&oid=… برمی‌گردد تا رسید + دیپ‌لینک fitup:// اجرا شود.
 *
 *  ③ شارژ کیف پول اپ (بخش ۱۱ سند): همان پل ② روی پرداخت wallet_topup.
 *     برای اینستاگرام هیچ جریان شارژ کیف پولی وجود ندارد (در UI هم مخفی است).
 *
 * ─── قواعد ضد-VPN (دیرکتیو صریح مالک) ───
 * کاربر لینک پیامکی را با VPN روشن باز می‌کند، زرین‌پال می‌گوید «فیلترشکن خاموش
 * کن»، کاربر خاموش می‌کند و دوباره روی همان لینک می‌زند/رفرش می‌زند:
 *   • توکن پیامکی «چندکلیکی» است — تا وقتی پرداخت موفق نشده منقضی‌شدن زمانی
 *     تنها مرگش است. گره سخت به IP عمداً نداریم (IP با خاموش/روشن VPN عوض
 *     می‌شود) — IP/UA فقط برای ممیزی ثبت می‌شود (انحراف آگاهانه از سند؛ سند
 *     خودش سناریوی VPN را بالاتر می‌داند).
 *   • هر شروعِ درگاه اول «استعلام» می‌زند: اگر authority فعلی PAID/VERIFIED
 *     بود، کاربر به مسیر verify استاندارد هدایت می‌شود (پولش هرگز گم نمی‌شود).
 *   • در غیر این صورت اگر authority کهنه/بی‌کال‌بک‌درست بود، authority تازه با
 *     کال‌بک درست ساخته و قبلی در PaymentAuthority ثبت می‌شود — اگر کاربر روی
 *     authority قدیمی پرداخت کرده باشد، verify آن را هم می‌پذیرد.
 *
 * ─── خطوط قرمز ───
 *  • وب: هیچ تابعی از این ماژول در مسیر وب صدا زده نمی‌شود؛ buildCallbackUrl
 *    بدون پارامتر همان URL قبلی را می‌دهد → رفتار وب بایت‌به‌بایت ثابت است.
 *  • اپ کافه‌بازار: هیچ ارجاعی ندارد (UAاش هم در entry-source مستثناست).
 *  • کرون‌های پیامک: هیچ زمان‌بندی جدیدی اینجا تعریف نمی‌شود؛ سبد رهاشده
 *    موجود فقط از ردیف‌های Payment pending تغذیه می‌شود که همین ماژول می‌سازد.
 */

import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import {
  buildCallbackUrl,
  isZarinpalConfigured,
  zarinpalInquiry,
  zarinpalRequest,
  zarinpalStartPayUrl,
} from "@/lib/fitness/zarinpal";
import type { Payment, User } from "@prisma/client";
import { createSmsShortLink } from "@/lib/fitness/sms-short-link";
import { sendTemplateSms } from "@/lib/fitness/smsir";
import { toPersianDigits } from "@/lib/fitness/types";

// ─── ثابت‌های امنیتی (سند بخش ۶ و ۳) ───
/** عمر توکن لینک پیامکی — ۲۰ دقیقه (سند: «اعتبار: ۲۰ دقیقه») */
export const SMS_TOKEN_TTL_MS = 20 * 60 * 1000;
/** عمر پل اپ اندروید — ۵ دقیقه (یک‌بار باز کردن Custom Tabs کافی است) */
export const APP_BRIDGE_TTL_MS = 5 * 60 * 1000;
/** آستانه تازه‌سازی authority — هم‌الگوی v124 در checkout */
const AUTHORITY_STALE_MS = 3 * 60 * 1000;
/** کد قالب پیامک لینک پرداخت (سند بخش ۲-۱) — env ارجح دارد */
const PAYMENT_LINK_TEMPLATE_ID =
  process.env.SMSIR_TEMPLATE_PAYMENT_LINK?.trim() || "744490";
/** حداکثر تعداد صدور لینک پیامکی برای یک پرداخت (ضد سوخت‌وسوز اعتبار پیامک) */
export const MAX_SMS_PER_PAYMENT = 5;

export type PaymentStartMode =
  | "gateway" // ریدایرکت به StartPay (authority آماده/تازه)
  | "verify_return" // پرداخت قبلاً انجام شده → مسیر verify استاندارد
  | "not_pending" // پرداخت دیگر معلق نیست (success/failed/...)
  | "gateway_error"; // درگاه در دسترس نیست

export interface PaymentStartResult {
  mode: PaymentStartMode;
  /** URL مقصد 302 (برای gateway و verify_return) */
  redirectUrl?: string;
  authority?: string | null;
  error?: string;
}

/** دامنهٔ رسمی — هرگز origin داخلی پراکسی به زرین‌پال/ریدایرکت نمی‌رود (الگوی v65) */
export function canonicalSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/\/$/, "");
}

/** ثبت منبع ورود کاربر — فقط اگر هنوز null/unknown است (اولین منبع مقدس می‌ماند) */
export async function stampUserSource(
  userId: string,
  source: string | null | undefined
): Promise<void> {
  if (!source) return;
  try {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: { entrySource: true },
    });
    if (!u || u.entrySource) return; // null=false... فقط وقتی ست نشده می‌نویسیم
    await db.user.update({
      where: { id: userId },
      data: { entrySource: source },
    });
  } catch (e) {
    console.warn("[payment-bridge] stampUserSource failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * آیا این authority قبلاً برای همین پرداختِ ما صادر شده است؟
 * در verify استفاده می‌شود تا authority «قدیمی‌تر ولی پرداخت‌شده» رد نشود.
 */
export async function isKnownAltAuthority(
  paymentId: string,
  authority: string
): Promise<boolean> {
  if (!authority) return false;
  const row = await db.paymentAuthority.findUnique({
    where: { authority },
    select: { paymentId: true },
  });
  return !!row && row.paymentId === paymentId;
}

/**
 * توکن ۶۴کاراکتری امن (hex از 32 بایت تصادفی) — سند: «۶۴ کاراکتر تصادفی امن».
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export interface IssueTokenOpts {
  userId: string;
  paymentId: string;
  amount: number;
  source: string;
  ip?: string | null;
  ua?: string | null;
}

/**
 * صدور توکن لینک پیامکی برای یک پرداخت — v197: توکن «قبلی» هم معتبر می‌ماند.
 *
 * ریشهٔ کاهش فروش (گزارش مالک: «کاربرا ۲-۵ بار کلیک کردن و پرداخت نکردن»):
 * رفتار قبلی همهٔ توکن‌های قبلی را باطل می‌کرد («فقط آخرین لینک معتبر است») —
 * کاربری که چند بار «ارسال مجدد» زده بود چند پیامک داشت و روی پیامک قدیمی‌تر
 * می‌زد → صفحهٔ «لینک منقضی شده» حتی چند ثانیه بعد از ارسال تازه → رها کردن
 * خرید. حالا فقط توکنِ قبل از آخرین معتبر باقی می‌ماند (دو لینک آخر همزمان
 * معتبرند) و توکن‌های قدیمی‌تر بلافاصله باطل می‌شوند — هم تبدیل بالا، هم
 * همان سطح امنیت (TTL هر دو ۲۰ دقیقه است و چندکلیک ضد-VPN هم پشتیبانی می‌شود).
 */
export async function createSmsPaymentToken(
  opts: IssueTokenOpts
): Promise<{ token: string; expiresAt: Date }> {
  // v197 — جدیدترین توکن زندهٔ قبلیِ همین پرداخت پیدا می‌شود تا معتبر بماند
  const previousLive = await db.paymentToken.findFirst({
    where: { kind: "sms_link", paymentId: opts.paymentId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // ابطال همهٔ توکن‌های زندهٔ قبلی به‌جز جدیدترین (پیامک‌های خیلی قدیمی مرده‌اند)
  await db.paymentToken.updateMany({
    where: {
      kind: "sms_link",
      paymentId: opts.paymentId,
      expiresAt: { gt: new Date() },
      ...(previousLive ? { id: { not: previousLive.id } } : {}),
    },
    data: { expiresAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SMS_TOKEN_TTL_MS);
  await db.paymentToken.create({
    data: {
      token,
      kind: "sms_link",
      userId: opts.userId,
      paymentId: opts.paymentId,
      phone: null,
      amount: opts.amount,
      source: opts.source,
      ipAddress: opts.ip ?? null,
      userAgent: (opts.ua ?? "").slice(0, 512) || null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * صدور پل کوتاه برای اپ اختصاصی (Custom Tabs سشن WebView را ندارد — سند بخش ۳).
 */
export async function createAppBridgeToken(
  opts: IssueTokenOpts
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + APP_BRIDGE_TTL_MS);
  await db.paymentToken.create({
    data: {
      token,
      kind: "app_bridge",
      userId: opts.userId,
      paymentId: opts.paymentId,
      amount: opts.amount,
      source: opts.source,
      ipAddress: opts.ip ?? null,
      userAgent: (opts.ua ?? "").slice(0, 512) || null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export interface ValidatedToken {
  tokenRow: {
    id: string;
    token: string;
    kind: string;
    userId: string;
    paymentId: string | null;
    expiresAt: Date;
    usedAt: Date | null;
  };
  user: User;
  payment: Payment | null;
}

export type TokenValidation =
  | { ok: true; data: ValidatedToken }
  | { ok: false; reason: "invalid" | "expired" | "blocked" };

/**
 * اعتبارسنجی توکن (هر دو kind) — بدون مصرف؛ مصرف/آمار کلیک در مسیر /enter ثبت می‌شود.
 */
export async function validatePaymentToken(
  token: string,
  kind: "sms_link" | "app_bridge"
): Promise<TokenValidation> {
  const clean = String(token || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) return { ok: false, reason: "invalid" };

  const tokenRow = await db.paymentToken.findUnique({
    where: { token: clean },
    include: { user: true, payment: true },
  });
  if (!tokenRow || tokenRow.kind !== kind) return { ok: false, reason: "invalid" };
  if (tokenRow.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (tokenRow.user.isBlocked) return { ok: false, reason: "blocked" };

  return {
    ok: true,
    data: {
      tokenRow: {
        id: tokenRow.id,
        token: tokenRow.token,
        kind: tokenRow.kind,
        userId: tokenRow.userId,
        paymentId: tokenRow.paymentId,
        expiresAt: tokenRow.expiresAt,
        usedAt: tokenRow.usedAt,
      },
      user: tokenRow.user,
      payment: tokenRow.payment,
    },
  };
}

/** ثبت آمار کلیک روی توکن (چندکلیک مجاز — فقط آمار و اولین استفاده) */
export async function recordTokenClick(tokenId: string): Promise<void> {
  try {
    const row = await db.paymentToken.findUnique({
      where: { id: tokenId },
      select: { usedAt: true, clickCount: true },
    });
    await db.paymentToken.update({
      where: { id: tokenId },
      data: {
        usedAt: row?.usedAt ?? new Date(),
        lastClickAt: new Date(),
        clickCount: (row?.clickCount ?? 0) + 1,
      },
    });
  } catch (e) {
    console.warn("[payment-bridge] recordTokenClick failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * ═══ قلب مشترک /enter و /pay/start ═══
 * آماده‌سازی ریدایرکت به درگاه برای یک پرداخت معلق گیت‌وی:
 *  ۱) استعلام authority فعلی → PAID/VERIFIED؟ → مسیر verify استاندارد (self-heal)
 *  ۲) authority تازه فقط وقتی: وجود ندارد | کال‌بکش با مقصد فعلی فرق دارد |
 *     بیشتر از ۳ دقیقه از صدورش گذشته (هم‌آستانه v124)
 *  ۳) authority قبلی همیشه در PaymentAuthority ثبت می‌شود تا verifyِ آن هم معتبر بماند
 *
 * @param desiredCallbackUrl کال‌بک مقصد (وب/اینستاگرام: ساده — اپ: با ret/oid)
 */
export async function resolveGatewayStart(
  payment: Payment,
  desiredCallbackUrl: string
): Promise<PaymentStartResult> {
  if (payment.status !== "pending") {
    return { mode: "not_pending", authority: payment.authority };
  }
  if (!isZarinpalConfigured()) {
    return { mode: "gateway_error", error: "درگاه پرداخت پیکربندی نشده است." };
  }
  if (payment.amount <= 0) {
    // پرداخت صفر-تومانی اصلاً نباید به درگاه برود (مسی activate رایگان)
    return { mode: "not_pending", authority: payment.authority };
  }

  // ① استعلام — «پرداخت کرده و برگشته» را قبل از هر دست‌زدنی می‌گیریم
  if (payment.authority) {
    try {
      const inq = await zarinpalInquiry({ authority: payment.authority });
      if (inq.status === "PAID" || inq.status === "VERIFIED") {
        return {
          mode: "verify_return",
          authority: payment.authority,
          redirectUrl: buildVerifyReturnUrl(payment, payment.authority),
        };
      }
    } catch {
      // استعلام ناموفق ≠ پرداخت ناموفق — ادامه با منطق تازه‌سازی (authority
      // قدیمی ثبت می‌شود؛ اگر پول روی آن بوده verifyِ جایگزین نجاتش می‌دهد)
    }
  }

  // ② آیا authority فعلی قابل استفاده مجدد است؟
  const callbackMatches = payment.authorityCallbackUrl === desiredCallbackUrl;
  const issuedAt = payment.authorityIssuedAt?.getTime() ?? 0;
  const authorityFresh =
    !!payment.authority && callbackMatches && Date.now() - issuedAt < AUTHORITY_STALE_MS;

  if (authorityFresh && payment.authority) {
    return {
      mode: "gateway",
      authority: payment.authority,
      redirectUrl: zarinpalStartPayUrl(payment.authority),
    };
  }

  // ③ تازه‌سازی — درخواست تازهٔ زرین‌پال با کال‌بک درست + ثبت authority قبلی
  try {
    const fresh = await zarinpalRequest({
      amount: payment.amount,
      description: payment.description || "پرداخت فیتاپ",
      callbackUrl: desiredCallbackUrl,
      mobile: undefined, // شماره در description هست؛ metadata اضافه لازم نیست
    });
    if (fresh.ok && fresh.authority && fresh.gatewayUrl) {
      // ثبت authority قبلی (اگر متفاوت است) — تضمین verifyِ پرداختِ روی قدیمی
      if (payment.authority && payment.authority !== fresh.authority) {
        try {
          await db.paymentAuthority.create({
            data: { paymentId: payment.id, authority: payment.authority },
          });
        } catch {
          // رکورد تکراری (P2002) یعنی قبلاً ثبت شده — بی‌ضرر
        }
      }
      await db.payment.update({
        where: { id: payment.id },
        data: {
          authority: fresh.authority,
          authorityCallbackUrl: desiredCallbackUrl,
          authorityIssuedAt: new Date(),
        },
      });
      return {
        mode: "gateway",
        authority: fresh.authority,
        redirectUrl: fresh.gatewayUrl,
      };
    }
    console.error("[payment-bridge] fresh zarinpal request failed:", fresh.error);
    // فال‌بک: اگر authority قابل‌قبولی داریم با همان برو (رفتار قدیمی v124)
    if (payment.authority) {
      return {
        mode: "gateway",
        authority: payment.authority,
        redirectUrl: zarinpalStartPayUrl(payment.authority),
      };
    }
    return { mode: "gateway_error", error: fresh.error || "اتصال به درگاه ناموفق بود." };
  } catch (e) {
    console.error("[payment-bridge] resolveGatewayStart exception:", e instanceof Error ? e.message : e);
    if (payment.authority) {
      return {
        mode: "gateway",
        authority: payment.authority,
        redirectUrl: zarinpalStartPayUrl(payment.authority),
      };
    }
    return { mode: "gateway_error", error: "اتصال به درگاه پرداخت ناموفق بود." };
  }
}

/**
 * URL بازگشت به مسیر verify استاندارد برای authority پرداخت‌شده.
 * ret/oid حفظ می‌شوند تا دیپ‌لینک اپ هم بعد از verify اجرا شود.
 */
export function buildVerifyReturnUrl(payment: Payment, authority: string): string {
  const base = `${canonicalSiteUrl()}/?payment_verify=1&Authority=${encodeURIComponent(
    authority
  )}&Status=OK`;
  const extra: string[] = [];
  if (payment.source === "app_android") {
    extra.push(`ret=app_android`, `oid=${encodeURIComponent(payment.id)}`);
  }
  return extra.length ? `${base}&${extra.join("&")}` : base;
}

/**
 * کال‌بک مقصد برای شروع درگاه — اینستاگرام/وب: ساده (رفتار استاندارد)؛
 * اپ اندروید: با ret=app_android&oid تا PaymentVerifyHandler دیپ‌لینک بزند.
 */
export function desiredCallbackForPayment(payment: Payment): string {
  if (payment.source === "app_android") {
    return buildCallbackUrl(canonicalSiteUrl(), {
      ret: "app_android",
      oid: payment.id,
    });
  }
  return buildCallbackUrl(canonicalSiteUrl());
}

// ═══════════ پیامک لینک پرداخت (قالب 744490 — سند بخش ۲-۱) ═══════════

export interface PaymentLinkSmsResult {
  ok: boolean;
  /** لینک کامل برای فال‌بک «کپی لینک» در UI اینستاگرام */
  link?: string;
  shortCode?: string;
  expiresAt?: Date;
  error?: string;
  skipped?: string;
}

/**
 * صدور توکن + لینک کوتاه + ارسال پیامک قالبی با #LINK# و #NAME#.
 *
 * ⚠️ پارامترهای قالب sms.ir سقف ۲۵ کاراکتر دارند — #LINK# = «r/XXXXXXXX»
 * (۱۰ کاراکتر) و مقصد واقعی (enter?token=…) در SmsShortLink نگهداری می‌شود.
 *
 * #NAME#: نام کاربر؛ اگر ثبت نشده «ورزشکار» (همان فال‌بک تأییدشدهٔ مالک در
 * قالب‌های onboarding — پیامک پرداخت هرگز به‌خاطر نام خالی بلاک نمی‌شود؛
 * این انحراف آگاهانه از گارد سخت no_name است چون خط قرمز پرداخت در میان است).
 */
export async function issueAndSendPaymentLinkSms(opts: {
  user: Pick<User, "id" | "mobile" | "name">;
  payment: Payment;
  source: string;
  ip?: string | null;
  ua?: string | null;
}): Promise<PaymentLinkSmsResult> {
  const { user, payment } = opts;

  // سقف تعداد صدور برای یک پرداخت
  const issuedCount = await db.paymentToken.count({
    where: { kind: "sms_link", paymentId: payment.id },
  });
  if (issuedCount >= MAX_SMS_PER_PAYMENT) {
    return { ok: false, error: "سقف ارسال لینک برای این پرداخت تکمیل شده است." };
  }

  const { token, expiresAt } = await createSmsPaymentToken({
    userId: user.id,
    paymentId: payment.id,
    amount: payment.amount,
    source: opts.source,
    ip: opts.ip,
    ua: opts.ua,
  });

  // لینک کوتاه — خروجی «r/XXXXXXXX» (≤۲۵ کاراکتر). عمرش بیشتر از توکن است تا
  // کلیکِ دیرهنگام به صفحهٔ «لینک منقضی» برسد (با پیام مناسب) نه به صفحهٔ اصلی بی‌توضیح
  const shortLink = await createSmsShortLink(`enter?token=${token}`, {
    userId: user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  if (!shortLink) {
    // نگاشت کوتاه شکست → بدون لینک پیامک نمی‌رود (پارامتر ۷۷کاراکتری 114 می‌دهد)
    return { ok: false, error: "ساخت لینک کوتاه پیامک ناموفق بود." };
  }
  const shortCode = shortLink;

  const firstName = (user.name || "").trim().split(/\s+/)[0] || "ورزشکار";
  const smsRes = await sendTemplateSms({
    key: `payment_link_${payment.id}_${issuedCount + 1}`,
    mobile: user.mobile,
    templateIdOverride: PAYMENT_LINK_TEMPLATE_ID,
    userId: user.id,
    params: [
      { name: "LINK", value: shortLink },
      { name: "NAME", value: firstName },
    ],
  });

  if (!smsRes.sent) {
    console.warn(
      `[payment-link] SMS not sent (payment=${payment.id}): ${smsRes.error ?? smsRes.skipped}`
    );
    return {
      ok: false,
      error: smsRes.error || `ارسال پیامک ناموفق بود (${smsRes.skipped ?? "نامشخص"}).`,
      // لینک برای فال‌بک «کپی» برمی‌گردد حتی اگر پیامک نرفت
      link: `${canonicalSiteUrl()}/enter?token=${token}`,
      shortCode,
      expiresAt,
    };
  }

  console.info(
    `[payment-link] SMS sent — payment=${payment.id} user=${user.id} source=${opts.source} ip=${opts.ip ?? "-"} amount=${toPersianDigits(payment.amount.toLocaleString("en-US"))}`
  );

  return {
    ok: true,
    link: `${canonicalSiteUrl()}/enter?token=${token}`,
    shortCode,
    expiresAt,
  };
}
