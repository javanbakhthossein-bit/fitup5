import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // ─── v56: پوشهٔ خروجی build قابل تنظیم با env (دیپلوی بدون قطعی) ───
  // deploy.sh بیلد را در .next.new انجام می‌دهد در حالی که نسخهٔ قدیمی از
  // .next همچنان در حال سرو است؛ بعد از موفقیت، تعویض چندثانیه‌ای می‌شود
  // و دیگر کاربر در زمان دیپلوی ۵۰۲ نمی‌بیند.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // ─── Type-check در build ───
  // قبلاً ignoreBuildErrors: true بود و خطاهای تایپ بی‌صدا به production
  // می‌رفتند. همه خطاهای تایپ اپ رفع شدند (examples/ و mini-services/ از
  // tsconfig خارج شدند) — از این به بعد build با خطای تایپ fail می‌شود
  // که همین رفتار درست است: باگ قبل از رسیدن به کاربر گرفته می‌شود.
  //
  // v127 — کلید سندباکس: در این محیط ۴GB، پروسهٔ webpack (~۲.۴GB) + فاز tsc
  // (~۱.۲GB) در همان build جا نمی‌شوند و kernel وسط فاز تایپ OOM-kill می‌کند.
  // سندباکس با FITUP_SKIP_TS_CHECK=1 بیلد می‌گیرد (چک تایپ جداگانه با
  // `bunx tsc --noEmit` انجام و صفر خطا تأیید می‌شود)؛ سرور تولید این env را
  // ندارد → مثل قبل با چک کامل تایپ بیلد می‌گیرد. رفتار پیش‌فرض تغییری نکرده.
  typescript: {
    ignoreBuildErrors: process.env.FITUP_SKIP_TS_CHECK === "1",
  },
  reactStrictMode: false,
  poweredByHeader: false,
  // ─── v56: کاهش مصرف حافظهٔ webpack (دیو) ───
  // سندباکس ۴GB دارد و کامپایل‌های سنگین این اپ مکرر OOM-kill می‌شدند؛
  // این فلگ بهینه‌سازی‌های حافظهٔ webpack را فعال می‌کند (اثری روی خروجی ندارد).
  // ─── v93: onDemandEntries (فقط دیو — اثری روی build تولیدی ندارد) ───
  // صفحات/routeهای کامپایل‌شدهٔ بی‌استفاده بعد از ۳۰ ثانیه از حافظه تخلیه و
  // بافر حداکثر ۲ ورودی نگه داشته می‌شود — جلوی رشد بی‌حد RSS در جنگ OOM
  // سندباکس را می‌گیرد (کامپایل مجدد گرمِ از-روی-کش ارزان است).
  experimental: {
    webpackMemoryOptimizations: true,
  },
  onDemandEntries: {
    maxInactiveAge: 30 * 1000,
    pagesBufferLength: 2,
  },
  // ─── v93: watchOptions (فقط دیو) — پوشه‌های داده‌ای هرگز watch نشوند ───
  // uploads/db/download/tool-results هزاران فایل داده‌ای دارند؛ watch بی‌ موردشان
  // در dev حافظهٔ watcher را بالا می‌برد (سهم OOM سندباکس). src و کانفیگ‌ها دست
  // نخورده watch می‌شوند — HMR کد کاملاً برقرار است.
  webpack: (config, { dev }) => {
    if (dev) {
      // v145 — فیکس ریشه‌ای «سندباکس بالا نمی‌آید / connection refused»:
      // سورس‌مپ‌های dev بزرگ‌ترین مصرف‌کنندهٔ حافظه در فاز کامپایل‌اند
      // (اثبات: پیک RSS next-server به ~۳GB می‌رسید و OOM-killer کرنل
      // پروسه را می‌کشت — دفترچه dmesg سندباکس). با خاموش‌کردن devtool،
      // پیک کامپایل به‌شدت پایین می‌آید؛ دیباگ با breakpooint/stack-trace
      // همچنان کار می‌کند (فقط mapping دقیق به سورس از بین می‌رود).
      // production هرگز از این مسیر استفاده نمی‌کند (dev-only).
      config.devtool = false;
      // ─── v146 — فیکس ریشه‌ای OOM دوم: «تولید برنامه ۳ بار ناموفق» ───
      // dmesg سندباکس نشان داد next-server وسط کامپایل routeهای برنامه با
      // RSS ~۳.۴GB دو بار OOM-kill شد (گزارش مالک: «برنامه بعد از ۳ تلاش ساخته
      // نشد»). کش ماژول webpack در dev بزرگ‌ترین مصرف‌کنندهٔ حافظهٔ ماندگار است؛
      // خاموش‌کردنش پیک RSS را به‌شدت پایین می‌آورد. هزینه: rebuild کمی کندتر
      // (فقط dev) — در production اثری ندارد.
      config.cache = false;
      const prev = (config.watchOptions as { ignored?: unknown } | undefined)?.ignored;
      const prevStrings = Array.isArray(prev)
        ? prev.filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          ...prevStrings,
          "**/uploads/**",
          "**/db/**",
          "**/download/**",
          "**/tool-results/**",
          "**/mini-services/**",
        ],
      };
    }
    return config;
  },
  // ─── Native binaries for standalone output ───
  // sharp و باینری‌های libvips آن (@img/*) باید به‌طور کامل در خروجی
  // standalone حضور داشته باشند. tracer پیش‌فرض فقط wrapper جاوااسکریپتی
  // را کپی می‌کند و فایل‌های .so (libvips) را جا می‌اندازد → در production
  // همه routeهای تصویر (تولید کاور/inline مقالات، آپلود، واترمارک) با خطای
  // ERR_DLOPEN_FAILED می‌افتادند. این خط آن باگ production بود.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  // ─── v62: پوشهٔ db هرگز نباید در فایل‌های traced بیلد بیاید (فیکس قطعی EISDIR) ───
  // خطای بیلد سرور: «EISDIR: illegal operation on a directory, copyfile
  // '.next/standalone/db' -> '.next/standalone/.next/standalone/db'».
  //
  // درس ریشه‌یابی v62 (با خواندن سورس next/dist/build/collect-build-traces.js):
  //  ۱) الگوهای قبلی («./db» و «.next/standalone/db») با picomatch خود Next
  //     هیچ‌وقت مچ نمی‌شدند — Next مقدار الگو را با path.join(dir, pattern)
  //     حل می‌کند و با {dot:true, contains:true} روی «مسیر مطلقِ نرمال‌شده»
  //     تست می‌کند. الگوهای ریشه‌دار «./db» روی مسیرهای واقعی false می‌دادند.
  //  ۲) مسیر «db» می‌تواند در هر عمقی ظاهر شود: ریشهٔ پروژه، داخل
  //     .next/standalone (بیلدهای in-place قبلی)، و حتی تو-در-تو
  //     (.next/standalone/.next/standalone/db — همان خطای لاگ مالک).
  //     پس الگو باید **/db و **/db/** باشد تا هر عمقی را بگیرد.
  //  ۳) کلید «*» با contains:true همهٔ روت‌ها را می‌گیرد؛ «/**» هم برای اطمینان.
  // نکتهٔ امنیتی: دیتابیس و سکرت سشن هرگز نباید داخل خروجی build کپی شوند —
  // deploy.sh بعد از build کپی امن خودش را انجام می‌دهد (قدم ۶-ج) و
  // DATABASE_URL روی سرور مطلق است (file:/var/www/fitup/db/custom.db).
  // node_modules هیچ پوشه‌ای به‌نام db ندارد — خطر حذف اتفاقی وابستگی صفر است.
  outputFileTracingExcludes: {
    "*": ["db", "db/**", "**/db", "**/db/**"],
    "/**": ["db", "db/**", "**/db", "**/db/**"],
  },
  // Allow cross-origin dev requests (for preview panel)
  allowedDevOrigins: ["*.space-z.ai"],
  // ─── Redirects ───
  // مهم: /auth به /?screen=auth هدایت می‌شود با ۳۰۱ (Permanent Redirect).
  // قبلاً از redirect() در page.tsx استفاده می‌کردیم که ۳۰۷ (Temporary) می‌داد
  // و HTML شامل <meta name="next-error" content="not-found"/> بود — گوگل آن را ۴۰۴ تفسیر می‌کرد.
  // با redirects() در next.config.ts، redirect در سطح سرور انجام می‌شود بدون رندر HTML.
  //
  // ─── v105 — بازیابی سئوی مقالات/حرکات/غذاها ───
  // تا v104 محتوا فقط با URL کوئری‌استرینگ (?article= / ?exercise= / ?food= /
  // ?screen=articles) سرو می‌شد؛ گوگل این‌ها را صفحهٔ مستقل حساب نمی‌کرد و
  // ۱٬۴۰۰+ مقاله عملاً نامرئی بود. حالا هر محتوا route واقعی دارد و همهٔ
  // URLهای قدیمی با 308 دائمی به مسیر واقعی می‌روند:
  //   ?article=slug                → /article/slug
  //   ?screen=articles&category=X  → /articles/category/X
  //   ?screen=articles             → /articles
  //   ?exercise=id                 → /exercise/id
  //   ?food=id                     → /food/id
  // نکته: ناوبری داخلی SPA با history.pushState است (درخواست به سرور نمی‌زند)
  // پس رفتار کاربر عادی دست‌نخورده می‌ماند؛ فقط ورود مستقیم/خزش گوگل redirect می‌شود.
  async redirects() {
    return [
      // ─── v105 نکته: ریدایرکت‌های ?article= / ?exercise= / ?food= /
      // ?screen=articles به src/proxy.ts منتقل شدند — چون redirects() کوئری
      // باقی‌مانده را به مقصد می‌چسباند و مقادیر فارسی در هدر Location خطای
      // 500 می‌دادند. proxy.ts ریدایرکت 308 تمیز با encode صحیح انجام می‌دهد.
      {
        source: "/auth",
        destination: "/?screen=auth",
        permanent: true, // ۳۰۱ — دائمی
      },
    ];
  },
  // ─── Rewrites ───
  // مهم: تمام درخواست‌های `/uploads/*` به API route `/api/serve-upload/*` هدایت می‌شوند.
  // این کار از از دست رفتن عکس‌ها در زمان build جلوگیری می‌کند، چون عکس‌ها در
  // `uploads/` (در ریشه پروژه) ذخیره می‌شوند — نه در `public/` که در build overwrite می‌شود.
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/serve-upload/:path*",
      },
      // ─── sitemap.xml (v12.3): دیگر rewrite ندارد — فیکس ریشه‌ای ۴۰۴ GSC ───
      // rewrite ها در standalone پروداکشن اجرا نمی‌شوند (باگ اثبات‌شده v21) و
      // گوگل هنگام خواندن /sitemap.xml صفحهٔ 404 می‌گرفت. حالا /sitemap.xml با
      // route واقعی `src/app/sitemap.ts` (استاندارد Next.js، force-dynamic)
      // سرو می‌شود که مستقل از rewrite در هر حالت دیپلوی کار می‌کند.
      // /api/sitemap هم با همان بیلدر مشترک برای سازگاری باقی است.
    ];
  },
  // ─── Browser caching for faster load ───
  // (FULL-PROFILE-AI-CONTEXT-WORKOUT) Static assets are cached aggressively;
  // HTML pages are NEVER cached (always fresh).
  // ⚠️ ترتیب مهم است: در Next.js برای هدرهای هم‌نام، «آخرین» قانونِ منطبق
  // برنده می‌شود — پس قانون عمومی no-cache باید «اول» بیاید و قوانین خاص
  // (uploads/fonts/manifest/...) بعد از آن تا بازنویسی کنند.
  async headers() {
    return [
      {
        // ─── v165 — فیکس ریشه‌ای دو باگ P0 (صفحهٔ سفید ابدی اپ + فلش «سشن قبلی» هدر) ───
        // قبلاً no-cache بود: مرورگر/WebView اجازهٔ «ذخیره» HTML را داشت و فقط
        // revalidation لازم بود. نتیجهٔ واقعی روی شبکهٔ ناپایدار (ایران + سوییچ VPN)
        // و بعد از هر دیپلوی:
        //   • WebView اپ (که Service Worker ندارد!) HTML شخصی‌سازی‌شدهٔ قبلی را
        //     نگه می‌داشت؛ اگر revalidation شکست می‌خورد/کهنه سرو می‌شد، HTML به
        //     چانک‌های JS حذف‌شده توسط دیپلوی اشاره می‌کرد → هیچ JS اجرا نمی‌شد →
        //     «صفحهٔ سفید» قطعی حتی بعد از بستن و بازکردن اپ (طوفان ChunkLoadError
        //     در لاگ خطاهای سرور — تأیید چند کاربر).
        //   • HTML دوران لاگین (با نام کاربر) یک لحظه از کش سرو می‌شد → فلش
        //     «سشن قبلی» در هدر لندینگ.
        // no-store یعنی HTML هیچ‌جا (دیسک WebView/مرورگر) ذخیره نمی‌شود — هر
        // رفرش HTML تازهٔ همان بیلد می‌گیرد. خط قرمز امنیتی هم همین است: HTML
        // شخصی (نام کاربر/پنل) نباید روی دیسک دستگاه بماند.
        // هزینه: بجای 304 فقط-هدر، بدنهٔ HTML هر بار دانلود می‌شود — در مقابل
        // حذف کامل کلاس باگ‌های «HTML کهنه» قابل‌چشم‌پوشی است.
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          // ─── 🔒 ممیزی امنیتی F11 — هدرهای امنیتی سراسری ───
          // nosniff: ضد MIME-sniffing (حلقهٔ اصلی SVG-XSS — F6)
          // Referrer-Policy: نشت URLهای داخلی به بیرون نمیرود | Permissions-Policy: قطع APIهای بلااستفاده
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // ⚠️ v144 — geolocation=(self): مسیریاب پیاده‌روی/دویدن (/activity) با
          // Geolocation API کار می‌کند. مقدار قبلی «geolocation=()» کل API را حتی
          // برای خود سایت می‌بست — به همین دلیل هرچقدر هم کاربر مجوز می‌داد،
          // مرورگر بی‌چون‌وچرا «PERMISSION_DENIED» برمی‌گرداند (گزارش مالک:
          // «حتی دستی مجوز دادم باز هم رد شد»). (self) یعنی فقط خود سایت
          // اجازه دارد؛ iframeهای ثالث همچنان بلاک‌اند. دوربین/میکروفون/پرداخت دست‌نخورده.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(self), payment=(self)",
          },
        ],
      },
      {
        // Next.js static build assets — hashed filenames, safe to cache forever
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // v165 — بهینه‌ساز تصویر Next: URL خروجی content-keyed است (url+w+q) و
        // خودش در .next/cache سمت سرور کش می‌شود. با no-store جدیدِ HTML، بدون
        // این قانون، هر بار کل تصویر رندرشده دانلود می‌شد — حالا ۲۴ ساعت + SWR.
        source: "/_next/image",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      {
        // User-uploaded media (chat images, body photos, blood tests)
        // ⚠️ این فایل‌ها خصوصی‌اند و از طریق route سرو با auth سرو
        // می‌شوند — Cache-Control باید private باشد تا proxy/CDN عمومی
        // عکس‌های بدن/آزمایش خون کاربران را کش نکند.
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "private, max-age=86400" },
          // 🔒 F6/F11 — محتوای آپلودی هرگز اجازهٔ اسکریپت/فریم ندارد؛
          // حتی اگر SVGای باز شود، اجرای اسکریپت درونش sandbox می‌شود
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
          },
        ],
      },
      {
        // ─── v21: عکس‌های مقالات — محتوای عمومی، کش همیشگی ───
        // بعد از قانون private می‌آید چون «آخرین قانون منطبق برنده است» —
        // عکس‌های عمومی مقالات نباید private کش شوند.
        source: "/uploads/articles/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // ─── v112: ویدیوهای اختصاصی بانک حرکات — عمومی، کش همیشگی ───
        // آموزش حرکت محتوای عمومی سایت است (نام فایل شامل timestamp — آپلود
        // جدید = URL جدید)؛ پخش با HTTP Range/206 توسط route سرو پشتیبانی می‌شود.
        source: "/uploads/exercise-videos/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Local fonts (Vazirmatn) — never change, cache forever
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Manifest — 1 day cache
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      {
        // Sitemap & robots.txt — cache 1 hour (Google needs fast response, not fresh)
        source: "/sitemap.xml",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
