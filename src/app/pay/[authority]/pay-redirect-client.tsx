"use client";

/**
 * v173 — کلاینت صفحهٔ میانی پرداخت /pay/{authority}
 *
 * بلافاصله (۶۰۰ms بعد از رندر) با location.replace به StartPay می‌رود:
 *   - replace به‌جای href → دکمهٔ back کاربر به صفحهٔ میانی برنمی‌گردد
 *     (بدون حلقهٔ back) و به صفحهٔ قبل از پرداخت برمی‌گردد.
 *   - Referer این ناوبری = دامنهٔ خودمان (fittup.ir) → زرین‌پال قبول می‌کند.
 * دکمهٔ دستی هم همیشه دیده می‌شود تا اگر JS/انتقال خودکار در مرورگر خاصی
 * مسدود شد، کاربر با یک کلیک به درگاه برسد (لینک ساده بدون rel=noreferrer
 * تا Referer حتماً ارسال شود).
 */

import { useEffect, useRef, useState } from "react";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

export default function PayRedirectClient({ target }: { target: string }) {
  const [leaving, setLeaving] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const t = setTimeout(() => {
      setLeaving(true);
      window.location.replace(target);
    }, 600);
    return () => clearTimeout(t);
  }, [target]);

  return (
    <div className="flex w-full max-w-md flex-col items-center rounded-2xl border bg-card p-6 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        {leaving ? (
          <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard className="h-7 w-7" aria-hidden="true" />
        )}
      </div>

      <h1 className="mb-2 text-lg font-bold text-foreground">
        {leaving ? "در حال اتصال به درگاه پرداخت…" : "در حال انتقال به درگاه پرداخت…"}
      </h1>
      <p className="mb-6 text-sm leading-6 text-muted-foreground">
        لطفاً چند لحظه صبر کنید؛ به صورت خودکار به درگاه امن پرداخت زرین‌پال
        می‌روید.
      </p>

      <a
        href={target}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
      >
        <CreditCard className="h-5 w-5" aria-hidden="true" />
        رفتن به درگاه پرداخت
      </a>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-green-600" aria-hidden="true" />
        پرداخت شما با درگاه امن زرین‌پال انجام می‌شود
      </p>
    </div>
  );
}
