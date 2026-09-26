"use client";

import { Dumbbell, Salad, Users, Bot } from "lucide-react";
import { usePublicStats } from "../use-public-stats";
import { CountUp } from "../count-up";

// Task 5-b — کارت چهارم دیگر عدد ثابت نیست: تعداد واقعی کاربران ثبت‌نام‌شده
// از دیتابیس (هوک usePublicStats با کش مشترک ماژول‌سطح) نمایش داده می‌شود.
// v94 — شمارندهٔ «حرکت ورزشی» هم پویا شد (دیرکتیو مالک: مجموع حرکات در صفحهٔ
// اصلی باید با رشد کتابخانه — پیلاتس/TRX و… — آپدیت شود) — CountUp از صفر.
// Task 7-d — شمارندهٔ «غذای سالم» هم پویا شد: رشتهٔ ثابت «۱۰۰۰+» حذف و با
// CountUp روی تعداد واقعی بانک غذا (stats.foods) جایگزین شد — مثل کاربران و
// حرکات از صفر شروع به شمارش می‌کند. فقط «۲۴/۷ مربی هوشمند» رشتهٔ ثابت می‌ماند.
// v137 — دیرکتیو مالک: کارت‌های بانک حرکات و بانک غذاها کلیک‌خور زیاد دارند →
// کل کارت به صفحهٔ خودش لینک شد (/exercises و /foods) — همان ظاهر، فقط کلیک‌پذیر.
const STATS = [
  {
    icon: Bot,
    value: "۲۴/۷",
    label: "مربی هوشمند",
    subtitle: "تحلیل ویدیو، عکس غذا و آزمایش خون",
    grad: "from-amber-500 to-orange-500",
    href: undefined as string | undefined,
  },
];

export function TrustBar() {
  // آمار عمومی — یک درخواست مشترک برای همهٔ کامپوننت‌های لندینگ (کش ماژول‌سطح)
  const stats = usePublicStats();

  // کارت کاربران واقعی + کارت حرکات پویا (v94) + کارت غذای سالم پویا (Task 7-d)
  const userStat = {
    icon: Users,
    value: <CountUp value={stats.users} suffix="+" />,
    label: "ورزشکار فیتاپی",
    subtitle: "به فیتاپ اعتماد کرده‌اند",
    grad: "from-amber-400 to-orange-400",
    href: undefined as string | undefined,
  };
  const exerciseStat = {
    icon: Dumbbell,
    value: <CountUp value={stats.exercises} suffix="+" />,
    label: "حرکت ورزشی",
    subtitle: "با آموزش گام‌به‌گام",
    grad: "from-orange-500 to-red-500",
    href: "/exercises",
  };
  const foodStat = {
    icon: Salad,
    value: <CountUp value={stats.foods} suffix="+" />,
    label: "غذای سالم",
    subtitle: "بانک مواد غذایی",
    grad: "from-yellow-500 to-amber-500",
    href: "/foods",
  };
  const ALL_STATS = [...STATS, foodStat, exerciseStat, userStat];

  return (
    <section className="py-10 sm:py-12 bg-white border-y border-orange-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Desktop: 4-column grid */}
        <div className="hidden md:grid grid-cols-4 gap-4 sm:gap-6">
          {ALL_STATS.map((stat, i) => {
            const Wrap = (stat.href ? "a" : "div") as "a";
            return (
              <Wrap
                key={i}
                {...(stat.href ? { href: stat.href } : {})}
                style={{ animationDelay: `${i * 0.1}s` }}
                className="animate-fade-in-up relative bg-white rounded-3xl border border-orange-100 shadow-sm hover:shadow-xl transition-all p-5 text-center overflow-hidden hover:-translate-y-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:outline-none"
                aria-label={stat.href ? `${stat.label} — مشاهده بانک` : undefined}
              >
                {/* Decorative gradient blob */}
                <div
                  className={`absolute -top-8 -left-8 w-24 h-24 rounded-full opacity-10 blur-2xl bg-gradient-to-br ${stat.grad}`}
                />
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${stat.grad} flex items-center justify-center mx-auto mb-3 shadow-lg`}
                >
                  <stat.icon className="w-7 h-7 text-white" strokeWidth={2.5} />
                </div>
                <p
                  className="text-2xl sm:text-3xl font-black mb-0.5"
                  style={{
                    background: "linear-gradient(135deg, #f59e0b, #f97316)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {stat.value}
                </p>
                <p className="text-sm font-bold text-slate-900">{stat.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{stat.subtitle}</p>
              </Wrap>
            );
          })}
        </div>

        {/* Mobile: 2x2 grid — تمیز و مینیمال */}
        <div className="md:hidden grid grid-cols-2 gap-2.5">
          {ALL_STATS.map((stat, i) => {
            const Wrap = (stat.href ? "a" : "div") as "a";
            return (
              <Wrap
                key={i}
                {...(stat.href ? { href: stat.href } : {})}
                style={{ animationDelay: `${i * 0.05}s` }}
                className="animate-fade-in-up bg-white rounded-2xl border border-orange-100 shadow-sm p-3 text-center cursor-pointer active:scale-[0.98] transition-transform"
                aria-label={stat.href ? `${stat.label} — مشاهده بانک` : undefined}
              >
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.grad} flex items-center justify-center mx-auto mb-1.5 shadow-md`}
                >
                  <stat.icon className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <p
                  className="text-xl font-black mb-0"
                  style={{
                    background: "linear-gradient(135deg, #f59e0b, #f97316)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {stat.value}
                </p>
                <p className="text-[11px] font-bold text-slate-900 leading-tight">{stat.label}</p>
              </Wrap>
            );
          })}
        </div>
      </div>
    </section>
  );
}
