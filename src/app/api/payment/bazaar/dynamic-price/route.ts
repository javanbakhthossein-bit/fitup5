import { NextRequest } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { getActivePlan } from "@/lib/fitness/pricing";
import type { Plan } from "@/lib/fitness/types";
import { computePlanFinalAmount, DiscountInvalidError } from "@/lib/fitness/payment-delivery";

/**
 * POST /api/payment/bazaar/dynamic-price — «تخفیف پویا» کافه‌بازار (فلوی رسمی JWT)
 *
 * ═══ v209 — بازنویسی کامل طبق مستندات رسمی بازار ═══
 * پیاده‌سازی قبلی (v55) اشتباه بود: به یک endpoint فرضی
 * (pardakht.cafebazaar.ir/dynamicprice/v1/...) POST می‌زد و «dynamic_price_id»
 * می‌گرفت — چنین سرویسی در مستندات رسمی وجود ندارد؛ نتیجه همیشه خطا بود و
 * تخفیف هرگز در درگاه اپ بازار اعمال نمی‌شد (گزارش مالک).
 *
 * فلوی رسمی (developer.cafebazaar.ir → تخفیف پویا):
 *  ۱. کلید امضای JWT از پیشخان بازار (پرداخت درون‌برنامه‌ای → کلید JWT) گرفته
 *     می‌شود و روی سرور (SiteSetting bazaar_dynamic_price_token یا env
 *     BAZAAR_DYNAMIC_PRICE_TOKEN) نگه‌داری می‌شود — هرگز داخل اپ (افشای کلید).
 *  ۲. سرور در شروع خرید، یک JWT یکبارمصرفِ کوتاه‌عمر با الگوریتم HS256/384/512
 *     می‌سازد. Payload اجباری:
 *       price        → مبلغی که کاربر باید بپردازد (ریال؛ ≤ قیمت SKU در پیشخان)
 *       package_name → پکیج‌نیم اپ (ir.fittup.app)
 *       sku          → شناسه کالا (fitup_{planId})
 *       exp          → انقضای توکن (UTC UNIX Timestamp)
 *     اختیاری: account_id (نیازمند ورود با بازار — نداریم)، nonce (یکتایی توکن).
 *  ۳. JWT در فیلد dynamicPriceToken در کلاس PurchaseRequest کتابخانه پولکی به
 *     بازار داده می‌شود (اپ از v1.15.4 همین پارامتر را به پولکی پاس می‌دهد).
 *  ۴. بازار امضا/انضا/مبلغ را همان لحظهٔ خرید راستی‌آزمایی می‌کند؛ کاربر همان
 *     مبلغ تخفیف‌دار را می‌پردازد (تمدید خودکار با قیمت اصلی پیشخان).
 *
 * ═══ v211 — درمان ریشه‌ای «اطلاعات ارسالی برنامه برای پرداخت نامعتبر است» ═══
 * این پیام خطای سمت بازار یعنی JWT/درخواست خرید در اعتبارسنجی بازار رد شده است.
 * سه ریسک شناخته‌شده این‌جا ریشه‌کنی شد:
 *  ① package_name از env خوانده می‌شد (BAZAAR_PACKAGE_NAME) — اگر روی سرور با
 *     پکیج اپ دیگر (مثلاً ir.fittup.panel اپ اختصاصی) تنظیم شده باشد، بازار
 *     JWT را با «پکیج‌نیمِ متفاوت با اپِ صداکننده» رد می‌کند. حالا پکیج‌نیم
 *     JWT سخت‌کد شده = applicationId دقیق APK بازار (ir.fittup.app).
 *  ② کلید امضا ممکن بود با کوتیشن/BOM/فاصلهٔ اضافی از env خوانده شود → امضای
 *     متفاوت → رد. حالا کلید ضدعفونی می‌شود (حذف کوتیشن/BOM/fillers).
 *  ③ واحد مبلغ: سند رسمی «ریال» است؛ اگر قیمت SKU پیشخان با تومان وارد شده
 *     باشد ×۱۰ درست است — اما به‌جای «حدس واحد»، اپ بازار از v1.15.6 قیمت
 *     واقعی SKU را از خودِ بازار (Poolakey getSkuDetails → رشتهٔ نمایشی قیمت)
 *     می‌گیرد و در skuPrice برای این مسیر می‌فرستد. سرور واحد را با مقایسهٔ
 *     عدد قیمت نمایشی و قیمت پلن «استنتاج» می‌کند و مبلغ JWT را از قیمت
 *     واقعی پیشخان می‌سازد → JWT در هر دو جهانِ واحد (تومان/ریال) همیشه
 *     ≤ قیمت پیشخان است (ضد خطای ۱۰ — قیمت بیشتر از SKU).
 *
 * کدهای خطای سمت بازار (۱ تا ۱۶) در جدول رسمی مستند شده‌اند (۲ ساختار توکن،
 * ۴ امضای دستکاری‌شده، ۵ منقضی، ۸ محصول یافت نشد، ۱۰ قیمت بیشتر از SKU،
 * ۱۱ توکن مصرف‌شده، …) — از بازار ۱۳.۳.۰ به بعد پشتیبانی می‌شود.
 */

