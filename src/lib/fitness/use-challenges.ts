"use client";

/**
 * v183 — هوک مشترک چالش‌ها (داشبورد + صفحهٔ چالش‌ها + جزئیات + جلسه)
 *
 * • جنسیت از سرور → فقط دیتای همان جنسیت dynamic-import می‌شود
 *   (آقایان فقط ۱۷ چالش آقایان، خانم‌ها فقط ۱۷ چالش خانم‌ها — دیرکتیو مالک)
 * • پیشرفت‌ها کش ماژول‌سطح — جابجایی بین تب‌ها دوباره fetch نمی‌زند
 * • mutation ها (start / complete-day) هم استور محلی و هم DB را آپدیت می‌کنند
 */
import { useCallback, useEffect, useState } from "react";
import type { ChallengeDef, ChallengeProgressDto } from "./challenges-data";

export type ChallengesBundle = {
  gender: "men" | "women";
  challenges: ChallengeDef[];
};

const CACHE_TTL_MS = 60_000;

let cache: { bundle: ChallengesBundle; progress: Record<string, ChallengeProgressDto>; at: number } | null = null;
let inflight: Promise<{ bundle: ChallengesBundle; progress: Record<string, ChallengeProgressDto> }> | null = null;

async function loadBundle(gender: "men" | "women"): Promise<ChallengeDef[]> {
  if (gender === "men") {
    const m = await import("./challenges-data-men");
    return m.CHALLENGES_MEN;
  }
  const w = await import("./challenges-data-women");
  return w.CHALLENGES_WOMEN;
}

async function fetchAll(): Promise<{ bundle: ChallengesBundle; progress: Record<string, ChallengeProgressDto> }> {
  const res = await fetch("/api/challenges", { cache: "no-store" });
  if (!res.ok) throw new Error("خطا در دریافت چالش‌ها");
  const data = await res.json();
  const gender: "men" | "women" = data.gender === "female" ? "women" : "men";
  const challenges = await loadBundle(gender);
  const progress: Record<string, ChallengeProgressDto> = {};
  for (const p of (data.progress ?? []) as ChallengeProgressDto[]) progress[p.slug] = p;
  return { bundle: { gender, challenges }, progress };
}

export function invalidateChallengesCache() {
  cache = null;
  inflight = null;
}

export function useChallenges() {
  const [bundle, setBundle] = useState<ChallengesBundle | null>(cache?.bundle ?? null);
  const [progress, setProgress] = useState<Record<string, ChallengeProgressDto>>(cache?.progress ?? {});
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && cache) {
      setBundle(cache.bundle);
      setProgress(cache.progress);
      setLoading(false);
      return;
    }
    if (inflight) {
      try {
        const r = await inflight;
        setBundle(r.bundle);
        setProgress(r.progress);
        setLoading(false);
      } catch {}
      return;
    }
    setLoading(true);
    setError(null);
    inflight = fetchAll();
    try {
      const r = await inflight;
      cache = { ...r, at: Date.now() };
      setBundle(r.bundle);
      setProgress(r.progress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
      inflight = null;
    }
  }, []);

  useEffect(() => {
    // TTL — اگر کش تازه است، fetch نزن
    if (cache && Date.now() - cache.at > CACHE_TTL_MS) {
      cache = null;
    }
    void load();
  }, [load]);

  /** شروع چالش */
  const startChallenge = useCallback(async (slug: string) => {
    setProgress((p) => ({
      ...p,
      [slug]: p[slug] ?? { slug, completedDays: [], currentDay: 1, startedAt: new Date().toISOString(), lastCompletedAt: null, completedAt: null },
    }));
    try {
      const res = await fetch("/api/challenges/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action: "start" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.progress) setProgress((p) => ({ ...p, [slug]: data.progress }));
        if (cache) cache.progress = { ...cache.progress, [slug]: data.progress };
      }
    } catch {
      // آفلاین — پیشرفت محلی می‌ماند؛ دفعهٔ بعد سینک می‌شود
    }
  }, []);

  /** تکمیل روز N — خروجی: آیا چالش با همین ثبت کامل شد؟ */
  const completeDay = useCallback(async (slug: string, day: number): Promise<{ justCompleted: boolean }> => {
    // به‌روزرسانی خوش‌بینانهٔ محلی
    let optimisticJustCompleted = false;
    setProgress((p) => {
      const cur = p[slug] ?? { slug, completedDays: [], currentDay: 1, startedAt: new Date().toISOString(), lastCompletedAt: null, completedAt: null };
      const days = cur.completedDays.includes(day) ? cur.completedDays : [...cur.completedDays, day];
      optimisticJustCompleted = !cur.completedAt && days.length >= 0 ? false : false; // از پاسخ سرور تصمیم می‌گیریم
      return {
        ...p,
        [slug]: {
          ...cur,
          completedDays: days,
          currentDay: Math.max(cur.currentDay, day + 1),
          lastCompletedAt: new Date().toISOString(),
        },
      };
    });
    try {
      const res = await fetch("/api/challenges/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action: "complete-day", day }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.progress) {
          setProgress((p) => ({ ...p, [slug]: data.progress }));
          if (cache) cache.progress = { ...cache.progress, [slug]: data.progress };
          return { justCompleted: !!data.justCompleted };
        }
      }
    } catch {
      // آفلاین — محلی می‌ماند
    }
    return { justCompleted: false };
  }, []);

  /** ریست چالش */
  const resetChallenge = useCallback(async (slug: string) => {
    setProgress((p) => {
      const next = { ...p };
      delete next[slug];
      return next;
    });
    try {
      await fetch("/api/challenges/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action: "reset" }),
      });
      if (cache) {
        const pc = { ...cache.progress };
        delete pc[slug];
        cache.progress = pc;
      }
    } catch {}
  }, []);

  return { bundle, progress, loading, error, reload: () => load(true), startChallenge, completeDay, resetChallenge };
}
