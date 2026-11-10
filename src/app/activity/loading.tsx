/**
 * v244 — اسکلتون بارگذاری صفحهٔ فعالیت‌ها
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
        {/* تب‌ها */}
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-28 rounded-full bg-muted animate-pulse" />
          ))}
        </div>
        {/* کارت‌های جلسه */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 p-4 flex items-center gap-4 bg-card">
              <div className="h-12 w-12 rounded-xl bg-muted animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-6 w-16 rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
