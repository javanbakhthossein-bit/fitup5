"use client";

import { useEffect } from "react";
import { installPullToRefresh } from "@/lib/fitness/pull-to-refresh";

/**
 * v153 — نصب pull-to-refresh سفارشی («فقط یک‌چهارم بالای صفحه») روی همهٔ
 * صفحات — در layout ریشه سوار می‌شود تا صفحات SSR (مقالات/tdee/حرکات) هم
 * همان رفتار یکدست را داشته باشند.
 */
export function PullToRefreshInstaller() {
  useEffect(() => {
    installPullToRefresh();
  }, []);
  return null;
}
