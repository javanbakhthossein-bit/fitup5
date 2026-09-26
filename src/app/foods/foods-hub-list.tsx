"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, UtensilsCrossed } from "lucide-react";

/**
 * ─── v106 — لیست تعاملی بانک کالری غذاها (/foods) ───
 * داده از سرور (SSR) می‌آید و در HTML اولیه رندر می‌شود — لینک‌های
 * /food/<id> برای خزنده‌ها کاملاً قابل دیدن‌اند؛ جستجو فقط سمت کلاینت
 * روی همین آیتم‌های رندرشده فیلتر می‌کند.
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

const toFa = (n: number) => n.toLocaleString("fa-IR");

export function FoodsHubList({ groups }: { groups: FoodHubGroup[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.name.includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const total = groups.reduce((acc, g) => acc + g.items.length, 0);

  return (
    <div>
      {/* جستجوی ساده — فیلتر روی آیتم‌های رندرشده */}
      <div className="relative mb-6">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
        filtered.map((group) => (
          <section key={group.category} className="mb-8">
            <h2 className="flex items-center gap-2 text-base font-black text-slate-900 mb-3">
              <span className="w-1.5 h-5 rounded-full bg-orange-500" />
              {CATEGORY_LABELS[group.category] || group.category}
              <span className="text-[11px] font-bold text-slate-400">
                {group.items.length} غذا
              </span>
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {group.items.map((item) => (
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
    </div>
  );
}
