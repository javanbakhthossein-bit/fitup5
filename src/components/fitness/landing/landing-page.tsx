"use client";

import { LandingNav } from "./landing-nav";
import { HeroSection } from "./sections/hero-section";
import { TrustBar } from "./sections/trust-bar";
import { CoachVsTraditionalSection } from "./sections/coach-vs-traditional-section";
import { FeaturesSection } from "./sections/features-section";
import { ToolsSection } from "./sections/tools-section";
import { DisciplinesSection } from "./sections/disciplines-section";
import { AiCoachSection } from "./sections/ai-coach-section";
import { SampleProgramSection } from "./sections/sample-program-section";
// v227 — دیرکتیو مالک: سکشن «ساخته‌شده توسط نخبگان بدنسازی ایران» به‌کلی حذف شد
import { PricingSection } from "./sections/pricing-section";
import { TestimonialsSection } from "./sections/testimonials-section";
import { FaqSection } from "./sections/faq-section";
import { CtaSection } from "./sections/cta-section";
import { ArticlesSliderSection } from "./sections/articles-slider-section";
import { AppInstallSection } from "./sections/app-install-section";
import { InstagramCtaSection } from "./sections/instagram-cta-section";
import { LandingFooter } from "./landing-footer";
import { LandingHashScroll } from "./landing-hash-scroll";
// v204 — آمار عمومی از SSR تزریق می‌شود (عدد واقعی در HTML اولیه — بدون صفر/انیمیشن)
import { seedPublicStats, type PublicStatsSeed } from "./use-public-stats";

export function LandingPage({ initialStats }: { initialStats?: PublicStatsSeed | null }) {
  // v204 — تزریق آمار سرور قبل از اولین رندر همهٔ سکشن‌ها (Hero/TrustBar/Pricing/Tools)
  // v207 — در سرور هر رندر با دادهٔ همان درخواست seed می‌شود (HTML == prop →
  // بدون mismatch #418)؛ در کلاینت فقط قبل از هیدریشن — جزئیات در use-public-stats.ts
  seedPublicStats(initialStats);
  // NOTE: scroll detection moved into LandingNav to prevent re-rendering
  // all child sections (which caused the "white flash" flicker on scroll).
  // Each section uses whileInView animations with viewport={{ once: true }},
  // and parent re-renders were resetting their animation state briefly.
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* v123 — پرش به سکشن مقصد با هش (بردکرامب رشته‌ها /#disciplines ، CTAها /#pricing و…) */}
      <LandingHashScroll />
      <LandingNav />
      <main>
        <HeroSection />
        <TrustBar />
        <CoachVsTraditionalSection />
        <FeaturesSection />
        <ToolsSection />
        {/* v94 — کارت‌های رشته‌های ترند (پیلاتس/TRX/…) → صفحهٔ پویا ?sport= */}
        <DisciplinesSection />
        <AiCoachSection />
        {/* ویترین نمونهٔ برنامه — کاربر قبل از خرید خروجی واقعی را می‌بیند (Task 5-c) */}
        <SampleProgramSection />
        {/* v227 — سکشن CoachesTrustSection (نخبگان بدنسازی ایران) حذف شد — دیرکتیو مالک */}
        <PricingSection />
        <ArticlesSliderSection />
        <TestimonialsSection />
        <FaqSection />
        <AppInstallSection />
        <CtaSection />
        {/* CTA اینستاگرام — بالای فوتر */}
        <InstagramCtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