/**
 * v211 — پکیج‌نیمِ JWT سخت‌کد = applicationId دقیق APK کافه‌بازار.
 * ⚠️ عمداً از env خوانده نمی‌شود (ریسک ① بالا) — BAZAAR_PACKAGE_NAME فقط برای
 * API راستی‌آزمایی خرید (bazaar-dev-api) استفاده می‌ماند نه ادعای JWT.
 */
const BAZAAR_JWT_PACKAGE = "ir.fittup.app";
/** عمر توکن خرید: ۱۵ دقیقه — پوشش کافی برای بازشدن/پرداخت درگاه بازار */
const DYNAMIC_PRICE_TOKEN_TTL_SEC = 15 * 60;

/**
 * v211 — ضدعفونی کلید امضا (ریسک ② بالا): کوتیشن دوتایی/تکیِ دور رشته،
 * BOM، فاصله‌ها و کاراکترهای نامرئی حذف می‌شوند. اگر کلید فاصلهٔ داخلی داشته
 * باشد تقریباً قطعاً اشتباه کپی شده — null برمی‌گردد تا با 503 روشن متوقف شود
 * (fail-closed v207) و لاگ ادمین علت را بگوید.
 */
function sanitizeSigningKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let key = raw
    .replace(/^\uFEFF/, "") // BOM
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "") // کوتیشن دور رشته
    .trim();
  if (!key) return null;
  if (/\s/.test(key)) {
    console.error(
      "[bazaar/dynamic-price] ❌ کلید JWT تخفیف پویا فاصله/کاراکتر نامرئی دارد — تقریباً قطعاً اشتباه کپی شده است. کلید را دوباره از پیشخان بازار → پرداخت درون‌برنامه‌ای → کلید JWT کپی کنید."
    );
    return null;
  }
  return key;
}

/** خواندن کلید امضای تخفیف پویا از SiteSetting یا env */
async function getDynamicPriceToken(): Promise<string | null> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: "bazaar_dynamic_price_token" } });
    const fromDb = sanitizeSigningKey(row?.value);
    if (fromDb) return fromDb;
  } catch {
    // DB error → env fallback
  }
  return sanitizeSigningKey(process.env.BAZAAR_DYNAMIC_PRICE_TOKEN);
}

/**
 * v211 — استنتاج واحد از رشتهٔ نمایشی قیمت خودِ بازار (خروجی Poolakey
 * getSkuDetails — مثلاً «۳۵۰٬۰۰۰ تومان» یا «3,500,000 ریال»).
 *
 * الگوریتم ضدحدس: عددِ نمایشی (همان چیزی که پنجرهٔ پرداخت بازار نشان می‌دهد)
 * باید مضرب شناخته‌شده‌ای از قیمت پلن (تومان) باشد؛ در غیر این صورت رشتهٔ
 * قابل‌اعتماد نیست و null برمی‌گردد (فال‌بک: محاسبهٔ قدیمی تومان×۱۰).
 *
 * خروجی: panelRial = قیمت واقعی SKU به ریال (مبنای سقف بازار)
 *   عدد نمایشی ≈ قیمت پلن (تومان)     → پنل تومانی است → panelRial = عدد×۱۰
 *   عدد نمایشی ≈ قیمت پلن×۱۰ (ریال)   → نمایش ریالی → panelRial = عدد
 *   عدد نمایشی ≈ قیمت پلن÷۱۰          → پنل ۱۰ برابر کمتر ثبت شده (اشتباه رایج
 *                                        ریال/تومان در پیشخان) → عدد تومان است
 *                                        → panelRial = عدد×۱۰ — JWT از همین
 *                                        سقفِ واقعی ساخته می‌شود تا خرید رد نشود
 *   بقیه                                → نامعتبر → null
 */
