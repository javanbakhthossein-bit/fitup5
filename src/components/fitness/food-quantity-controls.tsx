"use client";

/**
 * v254 — کنترل‌های مشترک «تنظیم مقدار غذا» (نه تبدیل واحد!)
 *
 * خواستهٔ مالک: واحد عوض نشود؛ «مقدارِ همان واحد» کم/زیاد شود:
 *   ۱۰۰ گرم → ۲۰۰ گرم، ۱ لیوان → ۲ لیوان، ۱ عدد → ۳ عدد، ۱ قاشق → ۰.۵ قاشق…
 *
 * FoodQuantityStepper — استپر فشردهٔ −/+ (گام ۰.۵، کف ۰.۵) + ورودی تایپی
 *   + چیپ‌های سریع ×۰.۵ / ×۱ / ×۲ / ×۳ + دکمهٔ بازگشت به «واحد مبنا» (مقدار ۱).
 * FoodUnitChips — انتخاب اینکه ضریب روی «کدام واحد» اعمال شود (مبنا/گرم/قاشق/لیوان/عدد…).
 *   ضریب نهایی و برچسب فارسی را food-units.ts حساب می‌کند؛ اینجا فقط UI است.
 *
 * طراحی: موبایل‌اول/RTL، هدف لمسی ≥44px، ارقام فارسی، زبان رنگی نارنجی/طلایی سایت.
 */

import { Minus, Plus, RotateCcw } from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";
import type { FoodUnitOption } from "@/lib/fitness/food-units";

/** چیپ‌های سریع ضریب (روی واحد انتخابی) — طبق دیرکتیو: ×۰.۵ ×۱ ×۲ ×۳ */
const QUICK_CHIPS = [0.5, 1, 2, 3] as const;

/** گرد به یک رقم اعشار — جلوگیری از خطای ممیز شناور در جمع ۰.۵ها */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * v87-الگو — نرمال‌سازی ورودی متنی مقدار: ارقام فارسی/عربی → لاتین + فقط رقم و نقطه.
 * (کیبورد فارسی کاربر ارقام فارسی می‌فرستد؛ ذخیره همیشه لاتین تا محاسبات امن بماند)
 */
function normalizeQtyInput(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/،/g, ".")
    .replace(/[^0-9.]/g, "");
}

export interface FoodQuantityStepperProps {
  /** مقدار فعلی به‌صورت رشتهٔ نرمال لاتین (مثل "1" یا "1.5") — state مشترک با caller */
  value: string;
  /** مقدار جدید نرمال‌شده (لاتین) — caller آن را به ضریب/ماکرو تبدیل می‌کند */
  onChange: (next: string) => void;
  /** گام استپر — پیش‌فرض ۰.۵ (دیرکتیو: حداقل گام ۰.۵) */
  step?: number;
  /** کف مجاز — پیش‌فرض ۰.۵ (صفر و منفی معنا ندارند) */
  min?: number;
  disabled?: boolean;
}

/**
 * استپر فشردهٔ مقدار: [−] [مقدار فارسی] [+] [واحد مبنا]
 * ردیف دوم: چیپ‌های سریع ×۰.۵ ×۱ ×۲ ×۳ (ضریبِ واحد انتخابی، نه تبدیل واحد).
 * چیپ فعال با مقدار جاری هایلایت می‌شود تا وضعیت همیشه شفاف باشد.
 */
