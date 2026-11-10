"use client";

/**
 * v252 — آواتار نویسنده (درخواست مالک): پرترهٔ واقعی حسین جوان از همان مسیر
 * رسمی صفحهٔ درباره‌ما (/images/hossein-javan.webp). سایر نویسنده‌ها مونوگرام.
 * فال‌بک ایمن: اگر عکس به هر دلیل (۴۰۴/شبکه) لود نشد، مونوگرام حرفه‌ای با
 * گرادیان برند نمایش داده می‌شود — صفحه هرگز با باگ ظاهری نمی‌ماند.
 * (کامپوننت کلاینتی سبک — فقط یک استیت onError)
 */

import { useState } from "react";

export function AuthorAvatar({ name }: { name: string }) {
  const isFounder = name === "حسین جوان";
  const [imgFailed, setImgFailed] = useState(false);
  if (isFounder && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/images/hossein-javan.webp"
        alt="حسین جوان — بنیان‌گذار فیتاپ"
        width={80}
        height={80}
        loading="eager"
        decoding="async"
        onError={() => setImgFailed(true)}
        className="w-20 h-20 rounded-full shrink-0 object-cover shadow-md ring-2 ring-white bg-orange-50"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="w-20 h-20 rounded-full shrink-0 flex items-center justify-center text-white font-black text-3xl shadow-md"
      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
    >
      {name.charAt(0) || "ف"}
    </div>
  );
}
