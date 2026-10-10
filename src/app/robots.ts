import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // مسیرهای API نباید توسط روبات‌های موتور جستجو کرال شوند.
        // این کار از خطای 401 روی /api/pwa/installed و سایر endpointهای محافظت‌شده
        // در Google Search Console جلوگیری می‌کند.
        // v216-SEO — مسیرهای خصوصی هم Disallow شدند: پرداخت (/pay/)، ورود/انقضا
        // (/enter/)، تمدید (/renew/)، فعالیت روزانه (/activity/)، لینک‌های
        // کمپینی (/go/، /r/) و کیف پول (/wallet/) — صفحات کاربر-محور بدون ارزش
        // سرچ‌اند و فقط بودجهٔ خزش گوگل را هدر می‌دهند.
        disallow: [
          "/api/",
          "/pay/",
          "/enter/",
          "/renew/",
          "/activity/",
          "/go/",
          "/r/",
          "/wallet/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
