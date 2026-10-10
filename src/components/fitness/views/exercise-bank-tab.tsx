"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dumbbell, Search, ChevronDown, Sparkles, Video, Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { exerciseMatchesSearch } from "@/lib/fitness/exercise-search";
import { toPersianDigits } from "@/lib/fitness/types";
import { useAppStore } from "@/lib/fitness/store";

/**
 * ─── v139 — تب ایزولهٔ «بانک حرکات» داخل پنل (دیرکتیو مالک) ───
 *
 * طراحی اختصاصی و ایزوله: هیچ ناوبری به مسیر عمومی انجام نمی‌شود؛
 * همه‌چیز داخل همین تب با سرعت بالا رندر می‌شود و بک مرورگر/اندروید
 * به داشبورد برمی‌گردد (رفتار استاندارد تب‌های پنل).
 *
 * سرعت: کش سشن (ماژول‌سطح) → ورود مجدد به تب بدون هیچ درخواست شبکه‌ای.
 * لیست بلند: رندر دسته‌ای (۳۶ تا در هر دسته) — صفر لگ با ۵۸۱ حرکت.
 */

interface BankExercise {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  hasVideo: boolean;
  /** v191 — لایهٔ ویدیو: ۰=اختصاصی، ۱=ماسل‌ویکی، ۲=یوتیوب، ۳=بدون (از API) */
  videoTier?: 0 | 1 | 2 | 3;
}

// ─── کش سشن (ماژول‌سطح) — ورود مجدد به تب = رندر لحظه‌ای بدون شبکه ───
let DATA_CACHE: BankExercise[] | null = null;

const MUSCLE_FILTERS = [
  { id: "all", label: "همه عضلات" },
  { id: "سینه", label: "سینه" },
  { id: "سرشانه", label: "سرشانه" },
  { id: "بازو", label: "بازو" },
  { id: "شکم", label: "شکم" },
  { id: "کمر و پشت", label: "کمر و پشت" },
  { id: "جلو ران", label: "جلو ران" },
  { id: "پشت ران", label: "پشت ران" },
  { id: "سینه و دست", label: "سینه و دست" },
];

const EQUIPMENT_FILTERS = [
  { id: "all", label: "همه تجهیزات" },
  { id: "dumbbell", label: "دمبل" },
  { id: "barbell", label: "هالتر" },
  { id: "machine", label: "دستگاه" },
  { id: "bodyweight", label: "وزن بدن" },
];

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};
const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-emerald-100 text-emerald-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-700",
};

const PAGE = 36;

