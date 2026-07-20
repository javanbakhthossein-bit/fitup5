import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/fitness/theme-provider";
import { HeadCodeInjector } from "@/components/fitness/head-code-injector";
import { PwaRegister } from "@/components/fitness/pwa-register";
import { PwaInstallPrompt } from "@/components/fitness/pwa-install-prompt";
import { ErrorCapture } from "@/components/fitness/error-capture";
import { BackButtonHandler } from "@/components/fitness/back-button-handler";

const vazirmatn = localFont({
  src: [
    { path: "../../public/fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
  preload: true,
});

// دامنه سایت — fittup.ir
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "برنامه بدنسازی هوشمند | فیتاپ — برنامه تمرینی و تغذیه با AI",
    template: "%s | فیتاپ",
  },
  description:
    "برنامه بدنسازی هوشمند با فیتاپ — برنامه تمرینی و غذایی شخصی‌سازی‌شده با هوش مصنوعی، برنامه تغذیه و مکمل، چت هوشمند ورزشی، آنالیز ویدیویی و آزمایش خون. ۴ پلن اشتراک متناسب با هر هدف.",
  applicationName: "فیتاپ",
  // Google Search Console verification — کد جدید برای fittup.ir
  verification: {
    google: "FBUeu2ZuRqKrlnu_aweORxGbh3gxSYHOlA1jhX4xiDs",
  },
  keywords: [
    "برنامه بدنسازی",
    "برنامه تمرینی",
    "برنامه تغذیه",
    "برنامه غذایی",
    "مکمل ورزشی",
    "عضله‌سازی",
    "کاهش وزن",
    "بدنسازی",
    "مربی هوش مصنوعی ورزشی",
    "برنامه تمرینی شخصی‌سازی",
    "فیتاپ",
    "fittup",
    "AI fitness coach",
    "workout plan",
  ],
  authors: [{ name: "فیتاپ", url: SITE_URL }],
  creator: "فیتاپ",
  publisher: "فیتاپ",
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "برنامه بدنسازی هوشمند | فیتاپ — برنامه تمرینی و تغذیه با AI",
    description:
      "برنامه بدنسازی و تغذیه کاملاً شخصی‌سازی‌شده با هوش مصنوعی. برنامه مکمل، چت هوشمند ورزشی، آنالیز ویدیویی و آزمایش خون — هر بدنی فیتاپ میخواد.",
    url: SITE_URL,
    siteName: "فیتاپ",
    locale: "fa_IR",
    type: "website",
    images: [
      {
        url: "/hero-fitup.webp",
        width: 886,
        height: 886,
        alt: "فیتاپ — اپلیکیشن تناسب اندام با هوش مصنوعی",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "برنامه بدنسازی هوشمند | فیتاپ",
    description:
      "برنامه بدنسازی و تغذیه شخصی‌سازی‌شده با هوش مصنوعی — هر بدنی فیتاپ میخواد.",
    images: ["/hero-fitup.webp"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.png"],
  },
  appleWebApp: {
    capable: true,
    title: "FitUp",
    statusBarStyle: "default",
  },
  category: "health",
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

// ---- Structured data (JSON-LD) ----
// سازمان (Organization)
const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "فیتاپ",
  alternateName: "FitUp",
  url: SITE_URL,
  logo: `${SITE_URL}/fitup-logo.png`,
  description: "اپلیکیشن برنامه بدنسازی و تغذیه هوشمند با هوش مصنوعی",
  slogan: "هر بدنی فیتاپ میخواد — برنامه بدنسازی هوشمند",
  sameAs: [SITE_URL],
};

// وب‌سایت (WebSite) با قابلیت جستجو
const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "فیتاپ",
  url: SITE_URL,
  inLanguage: "fa-IR",
  description: "برنامه بدنسازی و تغذیه هوشمند با هوش مصنوعی — هر بدنی فیتاپ میخواد",
  publisher: { "@type": "Organization", name: "فیتاپ", url: SITE_URL },
};

// سوالات متداول (FAQPage)
const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "آیا واقعاً هیچ مربی انسانی وجود ندارد؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! تمامی برنامه‌های تمرینی، غذایی، مشاوره‌ها و آنالیزها منحصراً توسط هوش مصنوعی تولید و مدیریت می‌شوند. این یعنی پاسخ آنی، ۲۴ ساعته و بدون محدودیت زمانی — همه فارسی و شخصی‌سازی‌شده برای شما.",
      },
    },
    {
      "@type": "Question",
      name: "چگونه ثبت‌نام می‌کنم؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ثبت‌نام با شماره موبایل و تأیید پیامک یک‌بارمصرف (OTP) انجام می‌شود. کد ۴ رقمی به شماره شما پیامک می‌شود و پس از تأیید، حساب شما ایجاد یا وارد می‌شود. ورود OTP یعنی پذیرش قوانین.",
      },
    },
    {
      "@type": "Question",
      name: "آیا برنامه تمرینی برای شرایط من مناسب است؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "برنامه کاملاً بر اساس اطلاعات آنبوردینگ شما (جنسیت، سن، قد، وزن، هدف، آسیب‌دیدگی‌ها، تجهیزات و رژیم غذایی) شخصی‌سازی می‌شود. اگر آسیب‌دیدگی دارید، هوش مصنوعی حرکات ایمن و جایگزین پیشنهاد می‌دهد.",
      },
    },
    {
      "@type": "Question",
      name: "پرداخت اشتراک چگونه انجام می‌شود؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "پرداخت از طریق درگاه امن زرین‌پال انجام می‌شود. پس از انتخاب اشتراک، به درگاه هدایت می‌شوید و پس از پرداخت موفق، اشتراک بلافاصله فعال می‌شود. رسید پرداخت در اپلیکیشن ذخیره می‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا می‌توانم برنامه‌ام را تغییر دهم؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! هر زمان که بخواهید می‌توانید با چت با مربی AI، جایگزین حرکت بخواهید، غذا را تعویض کنید یا درخواست بازسازی کل برنامه کنید. همچنین می‌توانید وزن جدید ثبت کنید و برنامه به‌روز می‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا اطلاعات و تصاویر من محرمانه می‌مانند؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله، حریم خصوصی شما برای ما مهم‌ترین اولویت است. تصاویر پیشرفت (Before/After) کاملاً خصوصی هستند و فقط برای خود شما نمایش داده می‌شوند. اطلاعات شما با هیچ شخص ثالثی به اشتراک گذاشته نمی‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا اپلیکیشن روی گوشی من کار می‌کند؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! اپلیکیشن فیتاپ یک وب‌اپلیکیشن واکنش‌گرا (Responsive) است که روی همه گوشی‌های اندروید و iOS از طریق مرورگر کار می‌کند. نیازی به نصب نیست — فقط باز کنید و شروع کنید.",
      },
    },
    {
      "@type": "Question",
      name: "اگر اشتراکم منقضی شود چه می‌شود؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "پس از انقضای اشتراک، دسترسی به برنامه‌های جدید و چت محدود می‌شود، اما اطلاعات قبلی شما (وزن، پیشرفت، تصاویر) حفظ می‌شود. هر زمان که اشتراک را تمدید کنید، دوباره به همه امکانات دسترسی دارید.",
      },
    },
  ],
};

