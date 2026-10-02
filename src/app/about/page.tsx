import type { Metadata } from "next";
import { AboutPage } from "@/components/fitness/about-page";

/**
 * ─── v106 — درباره ما (/about) — route واقعی ───
 * کامپوننت کلاینت بازاستفاده می‌شود؛ دکمه‌های ناوبری context-aware هستند
 * (isSpaMounted). کوئری قدیمی ?screen=about با 308 به همین مسیر می‌آید.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const metadata: Metadata = {
  title: { absolute: "درباره ما | فیتاپ" },
  description:
    "آشنایی با حسین جوان — عکاس به‌نام ایرانی، مؤلف کتاب «عکاس جوان» و خالق فیتاپ؛ بیش از ۱۲ سال عکاسی حرفه‌ای، ۴۰۰۰+ پروژه و ۸+ سال بدنسازی و تحقیق در علم روز ورزش و تغذیه ورزشی.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: "درباره ما | فیتاپ",
    description: "آشنایی با حسین جوان — عکاس، نویسنده و خالق فیتاپ.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/about`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/images/hossein-javan.webp`, width: 800, height: 800, alt: "حسین جوان — بنیان‌گذار فیتاپ" }],
  },
};

export default function AboutRoute() {
  return <AboutPage />;
}
