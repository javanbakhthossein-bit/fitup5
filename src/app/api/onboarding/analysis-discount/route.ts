import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/fitness/auth";
import { rateLimit } from "@/lib/fitness/rate-limit";
// v198 — رویدادگذاری قیف فروش (صدور/ابطال تخفیف صفحهٔ تحلیل)
import { recordFunnelEvent } from "@/lib/analytics/funnel";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v197 — تخفیف ۱۰٪ صفحهٔ تحلیل آنبوردینگ (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * مالک: «تخفیف انبوردینگ رو هم بذار ۱۰ درصد برای همه و بنویس از خرید در همین
 * صفحه ده درصد تخفیف بگیرید. و اگر اومد بیرون دیگه غیرفعال بشه.»
 *
 * مکانیزم بدون تغییر اسکیما — از جدول PaymentToken با kind="analysis_discount":
 *   • grant  → باز شدن صفحهٔ تحلیل: توکن ۳۰ دقیقه‌ای مخصوص کاربر صادر می‌شود
 *              (توکن‌های قبلی همان کاربر باطل می‌شوند — همیشه فقط یکی زنده است)
 *   • revoke → خروج از صفحهٔ تحلیل: توکن همان لحظه باطل می‌شود؛ با navigator
 *              .sendBeacon هم کار می‌کند (کوکی سشن خودکار ارسال می‌شود) پس
 *              بستن/ترک صفحه = غیرفعال شدن فوری تخفیف — دقیقاً طبق دیرکتیو.
 *   • GET    → وضعیت (برای نمایش/دیباگ)
 *
 * مصرف توکن فقط در /api/payment/checkout است: اگر توکن معتبر باشد ۱۰٪ مبلغ
 * نهایی (بعد از کد تخفیف و اعتبار ارتقا) کم می‌شود و usedAt ثبت می‌گردد.
 * TTL ۳۰ دقیقه = گارد دوم «اگر بیکن revoke از دست رفت» (تب بسته/قطع شبکه).
 *
 * ⚠️ نکتهٔ فنی: این ثابت‌ها عمداً export نمی‌شوند — Next.js در فایل‌های route.ts
 * فقط اکسپورتِ متدهای HTTP و فیلدهای پیکربندی را می‌پذیرد و اکسپورتِ ثابت باعث
 * خطای بیلد «is not a valid Route export field» می‌شود. اگر جایی به این مقادیر
 * نیاز بود، به جای import از route.ts، مقدار را از پاسخ API بخوانید.
 */
const ANALYSIS_DISCOUNT_PERCENT = 10;
const ANALYSIS_DISCOUNT_TTL_MS = 30 * 60 * 1000;

export async function GET() {
  try {
    const user = await requireAuth();
    const token = await db.paymentToken.findFirst({
      where: {
        kind: "analysis_discount",
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { token: true, expiresAt: true },
    });
    // v229 — ممیزی قیف: token هم برگردانده می‌شود تا مدال خرید (وقتی از تب
    // پلن‌ها/لندینگ باز می‌شود و پراپ تحلیل ندارد) تخفیفِ زندهٔ سرور را همان‌جا
    // نمایش و مصرف کند — «تخفیف با آپدیت/ناوبری حفظ می‌شود» (دیرکتیو مالک).
    // endpoint احراز-هویت‌شده است؛ افشای توکن به صاحبِ خودش بی‌خطر است.
    return Response.json({
      active: !!token,
      percent: token ? ANALYSIS_DISCOUNT_PERCENT : 0,
      expiresAt: token?.expiresAt ?? null,
      token: token?.token ?? null,
    });
  } catch {
    return Response.json({ active: false, percent: 0, expiresAt: null, token: null });
  }
}

export async function POST(req: NextRequest) {
  let action = "";
  try {
    const body = await req.json().catch(() => ({}));
    action = String(body?.action || "grant");
    const user = await requireAuth();

    if (action === "revoke") {
      // خروج از صفحهٔ تحلیل → ابطال فوری توکن تخفیف کاربر
      //
      // ═══ v200 — ابطال دقیق «توکنِ خودِ صفحه» (فیکس مسابقه revoke-grant) ═══
      // ریشه‌یابی باگ مالک (تخفیف در درگاه اعمال نشد): مرورگر درون‌اپی
      // اینستاگرام موقع reload/بازگشت، beacon ابطالِ صفحهٔ قبلی را «دیر»
      // می‌فرستد؛ اگر صفحهٔ جدید زودتر grant بزند، beacon دیرهنگام با
      // «ابطال همه» توکن تازه را هم می‌کشت → UI تخفیف را نشان می‌داد ولی
      // سرور مبلغ کامل می‌گرفت. حالا کلاینت توکنِ فعلی‌اش را در revoke
      // می‌فرستد و فقط «همان توکن» باطل می‌شود — grant صفحهٔ جدید امن است.
      // اگر token نیامده باشد (سازگاری نسخه‌های قبلی/سناریوهای قدیمی) همان
      // رفتار قبلی (ابطال همهٔ توکن‌های زنده) اجرا می‌شود.
      const revokeToken = typeof body?.token === "string" ? body.token.trim() : "";
      const r = await db.paymentToken.updateMany({
        where: {
          kind: "analysis_discount",
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
          ...(revokeToken ? { token: revokeToken } : {}),
        },
        data: { expiresAt: new Date() },
      });
      // v198 — رویداد قیف: ابطال تخفیف (خروج از صفحه — سنجهٔ «تخفیف را از دست داد»)
      if (r.count > 0) {
        await recordFunnelEvent({
          event: "analysis_discount_revoked",
          userId: user.id,
          meta: { revokedCount: r.count, targeted: !!revokeToken },
        });
      }
      return Response.json({ ok: true, revoked: r.count });
    }

    // ─── grant (پیش‌فرض) ───
    // ─── v202 ممیزی (M5) — dedupe: اگر توکن زندهٔ همان کاربر هست، همان برگردانده
    // می‌شود (نه صدور توکن جدید) — رفرش/باز شدن دوبارهٔ صفحهٔ تحلیل که بیکن revoke
    // گم کرده، دیگر هر بار توکن تازه نمی‌سازد (تولید مجدد توکن = تخفیف دائمی).
    // شکل پاسخ دقیقاً همان صدور عادی است؛ رویداد قیف هم فقط برای صدور واقعی ثبت می‌شود.
    const liveToken = await db.paymentToken.findFirst({
      where: {
        kind: "analysis_discount",
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { token: true, expiresAt: true },
    });
    if (liveToken) {
      return Response.json({
        ok: true,
        percent: ANALYSIS_DISCOUNT_PERCENT,
        token: liveToken.token,
        expiresAt: liveToken.expiresAt,
      });
    }
    // ─── v202 ممیزی (M5) — سقف صدور توکن: حداکثر ۱۲ توکن جدید در ۲۴ ساعت برای هر
    // کاربر (dedupe بالا مصرف رفرش‌ها را نمی‌شمارد — فقط صدورِ واقعی). TTL ۳۰ دقیقه
    // و رفتار revoke دست‌نخورده ماندند.
    const rlGrant = rateLimit(`ad-grant:${user.id}`, 12, 24 * 60 * 60 * 1000);
    if (!rlGrant.ok) {
      return Response.json(
        { ok: false, error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید." },
        { status: 429 }
      );
    }
    // فقط یک توکن زنده برای هر کاربر — قبلی‌ها باطل
    await db.paymentToken.updateMany({
      where: {
        kind: "analysis_discount",
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });
    const expiresAt = new Date(Date.now() + ANALYSIS_DISCOUNT_TTL_MS);
    const token = `${user.id.slice(-8)}${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await db.paymentToken.create({
      data: {
        token,
        kind: "analysis_discount",
        userId: user.id,
        amount: ANALYSIS_DISCOUNT_PERCENT, // درصد در فیلد ممیزی
        source: "analysis_screen",
        expiresAt,
      },
    });
    // v198 — رویداد قیف: توکن تخفیف صفحهٔ تحلیل صادر شد
    await recordFunnelEvent({
      event: "analysis_discount_granted",
      userId: user.id,
      meta: { ttlMin: 30 },
    });
    return Response.json({
      ok: true,
      percent: ANALYSIS_DISCOUNT_PERCENT,
      token,
      expiresAt,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "خطای نامشخص" },
      { status: action === "revoke" ? 200 : 401 } // revoke بهترین‌تلاش — خطا مهم نیست
    );
  }
}