// محصول و پلن‌ها — SoftwareApplication (بهترین نوع برای اپلیکیشن)
// شامل aggregateRating (نظرات کاربران)، offers (پلن‌ها) و featureList
const softwareAppLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "فیتاپ",
  alternateName: "FitUp",
  applicationCategory: "HealthAndFitnessApplication",
  operatingSystem: "Web, Android, iOS",
  description:
    "اپلیکیشن جامع تناسب اندام با هوش مصنوعی: برنامه تمرینی و غذایی شخصی‌سازی‌شده، چت هوشمند ورزشی، آنالیز ویدیویی و آزمایش خون. هر بدنی فیتاپ میخواد.",
  url: SITE_URL,
  downloadUrl: SITE_URL,
  screenshot: `${SITE_URL}/hero-fitup.webp`,
  softwareVersion: "3.0",
  datePublished: "2024-01-01",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "IRR",
    lowPrice: "350000",
    highPrice: "1800000",
    offerCount: 4,
    offers: [
      {
        "@type": "Offer",
        name: "پلن اقتصادی",
        price: "350000",
        priceCurrency: "IRR",
        description: "شروع مسیر تناسب اندام — برنامه تمرین و تغذیه ۴۵ روزه",
        url: `${SITE_URL}/#pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "پلن استاندارد",
        price: "800000",
        priceCurrency: "IRR",
        description: "برنامه کامل‌تر با مکمل و چکاپ دوره‌ای — ۴۵ روزه",
        url: `${SITE_URL}/#pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "پلن پیشرفته",
        price: "1200000",
        priceCurrency: "IRR",
        description: "چت هوشمند + حالت باشگاه + آنالیز عکس — ۴۵ روزه",
        url: `${SITE_URL}/#pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "پلن حرفه‌ای",
        price: "1800000",
        priceCurrency: "IRR",
        description: "آنالیز ویدیویی + آزمایش خون + پشتیبانی اختصاصی — ۴۵ روزه",
        url: `${SITE_URL}/#pricing`,
        availability: "https://schema.org/InStock",
      },
    ],
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.9",
    reviewCount: "10000",
    bestRating: "5",
    worstRating: "1",
  },
  featureList: [
    "برنامه تمرینی هوشمند شخصی‌سازی‌شده با هوش مصنوعی",
    "برنامه غذایی و مکمل اختصاصی",
    "چت ۲۴ ساعته با مربی هوشمند (متن، عکس، ویدیو)",
    "آنالیز هوشمند وعده‌های غذایی با عکس",
    "آنالیز ویدیویی بدن و اصلاح تکنیک حرکات",
    "تحلیل آزمایش خون (۴۷ ماده)",
    "پیگیری پیشرفت وزن و اندام‌ها با نمودار",
    "حالت باشگاه (Gym Mode) با تایمر استراحت",
    "دستیار تغذیه (Nutrition Companion)",
    "۲۵۰+ حرکت ورزشی با آموزش گام‌به‌گام",
    "۵۰۰+ غذای سالم در بانک مواد غذایی",
  ],
  brand: { "@type": "Brand", name: "فیتاپ" },
  publisher: { "@type": "Organization", name: "فیتاپ", url: SITE_URL },
  inLanguage: "fa-IR",
};

