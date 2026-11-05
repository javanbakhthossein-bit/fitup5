/**
 * v244 — اسکلتون بارگذاری بانک حرکات (لیست ~۵۰۰ حرکات + فیلترها)
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-72 max-w-full rounded bg-muted animate-pulse" />
        </div>
        {/* جستجو + فیلترها */}
        <div className="flex flex-wrap gap-2">
          <div className="h-10 flex-1 min-w-[200px] rounded-xl bg-muted animate-pulse" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
        {/* گرید حرکات */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 overflow-hidden bg-card">
              <div className="aspect-[4/3] bg-muted animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
