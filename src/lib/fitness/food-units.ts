/**
 * v253 — سیستم واحدهای چندگانهٔ غذا (ماژول اشتراکی — pure و client-safe)
 *
 * هر غذای FoodLibrary علاوه بر واحد مبنای servingSize می‌تواند فهرست واحدهای
 * دلخواه (قاشق غذاخوری، لیوان، عدد، مشت…) را در فیلد units (JSON آرایه‌ای از
 * {label, grams}) و وزن واحد مبنا را در servingGrams داشته باشد:
 *   units: '[{"label":"قاشق غذاخوری","grams":10},…]'
 *   servingGrams: 30   // یعنی یک servingSize = ۳۰ گرم
 *
 * این ماژول JSON خام را به گزینه‌های امن UI تبدیل می‌کند و ضریب تبدیل
 * «مقدار × واحد → چند وعدهٔ مبنا» را حساب می‌کند (پایهٔ محاسبهٔ خطی ماکروها).
 * هیچ گرد کردن اینجا انجام نمی‌شود — نمایش/ثبت با caller است.
 *
 * v254 — تنظیم مقدار (نه تبدیل واحد): کاربر یک واحد برمی‌دارد و «مقدار» همان
 * واحد را کم/زیاد می‌کند (۱۰۰ گرم → ۲۰۰ گرم، ۱ لیوان → ۲ لیوان، ۱ عدد → ۳ عدد).
 * برای ردیف‌های قدیمی بدون servingGrams، وزن مبنا به‌صورت دفاعی از متن
 * servingSize («۱۰۰ گرم») یا تطبیق برچسب مبنا با واحدهای بانک («۱ لیوان» +
 * {"label":"لیوان","grams":240}) استخراج می‌شود.
 */
import { toPersianDigits } from "@/lib/fitness/types";

export interface FoodUnitOption {
  label: string;
  /** وزن واحد بر حسب گرم — فقط برای واحد مبنا (serving) ممکن است null باشد */
  grams: number | null;
  kind: "serving" | "gram" | "unit";
}

export interface ParsedFoodUnits {
  units: FoodUnitOption[];
  servingGrams: number | null;
}

/** عدد «وزن معتبر»؟ (متناهی و مثبت) — ورودی unknown تا JSON خام هم امن بررسی شود */
function validGrams(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** رشتهٔ عددی (لاتین/فارسی/عربی، ممیز , یا .) → number امن؛ نامعتبر → null */
function parseFaNumber(s: string): number | null {
  const n = Number(
    s
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/,/g, ".")
  );
  return Number.isFinite(n) ? n : null;
}

/**
 * v254 — استخراج دفاعی «وزن واحد مبنا» وقتی servingGrams در DB خالی است (ردیف‌های قدیمی):
 *  ① برچسب وزنی صریح: «۱۰۰ گرم» / «۲۵۰ گرم» / «۱.۵ گرم» → همان عدد
 *     (یعنی وقتی وزن مبنا نامعلوم است و servingSize «۱۰۰ گرم» است،
 *     ضریبِ گرم = مقدار ÷ ۱۰۰ — دقیقاً طبق خواستهٔ مالک)
 *  ② برچسب شمارشی + واحدهای دلخواه: «۱ لیوان» با units=[{"label":"لیوان","grams":240}]
 *     → وزن مبنا = ۲۴۰ (واژهٔ پایانیِ برچسب مبنا با لیبل یکی از واحدهای بانک تطبیق می‌کند)
 * در غیر این صورت null → فراخوانی‌ها با factor=qty سقوط امن می‌کنند (وعده × تعداد).
 * هیچ‌وقت NaN/منفی برنمی‌گرداند.
 */
