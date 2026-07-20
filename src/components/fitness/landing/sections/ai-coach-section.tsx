"use client";

import { motion } from "framer-motion";
import { Bot, Send, Sparkles, Check, Dumbbell, Salad, RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen } from "@/lib/fitness/navigation";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

export function AiCoachSection() {
  const { setScreen } = useAppStore();

  return (
    <section id="ai-coach" className="py-20 sm:py-28 bg-white relative overflow-hidden">
      {/* subtle gold tinted blobs (replacing dark blur backgrounds) */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full bg-orange-200/25 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Visual - chat mockup */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.4 }}
            className="relative order-2 lg:order-1"
          >
            {/* Chat mockup - white card with gold border */}
            <div className="bg-white rounded-3xl border-2 border-orange-200 shadow-2xl shadow-orange-500/10 overflow-hidden max-w-md mx-auto">
              {/* Chat header — gold gradient bar */}
              <div className="flex items-center gap-3 p-4 border-b border-orange-100 bg-amber-50/60">
                <div className="relative">
                  {/* Bot avatar with gold gradient */}
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center shadow-md shadow-orange-500/20"
                    style={{ background: goldGradient }}
                  >
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                  <span className="absolute bottom-0 left-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-sm text-slate-900">فیتاپ هوشمند</h4>
                  <p className="text-[11px] text-emerald-600">آنلاین — آماده پاسخگویی</p>
                </div>
                <Sparkles className="w-5 h-5 text-orange-500" />
              </div>

              {/* Messages */}
              <div className="p-4 space-y-3 min-h-[320px] bg-orange-50/30">
                <ChatBubble side="user">
                  می‌تونی جای اسکوات یک حرکت جایگزین برای پاها بهم بدی؟ زانوم اذیتم می‌کنه.
                </ChatBubble>
                <ChatBubble side="ai">
                  حتماً! 💪 به جای اسکوات، این حرکات پیشنهاد می‌کنم:
                  <br />
                  <br />
                  ۱. <b>لانگز (قیچی)</b> — کمتر روی زانو فشار میاره
                  <br />
                  ۲. <b>پل باسن</b> — تقویت پشت پا و باسن
                  <br />
                  ۳. <b>ددلیفت رومانیایی</b> — با وزنه سبک‌تر
                  <br />
                  <br />
                  کدوم رو برای امروز انتخاب می‌کنی؟ 🏋️
                </ChatBubble>
                <ChatBubble side="user">
                  لانگز عالیه! ممنونم 🙏
                </ChatBubble>
                <ChatBubble side="ai">
                  انتخاب خوبیه! 🎯 قبل از شروع ۵ دقیقه گرم کن. موفق باشی! 💪
                </ChatBubble>

                {/* Input mockup */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="flex-1 rounded-2xl border-2 border-orange-100 bg-white px-4 py-2.5 text-sm text-slate-400">
                    سوال خود را بنویسید...
                  </div>
                  <button
                    className="w-10 h-10 rounded-full flex items-center justify-center shadow-md shadow-orange-500/20"
                    style={{ background: goldGradient }}
                  >
                    <Send className="w-4 h-4 text-white -rotate-180" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.4 }}
            className="order-1 lg:order-2"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 border border-orange-200 text-orange-600 text-sm font-medium mb-4">
              <Sparkles className="w-4 h-4" />
              مربی هوش مصنوعی
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4 leading-tight text-slate-900">
              مربی شخصی که <span className="text-transparent bg-clip-text" style={{ backgroundImage: goldGradient }}>هرگز خسته نمی‌شود</span>
            </h2>
            <p className="text-slate-500 leading-relaxed mb-6">
              با فیتاپ هوشمند ما، یک متخصص ورزشی و تغذیه همیشه در جیب شماست. هر سوال، هر مشکلی، هر زمان —
              پاسخ آنی و فارسی دریافت کنید. بدون نوبت، بدون انتظار.
            </p>

            <div className="space-y-3 mb-8">
              {[
                { icon: Dumbbell, text: "جایگزینی حرکات متناسب با آسیب‌دیدگی شما" },
                { icon: Salad, text: "مشاوره تغذیه‌ای و پیشنهاد غذای جایگزین هم‌کالری" },
                { icon: RotateCcw, text: "تغییر برنامه تمرینی هر زمان که بخواهید" },
                { icon: Check, text: "پاسخ علمی، دقیق و شخصی‌سازی‌شده" },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="flex items-center gap-3 bg-white border border-orange-100 rounded-2xl px-3 py-2.5 hover:border-orange-300 hover:shadow-md hover:shadow-orange-500/5 transition-all"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm shadow-orange-500/20"
                    style={{ background: goldGradient }}
                  >
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm text-slate-700">{item.text}</span>
                </motion.div>
              ))}
            </div>

            <button
              onClick={() => { setScreen("auth"); pushScreen("auth") }}
              className="inline-flex items-center justify-center gap-2 h-12 px-6 font-bold text-white rounded-2xl shadow-lg shadow-orange-500/30 hover:scale-[1.02] hover:shadow-xl hover:shadow-orange-500/40 transition-all duration-200"
              style={{ background: goldGradient }}
            >
              با مربی AI چت کن
            </button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ side, children }: { side: "user" | "ai"; children: React.ReactNode }) {
  const isUser = side === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.4 }}
      className={`flex ${isUser ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "text-white rounded-bl-md shadow-md shadow-orange-500/20"
            : "bg-white border border-orange-100 text-slate-700 rounded-br-md shadow-sm"
        }`}
        style={isUser ? { background: goldGradient } : undefined}
      >
        {children}
      </div>
    </motion.div>
  );
}
