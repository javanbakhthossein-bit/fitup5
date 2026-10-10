"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Salad, Search, Flame, ChevronDown, Sparkles, Wheat, Drumstick, Droplet, Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/fitness/types";
import { useAppStore } from "@/lib/fitness/store";

/**
 * ─── v139 — تب ایزولهٔ «بانک غذاها» داخل پنل (دیرکتیو مالک) ───
 *
 * طراحی اختصاصی و ایزوله: هیچ ناوبری به مسیر عمومی انجام نمی‌شود؛
 * همه‌چیز داخل همین تب با سرعت بالا رندر می‌شود و بک مرورگر/اندروید
 * به داشبورد برمی‌گردد (رفتار استاندارد تب‌های پنل).
 *
 * سرعت: کش سشن (ماژول‌سطح) → ورود مجدد به تب بدون هیچ درخواست شبکه‌ای.
 * لیست بلند: رندر دسته‌ای — صفر لگ با ۱۵۲۵ غذا.
 */

interface BankFood {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
}

const CATEGORY_FILTERS = [
  { id: "all", label: "همه" },
  { id: "breakfast", label: "صبحانه" },
  { id: "lunch", label: "ناهار" },
  { id: "dinner", label: "شام" },
  { id: "snack", label: "میان‌وعده" },
];

const CATEGORY_LABELS: Record<string, string> = {
  breakfast: "صبحانه",
  lunch: "ناهار",
  dinner: "شام",
  snack: "میان‌وعده",
};

const CATEGORY_ICONS: Record<string, string> = {
  breakfast: "🌅",
  lunch: "🍛",
  dinner: "🌙",
  snack: "🍎",
};

const CATEGORY_COLORS: Record<string, string> = {
  breakfast: "from-amber-500 to-orange-500",
  lunch: "from-emerald-500 to-teal-500",
  dinner: "from-indigo-500 to-violet-500",
  snack: "from-rose-500 to-pink-500",
};

const PAGE = 60;

// ─── کش سشن (ماژول‌سطح) ───
let DATA_CACHE: BankFood[] | null = null;