function deriveBaseGrams(servingSize: string, unitsJson: string | null | undefined): number | null {
  const label = (servingSize || "").trim();
  if (!label) return null;
  // ① وزن صریح داخل برچسب مبنا («۱۰۰ گرم»)
  const m = label.match(/([\d۰-۹٠-٩]+(?:[.,،][\d۰-۹٠-٩]+)?)\s*گرم/);
  if (m) {
    const g = parseFaNumber(m[1]);
    if (g !== null && g > 0) return g;
  }
  // ② واژهٔ پایانی برچسب مبنا («۱ لیوان» → «لیوان») در واحدهای دلخواه
  const tail = label.replace(/^[\d۰-۹٠-٩.,،]+\s*/, "").trim();
  if (tail && unitsJson && unitsJson.trim()) {
    try {
      const raw: unknown = JSON.parse(unitsJson);
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (!entry || typeof entry !== "object") continue;
          const l = (entry as { label?: unknown }).label;
          const g = (entry as { grams?: unknown }).grams;
          if (typeof l !== "string" || !l.trim() || !validGrams(g)) continue;
          if (l.trim() === tail) return g;
        }
      }
    } catch {
      // JSON نامعتبر → سقوط امن
    }
  }
  return null;
}

/**
 * تبدیل units JSON خام به گزینه‌های واحد امن برای UI:
 *  - units[0] همیشه واحد مبنا (serving) است: label = servingSize، grams = وزن مبنا
 *  - اگر وزن مبنا معتبر باشد (از DB یا استخراج دفاعی از متن servingSize/units)،
 *    واحد «گرم» هم اضافه می‌شود (ضریب وزنی دقیق)
 *  - سپس واحدهای دلخواهِ parse‌شده از JSON اضافه می‌شوند (kind: "unit")
 * دفاعی: JSON نامعتبر / ورودی‌های خراب بی‌صدا رد می‌شوند — هیچ‌وقت crash نمی‌کند.
 */
export function parseFoodUnits(
  unitsJson: string | null | undefined,
  servingSize: string,
  servingGrams: number | null | undefined
): ParsedFoodUnits {
  // v254 — ردیف‌های قدیمی بدون servingGrams: وزن مبنا از متن servingSize/units استخراج می‌شود
  const sg = validGrams(servingGrams) ? servingGrams : deriveBaseGrams(servingSize, unitsJson);
  const units: FoodUnitOption[] = [
    { label: (servingSize || "").trim() || "۱ وعده", grams: sg, kind: "serving" },
  ];
  if (sg !== null) units.push({ label: "گرم", grams: 1, kind: "gram" });
  if (unitsJson && unitsJson.trim()) {
    try {
      const raw: unknown = JSON.parse(unitsJson);
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (!entry || typeof entry !== "object") continue;
          const label = (entry as { label?: unknown }).label;
          const grams = (entry as { grams?: unknown }).grams;
          // label باید رشتهٔ غیرخالی و grams عدد مثبت متناهی باشد
          if (typeof label !== "string" || !label.trim()) continue;
          if (!validGrams(grams)) continue;
          units.push({ label: label.trim(), grams, kind: "unit" });
        }
      }
    } catch {
      // JSON نامعتبر → فقط واحدهای پایه (مبنا + گرم)
    }
  }
  return { units, servingGrams: sg };
}

/**
 * ضریب تبدیل «مقدار × واحد» به تعداد وعدهٔ مبنا — ماکروی نهایی = ماکروی مبنا × factor:
 *  - kind "serving": خودِ مقدار ضریب است (رفتار قدیمی «تعداد وعده (ضریب)»)
 *  - kind "gram":    مقدارِ گرم ÷ وزن وعدهٔ مبنا (۲۰۰ گرم روی پایهٔ «۱۰۰ گرم» → ۲)
 *  - kind "unit":    (مقدار × وزن واحد) ÷ وزن وعدهٔ مبنا (۲ لیوان ۲۴۰گ روی پایهٔ ۲۴۰گ → ۲)
 * وزن مبنا از servingGrams یا استخراج دفاعی (متن servingSize / تطبیق units) می‌آید؛
 * اگر حتی با استخراج هم نامعلوم بماند → سقوط امن: factor = qty
 * (واحد گرم اصلاً تولید نمی‌شود و واحدهای دلخواه مثل ضریب رفتار می‌کنند — «۱ وعده»→«۲ وعده»).
 */
