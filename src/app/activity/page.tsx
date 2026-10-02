import type { Metadata } from "next";
import { redirect } from "next/navigation";

/**
 * ─── v138 — مسیریاب فیتاپ (پیاده‌روی و دویدن) ───
 *
 * v143 (دیرکتیو مالک): «داخل محیط پنل کاربری بساز نه اینکه یک بخش جدا باشه» —
 * کل تجربهٔ مسیریاب حالا تب «پیاده‌روی و دویدن» داخل پنل است (طراحی هم‌سبک
 * با بقیهٔ تب‌ها، بدون کرامپ لندینگ). این مسیر فقط به تب پنل ریدایرکت می‌کند.
 *
 * noindex: صفحهٔ شخصی کاربر است (نیازمند لاگین) — محتوای عمومی ندارد.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "مسیریاب فیتاپ — پیاده‌روی و دویدن با نقشهٔ زنده" },
  description:
    "پیاده‌روی و دویدن خودت را با GPS ثبت کن: مسافت، سرعت، ریتم، کالری و مسیر روی نقشهٔ زنده — با گیمیفیکیشن و تاریخچهٔ کامل.",
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  redirect("/?screen=panel&tab=activity");
}
