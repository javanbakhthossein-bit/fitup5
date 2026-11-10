import Link from "next/link";

/**
 * ─── فوتر مشترک صفحات محتوایی SSR (v105) ───
 * بدون "use client" — در سرور رندر می‌شود؛ footer با mt-auto همیشه
 * انتهای viewport می‌چسبد (min-h-screen flex flex-col والد).
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-wrap flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="text-xs font-black text-slate-700">فیتاپ — هر بدنی فیتاپ میخواد</span>
        </div>
        <nav aria-label="فوتر" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <Link href="/" className="hover:text-orange-600 transition">خانه</Link>
          <Link href="/articles" className="hover:text-orange-600 transition">مقالات</Link>
          {/* v218 — گسترش لینک‌های فوتر مشترک (سئو: مسیر خزش داخلی از همهٔ صفحات محتوایی) */}
          <Link href="/tdee" className="hover:text-orange-600 transition">محاسبه کالری</Link>
          <Link href="/exercises" className="hover:text-orange-600 transition">بانک حرکات</Link>
          <Link href="/foods" className="hover:text-orange-600 transition">کالری غذاها</Link>
          <Link href="/about" className="hover:text-orange-600 transition">درباره ما</Link>
          <Link href="/terms" className="hover:text-orange-600 transition">قوانین</Link>
          <Link href="/contact" className="hover:text-orange-600 transition">تماس با ما</Link>
        </nav>
        {/* v262 — ممیزی سئو (دیرکتیو مالک): فوتر مشترک — تنها لینک‌سازی سراسری
            واقعی SSR سایت — صفر لینک به لندینگ رشته‌ها (/sport/bodybuilding و…)
            و خوشهٔ خرید («خرید برنامه بدنسازی» جایگاه ۱۳.۴ و نزولی) داشت.
            این ردیف از همهٔ صفحات محتوایی (مقاله/مجله/ابزار/غذا/نویسنده) سیگنال
            لینک داخلی به دو هاب حیاتی می‌فرستد — لینک‌های ثابت SSR، بدون DB. */}
        <nav
          aria-label="رشته‌ها و راهنماها"
          className="sm:basis-full mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 text-xs text-slate-500"
        >
          <Link href="/sport/bodybuilding" className="font-bold text-slate-600 hover:text-orange-600 transition">بدنسازی</Link>
          <Link href="/sport/powerlifting" className="hover:text-orange-600 transition">پاورلیفتینگ</Link>
          <Link href="/sport/calisthenics" className="hover:text-orange-600 transition">کالستنیکس</Link>
          <Link href="/sport/pilates" className="hover:text-orange-600 transition">پیلاتس</Link>
          <Link href="/sport/trx" className="hover:text-orange-600 transition">TRX</Link>
          <Link href="/sport/wellness" className="hover:text-orange-600 transition">ولنس</Link>
          <Link href="/sport/bikini_fitness" className="hover:text-orange-600 transition">بیکینی فیتنس</Link>
          <Link href="/article/buy-workout-program-guide" className="font-bold text-slate-600 hover:text-orange-600 transition">راهنمای خرید برنامه</Link>
          <Link href="/free-programs" className="hover:text-orange-600 transition">برنامه‌های رایگان</Link>
        </nav>
      </div>
    </footer>
  );
}
