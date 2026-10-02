import { NextRequest, NextResponse } from "next/server";

/**
 * ─── v105/v106 — مهاجرت URLهای کوئری‌استرینگ به routeهای واقعی (بازیابی سئو) ───
 *
 * تا v104 محتوای مقاله/حرکت/غذا/لیست مقالات/ابزارها فقط با URL کوئری سرو می‌شد:
 *   /?article=slug ، /?exercise=id ، /?food=id ، /?screen=articles[&category=…]،
 *   /?tool=tdee|exercises|foods ، /?screen=terms[&doc=privacy]|contact|about
 * گوگل این‌ها را صفحهٔ مستقل حساب نمی‌کرد → ۱٬۴۰۰+ مقاله نامرئی بود.
 *
 * حالا هر محتوا route واقعی دارد و این proxy ورود مستقیم به URLهای قدیمی را
 * با ریدایرکت 308 دائمی به مسیر تمیز و واقعی می‌برد:
 *   /?article=slug                → /article/slug
 *   /?screen=articles&category=X  → /articles/category/X
 *   /?screen=articles             → /articles
 *   /?exercise=id                 → /exercise/id
 *   /?food=id                     → /food/id
 *   /?tool=tdee                   → /tdee
 *   /?tool=exercises              → /exercises
 *   /?tool=foods                  → /foods
 *   /?screen=terms[&doc=privacy]  → /terms[?doc=privacy]
 *   /?screen=contact              → /contact
 *   /?screen=about                → /about
 *
 * مقادیر خالی/ناشناخته fall-through می‌کنند (NextResponse.next) تا screenهای
 * داخلی اپ (?screen=auth/panel/…) بدون تغییر مثل قبل در SPA باز شوند.
 *
 * چرا proxy و نه redirects() در next.config؟
 *  ۱) redirects() پارامترهای کوئری مصرف‌نشده را به مقصد می‌چسباند
 *     (?article=x → /article/x?article=x — URL ناقص‌الحسن)؛
 *  ۲) مقادیر فارسی (دسته‌ها) در هدر Location خطای 500 می‌دادند.
 *  اینجا کنترل کامل داریم: encode صحیح + URL تمیز بدون کوئری اضافه.
 *
 * نکتهٔ سازگاری: ناوبری داخلی SPA از v106 همیشه مسیر واقعی pushState می‌کند
 * (به سرور نمی‌زند)؛ این ریدایرکت‌ها فقط ورود مستقیم/خزش گوگل را می‌گیرند.
 */
/**
 * ─── v125 — کنترل فریم‌پذیری (XFO/CSP frame-ancestors) + ریدایرکت‌های legacy ───
 *
 * v124 هدر X-Frame-Options: SAMEORIGIN را سراسری کرد → پنل پیش‌نمایش سندباکس
 * (iframe روی preview-chat-*.space-z.ai که سایت را از هاست دیگر space-z.ai
 * لود می‌کند) با «refused to connect» بسته شد. چون هدرهای next.config قابل
 * حذف شرطی نیستند، فریم‌پذیری به اینجا منتقل شد (proxy.ts = middleware):
 *   - هاست سندباکس (*.space-z.ai) → بدون XFO؛ CSP: frame-ancestors * (پنل پیش‌نمایش زنده می‌ماند)
 *   - هاست تولید (fittup.ir و…)  → XFO: SAMEORIGIN + CSP: frame-ancestors 'self'
 *     (هر دو — مرورگرهای مدرن frame-ancestors را بر XFO ترجیح می‌دهند؛ مرورگر
 *     قدیمی هم XFO دارد؛ ضد clickjacking کامل می‌ماند)
 *
 * نکته: هدرهای امنیتی دیگر (nosniff/Referrer-Policy/Permissions-Policy) مثل
 * قبل در next.config.ts می‌مانند — فقط XFO از آنجا حذف شد.
 */
