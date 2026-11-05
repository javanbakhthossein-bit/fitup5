"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, UtensilsCrossed, ChevronDown } from "lucide-react";

/**
 * ─── v106 — لیست تعاملی بانک کالری غذاها (/foods) ───
 * داده از سرور (SSR) می‌آید و در HTML اولیه رندر می‌شود — لینک‌های
 * /food/<id> برای خزنده‌ها کاملاً قابل دیدن‌اند؛ جستجو فقط سمت کلاینت
 * روی همین آیتم‌های رندرشده فیلتر می‌کند.
 *
 * v249-dom-fix (ممیزی سئو مالک: «DOM صفحه بزرگ است — ۶٬۶۲۴ عنصر»):
 * ریشه — رندر SSR همهٔ ۱۵۰۰+ غذا. درمان — رندر دسته‌ای: اولین دسته در
 * SSR (لینک‌های مهم + سایت‌مپ همهٔ /food/<id> را پوشش می‌دهد) و بقیه با
 * دکمهٔ «نمایش غذاهای بیشتر» — DOM اولیه ~۹۵٪ سبک‌تر.
 */

export interface FoodHubItem {
  id: string;
  name: string;
  calories: number;
  category: string;
}

export interface FoodHubGroup {
  category: string;
  items: FoodHubItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  breakfast: "صبحانه",
  lunch: "ناهار",
  dinner: "شام",
  snack: "میان‌وعده",
};

// v149 — فیکس ریشه‌ای React #418 (mismatch متن) در /foods:
// این کامپوننت client است ولی SSR هم می‌شود (HTML اولیهٔ بانک غذاها).
// قبلاً toLocaleString("fa-IR") در Node (ICU کامل) و مرورگرهای موبایل
// (ICU ناقص — WebViewهای قدیمی‌تر اندروید/سافاری) خروجی «یکسان» تولید
// نمی‌کرد → ارور «Hydration failed … text content does not match» برای
// ~۱۰۰۰ آیتم غذا. حالا تبدیل ارقام کاملاً قطعی (pure JS) است — سرور و
// کلاینت همیشه خروجی یکسان دارند.
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toFa = (n: number) =>
  n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);

// v249-dom-fix — اندازهٔ دستهٔ اولیه و گام بعدی
const INITIAL_FOODS = 60;
const NEXT_FOODS = 60;

export function FoodsHubList({ groups }: { groups: FoodHubGroup[] }) {
  const [query, setQuery] = useState("");
  // v249-dom-fix — بودجهٔ رندر آیتم‌ها (دسته‌ای) — با تغییر جستجو ریست
  const [limit, setLimit] = useState(INITIAL_FOODS);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.name.includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const total = groups.reduce((acc, g) => acc + g.items.length, 0);
  const filteredTotal = filtered.reduce((acc, g) => acc + g.items.length, 0);

  // v249-dom-fix — توزیع بودجهٔ رندر روی گروه‌ها (بدون شکستن گروه‌بندی وعده‌ها)
  const visibleGroups: { group: FoodHubGroup; slice: FoodHubItem[] }[] = [];
  let shown = 0;
  for (const group of filtered) {
    if (shown >= limit) break;
    const slice = group.items.slice(0, limit - shown);
    shown += slice.length;
    visibleGroups.push({ group, slice });
  }
  const remaining = filteredTotal - shown;

  return (
    <div>
      {/* جستجوی ساده — فیلتر روی آیتم‌های رندرشده */}
      <div className="relative mb-6">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(INITIAL_FOODS); // v249-dom-fix — ریست دسته با تغییر جستجو
          }}
          placeholder={`جستجو در ${total} غذا...`}
          aria-label="جستجوی غذا"
          className="w-full h-11 pr-10 pl-4 rounded-xl border-2 border-slate-200 focus:border-orange-300 outline-none text-sm text-slate-800 bg-white transition"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-14">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <UtensilsCrossed className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-500 text-sm">غذایی با این نام پیدا نشد</p>
        </div>
      ) : (
        visibleGroups.map(({ group, slice }) => (
          <section key={group.category} className="mb-8">
            <h2 className="flex items-center gap-2 text-base font-black text-slate-900 mb-3">
              <span className="w-1.5 h-5 rounded-full bg-orange-500" />
              {CATEGORY_LABELS[group.category] || group.category}
              <span className="text-[11px] font-bold text-slate-400">
                {/* v249-dom-fix — اگر گروه بریده شد، تعداد واقعی همان‌جا اعلام می‌شود */}
                {slice.length < group.items.length
                  ? `${toFa(slice.length)} از ${toFa(group.items.length)} غذا`
                  : `${toFa(group.items.length)} غذا`}
              </span>
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {slice.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/food/${encodeURIComponent(item.id)}`}
                    prefetch={false} /* v137: با ۱۵۰۰+ لینک، prefetch = لگ جدی — غیرفعال */
                    className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 bg-white hover:border-orange-300 hover:shadow-md transition group"
                  >
                    <span className="text-sm font-bold text-slate-800 group-hover:text-orange-600 transition truncate">
                      {item.name}
                    </span>
                    <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-bold">
                      {toFa(item.calories)} کالری
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* v249-dom-fix — دکمهٔ نمایش دستهٔ بعدی */}
      {remaining > 0 && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setLimit((c) => c + NEXT_FOODS)}
            className="inline-flex items-center gap-2 min-h-[48px] px-6 rounded-2xl text-sm font-black text-orange-700 bg-orange-50 border-2 border-orange-200 hover:bg-orange-100 hover:border-orange-300 transition"
          >
            <ChevronDown className="w-4 h-4" />
            نمایش {toFa(Math.min(NEXT_FOODS, remaining))} غذای بیشتر
            <span className="text-xs font-bold text-slate-400">({toFa(remaining)} غذای دیگر)</span>
          </button>
        </div>
      )}
    </div>
  );
}
