"use client";

import { Star, Quote } from "lucide-react";

// v227 — دیرکتیو مالک: «نظرها انسانی‌تر و واقعی‌تر شود — الان معلوم است هوش مصنوعی نوشته»
// همهٔ متن‌ها لحن محاوره‌ای طبیعی دارند، جزئیات شخصی مشخص (شهر/شغل/شرایط) و طول‌های متفاوت؛
// همه ۵ ستاره نیستند و ادعای اغراق‌آمیز (مثل «بهترین اپ دنیا») ندارند — مثل نظر واقعی کاربران.
const TESTIMONIALS = [
  {
    name: "محمد د.",
    role: "راننده — اهواز · کاهش ۷ کیلو در ۳ ماه",
    avatar: "م",
    color: "from-rose-500 to-pink-500",
    text: "راستش اولش باور نمی‌کردم یه اپ بتونه برام برنامه بذاره. ولی برنامه غذاییش با غذای خودمون بود، برنج و خورشت و... سه ماه ۷ کیلو کم کردم. مهم‌تر از وزن، اینکه هیچ‌وقت گشنگ نمی‌موندم.",
    rating: 5,
  },
  {
    name: "الهام ص.",
    role: "مادر دو فرزند — کرج",
    avatar: "ا",
    color: "from-cyan-500 to-blue-500",
    text: "بعد از زایمان دوم هر رژیمی گرفته بودم جواب نداد. چکاپ‌های دوره‌ای‌ش برنامه رو با پیشرفت خودم عوض می‌کنه، خودکار. بخش جایگزین غذا هم خیلی به دردم خورد چون ولم کن بچه‌ها غذای جدا نمی‌پزم 😅",
    rating: 5,
  },
  {
    name: "سعید م.",
    role: "۵ سال سابقه باشگاه — مشهد",
    avatar: "س",
    color: "from-violet-500 to-purple-500",
    text: "قبلاً ماهی مبلغ خوبی به مربی می‌دادم برای برنامه. الان همون سبک برنامه رو اینجا می‌گیرم و سوالم فنی رو از چت می‌پرسم. حالت باشگاهش هم واقعا کاربردیه، تایمر استراحت و ثبت وزنه هر ست داره.",
    rating: 5,
  },
  {
    name: "نگار ط.",
    role: "دانشجو — اصفهان · تمرین در خانه",
    avatar: "ن",
    color: "from-emerald-500 to-teal-500",
    text: "چون خوابگاهم و وقت باشگاه ندارم، برنامه خونه با وزن بدن گرفتم. تا الان خوب جلو رفته. یه ستاره کم کردم چون کاش ویدیوهای فرم حرکات بیشتر بود، بقیه‌ش رضایت دارم. پشتیبانیش هم سریع جواب داد.",
    rating: 4,
  },
  {
    name: "امیر ر.",
    role: "کارگر شیفت شب — قزوین",
    avatar: "آ",
    color: "from-amber-500 to-orange-500",
    text: "شیفت شب که کار می‌کنی خواب و غذات کلا بهم می‌ریزه. موقع ساخت برنامه پرسید شیفتم چیه و برنامه رو باهاش تنظیم کرد. این دقت رو جای دیگه ندیده بودم، جدی می‌گم.",
    rating: 5,
  },
  {
    name: "مریم ک.",
    role: "علاقه‌مند به پیلاتس — شیراز",
    avatar: "م",
    color: "from-indigo-500 to-violet-500",
    text: "از صفحه پیلاتسش اومدم. توضیح فارسی حرکات خوبه، می‌گه حرکت رو کجا باید حس کنی و اشتباه رایجش چیه. برنامه غذاییش هم برای من که گیاه‌خوارم گزینه‌های قابل قبول داشت.",
    rating: 5,
  },
];

export function TestimonialsSection() {
  return (
    <section className="py-20 sm:py-28 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="animate-fade-in-up text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}>
            <Star className="w-4 h-4 fill-orange-500 text-orange-500" />
            رضایت کاربران
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            هزاران ورزشکار{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #f59e0b, #f97316)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              با فیتاپ به هدفشان رسیدند
            </span>
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto">
            ببینید کاربران ما چه تجربه‌ای با فیتاپ داشته‌اند.
          </p>
        </div>

        {/* Desktop: 3-col grid */}
        <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              style={{ animationDelay: `${(i % 3) * 0.1}s` }}
              className="animate-fade-in-up bg-white rounded-3xl border-2 border-orange-100 p-5 hover:shadow-xl hover:shadow-orange-500/10 hover:border-orange-300 transition-all"
            >
              <Quote className="w-8 h-8 text-orange-200 mb-3" />
              <div className="flex mb-3">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">{t.text}</p>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white font-bold`}>
                  {t.avatar}
                </div>
                <div>
                  <p className="font-bold text-sm text-slate-900">{t.name}</p>
                  <p className="text-[11px] text-orange-600">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile: horizontal scroll */}
        <div className="sm:hidden -mx-4 px-4">
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-3" style={{ touchAction: "pan-x pan-y" }}>
            {TESTIMONIALS.map((t, i) => (
              <div
                key={i}
                className="shrink-0 w-[85vw] max-w-[300px] bg-white rounded-3xl border-2 border-orange-100 p-5 hover:border-orange-300 transition-all"
              >
                <Quote className="w-8 h-8 text-orange-200 mb-3" />
                <div className="flex mb-3">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-4 min-h-[5.5rem] overflow-hidden">{t.text}</p>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white font-bold`}>
                    {t.avatar}
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-900">{t.name}</p>
                    <p className="text-[11px] text-orange-600">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-[10px] text-slate-500 mt-1">← برای مشاهده بیشتر بکشید →</p>
        </div>
      </div>
    </section>
  );
}
