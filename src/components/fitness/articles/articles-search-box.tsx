"use client";

/**
 * articles-search-box.tsx — v119
 *
 * جستجوی مقالات روی لیست SSR (/articles) — پورت قابلیت جستجوی نسخهٔ SPA.
 * نتیجه سمت سرور و قابل بوکمارک است: /articles?search=<عبارت>
 * (بارگذاری کامل صفحه — بدون اسکرین SPA؛ همان الگوی تک‌نسخه‌سازی v113/v118)
 */

import { useState } from "react";
import { Search } from "lucide-react";

export function ArticlesSearchBox({ initial = "" }: { initial?: string }) {
  const [q, setQ] = useState(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) {
      window.location.assign(`/articles?search=${encodeURIComponent(term)}`);
    } else {
      window.location.assign("/articles");
    }
  }

  return (
    <form onSubmit={submit} className="relative mb-6" role="search" aria-label="جستجوی مقالات">
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جستجو در مقالات فیتاپ..."
        aria-label="جستجوی مقالات"
        className="w-full h-11 pr-10 pl-4 rounded-xl border-2 border-slate-200 focus:border-orange-300 outline-none text-sm text-slate-800 bg-white transition"
      />
    </form>
  );
}
