"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

/**
 * توستر سراسری فیتاپ — برندینگ پرمیوم تیره (۳۲-B):
 *  - کارت گرادیانی stone تیره با حاشیه کهربایی و گوشه‌های گرد
 *  - فونت فارسی (font-sans → وزیرمتن از globals.css) — چون sonner فونت
 *    سیستم خودش را روی [data-sonner-toaster] می‌گذارد، روی toast فورس می‌کنیم
 *  - dir=rtl برای جای درست دکمه بستن و جهت سوایپ
 *  - مدت پیش‌فرض ۷ ثانیه (شکایت کاربر: توست ~۴ثانیه‌ای قبل از خواندن محو می‌شد)
 *  - closeButton فعال — کاربر می‌تواند زودتر ببندد
 * پسوندهای «!» (سینتکس Tailwind 4) برای شکستن استایل‌های پیش‌فرض sonner است.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      dir="rtl"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        // مدت پیش‌فرض ۷ ثانیه — هر توست می‌تواند با duration اختصاصی بازنویسی کند
        duration: 7000,
        closeButton: true,
        classNames: {
          toast:
            "font-sans! text-sm! bg-linear-to-b! from-stone-800! via-stone-900! to-stone-950! text-stone-100! border! border-amber-500/20! rounded-xl! shadow-2xl! backdrop-blur-md",
          title: "font-sans! font-bold! text-stone-100!",
          description: "font-sans! text-stone-300! leading-relaxed!",
          actionButton:
            "font-sans! bg-amber-500! text-stone-950! font-bold! rounded-lg! border-0!",
          cancelButton:
            "font-sans! bg-stone-800! text-stone-200! font-bold! rounded-lg! border-0!",
          closeButton:
            "font-sans! bg-stone-900! text-stone-200! border-amber-500/30! rounded-md!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
