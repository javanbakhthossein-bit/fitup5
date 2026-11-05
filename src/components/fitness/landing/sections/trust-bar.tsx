"use client";

import { Dumbbell, Salad, Users, Smartphone } from "lucide-react";
import { usePublicStats } from "../use-public-stats";

// Task 5-b — کارت چهارم: تعداد واقعی کاربران ثبت‌نام‌شده از دیتابیس.
// v94 — شمارندهٔ «حرکت ورزشی» پویا (مجموع حرکات کتابخانه) — Task 7-d — «غذای سالم» پویا.
// v204 — دیرکتیو مالک:
//   ① دیگر هیچ شمارندهٔ «از صفر» وجود ندارد — عدد واقعی از SSR می‌آید و همان
//      لحظهٔ اول (توی HTML) نوشته شده است؛ با اینترنت کند هم کاربر صفر نمی‌بیند.
//   ② کارت «مربی ۲۴/۷» حذف شد → جای آن «نصب اپ» با مجموع نصب اپ اختصاصی +
//      اپ کافه‌بازار + وب‌اپ (PWA) — همان فرمول داشبورد ادمین، زنده مثل بقیه اعداد.
// v137 — کارت‌های بانک حرکات و بانک غذاها کلیک‌خور زیاد دارند → کل کارت به
// صفحهٔ خودش لینک شد (/exercises و /foods) — همان ظاهر، فقط کلیک‌پذیر.
export function TrustBar() {
  // آمار عمومی — یک درخواست مشترک برای همهٔ کامپوننت‌های لندینگ (کش ماژول‌سطح)
  // v204 — با seed سرور، همین رندر اول عدد واقعی را دارد.
  const stats = usePublicStats();

  const installStat = {
    icon: Smartphone,
    value: stats.appInstallsFa,
    label: "نصب اپ",
    subtitle: "اپ بازار، اختصاصی و وب‌اپ",
    grad: "from-amber-500 to-orange-500",
    href: undefined as string | undefined,
  };
  const userStat = {
    icon: Users,
    value: stats.usersFa,
    label: "ورزشکار فیتاپی",
    subtitle: "به فیتاپ اعتماد کرده‌اند",
    grad: "from-amber-400 to-orange-400",
    href: undefined as string | undefined,
  };
  const exerciseStat = {
    icon: Dumbbell,
    value: stats.exercisesFa,
    label: "حرکت ورزشی",
    subtitle: "با آموزش گام‌به‌گام",
    grad: "from-orange-500 to-red-500",
    href: "/exercises",
  };
  const foodStat = {
    icon: Salad,
    value: stats.foodsFa,
    label: "غذای سالم",
    subtitle: "بانک مواد غذایی",
    grad: "from-yellow-500 to-amber-500",
    href: "/foods",
  };
  const ALL_STATS = [installStat, foodStat, exerciseStat, userStat];

  return (
    <section className="py-10 sm:py-12 bg-white border-y border-orange-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ─── v249-dom-fix — یک گرید واحد برای دسکتاپ/موبایل ───
            قبلاً همین ۴ آمار «دو بار» رندر می‌شد (۴ستونهٔ دسکتاپ + ۲×۲ موبایل؛
            هر دو همیشه در DOM با hideکردن CSS). حالا یک کانتینر با کلاس‌های
            ریسپانسیو — ظاهر هر دو عیناً حفظ شده. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4 lg:gap-6">
          {ALL_STATS.map((stat, i) => {
            const Wrap = (stat.href ? "a" : "div") as "a";
            return (
              <Wrap
                key={i}
                {...(stat.href ? { href: stat.href } : {})}
                style={{ animationDelay: `${i * (i < 2 ? 0.05 : 0.1)}s` }}
                className="animate-fade-in-up relative bg-white rounded-2xl md:rounded-3xl border border-orange-100 shadow-sm p-3 md:p-5 text-center overflow-hidden cursor-pointer active:scale-[0.98] md:active:scale-100 transition-transform md:transition-all md:hover:shadow-xl md:hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:outline-none"
                aria-label={stat.href ? `${stat.label} — مشاهده بانک` : undefined}
              >
                {/* Decorative gradient blob — فقط دسکتاپ (مثل قبل) */}
                <div
                  className={`hidden md:block absolute -top-8 -left-8 w-24 h-24 rounded-full opacity-10 blur-2xl bg-gradient-to-br ${stat.grad}`}
                />
                <div
                  className={`w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-gradient-to-br ${stat.grad} flex items-center justify-center mx-auto mb-1.5 md:mb-3 shadow-md md:shadow-lg`}
                >
                  <stat.icon className="w-5 h-5 md:w-7 md:h-7 text-white" strokeWidth={2.5} />
                </div>
                <p
                  className="text-xl md:text-2xl lg:text-3xl font-black mb-0 md:mb-0.5"
                  style={{
                    background: "linear-gradient(135deg, #f59e0b, #f97316)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {stat.value}
                </p>
                <p className="text-[11px] md:text-sm font-bold text-slate-900 leading-tight md:leading-normal">{stat.label}</p>
                <p className="hidden md:block text-[11px] text-slate-500 mt-0.5">{stat.subtitle}</p>
              </Wrap>
            );
          })}
        </div>
      </div>
    </section>
  );
}