function framePolicyHeaders(req: NextRequest): Record<string, string> {
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    "";
  // سندباکس پیش‌نمایش (پنل پیش‌نمایش + گیت‌وی space-z.ai) — localhost هم برای dev محلی
  const isSandbox =
    /(^|\.)space-z\.ai$/i.test(host) ||
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  if (isSandbox) {
    return { "Content-Security-Policy": "frame-ancestors *" };
  }
  return {
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "frame-ancestors 'self'",
  };
}

export default function proxy(req: NextRequest) {
  // ─── v125 — رفتار legacy دقیقاً مثل قبل: redirectها فقط روی مسیر اصلی ───
  // (matcher حالا همهٔ صفحات را برای هدرهای فریم‌پذیری می‌پوشاند؛ redirectهای
  // ?article=… فقط همان‌جا معنی دارند که قبلاً هم داشتند — روی /)
  if (req.nextUrl.pathname === "/") {
    return legacyParamRedirects(req);
  }

  // v125 — هدرهای فریم‌پذیری شرطی-هاست (پیش‌نمایش سندباکس / ضد clickjacking تولید)
  const res = NextResponse.next();
  for (const [key, value] of Object.entries(framePolicyHeaders(req))) {
    res.headers.set(key, value);
  }
  return res;
}

/** ریدایرکت‌های 308 پارامترهای legacy (v105/v106 — فقط روی مسیر اصلی) */
function legacyParamRedirects(req: NextRequest): NextResponse {
  const { searchParams, origin } = req.nextUrl;

  const build = (path: string) => NextResponse.redirect(new URL(path, origin), 308);

  // مقاله — اولویت اول (ممکن است با پارامترهای دیگر ترکیب شده باشد)
  const article = searchParams.get("article");
  if (article) {
    return build(`/article/${encodeURIComponent(article)}`);
  }

  // حرکت ورزشی
  const exercise = searchParams.get("exercise");
  if (exercise) {
    return build(`/exercise/${encodeURIComponent(exercise)}`);
  }

  // غذا
  const food = searchParams.get("food");
  if (food) {
    return build(`/food/${encodeURIComponent(food)}`);
  }

  // رشتهٔ ورزشی (v119 — گپ قدیمی: /?sport= قبل از این هم رندر SPA می‌شد)
  const sport = searchParams.get("sport");
  if (sport) {
    return build(`/sport/${encodeURIComponent(sport)}`);
  }

  // ابزارهای رایگان (v106 — route واقعی)
  const tool = searchParams.get("tool");
  if (tool === "tdee") return build("/tdee");
  if (tool === "exercises") return build("/exercises");
  if (tool === "foods") return build("/foods");

  // screenهای عمومی (v106 — route واقعی)
  if (searchParams.get("screen") === "articles") {
    // لیست مقالات + آرشیو دسته
    const category = searchParams.get("category");
    return build(
      category
        ? `/articles/category/${encodeURIComponent(category)}`
        : "/articles"
    );
  }
  if (searchParams.get("screen") === "terms") {
    // سند حریم خصوصی سند جدا است — پارامتر doc حفظ می‌شود
    const doc = searchParams.get("doc");
    return build(doc === "privacy" ? "/terms?doc=privacy" : "/terms");
  }
  if (searchParams.get("screen") === "contact") {
    return build("/contact");
  }
  if (searchParams.get("screen") === "about") {
    return build("/about");
  }

  // v125 — هدرهای فریم‌پذیری شرطی-هاست (پیش‌نمایش سندباکس / ضد clickjacking تولید)
  const res = NextResponse.next();
  for (const [key, value] of Object.entries(framePolicyHeaders(req))) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  // همهٔ مسیرهای صفحه (HTML) — api/uploads/static/فونت‌ها بدون هزینه رد می‌شوند؛
  // redirectهای legacy مثل قبل فقط روی مسیر اصلی اجرا می‌شوند (چک searchParams).
  matcher: "/((?!api|_next/static|_next/image|uploads|fonts|download|favicon|manifest.json|sitemap.xml|robots.txt|sw.js|icon-|apple-touch-icon).*)",
};
