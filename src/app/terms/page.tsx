import type { Metadata } from "next";
import { TermsPage } from "@/components/fitness/terms-page";

/**
 * ─── v106 — شرایط و قوانین (/terms) — route واقعی ───
 * کامپوننت کلاینت بازاستفاده می‌شود؛ روی این روت دکمه‌های ناوبری context-aware
 * هستند (tools-nav/terms-page — isSpaMounted). سند حریم خصوصی: /terms?doc=privacy
 * (کوئری قدیمی ?screen=terms با 308 به همین مسیر می‌آید — src/proxy.ts).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const metadata: Metadata = {
  title: { absolute: "قوانین و مقررات | فیتاپ" },
  description:
    "قوانین و مقررات استفاده از خدمات اپلیکیشن فیتاپ — شرایط استفاده، حقوق کاربر، سیاست بازگشت وجه و حریم خصوصی.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/terms` },
  openGraph: {
    title: "قوانین و مقررات | فیتاپ",
    description: "قوانین و مقررات استفاده از خدمات اپلیکیشن فیتاپ.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/terms`,
    siteName: "فیتاپ",
  },
};

export default function TermsRoute() {
  return <TermsPage />;
}