export function FoodBankTab() {
  // v190 — CTA خرید پلن: کاربرِ بدون پلن فعال در بالای صفحه دیده می‌شود (دیرکتیو مالک)
  const user = useAppStore((s) => s.user);
  const setMainTab = useAppStore((s) => s.setMainTab);
  // الگوی همان main-app/dashboard: planName/hasActiveSubscription/hasPendingSubscription —
  // تا رفرش اول (user=null) حالت اشتباه نشان ندهد و کاربر پلن‌دار/pending هرگز نبیند
  const showPlanCta =
    !!user && !user.planName && !user.hasActiveSubscription && !user.hasPendingSubscription;
  const [all, setAll] = useState<BankFood[]>(DATA_CACHE ?? []);
  const [loading, setLoading] = useState(!DATA_CACHE);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (DATA_CACHE) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bank/foods");
        const data = await res.json();
        const list = (data.foods ?? []) as BankFood[];
        DATA_CACHE = list;
        if (!cancelled) {
          setAll(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim();
    return all.filter(
      (f) => (category === "all" || f.category === category) && (!q || f.name.includes(q))
    );
  }, [all, search, category]);

  // ریست دسته‌بندی رندر با تغییر فیلتر — الگوی «تنظیم state هنگام رندر»
  // (بدون effect — قاعدهٔ lint: setState همگام در effect رندر آبشاری می‌سازد)
  const [prevFilters, setPrevFilters] = useState({ search: "", category: "all" });
  if (prevFilters.search !== search || prevFilters.category !== category) {
    setPrevFilters({ search, category });
    setVisible(PAGE);
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < filtered.length ? Math.min(v + PAGE, filtered.length) : v));
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // گروه‌بندی نمایشی بر اساس وعده (فقط روی بخش نمایان)
  const shown = filtered.slice(0, visible);
  const grouped = useMemo(() => {
    const map = new Map<string, BankFood[]>();
    for (const f of shown) {
      const c = CATEGORY_LABELS[f.category] ? f.category : "snack";
      let g = map.get(c);
      if (!g) {
        g = [];
        map.set(c, g);
      }
      g.push(f);
    }
    return Array.from(map.entries());
  }, [shown]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
      {/* v190 — CTA خرید پلن — فقط برای کاربر بدون پلن فعال؛ بالای صفحه (دیرکتیو مالک).
          ناوبری با همان مکانیزم همهٔ دکمه‌های خرید پنل: setMainTab("plans") */}
      {showPlanCta && (
        <div
          className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg shadow-emerald-200/50 mb-4"
          style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
        >
          <div className="absolute -left-6 -top-6 w-24 h-24 rounded-full bg-white/10" aria-hidden />
          <div className="absolute -right-4 -bottom-8 w-20 h-20 rounded-full bg-black/10" aria-hidden />
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 text-white" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-black text-sm sm:text-base leading-snug">برنامهٔ اختصاصی خودت را بگیر</h2>
              <p className="text-[11px] sm:text-xs text-white/85 mt-0.5 leading-snug">
                برنامهٔ تمرینی و غذایی شخصی‌سازی‌شده با هوش مصنوعی فیتاپ
              </p>
            </div>
            <button
              onClick={() => setMainTab("plans")}
              className="shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-xl bg-white text-emerald-600 font-black text-xs sm:text-sm hover:bg-white/90 active:scale-[0.98] transition"
            >
              خرید پلن
            </button>
          </div>
        </div>
      )}

      {/* هدر برند */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-emerald-600 via-emerald-500 to-teal-500 p-5 sm:p-7 text-white shadow-lg shadow-emerald-200/50 mb-5">
        <div className="absolute -left-8 -top-8 w-36 h-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 -bottom-12 w-44 h-44 rounded-full bg-black/10" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shadow-inner">
            <Salad className="w-7 h-7" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black tracking-tight">بانک غذاها</h1>
            <p className="text-xs sm:text-sm text-emerald-50/90 mt-0.5">
              {/* v190 — جملهٔ «مال همهٔ کاربران فیتاپ» حذف شد (دیرکتیو مالک) */}
              {loading ? "در حال بارگذاری…" : `${toPersianDigits(all.length)} غذا با کالری و درشت‌مغذی`}
            </p>
          </div>
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 ms-auto text-emerald-100 animate-pulse hidden sm:block" aria-hidden />
        </div>
      </div>

      {/* جستجو + فیلتر */}
      <div className="sticky top-14 sm:top-[4.25rem] z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-2.5 bg-white sm:bg-white/85 sm:backdrop-blur-md rounded-b-2xl">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی غذا… (مثلاً برنج، مرغ، ماست)"
            className="pr-10 rounded-xl border-2 h-11"
            aria-label="جستجوی غذا"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2 pb-0.5" role="group" aria-label="فیلتر وعده">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-bold transition-all duration-150 border ${
                category === c.id
                  ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200"
                  : "bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-600"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && (
        <p className="text-xs text-slate-500 mt-3" role="status">
          {filtered.length === all.length
            ? `همهٔ ${toPersianDigits(all.length)} غذا`
            : `${toPersianDigits(filtered.length)} نتیجه`}
        </p>
      )}

      {/* لیست گروهی */}
      {loading ? (
        <div className="space-y-2 mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Salad className="w-12 h-12 mx-auto text-slate-300 mb-3" aria-hidden />
          <p className="text-slate-500 font-bold">غذایی پیدا نشد</p>
          <p className="text-xs text-slate-400 mt-1">عبارت دیگری را جستجو کن یا فیلتر را عوض کن</p>
        </div>
      ) : (
        <div className="mt-3 space-y-5">
          {grouped.map(([cat, foods]) => (
            <section key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.snack} text-white flex items-center justify-center text-sm shadow-sm`}>
                  {CATEGORY_ICONS[cat] ?? "🍽️"}
                </span>
                <h2 className="font-black text-sm text-slate-700">{CATEGORY_LABELS[cat] ?? cat}</h2>
                <span className="text-[10px] font-bold text-slate-400">{toPersianDigits(foods.length)} غذا</span>
              </div>
              <div className="space-y-1.5">
                {foods.map((f) => {
                  const isOpen = expanded.has(f.id);
                  return (
                    <div
                      key={f.id}
                      className="rounded-2xl border-2 border-slate-100 bg-white overflow-hidden hover:border-emerald-200 transition-colors duration-150"
                    >
                      <button
                        onClick={() => toggle(f.id)}
                        className="w-full flex items-center gap-3 p-3 text-right"
                        aria-expanded={isOpen}
                      >
                        <div className="shrink-0 w-14 text-center">
                          <div className="text-lg font-black text-emerald-600 leading-none flex items-center justify-center gap-0.5">
                            <Flame className="w-3.5 h-3.5 text-orange-500" aria-hidden />
                            {toPersianDigits(f.calories)}
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5">کیلوکالری</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-black text-sm text-slate-800 leading-snug">{f.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{f.servingSize}</div>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-slate-50 bg-slate-50/60">
                          <div className="grid grid-cols-3 gap-2 mt-1.5">
                            <MacroPill icon={<Drumstick className="w-3.5 h-3.5" />} label="پروتئین" value={f.protein} color="text-rose-600 bg-rose-50" />
                            <MacroPill icon={<Wheat className="w-3.5 h-3.5" />} label="کربوهیدرات" value={f.carbs} color="text-amber-600 bg-amber-50" />
                            <MacroPill icon={<Droplet className="w-3.5 h-3.5" />} label="چربی" value={f.fat} color="text-sky-600 bg-sky-50" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-2" aria-hidden />
      {visible < filtered.length && (
        <div className="text-center mt-4">
          <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)} className="rounded-full font-bold">
            نمایش بیشتر ({toPersianDigits(filtered.length - visible)} غذای باقی مانده)
            <ChevronDown className="w-4 h-4 ms-1" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function MacroPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`rounded-xl px-2.5 py-2 text-center ${color}`}>
      <div className="flex items-center justify-center gap-1 opacity-70">{icon}</div>
      <div className="text-sm font-black mt-0.5">{toPersianDigits(Math.round(value))} گرم</div>
      <div className="text-[9px] opacity-70">{label}</div>
    </div>
  );
}
