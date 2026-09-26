import type { Metadata } from "next";
import { ContactPage } from "@/components/fitness/contact-page";

/**
 * ─── v106 — تماس با ما (/contact) — route واقعی ───
 * کامپوننت کلاینت بازاستفاده می‌شود؛ دکمه‌های ناوبری context-aware هستند
 * (isSpaMounted). کوئری قدیمی ?screen=contact با 308 به همین مسیر می‌آید.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const metadata: Metadata = {
  title: { absolute: "تماس با ما | فیتاپ" },
  description:
    "تماس با تیم پشتیبانی فیتاپ از طریق تلفن، پیام‌رسان بله، تیکت پشتیبانی و چت با نیکا. پاسخگویی تلفنی در ساعات کاری ۱۰ تا ۲۰.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/contact` },
  openGraph: {
    title: "تماس با ما | فیتاپ",
    description: "راه‌های ارتباط با تیم پشتیبانی فیتاپ — تلفن، بله و تیکت پشتیبانی.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/contact`,
    siteName: "فیتاپ",
  },
};

export default function ContactRoute() {
  return <ContactPage />;
}
