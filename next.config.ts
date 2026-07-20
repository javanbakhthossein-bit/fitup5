import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  poweredByHeader: false,
  // Allow cross-origin dev requests (for preview panel)
  allowedDevOrigins: ["*.space-z.ai"],
  // ─── Redirects ───
  // مهم: /auth به /?screen=auth هدایت می‌شود با ۳۰۱ (Permanent Redirect).
  // قبلاً از redirect() در page.tsx استفاده می‌کردیم که ۳۰۷ (Temporary) می‌داد
  // و HTML شامل <meta name="next-error" content="not-found"/> بود — گوگل آن را ۴۰۴ تفسیر می‌کرد.
  // با redirects() در next.config.ts، redirect در سطح سرور انجام می‌شود بدون رندر HTML.
  async redirects() {
    return [
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
    ];
  },
  // ─── Browser caching for faster load ───
  // (FULL-PROFILE-AI-CONTEXT-WORKOUT) Static assets are cached aggressively;
  // HTML pages are NEVER cached (always fresh).
  async headers() {
    return [
      {
        // Next.js static build assets — hashed filenames, safe to cache forever
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // User-uploaded media (chat images, body photos, blood tests)
        // Cached for 1 day — refreshes if user uploads new media
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
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
        // HTML pages — NEVER cache, always fresh
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
