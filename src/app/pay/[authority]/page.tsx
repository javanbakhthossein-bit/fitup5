/**
 * v173 — صفحهٔ میانی پرداخت /pay/{authority}
 *
 * مشکل: زرین‌پال روی صفحهٔ StartPay هدر Referer ناوبری را چک می‌کند و اگر
 * origin آن با دامنهٔ ثبت‌شدهٔ درگاه (fittup.ir) یکی نباشد، پیام
 * «دسترسی از این دامنه مجاز نمی باشد، لطفاً از دامنه‌ی اصلی اقدام نمایید»
 * می‌دهد. ورود مستقیم به StartPay (اپ اندروید، ریدایرکت ۳۰۲ سرور، مرورگر
 * اینستاگرام) همیشه بدون Refererِ درست است و رد می‌شد.
 *
 * راه‌حل (دیرکتیو مالک — «صفحهٔ میانی»): این صفحه روی دامنهٔ خودمان رندر
 * می‌شود و بلافاصله با location.replace به StartPay می‌رود؛ مرورگر این
 * ناوبری را از دامنهٔ خودمان انجام می‌دهد و Referer: https://fittup.ir/
 * ارسال می‌شود → درگاه بدون خطا باز می‌شود (با curl تست شد).
 *
 * امنیت: خروجی این صفحه فقط به دامنهٔ ثابت payment.zarinpal.com ریدایرکت
 * می‌کند و authority با regex سفت اعتبارسنجی می‌شود → امکان open-redirect
 * و تزریق وجود ندارد. صفحه noindex است و کش نمی‌شود.
 *
 * نکتهٔ فنی: <meta name="referrer"> عمداً روی strict-origin-when-cross-origin
 * (پیش‌فرض مرورگرها) قفل شده تا هیچ پالیسی سراسریِ آینده نتواند Referer را
 * حذف کند و درگاه دوباره بشکند.
 */

import type { Metadata } from "next";
import { zarinpalDirectStartPayUrl } from "@/lib/payment/providers/zarinpal";
import PayRedirectClient from "./pay-redirect-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "انتقال به درگاه پرداخت",
  robots: { index: false, follow: false },
};

/**
 * فرمت authority زرین‌پال: ۳۶ کاراکتر (مثل A000000000000000000000000000vdddqx8q).
 * برای سازگاری با authorityهای شبیه‌سازی‌شدهٔ sandbox و فرمت‌های آینده، بازهٔ
 * ۲۰ تا ۶۴ کاراکتر فقط-الفبایی پذیرفته می‌شود — هر چیز دیگری لینک نامعتبر است.
 */
const AUTHORITY_RE = /^[A-Za-z0-9]{20,64}$/;

export default async function PayRedirectPage({
  params,
}: {
  params: Promise<{ authority: string }>;
}) {
  const { authority } = await params;
  const decoded = (() => {
    try {
      return decodeURIComponent(authority);
    } catch {
      return authority;
    }
  })();

  if (!AUTHORITY_RE.test(decoded)) {
    return (
      <main
        dir="rtl"
        className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-background px-4 py-10"
      >
        <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-2xl">
            ⚠️
          </div>
          <h1 className="mb-2 text-lg font-bold text-foreground">
            لینک پرداخت نامعتبر است
          </h1>
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            شناسهٔ پرداخت ناقص یا خراب شده است. لطفاً از داخل سایت یا اپ فیتاپ
            دوباره اقدام به پرداخت کنید.
          </p>
          <a
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            بازگشت به فیتاپ
          </a>
        </div>
      </main>
    );
  }

  const target = zarinpalDirectStartPayUrl(authority);

  return (
    <main
      dir="rtl"
      className="flex min-h-[70vh] flex-col items-center justify-center bg-background px-4 py-10"
    >
      {/* React 19 این تگ را به <head> منتقل می‌کند — تضمین ارسال Referer به زرین‌پال */}
      <meta name="referrer" content="strict-origin-when-cross-origin" />
      <PayRedirectClient target={target} />
    </main>
  );
}
