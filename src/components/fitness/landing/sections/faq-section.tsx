"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// v251-faq-sync — منبع واحد حقیقت: این آرایه از ماژول خنثای مشترک می‌آید تا
// FAQPage در home-jsonld.tsx دقیقاً هم‌متنِ همین بخش قابل‌مشاهده باشد
// (ریسک Manual Action ناهم‌خوانی markup با structured data صفر می‌شود).
import { LANDING_FAQS } from "@/lib/fitness/landing-faqs";

const FAQS = LANDING_FAQS;

export function FaqSection() {
  return (
    <section id="faq" className="py-20 sm:py-28 bg-white border-y border-orange-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div
          className="animate-fade-in-up text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-orange-600 text-sm font-medium mb-4">
            <HelpCircle className="w-4 h-4" />
            سوالات متداول
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            هر چه <span className="gradient-text">می‌خواهید بدانید</span>
          </h2>
          <p className="text-slate-500">
            پاسخ سوالات پرتکرار درباره فیتاپ
          </p>
        </div>

        <div
          className="animate-fade-in-up"
        >
          <Accordion type="single" collapsible className="space-y-3">
            {FAQS.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="bg-white border border-orange-200 rounded-2xl px-5 shadow-sm hover:border-orange-300 transition-colors [&[data-state=open]]:border-orange-400 [&[data-state=open]]:shadow-md"
              >
                <AccordionTrigger className="text-right font-bold text-sm text-slate-900 hover:no-underline py-5 hover:text-orange-600 transition-colors">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-slate-600 leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
