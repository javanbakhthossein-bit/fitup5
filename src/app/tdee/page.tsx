import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { TdeeCalculator } from "@/components/fitness/tools/tdee-calculator";

/**
 * ─── v106 — محاسبه‌گر کالری (/tdee) — route واقعی SSR ───
 *
 * تا v105 محاسبه‌گر فقط اسکرین SPA (?tool=tdee) بود؛ حالا مسیر واقعی دارد و
 * ورودی‌های قدیمی با 308 به همین‌جا می‌آیند (src/proxy.ts).
 * کامپوننت محاسبه‌گر کاملاً self-contained است (بدون وابستگی به store SPA) —
 * فقط CTAهای بعد از نتیجه context-aware شدند (tool-result-cta.tsx).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "محاسبه کالری روزانه و TDEE | محاسبه‌گر کالری، BMR و BMI | فیتاپ" },
  description:
    "محاسبه کالری روزانه با محاسبه‌گر حرفه‌ای و رایگان فیتاپ: TDEE، BMR، شاخص BMI، درشت‌مغذی‌ها و وزن ایده‌آل — مبتنی بر فرمول علمی هریس-بندیکت برای رژیم لاغری، چربی‌سوزی و عضله‌سازی.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/tdee` },
  openGraph: {
    title: "محاسبه کالری روزانه و TDEE | فیتاپ",
    description:
      "محاسبه‌گر حرفه‌ای و رایگان کالری روزانه: TDEE، BMR، BMI، درشت‌مغذی‌ها و وزن ایده‌آل — فیتاپ.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/tdee`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: "محاسبه‌گر کالری فیتاپ" }],
  },
};

async function getExerciseCount(): Promise<number> {
  try {
    return await db.exerciseLibrary.count();
  } catch {
    return 0;
  }
}

export default async function TdeePage() {
  // یک دادهٔ زنده برای پاراگراف معرفی (تقویت محتوایی هاب‌های داخلی)
  const exCount = await getExerciseCount();

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      {/* v123 — هایلایت ابزار فعلی روی نوار واحد ابزارهای رایگان */}
      <ToolsNav active="tool-tdee" />
      <main className="pt-20 pb-16">
        {/* معرفی SSR — محتوای متنی واقعی برای سئو (۲-۳ جمله دربارهٔ TDEE/BMR) */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3">
            محاسبه‌گر کالری روزانه (TDEE) فیتاپ
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            TDEE یا «کل انرژی روزانهٔ بدن» مجموع کالری‌ای است که بدن شما در یک شبانه‌روز می‌سوزاند؛
            یعنی متابولیسم پایه (BMR — انرژی لازم برای تنفس، گردش خون و بازسازی سلولی) به‌اضافهٔ
            کالری فعالیت‌ها و ورزش. این عدد مبنای هر برنامهٔ لاغری، چربی‌سوزی یا عضله‌سازی است:
            کمتر از TDEE بخورید تا وزن کم کنید و بیشتر از آن تا عضله بسازید.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            ماشین‌حساب زیر با فرمول علمی هریس-بندیکت و ضریب فعالیت واقعی شما، کالری روزانه،
            BMI و درشت‌مغذی‌های پیشنهادی (پروتئین، کربوهیدرات و چربی) را دقیق محاسبه می‌کند —
            کاملاً رایگان. بعد از نتیجه، می‌توانید از{" "}
            <a href="/exercises" className="text-orange-600 font-bold hover:text-orange-700 transition">
              بانک {exCount > 0 ? exCount.toLocaleString("fa-IR") : ""} حرکت فیتاپ
            </a>{" "}
            برای شروع تمرین استفاده کنید.
          </p>
        </section>

        <TdeeCalculator />
      </main>
    </div>
  );
}
