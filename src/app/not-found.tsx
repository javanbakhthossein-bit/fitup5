import Link from "next/link";

/**
 * ─── v222 — صفحهٔ ۴۰۴ فیتاپ (بازنویسی کامل طبق دیرکتیو مالک) ───
 *
 * متن قبلی (شوخی‌های تمرینی + «۴۰۴» بزرگ + لینک‌های متعدد) کلاً حذف شد.
 * مالک: «کلاً متنش باید پاک بشه و به جاش بنویسی:
 *   متاسفانه این صفحه در دسترس نیست، نگران نباش از همین جا مسیرت را ادامه بده.
 *   و به جای لوگوی دمبل، لوگوی خود فیتاپ رو بذار.»
 *
 * ساختار: لوگوی فیتاپ + همان جمله + یک دکمهٔ «ادامه» به خانه.
 * noindex دولایه حفظ شد (React 19 تگ‌های رندرشده را به head منتقل می‌کند) —
 * صفحهٔ خطا هرگز نباید ایندکس شود.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      <title>فیتاپ</title>
      <meta name="robots" content="noindex, follow" />

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full text-center">
          {/* لوگوی خود فیتاپ — به‌جای آیکون دمبل نسخهٔ قبلی */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/fitup-logo.png"
            alt="فیتاپ"
            className="mx-auto mb-8 w-24 h-24 object-contain"
          />

          <h1 className="text-xl md:text-2xl font-black text-slate-900 leading-relaxed">
            متاسفانه این صفحه در دسترس نیست؛
            <br />
            <span className="font-bold text-slate-500">
              نگران نباش، از همین جا مسیرت را ادامه بده.
            </span>
          </h1>

          <Link
            href="/"
            className="mt-8 inline-flex items-center justify-center h-12 px-10 rounded-2xl font-bold text-white shadow-lg transition active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, #f59e0b, #f97316)",
              boxShadow: "0 10px 24px -8px rgba(249, 115, 22, 0.45)",
            }}
          >
            ادامه
          </Link>
        </div>
      </main>
    </div>
  );
}
