/**
 * v244 — اسکلتون بارگذاری هاب غذاها (دسته‌ها + گرید ~۲۰۰۰ آیتم)
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-64 max-w-full rounded bg-muted animate-pulse" />
        </div>
        {/* جستجو + دسته‌ها */}
        <div className="flex flex-wrap gap-2">
          <div className="h-10 flex-1 min-w-[200px] rounded-xl bg-muted animate-pulse" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 rounded-full bg-muted animate-pulse" />
          ))}
        </div>
        {/* گرید غذاها */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 p-4 space-y-3 bg-card">
              <div className="h-12 w-12 rounded-xl bg-muted animate-pulse" />
              <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
