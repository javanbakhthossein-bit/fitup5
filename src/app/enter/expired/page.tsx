import type { Metadata } from "next";
import { ExpiredClient } from "./expired-client";

/**
 * ─── v218 — رپر سرور صفحهٔ لینک منقضی (/enter/expired) ───
 *
 * قبلاً کل صفحه "use client" بود و metadata نداشت (صفحهٔ وضعیت پرداخت
 * بدون title/noindex ایندکس می‌شد). حالا این page.tsx سرور metadata
 * (title + noindex,follow) صادر می‌کند و کامپوننت کلاینت را رندر می‌کند —
 * UI عیناً همان قبلی است (expired-client.tsx بدون تغییر رفتاری).
 */

export const metadata: Metadata = {
  title: "لینک منقضی شده",
  robots: { index: false, follow: false },
};

export default function EnterExpiredRoute() {
  return <ExpiredClient />;
}