export function computeFoodFactor(
  food: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    servingSize: string;
    units?: string | null;
    servingGrams?: number | null;
  },
  qty: number,
  unitIndex: number
): { factor: number; unitLabel: string } {
  const { units, servingGrams } = parseFoodUnits(
    food.units,
    food.servingSize,
    food.servingGrams
  );
  const unit = unitIndex >= 0 && unitIndex < units.length ? units[unitIndex] : units[0];
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  if (unit.kind === "gram" && servingGrams !== null) {
    const factor = q / servingGrams;
    return { factor: Number.isFinite(factor) && factor > 0 ? factor : q, unitLabel: unit.label };
  }
  if (unit.kind === "unit" && unit.grams !== null && servingGrams !== null) {
    const factor = (q * unit.grams) / servingGrams;
    return { factor: Number.isFinite(factor) && factor > 0 ? factor : q, unitLabel: unit.label };
  }
  // serving — یا سقوط امن وقتی وزن مبنا برای تبدیل موجود نیست
  return { factor: q, unitLabel: unit.label };
}

/**
 * برچسب فارسیِ «مقدار + واحد» برای ذخیره در servingSize لاگ:
 *   formatServingLabel(2, "قاشق غذاخوری")  → «۲ قاشق غذاخوری»
 *   formatServingLabel(1.5, "لیوان")       → «۱.۵ لیوان» (اعشار پشتیبانی می‌شود)
 *   formatServingLabel(0.5, "لیوان")       → «نیم لیوان» (فقط دقیقاً ۰.۵ → «نیم»)
 *   formatServingLabel(200, "گرم")         → «۲۰۰ گرم»
 *
 * واحدهای مبنا در بانک معمولاً خودشان عدد شمارشی دارند («۱ عدد»، «۱ کف دست»):
 *  - «۱ عدد» + qty=۲ → «۲ عدد» (عدد شمارشی «۱» با مقدار کاربر جایگزین می‌شود)
 *  - واحد وزنی خالص («۱۰۰ گرم» به‌عنوان واحد مبنا) + qty=۲ → «۲۰۰ گرم»
 *    (همان خواستهٔ مالک: «۱۰۰ گرم رو بشه ۲۰۰ گرم کرد» — برچسب گرمی با مقدار ضرب می‌شود)
 *  - برچسب عددیِ غیرگرمی → qty=۱ خود برچسب، qty≠۱ «۲×برچسب» (بدون گمراهی)
 *  - برچسب ساده («قاشق غذاخوری»/«وعده») → همیشه «{مقدار} {واحد}» حتی برای qty=۱ («۱ وعده»)
 */
export function formatServingLabel(qty: number, unitLabel: string): string {
  const r = Math.round(qty * 10) / 10;
  const qtyStr = r % 1 === 0 ? String(Math.round(r)) : String(r);
  const label = (unitLabel || "").trim() || "وعده";
  // «۱» شمارشی ابتدای برچسب مبنا → با مقدار کاربر جایگزین می‌شود («۱ عدد» → «۲ عدد»)
  const stripped = label.replace(/^[۱1]\s+/, "").trim();
  // v254 — دقیقاً ۰.۵ → «نیم …» (املای درست نیم به‌جای «۰.۵»؛ بقیهٔ اعشار دهدهی می‌مانند)
  if (r === 0.5) {
    return `نیم ${stripped && stripped !== label ? stripped : label}`;
  }
  if (stripped && stripped !== label) return `${toPersianDigits(qtyStr)} ${stripped}`;
  // v254 — برچسب وزنی خالص («۱۰۰ گرم») → برچسب گرمیِ ضرب‌شده («۲۰۰ گرم»)
  const gramBase = label.match(/^([\d۰-۹٠-٩]+(?:[.,،][\d۰-۹٠-٩]+)?)\s*گرم$/);
  if (gramBase) {
    const base = parseFaNumber(gramBase[1]);
    if (base !== null && base > 0 && qtyStr !== "1") {
      const total = Math.round(base * r * 10) / 10;
      const totalStr = total % 1 === 0 ? String(Math.round(total)) : String(total);
      return `${toPersianDigits(totalStr)} گرم`;
    }
  }
  // برچسب با عدد پایهٔ غیرگرمی → qty=۱ همان برچسب، qty≠۱ با ضریب ×
  if (/^[۰-۹0-9]/.test(label)) {
    return qtyStr === "1" ? label : `${toPersianDigits(qtyStr)}×${label}`;
  }
  return `${toPersianDigits(qtyStr)} ${label}`;
}
