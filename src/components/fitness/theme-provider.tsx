"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * ─── v207 — حذف init دوم Clarity (رشد خطاهای «Script error.») ───
 * ClientSideScripts با پکیج npm، Clarity را همان لحظهٔ mount اجرا می‌کرد؛
 * همزمان لودر inline بهینهٔ v139 در layout.tsx هم همان پروژه را بعد از load
 * اجرا می‌کند → دو تگ اسکریپت clarity.ms در هر صفحه = دوبل بودن beaconها،
 * فشار اضافه روی موبایل و دوبرابر شدن خطاهای ثبت‌شده. لودر inline تنها
 * مسیر رسمی است (v139) و این wrapper فقط ThemeProvider می‌ماند.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
