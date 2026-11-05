/**
 * v244 — اسکلتون بارگذاری ماشین‌حساب TDEE
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-56 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-80 max-w-full rounded bg-muted animate-pulse" />
        </div>
        {/* فرم ورودی‌ها */}
        <div className="rounded-2xl border border-border/60 p-6 space-y-4 bg-card">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
              <div className="h-11 w-full rounded-xl bg-muted animate-pulse" />
            </div>
          ))}
          <div className="h-12 w-full rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}