// نظرات کاربران (Review) — برای نمایش ستاره‌ها در گوگل
const reviewsLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "فیتاپ — برنامه بدنسازی هوشمند",
  description: "اپلیکیشن تناسب اندام با هوش مصنوعی",
  brand: { "@type": "Brand", name: "فیتاپ" },
  image: `${SITE_URL}/hero-fitup.webp`,
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.9",
    reviewCount: "10000",
    bestRating: "5",
  },
  review: [
    {
      "@type": "Review",
      author: { "@type": "Person", name: "رضا کریمی" },
      reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
      reviewBody: "بهترین چت ورزشی که دیدم! هر بار سوالی داشتم سریع جواب میگرفتم. مخصوصاً قسمت تعویض حرکت برای آسیبدیدگی کمرم خیلی کمکم کرد.",
      name: "افزایش ۵ کیلو عضله",
    },
    {
      "@type": "Review",
      author: { "@type": "Person", name: "مریم احمدی" },
      reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
      reviewBody: "برنامه غذایی فوق‌العادهست. با غذاهای ایرانی و در دسترس، ولی کاملاً سالم. نمودار پیشرفت وزن هم انگیزه زیادی میده.",
      name: "تناسب اندام پس از زایمان",
    },
    {
      "@type": "Review",
      author: { "@type": "Person", name: "امیر حسینی" },
      reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
      reviewBody: "حتی به‌عنوان کسی که سالها بدنسازی کردم، تنوع حرکات و شخصیسازی برنامه واقعاً عالیه. تایمر استراحت و ثبت وزنه خیلی کاربردیه.",
      name: "بدنسازی حرفه‌ای",
    },
  ],
};

// BreadcrumbList برای صفحه اصلی
const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "خانه",
      item: SITE_URL,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "امکانات",
      item: `${SITE_URL}/#features`,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "پلن‌ها و قیمت‌ها",
      item: `${SITE_URL}/#pricing`,
    },
    {
      "@type": "ListItem",
      position: 4,
      name: "سوالات متداول",
      item: `${SITE_URL}/#faq`,
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* ── تأییدیه‌ها ── */}
        {/* Google Search Console Verification — کد جدید برای fittup.ir */}
        <meta name="google-site-verification" content="FBUeu2ZuRqKrlnu_aweORxGbh3gxSYHOlA1jhX4xiDs" />
        {/* اینماد — کد جدید 24472446 */}
        <meta name="enamad" content="24472446" />
        {/* Microsoft Clarity */}
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "xi8940h5ty");`,
          }}
        />
        {/* Preconnect to third-party origins for faster resource loading */}
        <link rel="preconnect" href="https://www.clarity.ms" />
        <link rel="dns-prefetch" href="https://www.clarity.ms" />
        {/* Preload hero image (LCP element) */}
        <link rel="preload" as="image" href="/hero-fitup.webp" fetchPriority="high" />
        {/* Favicon */}
        {/* Favicon — FitUp logo with padding (full logo visible) */}
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=7" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=7" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png?v=7" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=7" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=7" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=7" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=7" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png" />
        {/* iOS PWA — full standalone mode (no Safari chrome) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FitUp" />
        {/* PWA manifest link (explicit, for older browsers) */}
        <link rel="manifest" href="/manifest.json" />
        {/* Theme color for mobile browsers */}
        <meta name="theme-color" content="#f97316" />
        {/* NOTE: canonical از metadata.alternates.canonical تولید می‌شود — تگ دستی حذف شد تا کنونیکال تکراری نباشد */}

        {/* Structured Data: Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        {/* Structured Data: WebSite */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
        {/* Structured Data: FAQPage */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
        {/* Structured Data: SoftwareApplication با offers و aggregateRating (بهترین نوع برای اپ) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppLd) }}
        />
        {/* Structured Data: Product با Reviews (نظرات کاربران برای ستاره‌های گوگل) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewsLd) }}
        />
        {/* Structured Data: BreadcrumbList */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
        />

        {/* Server-side injection of analytics/search-console/pixel codes (head placement) */}
        <HeadCodeInjector placement="head" />
      </head>
      <body
        className={`${vazirmatn.variable} font-sans antialiased bg-background text-foreground`}
      >
        {/* Server-side injection (body_start placement) */}
        <HeadCodeInjector placement="body_start" />
        {/* PWA: register service worker + install prompt banner */}
        <PwaRegister />
        {/* PWA: prevent accidental exit with back button */}
        <BackButtonHandler />
        {/* Capture client-side errors and log them for admin review */}
        <ErrorCapture />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          disableTransitionOnChange
        >
          {children}
          <PwaInstallPrompt />
          <Toaster />
          <SonnerToaster position="top-center" dir="rtl" />
        </ThemeProvider>
        {/* Server-side injection (body_end placement) */}
        <HeadCodeInjector placement="body_end" />
      </body>
    </html>
  );
}
