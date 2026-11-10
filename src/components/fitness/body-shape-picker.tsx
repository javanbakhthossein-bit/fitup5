"use client";

/**
 * v170 — انتخابگر «فرم بدن» آنبوردینگ (اجباری — دیرکتیو مالک)
 *
 * نسخهٔ ۴ — سیلیوئت‌های «چارت کلاسیک فرم بدن»:
 * مبنا چارت شناخته‌شدهٔ ویکی‌مدیا (Public Domain) است؛ کاربر این استایل را بلافاصله
 * به‌عنوان «چارت فرم بدن» تشخیص می‌دهد — دست‌ها روی کمر، ایستادهٔ روبه‌رو، خطوط
 * هنری یکدست. هر ۱۲ ترکیب (۶ فرم × ۲ جنسیت) از یک موتور مورف واحد بیرون می‌آید
 * (src/lib/fitness/body-shape.ts) تا خانوادهٔ بصری کاملاً یکدست بماند.
 */
import { Check, Info } from "lucide-react";
import { motion } from "framer-motion";
import { BODY_SHAPES, bodyShapePaths } from "@/lib/fitness/body-shape";
import { BODY_SHAPE_VIEWBOX } from "@/lib/fitness/body-shape-base";
import type { BodyShapeKey, Gender } from "@/lib/fitness/types";

const GOLD_GRADIENT = "linear-gradient(135deg, #f59e0b, #f97316)";

export function BodyShapeSilhouette({
  gender,
  shape,
  selected,
  height = 104,
}: {
  gender: Gender;
  shape: BodyShapeKey;
  selected?: boolean;
  height?: number;
}) {
  const paths = bodyShapePaths(gender, shape);
  const uid = `${gender}-${shape}`;
  const w = Math.round(height * (120 / 310));

  const fill = selected ? `url(#fig-${uid})` : "#fdba74";
  const stroke = selected ? "#ea580c" : "#fb923c";

  return (
    <svg
      width={w}
      height={height}
      viewBox={BODY_SHAPE_VIEWBOX}
      fill="none"
      aria-hidden="true"
      className="mx-auto block"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`fig-${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <radialGradient id={`halo-${uid}`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0%" stopColor="#fdba74" stopOpacity={selected ? 0.35 : 0.16} />
          <stop offset="100%" stopColor="#fdba74" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* هالهٔ پشت فیگور */}
      <ellipse cx="0" cy="155" rx="52" ry="145" fill={`url(#halo-${uid})`} />

      {/* خطوط چارت — ضخامت ۳ واحدی تا در اندازهٔ کوچک هم خوانا بماند */}
      <g
        fill={fill}
        stroke={stroke}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function BodyShapePicker({
  gender,
  value,
  onChange,
}: {
  gender: Gender;
  value?: BodyShapeKey;
  onChange: (shape: BodyShapeKey) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {BODY_SHAPES.map((s, i) => {
          const active = value === s.id;
          return (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              aria-pressed={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              whileTap={{ scale: 0.96 }}
              className={`relative flex flex-col items-center pt-3 pb-2.5 px-2 rounded-2xl border-2 bg-white transition-all text-center overflow-hidden ${
                active
                  ? "border-orange-500 shadow-lg shadow-orange-500/20"
                  : "border-orange-100 hover:border-orange-300 hover:shadow-md hover:shadow-orange-100"
              }`}
              style={active ? { background: "linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%)" } : undefined}
            >
              <BodyShapeSilhouette gender={gender} shape={s.id} selected={active} height={92} />
              <div className="mt-1.5 font-black text-[13px] leading-5 text-slate-900">{s.label}</div>
              <div className="mt-0.5 text-[10px] leading-4 text-slate-500 min-h-[28px]">{s.desc}</div>
              {active && (
                <motion.div
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center shadow-md shadow-orange-300"
                  style={{ background: GOLD_GRADIENT }}
                >
                  <Check className="w-4 h-4 text-white" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-start gap-1.5 rounded-xl bg-amber-50/70 border border-amber-200/70 px-3 py-2">
        <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[10.5px] leading-4 text-amber-800">
          فرم بدن فعلی‌ات به چه شکلی است؟ برنامه بر اساس همین پاسخ برای توازن نسبت‌های بدنی‌ات تنظیم می‌شود — مثلاً پایین‌تنهٔ پهن یعنی تأکید بیشتر روی بالاتنه.
        </p>
      </div>
    </div>
  );
}
