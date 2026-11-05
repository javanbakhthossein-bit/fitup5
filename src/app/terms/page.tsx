import type { Metadata } from "next";
import { NikaWidget } from "@/components/fitness/nika-widget";

import { TermsPage } from "@/components/fitness/terms-page";

/**
 * ─── v106 — شرایط و قوانین (/terms) — route واقعی ───
 * کامپوننت کلاینت بازاستفاده می‌شود؛ روی این روت دکمه‌های ناوبری context-aware
 * هستند (tools-nav/terms-page — isSpaMounted). سند حریم خصوصی: /terms?doc=privacy
 * (کوئری قدیمی ?screen=terms با 308 به همین مسیر می‌آید — src/proxy.ts).
 *
 * ─── v218 — generateMetadata (ممیزی سئو) ───
 * قبلاً metadata ثابت با canonical /terms بود درحالی‌که ?doc=privacy سند
 * کاملاً متفاوتی نشان می‌داد (title/canonical با محتوا ناهم‌خوان).
 * حالا: doc=privacy → title «حریم خصوصی | فیتاپ» + canonical همان URL؛
 * پیش‌فرض → همان metadata قبلی (/terms).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const isPrivacy = sp.doc === "privacy";

  if (isPrivacy) {
    const title = "حریم خصوصی | فیتاپ";
    const description =
      "حریم خصوصی و سیاست حفاظت از اطلاعات کاربران اپلیکیشن فیتاپ — چه اطلاعاتی جمع‌آوری می‌شود، چگونه محافظت می‌شود و حقوق شما.";
    return {
      title: { absolute: title },
      description,
      robots: "index,follow",
      alternates: { canonical: `${SITE_URL}/terms?doc=privacy` },
      openGraph: {
        title,
        description,
        type: "website",
        locale: "fa_IR",
        url: `${SITE_URL}/terms?doc=privacy`,
        siteName: "فیتاپ",
      },
    };
  }

  return {
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
}

export default async function TermsRoute() {
  return (
    <>
      <TermsPage />
      {/* v211 — سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </>
  );
}