export function ExerciseBankTab() {
  const setExerciseDetailId = useAppStore((s) => s.setExerciseDetailId);
  const setOverlay = useAppStore((s) => s.setOverlay);
  // v190 — CTA خرید پلن: کاربرِ بدون پلن فعال در بالای صفحه دیده می‌شود (دیرکتیو مالک)
  const user = useAppStore((s) => s.user);
  const setMainTab = useAppStore((s) => s.setMainTab);
  // الگوی همان main-app/dashboard: planName/hasActiveSubscription/hasPendingSubscription —
  // تا رفرش اول (user=null) حالت اشتباه نشان ندهد و کاربر پلن‌دار/pending هرگز نبیند
  const showPlanCta =
    !!user && !user.planName && !user.hasActiveSubscription && !user.hasPendingSubscription;
  const [all, setAll] = useState<BankExercise[]>(DATA_CACHE ?? []);
  const [loading, setLoading] = useState(!DATA_CACHE);
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // ─── لود داده (با کش سشن) ───
  useEffect(() => {
    if (DATA_CACHE) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bank/exercises");
        const data = await res.json();
        const list = (data.exercises ?? []) as BankExercise[];
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
    const baseOk = (ex: BankExercise) => {
      if (muscle !== "all" && ex.muscle !== muscle) return false;
      if (equipment !== "all" && !ex.equipment.includes(equipment)) return false;
      return true;
    };
    let list = all.filter((ex) => baseOk(ex) && (!q || exerciseMatchesSearch(ex, q)));
    if (q && list.length === 0) {
      const stripped = q.replace(/\s+با\s+\S+\s*$/u, "").trim();
      if (stripped && stripped !== q) {
        list = all.filter((ex) => baseOk(ex) && exerciseMatchesSearch(ex, stripped));
      }
    }
    // v191 — مرتب‌سازی اولویت ویدیو (دیرکتیو مالک): اختصاصی > ماسل‌ویکی > یوتیوب > بدون ویدیو
    // (API هم مرتب‌شده می‌فرستد؛ اینجا محکم‌کاری برای فیلتر/کش قدیمی)
    const tierOf = (ex: BankExercise) => ex.videoTier ?? (ex.hasVideo ? 1 : 3);
    list = [...list].sort((a, b) => {
      const ta = tierOf(a);
      const tb = tierOf(b);
      if (ta !== tb) return ta - tb;
      return (a.name ?? "").localeCompare(b.name ?? "", "fa");
    });
    return list;
  }, [all, search, muscle, equipment]);

  // ریست دسته‌بندی رندر با تغییر فیلتر — الگوی «تنظیم state هنگام رندر»
  // (بدون effect — قاعدهٔ lint: setState همگام در effect رندر آبشاری می‌سازد)
  const [prevFilters, setPrevFilters] = useState({ search: "", muscle: "all", equipment: "all" });
  if (prevFilters.search !== search || prevFilters.muscle !== muscle || prevFilters.equipment !== equipment) {
    setPrevFilters({ search, muscle, equipment });
    setVisible(PAGE);
  }

  // IntersectionObserver — «نمایش بیشتر» خودکار بدون کلیک (نرم و بدون لگ)
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

  /** بازکردن جزئیات — از طریق اورلی استور (بک فقط اورلی را می‌بندد) */
  function openDetail(id: string) {
    setExerciseDetailId(id);
    setOverlay("exerciseBankDetail");
  }

  const videoCount = useMemo(() => all.filter((e) => e.hasVideo).length, [all]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
      {/* v190 — CTA خرید پلن — فقط برای کاربر بدون پلن فعال؛ بالای صفحه (دیرکتیو مالک).
          ناوبری با همان مکانیزم همهٔ دکمه‌های خرید پنل: setMainTab("plans") */}
      {showPlanCta && (
        <div
          className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg shadow-orange-200/50 mb-4"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
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
              className="shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-xl bg-white text-orange-600 font-black text-xs sm:text-sm hover:bg-white/90 active:scale-[0.98] transition"
            >
              خرید پلن
            </button>
          </div>
        </div>
      )}

      {/* هدر برند */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-orange-600 via-orange-500 to-amber-500 p-5 sm:p-7 text-white shadow-lg shadow-orange-200/50 mb-5">
        <div className="absolute -left-8 -top-8 w-36 h-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 -bottom-12 w-44 h-44 rounded-full bg-black/10" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shadow-inner">
            <Dumbbell className="w-7 h-7" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black tracking-tight">بانک حرکات</h1>
            <p className="text-xs sm:text-sm text-orange-50/90 mt-0.5">
              {/* v190 — جملهٔ «مال همهٔ کاربران فیتاپ» حذف شد (دیرکتیو مالک) */}
              {loading
                ? "در حال بارگذاری…"
                : `${toPersianDigits(all.length)} حرکت آموزشی${videoCount > 0 ? ` • ${toPersianDigits(videoCount)} حرکت با ویدیو` : ""}`}
            </p>
          </div>
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 ms-auto text-amber-200 animate-pulse hidden sm:block" aria-hidden />
        </div>
      </div>

      {/* جستجو + فیلترها */}
      <div className="sticky top-14 sm:top-[4.25rem] z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-2.5 bg-white sm:bg-white/85 sm:backdrop-blur-md rounded-b-2xl">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی حرکات… (مثلاً پرس سینه، اسکات، جلو بازو)"
            className="pr-10 rounded-xl border-2 h-11"
            aria-label="جستجوی حرکات"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2 pb-0.5" role="group" aria-label="فیلتر عضله">
          {MUSCLE_FILTERS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMuscle(m.id)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-bold transition-all duration-150 border ${
                muscle === m.id
                  ? "bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-200"
                  : "bg-white border-slate-200 text-slate-600 hover:border-orange-300 hover:text-orange-600"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-1.5 pb-0.5" role="group" aria-label="فیلتر تجهیزات">
          {EQUIPMENT_FILTERS.map((m) => (
            <button
              key={m.id}
              onClick={() => setEquipment(m.id)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-bold transition-all duration-150 border ${
                equipment === m.id
                  ? "bg-slate-800 border-slate-800 text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* آمار نتیجه */}
      {!loading && (
        <p className="text-xs text-slate-500 mt-3" role="status">
          {filtered.length === all.length
            ? `همهٔ ${toPersianDigits(all.length)} حرکت`
            : `${toPersianDigits(filtered.length)} نتیجه`}
        </p>
      )}

      {/* گرید حرکات — رندر دسته‌ای */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Dumbbell className="w-12 h-12 mx-auto text-slate-300 mb-3" aria-hidden />
          <p className="text-slate-500 font-bold">حرکتی پیدا نشد</p>
          <p className="text-xs text-slate-400 mt-1">عبارت دیگری را جستجو کن یا فیلترها را ساده‌تر کن</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
          {filtered.slice(0, visible).map((ex) => (
            <button
              key={ex.id}
              onClick={() => openDetail(ex.id)}
              className="text-right rounded-2xl border-2 border-slate-100 bg-white p-3.5 hover:border-orange-300 hover:shadow-md hover:shadow-orange-100 transition-all duration-150 active:scale-[0.98]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-black text-sm text-slate-800 leading-snug line-clamp-2">{ex.name}</span>
                {ex.hasVideo && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 rounded-full px-1.5 py-0.5">
                    <Video className="w-3 h-3" aria-hidden /> ویدیو
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{ex.muscle}</span>
                <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${DIFFICULTY_COLORS[ex.difficulty] ?? "bg-slate-100 text-slate-600"}`}>
                  {DIFFICULTY_LABELS[ex.difficulty] ?? ex.difficulty}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* سنتینل برای لود خودکار دستهٔ بعد */}
      <div ref={sentinelRef} className="h-2" aria-hidden />
      {visible < filtered.length && (
        <div className="text-center mt-4">
          <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)} className="rounded-full font-bold">
            نمایش بیشتر ({toPersianDigits(filtered.length - visible)} حرکت باقی مانده)
            <ChevronDown className="w-4 h-4 ms-1" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