export function FoodQuantityStepper({
  value,
  onChange,
  step = 0.5,
  min = 0.5,
  disabled = false,
}: FoodQuantityStepperProps) {
  const parsed = Number(value);
  // دفاعی: ورودی تایپی خراب/خالی → رفتار همان qty=1 (هم‌راستا با computeFoodFactor)
  const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  function apply(n: number) {
    const next = Math.max(min, round1(n));
    // دفاعی: نتیجه همیشه عدد متناهی مثبت است؛ باز هم چک می‌کنیم
    onChange(Number.isFinite(next) && next > 0 ? String(next) : String(min));
  }

  return (
    <div>
      <div className="flex items-center gap-1.5" role="group" aria-label="تنظیم مقدار">
        <button
          type="button"
          onClick={() => apply(qty - step)}
          disabled={disabled || qty <= min}
          className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-xl border-2 border-amber-200 bg-white text-amber-700 hover:bg-amber-50 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          aria-label="کم کردن مقدار"
        >
          <Minus className="w-4 h-4" aria-hidden />
        </button>
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={toPersianDigits(value || "")}
          onChange={(e) => onChange(normalizeQtyInput(e.target.value))}
          onBlur={() => {
            // خروج از فیلد خالی/نامعتبر → برگشت به مقدار مبنا (۱)
            if (!value.trim() || !(Number(value) > 0)) onChange("1");
          }}
          disabled={disabled}
          className="h-11 w-16 shrink-0 rounded-xl border-2 border-amber-200 bg-white text-center text-sm font-black text-slate-800 focus:outline-none focus:border-amber-400 disabled:opacity-60"
          aria-label="مقدار"
        />
        <button
          type="button"
          onClick={() => apply(qty + step)}
          disabled={disabled}
          className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-xl border-2 border-amber-200 bg-white text-amber-700 hover:bg-amber-50 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          aria-label="اضافه کردن مقدار"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onChange("1")}
          disabled={disabled}
          className={`inline-flex items-center justify-center gap-1 h-11 px-2.5 rounded-xl border-2 text-[11px] font-black transition active:scale-95 disabled:opacity-40 ${
            qty === 1
              ? "bg-gradient-to-br from-amber-500 to-orange-500 border-transparent text-white shadow-sm shadow-amber-200"
              : "border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
          }`}
          aria-label="بازگشت به واحد مبنا"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          واحد مبنا
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2" role="group" aria-label="مقدار سریع">
        {QUICK_CHIPS.map((n) => {
          const active = qty === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => apply(n)}
              disabled={disabled}
              aria-pressed={active}
              className={`inline-flex items-center justify-center h-11 min-w-11 px-2.5 rounded-xl border-2 text-xs font-black transition active:scale-95 disabled:opacity-40 ${
                active
                  ? "bg-gradient-to-br from-amber-500 to-orange-500 border-transparent text-white shadow-sm shadow-amber-200"
                  : "border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
              }`}
            >
              <span dir="ltr">×{toPersianDigits(n)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface FoodUnitChipsProps {
  /** گزینه‌های واحد از parseFoodUnits (اولی همیشه واحد مبنا است) */
  units: FoodUnitOption[];
  /** اندیس واحد انتخاب‌شده */
  value: number;
  onChange: (nextIndex: number) => void;
  disabled?: boolean;
}

/**
 * انتخابگر کوچک واحد (چیپ‌های سگمنتی): کاربر تعیین می‌کند ضریبِ مقدار روی
 * «کدام واحد» اعمال شود — گرم / لیوان / قاشق / عدد… (تبدیل بین واحدها نیست).
 * وزن هر واحد دلخواه (وقتی معلوم است) به‌صورت شفاف کنار لیبل نشان داده می‌شود.
 */
export function FoodUnitChips({ units, value, onChange, disabled = false }: FoodUnitChipsProps) {
  if (!units.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="انتخاب واحد">
      {units.map((u, i) => {
        const active = value === i;
        return (
          <button
            key={`${u.kind}-${i}`}
            type="button"
            onClick={() => onChange(i)}
            disabled={disabled}
            aria-pressed={active}
            className={`inline-flex flex-col items-center justify-center min-h-11 px-3 py-1 rounded-xl border-2 text-xs font-black leading-tight transition active:scale-95 disabled:opacity-40 ${
              active
                ? "bg-slate-800 border-transparent text-white shadow-sm"
                : "border-amber-200 bg-white text-slate-600 hover:bg-amber-50 hover:border-amber-300"
            }`}
          >
            <span>{u.label}</span>
            {/* شفافیت وزن واحد دلخواه — فقط برای واحدهای وزن‌دار بانک (نه گرم/مبنا) */}
            {u.kind === "unit" && typeof u.grams === "number" && u.grams > 0 && (
              <span className={`text-[9px] font-bold ${active ? "text-white/70" : "text-slate-400"}`}>
                {toPersianDigits(Math.round(u.grams))} گرمی
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