function parseBazaarSkuPriceRial(raw: string | undefined | null, planPriceToman: number): number | null {
  if (!raw) return null;
  try {
    // نرمال‌سازی ارقام فارسی/عربی → لاتین
    const fa = "۰۱۲۳۴۵۶۷۸۹";
    const ar = "٠١٢٣٤٥٦٧٨٩";
    let s = String(raw);
    s = s.replace(/[۰-۹]/g, (d) => String(fa.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
    const isRial = /ریال/.test(s);
    const isToman = /تومان|تومان‌|تomain|تومن/.test(s) || (!isRial && /(^|[\s«»(])ت([\s«»)]|$)/.test(s));
    // جداکننده‌های هزارگان حذف؛ فقط رقم‌ها می‌مانند (قیمت‌ها صحیح‌اند)
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return null;
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (planPriceToman <= 0) return null;

    const r = n / planPriceToman; // نسبت عدد نمایشی به قیمت پلن (تومان)
    // هم‌پوشانی با ±۲٪ برای گردکردن نمایش بازار
    const near = (x: number, y: number) => Math.abs(x - y) <= y * 0.02;
    if (isRial && (near(r, 10) || near(r, 1))) return n; // نمایش ریالی
    if (isToman && (near(r, 1) || near(r, 0.1))) return n * 10; // نمایش تومانی
    if (!isRial && !isToman) {
      // واحد در رشته نبود — با نسبت مقدار تصمیم می‌گیریم (بازار همیشه واحد می‌گذارد؛ گارد محافظتی)
      if (near(r, 1) || near(r, 0.1)) return n * 10;
      if (near(r, 10)) return n;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * v209 — ساخت JWT یکبارمصرف تخفیف پویا (HS256 طبق مستندات رسمی بازار).
 * کلید = همان کلید امضای پیشخان بازار (BAZAAR_DYNAMIC_PRICE_TOKEN).
 */
function makePurchaseDynamicPriceJwt(params: {
  key: string;
  sku: string;
  priceRial: number;
}): string {
  const { key, sku, priceRial } = params;
  const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      price: priceRial, // ریال — عدد (خطای ۱۵ = تایپ غلط؛ هرگز رشته نگذاریم)
      package_name: BAZAAR_JWT_PACKAGE,
      sku,
      exp: now + DYNAMIC_PRICE_TOKEN_TTL_SEC,
      // nonce — یکتایی توکن‌های هم‌مبلغ (یکبارمصرف بودن را بازار خودش سخت‌گیرانه چک می‌کند — خطای ۱۱)
      nonce: randomBytes(12).toString("hex"),
    })
  );
  const sig = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

interface DynamicPriceBody {
  planId?: string;
  discountCode?: string;
  userDiscountCode?: string;
  /** v207 — توکن تخفیف صفحهٔ تحلیل آنبوردینگ (هم‌تراز checkout) */
  analysisDiscountToken?: string;
  /**
   * v211 — رشتهٔ نمایشی قیمت SKU از خودِ بازار (Poolakey getSkuDetails در اپ
   * بازار v1.15.6+). اختیاری؛ بودنش یعنی مبلغ JWT از سقف واقعی پیشخان ساخته
   * می‌شود نه از حدس واحد تومان×۱۰.
   */
  skuPrice?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const rl = rateLimit(`bazaar-dynamic-price:${user.id}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as DynamicPriceBody;
    const planId = String(body.planId || "").trim();
    const VALID_PLANS: Plan[] = ["basic", "standard", "advanced", "ultimate"];
    if (!VALID_PLANS.includes(planId as Plan)) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    const plan = await getActivePlan(planId as Plan);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    // مبلغ نهایی — همان منطق checkout (خطای کد تخفیف → 400 مثل checkout)
    // v207 — توکن تخفیف صفحهٔ تحلیل هم وارد محاسبه می‌شود (قبلاً در مسیر بازار
    // پشتیبانی نمی‌شد و UI ده‌درصدی نشان می‌داد، درگاه قیمت کامل می‌گرفت)
    let computed;
    try {
      computed = await computePlanFinalAmount(user.id, plan, {
        discountCode: body.discountCode,
        userDiscountCode: body.userDiscountCode,
        analysisDiscountToken: body.analysisDiscountToken,
      });
    } catch (e) {
      if (e instanceof DiscountInvalidError) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    // ═══ v207 — گارد fail-closed توکن تحلیل ═══
    // کلاینت ادعای تخفیف صفحهٔ تحلیل دارد ولی سرور معتبرش نمی‌داند (منقضی/ابطال‌شده) —
    // ادامه یعنی قیمت کامل بی‌صدا (عین باگ گزارش مالک). رد شفاف با پیام روشن.
    if (computed.analysisTokenProvided && !computed.analysisTokenId) {
      return Response.json(
        {
          error:
            "مهلت تخفیف صفحهٔ تحلیل تمام شده است. برای ادامه، صفحهٔ پلن‌ها را دوباره باز کنید.",
          reason: "analysis_token_invalid",
        },
        { status: 400 }
      );
    }

    // ═══ v112 — فعال‌سازی رایگان: مبلغ صفر (کد تخفیف ۱۰۰٪ / اعتبار ارتقای کامل) ═══
    // بازار نمی‌تواند خرید رایگان پردازش کند (مبلغ صفر در توکن تخفیف پویا معتبر نیست).
    // بدون ساخت توکن، freeActivation برمی‌گردد تا کلاینت به‌جای IAP بازار از فلوی
    // عادی سایت (فعال‌سازی مستقیم) استفاده کند.
    if (computed.finalAmount <= 0) {
      return Response.json({
        dynamicPriceToken: null,
        dynamicPriceId: null,
        finalAmount: 0,
        originalAmount: plan.price,
        discountCode: computed.discountCode,
        upgradeCredit: computed.upgradeCredit,
        freeActivation: true,
        reason: "free_activation",
      });
    }

    // اگر تخفیف/اعتباری اعمال نشده → قیمت پایه SKU — نیازی به توکن تخفیف پویا نیست
    if (computed.finalAmount >= plan.price) {
      return Response.json({
        dynamicPriceToken: null,
        dynamicPriceId: null,
        finalAmount: plan.price,
        originalAmount: plan.price,
        discountCode: null,
        upgradeCredit: computed.upgradeCredit,
        reason: "base_price",
      });
    }

    // ─── ساخت توکن تخفیف پویا (JWT) — فلوی رسمی بازار ───
    // ═══ v207/v209 — fail-closed: این نقطه فقط وقتی اجرا می‌شود که مبلغ نهایی <
    // قیمت پایه است (تخفیف/اعتبار ارتقا/تخفیف تحلیل در کار است). بدون کلید، خرید
    // تخفیف‌دار متوقف می‌شود تا هرگز قیمت کامل بی‌صدا پرداخت نشود (باگ مالک).
    const key = await getDynamicPriceToken();
    if (!key) {
      console.error(
        "[bazaar/dynamic-price] ❌ کلید امضای تخفیف پویا (bazaar_dynamic_price_token) تنظیم نیست — خرید تخفیف‌دار متوقف شد (fail-closed v207). کلید JWT از پیشخان بازار → پرداخت درون‌برنامه‌ای → کلید JWT گرفته و در SiteSetting یا env BAZAAR_DYNAMIC_PRICE_TOKEN قرار می‌گیرد."
      );
      return Response.json(
        {
          error:
            "ثبت قیمت تخفیف‌دار در کافه‌بازار فعلاً ممکن نیست — پرداخت متوقف شد تا تخفیف شما از دست نرود. لطفاً چند لحظه بعد دوباره تلاش کنید یا با پشتیبانی در تماس باشید.",
          reason: "dynamic_price_not_configured",
        },
        { status: 503 }
      );
    }

    const sku = `fitup_${plan.id}`;
    const ratio = computed.finalAmount / plan.price; // 0 < ratio < 1

    // ═══ v211 — مبلغ JWT از سقف واقعی پیشخان ساخته می‌شود (ضد خطای ۱۰) ═══
    // اگر اپ رشتهٔ قیمت واقعی SKU بازار را فرستاده باشد: jwtPrice = panelRial × ratio
    // — با ساختار ریاضی، همیشه اکیداً کمتر از قیمت پیشخان است؛ در جهانِ سالم
    // (پنل تومانی) دقیقاً برابر finalToman×۱۰ درمی‌آید.
    const panelRial = parseBazaarSkuPriceRial(body.skuPrice, plan.price);
    let priceRial: number;
    let priceSource: "computed" | "bazaar_sku";
    if (panelRial && panelRial > 0) {
      priceRial = Math.max(1, Math.round(panelRial * ratio));
      priceSource = "bazaar_sku";
      // گارد سلامت: اگر نتیجه با تومان×۱۰ هم‌خوان نیست، پنل ۱۰ برابر خطا دارد —
      // لاگ برای ادمین (خرید همین با سقف واقعی پیشخان انجام می‌شود و رد نمی‌شود)
      const expected = computed.finalAmount * 10;
      if (Math.abs(priceRial - expected) > expected * 0.02) {
        console.error(
          `[bazaar/dynamic-price] ⚠️ ناسازگاری واحد قیمت پیشخان بازار — sku=${sku} skuPrice="${String(body.skuPrice).slice(0, 40)}" → panelRial=${panelRial}، مبلغ JWT=${priceRial} ریال در حالی که انتظار ${expected} ریال بود. قیمت کالای «${sku}» در پیشخان بازار باید با قیمت سایت (${plan.price.toLocaleString("fa-IR")} تومان) هم‌تراز شود.`
        );
      }
    } else {
      // فال‌بک (اپ قدیمی/رشتهٔ ناخوانا): همان محاسبهٔ رسمی تومان→ریال
      priceRial = computed.finalAmount * 10;
      priceSource = "computed";
    }
    // گارد نهایی سند رسمی: عدد صحیح ریال، مثبت، و اکیداً کمتر از سقف پیشخان
    if (!Number.isInteger(priceRial) || priceRial < 1000) {
      return Response.json(
        {
          error: "مبلغ تخفیف‌دار برای ثبت در کافه‌بازار نامعتبر است — پرداخت متوقف شد. لطفاً با پشتیبانی در تماس باشید.",
          reason: "dynamic_price_invalid_amount",
        },
        { status: 400 }
      );
    }
    if (panelRial && priceRial >= panelRial) {
      priceRial = panelRial - 1; // هرگز بیشتر/مساوی سقف پیشخان (خطای ۱۰) — یک ریال زیر سقف
    }

    try {
      const jwt = makePurchaseDynamicPriceJwt({ key, sku, priceRial });
      // dynamicPriceId هم با همان مقدار برمی‌گردد تا کلاینت‌های قدیمی‌تر
      // (که فیلد قدیمی را می‌خوانند) هم بدون شکست کار کنند.
      // priceToman = مبلغی که پنجرهٔ پرداخت بازار واقعاً نشان می‌دهد (نمایش مودال)
      return Response.json({
        dynamicPriceToken: jwt,
        dynamicPriceId: jwt,
        sku,
        priceRial,
        priceToman: Math.round(priceRial / 10),
        priceSource,
        finalAmount: computed.finalAmount,
        originalAmount: plan.price,
        discountCode: computed.discountCode,
        upgradeCredit: computed.upgradeCredit,
        reason: "dynamic",
      });
    } catch (e) {
      console.error("[bazaar/dynamic-price] jwt build error:", e);
      // v207 — fail-closed: خرید تخفیف‌دار متوقف می‌شود (قبلاً بی‌صدا قیمت کامل می‌گرفت)
      return Response.json(
        {
          error:
            "ساخت توکن قیمت تخفیف‌دار ناموفق بود — پرداخت متوقف شد تا تخفیف شما از دست نرود. لطفاً چند لحظه بعد دوباره تلاش کنید.",
          reason: "dynamic_price_token_error",
        },
        { status: 503 }
      );
    }
  } catch (e) {
    return apiError(e);
  }
}
