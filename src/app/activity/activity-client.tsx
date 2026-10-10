"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, Square, Camera, Trash2, X, Loader2,
  Flame, Timer, Gauge, MapPin, Route, ChevronLeft, Trophy, Medal,
  Footprints, Mountain, Sparkles, RefreshCw, Crown, Info, Wallet, Send, LocateFixed,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  ActivityTracker,
  formatClock,
  formatPace,
  type TrackerSnapshot,
} from "@/lib/fitness/activity-engine";
import { toPersianDigits } from "@/lib/fitness/types";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { useAppStore } from "@/lib/fitness/store";
// v179 — دیرکتیو مالک: عکس یادبود پیاده‌روی/دویدن هم «دوربین» دارد هم «گالری» —
// مثل بقیهٔ نقاط آپلود (شیت انتخاب منبع مشترک فیتاپ)
import { useMediaSourcePicker } from "@/components/fitness/media-source-picker";

/**
 * ─── v138 — مسیریاب فیتاپ (کلاینت) ───
 * طراحی گیمیفایکشن با برند نارنجی فیتاپ؛ صفر لگ/فلیکر:
 *  • همهٔ انیمیشن‌ها one-shot (framer-motion initial/animate) — بدون loop
 *  • نقشه lazy (dynamic import leaflet) — فقط وقتی لازم است
 *  • تیک ردیابی از timestamp واقعی — بدون drift
 */

// ───────────────────────────── انواع ─────────────────────────────

interface SessionDto {
  id: string;
  activityType: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  movingSec: number;
  distanceM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  paceSecPerKm: number;
  calories: number;
  steps: number;
  elevationGainM: number;
  pointsCount: number;
  photoUrl: string | null;
  note: string | null;
}

interface MeDto {
  id: string;
  name: string | null;
  planName: string | null;
  hasActiveSubscription: boolean;
}

type Screen = "boot" | "guest" | "home" | "gps" | "countdown" | "tracking" | "finish" | "saved";

const TYPE_META: Record<string, { label: string; emoji: string; color: string }> = {
  walk: { label: "پیاده‌روی", emoji: "🚶", color: "#10b981" },
  jog: { label: "دویدن سبک", emoji: "🏃", color: "#f59e0b" },
  run: { label: "دویدن", emoji: "⚡", color: "#f97316" },
  unknown: { label: "فعالیت", emoji: "👟", color: "#64748b" },
};

const fa = (v: string | number): string => toPersianDigits(v);
const kmFmt = (m: number): string => {
  const km = m / 1000;
  return km >= 100 ? fa(Math.round(km)) : fa(Number(km.toFixed(2)));
};
const dateFa = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran",  month: "long", day: "numeric" });
  } catch {
    return "";
  }
};
const timeFa = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran",  hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};
const weekdayFa = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran",  weekday: "long" });
  } catch {
    return "";
  }
};

// ───────────────────────────── نقشهٔ مسیر (lazy leaflet) ─────────────────────────────

function RouteMap({
  points,
  liveLast,
  liveAccuracy,
  heightClass,
  interactive = true,
}: {
  points: number[][]; // [lat, lng]
  liveLast?: { lat: number; lng: number } | null;
  liveAccuracy?: number;
  heightClass: string;
  interactive?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ map: any; L: any } | null>(null);
  const lineRef = useRef<any>(null);
  const caseRef = useRef<any>(null);
  const liveRef = useRef<any>(null);
  const accRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  // ─── v191 — حالت دنبال‌کردن زنده: موقعیت کاربر همیشه وسط نقشه ───
  // با درگ دستی (یک یا دو انگشتی) موقتاً خاموش می‌شود و با دکمه «موقعیت من» برمی‌گردد.
  // زوم دو‌انگشتی حالت دنبال‌کردن را حفظ می‌کند (بعد از زوم دوباره مرکز = کاربر).
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const liveLastRef = useRef<{ lat: number; lng: number } | null>(liveLast ?? null);
  const recenterRef = useRef<(() => void) | null>(null);

  // init یک‌بار
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod as any).default ?? mod;
      if (cancelled || !boxRef.current || mapRef.current) return;
      const map = L.map(boxRef.current, {
        zoomControl: false,
        scrollWheelZoom: interactive,
        dragging: interactive,
        touchZoom: interactive,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      map.setView([35.6892, 51.389], 12); // تهران — تا رسیدن نقاط
      // درگ دستی = توقف دنبال‌کردن (زوم دو‌انگشتی درگ نیست و دنبال‌کردن ادامه می‌یابد)
      map.on("dragstart", () => {
        followRef.current = false;
        setFollowing(false);
      });
      map.on("zoomend", () => {
        // بعد از زوم (حتی دو‌انگشتی) اگر دنبال‌کردن فعال است، کاربر را دوباره مرکز کن
        if (followRef.current && liveLastRef.current) {
          try {
            map.setView([liveLastRef.current.lat, liveLastRef.current.lng], map.getZoom(), { animate: true });
          } catch {}
        }
      });
      mapRef.current = { map, L };
      setReady(true);
    })();
    return () => {
      cancelled = true;
      try {
        mapRef.current?.map.remove();
      } catch {}
      mapRef.current = null;
      lineRef.current = null;
      caseRef.current = null;
      liveRef.current = null;
      accRef.current = null;
      fittedRef.current = false;
      followRef.current = true;
      liveLastRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // به‌روزرسانی مسیر
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || !ready) return;
    const { map, L } = ctx;
    // 🩹 v198 — فیکس کرش «Cannot read properties of undefined (reading '0')» در
    // _projectLatlngs (لاگ واقعی کاربر اپ بازار): نقاط نامعتبر (undefined /
    // طول ناکافی / غیرعددی) قبل از ساخت polyline فیلتر می‌شوند — Leaflet با
    // نقاط خراب هنگام project کرش می‌کند و مرز خطای کل تب را می‌بندد.
    const latlngs = (points || [])
      .filter(
        (p: unknown) =>
          Array.isArray(p) &&
          p.length >= 2 &&
          Number.isFinite(p[0] as number) &&
          Number.isFinite(p[1] as number)
      )
      .map((p: number[]) => [p[0], p[1]]);

    if (!caseRef.current && latlngs.length >= 2) {
      caseRef.current = L.polyline(latlngs, {
        color: "#ffffff",
        weight: 11,
        opacity: 0.9,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);
      lineRef.current = L.polyline(latlngs, {
        color: "#f97316",
        weight: 6,
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);
    } else if (lineRef.current && caseRef.current) {
      // 🩹 v198 — هرگز setLatLngs با کمتر از ۲ نقطهٔ معتبر صدا زده نمی‌شود
      // (ریشهٔ دوم همان کرش Leaflet)؛ در عوض خط از نقشه برداشته می‌شود.
      if (latlngs.length >= 2) {
        caseRef.current.setLatLngs(latlngs);
        lineRef.current.setLatLngs(latlngs);
      } else {
        try {
          map.removeLayer(caseRef.current);
          map.removeLayer(lineRef.current);
        } catch {}
        caseRef.current = null;
        lineRef.current = null;
      }
    }

    // مارکرهای شروع/پایان (فقط نمایش تاریخی — live جداگانه)
    if (!liveLast && latlngs.length >= 2) {
      map.eachLayer((layer: any) => {
        if (layer?.options?.fitupMarker) map.removeLayer(layer);
      });
      L.circleMarker(latlngs[0], {
        radius: 7, color: "#fff", weight: 3, fillColor: "#10b981", fillOpacity: 1, fitupMarker: 1,
      }).addTo(map);
      const last = latlngs[latlngs.length - 1];
      L.circleMarker(last, {
        radius: 7, color: "#fff", weight: 3, fillColor: "#f43f5e", fillOpacity: 1, fitupMarker: 1,
      }).addTo(map);
    }

    // fit هوشمند — یک‌بار روی اولین ۲ نقطهٔ معتبر؛ بعد فقط اگر مسیر از کادر بیرون زد
    if (latlngs.length >= 2 && (!fittedRef.current || !liveLast)) {
      try {
        const b = L.latLngBounds(latlngs);
        map.fitBounds(b, { padding: [34, 34] });
        fittedRef.current = true;
      } catch {}
    }
  }, [points, ready, liveLast]);

  // ─── v191 — ردیابی زندهٔ موقعیت کاربر: همیشه مرکز نقشه ───
  useEffect(() => {
    liveLastRef.current = liveLast ?? null;
  }, [liveLast]);
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || !ready) return;
    recenterRef.current = () => {
      followRef.current = true;
      setFollowing(true);
      const p = liveLastRef.current;
      if (!p) return;
      try {
        const z = Math.max(ctx.map.getZoom(), 16);
        ctx.map.setView([p.lat, p.lng], z, { animate: true, duration: 0.5 });
      } catch {}
    };
  }, [ready]);

  // مارکر زندهٔ ردیابی
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || !ready) return;
    const { map, L } = ctx;
    if (!liveLast) {
      if (liveRef.current) {
        try { map.removeLayer(liveRef.current); } catch {}
        liveRef.current = null;
      }
      if (accRef.current) {
        try { map.removeLayer(accRef.current); } catch {}
        accRef.current = null;
      }
      return;
    }
    if (!liveRef.current) {
      liveRef.current = L.circleMarker([liveLast.lat, liveLast.lng], {
        radius: 9,
        color: "#ffffff",
        weight: 4,
        fillColor: "#2563eb",
        fillOpacity: 1,
      }).addTo(map);
    } else {
      liveRef.current.setLatLng([liveLast.lat, liveLast.lng]);
    }
    if (accRef.current) {
      accRef.current.setLatLng([liveLast.lat, liveLast.lng]);
      accRef.current.setRadius(Math.min(80, liveAccuracy ?? 20));
    } else {
      accRef.current = L.circle([liveLast.lat, liveLast.lng], {
        radius: Math.min(80, liveAccuracy ?? 20),
        color: "#2563eb",
        weight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.08,
      }).addTo(map);
    }
    // ─── v191 — دنبال‌کردن زنده: با هر تیک GPS کاربر در مرکز نقشه می‌ماند ───
    if (followRef.current) {
      try {
        const z = map.getZoom() < 14 ? 16 : map.getZoom();
        map.setView([liveLast.lat, liveLast.lng], z, { animate: true, duration: 0.5 });
      } catch {}
    }
  }, [liveLast, liveAccuracy, ready, points]);

  return (
    <div className={`relative overflow-hidden rounded-2xl ${heightClass}`} dir="ltr">
      <div ref={boxRef} className="absolute inset-0 z-0" style={{ background: "#e8eef2" }} />
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      )}
      {/* v191 — دکمهٔ بازگشت به موقعیت زنده وقتی کاربر دستی نقشه را جابه‌جا کرده */}
      {ready && !!liveLast && !following && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            recenterRef.current?.();
          }}
          className="absolute bottom-3 left-3 z-[500] flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-3.5 py-2.5 text-[12px] font-black text-slate-700 shadow-2xl border border-orange-200 transition active:scale-95"
          aria-label="بازگشت به موقعیت من"
        >
          <LocateFixed className="w-4 h-4 text-orange-500" />
          <span>موقعیت من</span>
        </button>
      )}
      {ready && !!liveLast && following && (
        <span className="absolute top-3 left-3 z-[500] flex items-center gap-1.5 rounded-full bg-emerald-600/90 backdrop-blur px-3 py-1.5 text-[10px] font-black text-white shadow-lg pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          ردیابی زنده
        </span>
      )}
    </div>
  );
}

// ───────────────────────────── چیپ آمار ─────────────────────────────

function StatChip({
  icon: Icon,
  value,
  label,
  accent = "#f97316",
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-white/10 backdrop-blur px-2 py-3 min-h-[76px]">
      <Icon className="w-4 h-4 mb-1.5" style={{ color: accent }} />
      <span className="text-lg font-black leading-none text-white tabular-nums">{value}</span>
      <span className="text-[10px] text-white/60 mt-1">{label}</span>
    </div>
  );
}

// ───────────────────────────── تولتیپ کوچک ─────────────────────────────

function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="توضیح"
        className="align-middle"
      >
        <Info className="w-3 h-3 text-slate-400 hover:text-orange-500 transition" />
      </button>
      {open && (
        <span className="absolute bottom-full right-1/2 translate-x-1/2 mb-2 z-40 w-56 p-2.5 rounded-xl text-[11px] leading-relaxed shadow-2xl bg-white border border-orange-200 text-slate-600 font-medium normal-case">
          {text}
        </span>
      )}
    </span>
  );
}

// ───────────────────────────── کامپوننت اصلی ─────────────────────────────

const EMPTY_SNAPSHOT: TrackerSnapshot = {
  status: "idle",
  startedAt: 0,
  elapsedSec: 0,
  movingSec: 0,
  distanceM: 0,
  speedKmh: 0,
  maxSpeedKmh: 0,
  caloriesKcal: 0,
  steps: 0,
  activityType: "unknown",
  pointsCount: 0,
  accuracyM: 0,
  errorMessage: "",
};

export function ActivityClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [screen, setScreen] = useState<Screen>("boot");
  const [me, setMe] = useState<MeDto | null>(null);
  const [snap, setSnap] = useState<TrackerSnapshot>(EMPTY_SNAPSHOT);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [detail, setDetail] = useState<SessionDto | null>(null);
  const [detailPoints, setDetailPoints] = useState<number[][]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [hasWakeLock, setHasWakeLock] = useState(false);
  // v143 — خطای شروع دیگر بی‌صدا نیست: روی صفحهٔ home با راهنمای دقیق دیده می‌شود
  const [startError, setStartError] = useState("");
  const [gpsHint, setGpsHint] = useState(false); // v144 — راهنمای «پنجرهٔ مجوز» اگر GPS دیر جواب دهد

  // finish form
  const [finishFile, setFinishFile] = useState<File | null>(null);
  const [finishPreview, setFinishPreview] = useState<string>("");
  const [finishNote, setFinishNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savedResult = useRef<{ id: string; distanceM: number; calories: number; activityType: string } | null>(null);

  const trackerRef = useRef<ActivityTracker | null>(null);
  const startingRef = useRef(false); // v144 — قفل شروعِ موازی

  const hasPlan = !!me?.hasActiveSubscription;

  // ── boot: احراز هویت + جلسه‌ها + draft ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // v143 — حالت embedded (تب پنل): کاربر از قبل در store است — بدون fetch
      if (embedded) {
        const u = useAppStore.getState().user;
        if (u) {
          setMe({
            id: u.id,
            name: u.name ?? null,
            planName: u.planName ?? null,
            hasActiveSubscription: !!u.hasActiveSubscription,
          });
          setScreen("home");
          loadSessions();
          const t = new ActivityTracker();
          if (t.loadDraft()) setDraftAvailable(true);
          return;
        }
      }
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data?.user) {
          setMe({
            id: data.user.id,
            name: data.user.name ?? null,
            planName: data.user.planName ?? null,
            hasActiveSubscription: !!data.user.hasActiveSubscription,
          });
          setScreen("home");
          loadSessions();
          // draft نیمه‌کاره؟
          const t = new ActivityTracker();
          if (t.loadDraft()) {
            setDraftAvailable(true);
          }
        } else {
          setScreen("guest");
        }
      } catch {
        if (!cancelled) setScreen("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/activity/sessions?limit=25", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data?.items)) setSessions(data.items);
    } catch {}
    setSessionsLoading(false);
  }, []);

  // ── tracker lifecycle ──
  const ensureTracker = useCallback(() => {
    if (!trackerRef.current) {
      const t = new ActivityTracker();
      t.onStart((s) => setSnap({ ...s }));
      trackerRef.current = t;
    }
    return trackerRef.current;
  }, []);

  // ریکاوری wake lock بعد از برگشت به تب
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void trackerRef.current?.reacquireWakeLockIfTracking();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const startFlow = useCallback(async () => {
    // v144 — محافظ دوبارکلیک: شروعِ موازی، مسیر GPS را خراب می‌کرد
    if (startingRef.current) return;
    startingRef.current = true;
    const t = ensureTracker();
    setStartError("");
    setGpsHint(false);
    setScreen("gps");
    try {
      const res = await t.start();
      if (!res.ok) {
        // v143 — شکست دیگر بی‌صدا نیست: پیام دقیق موتور + راهنما روی home رندر می‌شود
        setStartError(res.error || "گرفتن موقعیت ناموفق بود — دوباره تلاش کن.");
        setScreen("home");
        return;
      }
      setHasWakeLock(true);
      setScreen("countdown");
      setCountdown(3);
      let n = 3;
      const iv = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          clearInterval(iv);
          setScreen("tracking");
        } else {
          setCountdown(n);
        }
      }, 700);
    } finally {
      startingRef.current = false;
    }
  }, [ensureTracker]);

  // v144 — اگر گرفتن GPS بیشتر از ۹ ثانیه طول کشید، راهنمای پنجرهٔ مجوز نشان بده
  // (خیلی‌ها پنجرهٔ «اجازه دسترسی به موقعیت» را بالا/پشت اپ نمی‌بینند)
  useEffect(() => {
    if (screen !== "gps") {
      setGpsHint(false);
      return;
    }
    const t = setTimeout(() => setGpsHint(true), 9000);
    return () => clearTimeout(t);
  }, [screen]);

  const stopFlow = useCallback(() => {
    const t = trackerRef.current;
    if (!t) return;
    // مکث قبل از فرم پایان — زمان صرف‌شده روی فرم، در جلسه حساب نمی‌شود
    t.pause();
    setScreen("finish");
  }, []);

  const cancelActivity = useCallback(() => {
    trackerRef.current?.reset();
    setSnap(EMPTY_SNAPSHOT);
    setScreen("home");
  }, []);

  // ── ذخیره ──
  const saveSession = useCallback(async () => {
    const t = trackerRef.current;
    if (!t || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = t.finish();
      if (!payload) throw new Error("no-payload");
      let photoUrl: string | undefined;
      if (finishFile) {
        const fd = new FormData();
        fd.append("image", finishFile);
        const up = await fetch("/api/activity/photo", { method: "POST", body: fd });
        const upData = await up.json();
        if (!up.ok || !upData?.url) {
          throw new Error(upData?.error || "آپلود عکس ناموفق بود");
        }
        photoUrl = upData.url;
      }
      const res = await fetch("/api/activity/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startedAt: payload.startedAtIso,
          endedAt: payload.endedAtIso,
          points: payload.points,
          suggestedType: payload.suggestedType,
          photoUrl,
          note: finishNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "ثبت جلسه ناموفق بود");
      }
      savedResult.current = {
        id: data.id,
        distanceM: data.distanceM,
        calories: data.calories,
        activityType: data.activityType,
      };
      t.reset();
      setSnap(EMPTY_SNAPSHOT);
      setScreen("saved");
      setDraftAvailable(false);
      loadSessions();
      // جشن گیمیفیکشن
      void import("canvas-confetti").then(({ default: confetti }) => {
        try {
          confetti({
            particleCount: 130,
            spread: 80,
            origin: { y: 0.35 },
            colors: ["#f97316", "#fbbf24", "#10b981", "#ffffff"],
            disableForReducedMotion: true,
          });
        } catch {}
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "خطای نامشخص";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [finishFile, finishNote, saving, loadSessions]);

  const discardFinish = useCallback(() => {
    trackerRef.current?.reset();
    setSnap(EMPTY_SNAPSHOT);
    setFinishFile(null);
    if (finishPreview) URL.revokeObjectURL(finishPreview);
    setFinishPreview("");
    setFinishNote("");
    setScreen("home");
  }, [finishPreview]);

  const onPhotoPicked = useCallback(
    (f: File | null) => {
      if (!f) return;
      setFinishFile(f);
      if (finishPreview) URL.revokeObjectURL(finishPreview);
      setFinishPreview(URL.createObjectURL(f));
    },
    [finishPreview]
  );

  // v179 — دیرکتیو مالک: شیت مشترک «دوربین / گالری» برای عکس یادبود —
  // دقیقاً همان انتخابگر بقیهٔ نقاط آپلود (گالری پیشرفت، پروفایل، آزمایش خون…).
  // دوربین: input با صفت capture → در WebView اپ‌ها onShowFileChooser با
  // isCaptureEnabled=true → ACTION_IMAGE_CAPTURE (بدون نیاز به آپدیت اپ).
  const photoPicker = useMediaSourcePicker({
    kind: "image",
    onFiles: (files) => onPhotoPicked(files[0] ?? null),
  });
  const pickPhoto = useCallback(() => {
    photoPicker.openPicker();
  }, [photoPicker]);

  // ── جزئیات تاریخچه ──
  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailPoints([]);
    setDetail(sessions.find((s) => s.id === id) ?? null);
    try {
      const res = await fetch(`/api/activity/sessions/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data?.id) {
        setDetail(data);
        // 🩹 v198 — پاکسازی نقاط خراب در مرز داده (undefined/غیرعددی) — ریشهٔ
        // کرش «reading '0'» لاگ ادمین؛ هم رندر والد و هم نقشه ایمن می‌شود
        const raw = Array.isArray(data.points) ? data.points : [];
        setDetailPoints(
          raw.filter(
            (p: unknown) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              Number.isFinite(p[0]) &&
              Number.isFinite(p[1])
          )
        );
      }
    } catch {}
    setDetailLoading(false);
  }, [sessions]);

  const deleteDetail = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm("این جلسه از تاریخچهٔ فیتاپ حذف شود؟")) return;
    try {
      await fetch(`/api/activity/sessions/${detail.id}`, { method: "DELETE" });
      setDetail(null);
      setDetailPoints([]);
      loadSessions();
    } catch {}
  }, [detail, loadSessions]);

  // ── آمار هفته + نشان‌ها (گیمیفیکشن) ──
  const weekStats = useMemo(() => {
    const since = Date.now() - 7 * 86400_000;
    const wk = sessions.filter((s) => new Date(s.startedAt).getTime() >= since);
    return {
      count: wk.length,
      distanceM: wk.reduce((a, s) => a + s.distanceM, 0),
      calories: wk.reduce((a, s) => a + s.calories, 0),
      minutes: Math.round(wk.reduce((a, s) => a + s.durationSec, 0) / 60),
    };
  }, [sessions]);

  const badges = useMemo(() => {
    const totalKm = sessions.reduce((a, s) => a + s.distanceM, 0) / 1000;
    const best = sessions.reduce((a, s) => Math.max(a, s.distanceM), 0);
    const fastest = sessions.reduce((a, s) => Math.max(a, s.avgSpeedKmh), 0);
    const list: { emoji: string; label: string; earned: boolean }[] = [
      { emoji: "🥇", label: "اولین مسیر", earned: sessions.length >= 1 },
      { emoji: "🎯", label: "۳ مسیر", earned: sessions.length >= 3 },
      { emoji: "🌍", label: "۱۰ کیلومتر جمع", earned: totalKm >= 10 },
      { emoji: "🏔️", label: "۲۵ کیلومتر جمع", earned: totalKm >= 25 },
      { emoji: "🚀", label: "مسیر بلند ۵+ کیلومتر", earned: best >= 5000 },
      { emoji: "⚡", label: "سرعت ۸+ km/h", earned: fastest >= 8 },
    ];
    return list;
  }, [sessions]);

  const earnedBadges = badges.filter((b) => b.earned).length;

  // نقشهٔ زنده — نقاط از tracker
  const livePoints = useMemo(() => {
    if (!trackerRef.current) return [];
    return trackerRef.current.getPoints().map((p) => [p.lat, p.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.pointsCount]);

  // ═══════════════════ رندر ═══════════════════

  const firstName = (me?.name || "").trim().split(/\s+/)[0] || "";

  return (
    <div
      className={
        embedded
          ? "max-w-6xl mx-auto px-4 sm:px-6 pb-16 w-full"
          : "min-h-screen flex flex-col bg-slate-50"
      }
      dir="rtl"
    >
      <main className={embedded ? "" : "flex-1"}>
        {/* ── هدر برند ── */}
        {!embedded && (
          <div
            className="relative overflow-hidden"
            style={{ background: "linear-gradient(150deg, #1c1917 0%, #292524 55%, #7c2d12 100%)" }}
          >
            <div className="absolute -top-14 -left-14 w-48 h-48 rounded-full blur-3xl opacity-25" style={{ background: "#f97316" }} />
            <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-7 relative">
              <div className="flex items-center justify-between">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 text-white/70 hover:text-white transition text-sm font-bold"
                >
                  <ChevronLeft className="w-4 h-4" />
                  خانه
                </Link>
                <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-amber-200 font-bold border border-white/10">
                  <Sparkles className="w-3 h-3" />
                  رایگان برای همهٔ فیتاپی‌ها
                </span>
              </div>

              <div className="mt-5 flex items-start gap-3.5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                >
                  <Footprints className="w-7 h-7 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                    مسیریاب فیتاپ
                  </h1>
                  <p className="text-sm text-white/65 mt-1 leading-relaxed">
                    {firstName ? `${fa(firstName)} جان، ` : ""}پیاده‌روی یا دویدنت رو ثبت کن — مسیر، سرعت، کالری و نقشه، همه با هم.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* v143 — هدر فشردهٔ هم‌سبک با بقیهٔ تب‌های پنل (بدون دکمهٔ خانه/کرامپ لندینگ) */}
        {embedded && (
          <div
            className="relative overflow-hidden rounded-3xl p-5 sm:p-6 mb-5"
            style={{ background: "linear-gradient(150deg, #1c1917 0%, #292524 55%, #7c2d12 100%)" }}
          >
            <div className="absolute -top-14 -left-14 w-48 h-48 rounded-full blur-3xl opacity-25" style={{ background: "#f97316" }} />
            <div className="relative flex items-start gap-3.5">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <Footprints className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-white leading-tight">مسیریاب فیتاپ</h1>
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-amber-200 font-bold border border-white/10">
                    <Sparkles className="w-3 h-3" />
                    رایگان
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-white/65 mt-1 leading-relaxed">
                  {firstName ? `${fa(firstName)} جان، ` : ""}پیاده‌روی یا دویدنت رو ثبت کن — مسیر، سرعت، کالری و نقشه، همه با هم.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={embedded ? "" : "max-w-3xl mx-auto px-4 sm:px-6 py-6 w-full"}>
          {/* ══════════ BOOT ══════════ */}
          {screen === "boot" && (
            <div className="py-24 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              <p className="text-sm text-slate-500">در حال آماده‌سازی مسیریاب…</p>
            </div>
          )}

          {/* ══════════ GUEST ══════════ */}
          {screen === "guest" && (
            <div className="py-10">
              <div className="rounded-3xl p-8 text-center bg-white border border-orange-100 shadow-sm">
                <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}>
                  <Footprints className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-black text-slate-900 mb-2">برای شروع، وارد حساب فیتاپ شو</h2>
                <p className="text-sm text-slate-500 leading-relaxed mb-5">
                  ثبت پیاده‌روی و دویدن برای همهٔ کاربران فیتاپ رایگان است — وارد شو و اولین مسیرت را ثبت کن.
                </p>
                <Link
                  href="/?screen=auth"
                  className="inline-flex items-center gap-2 rounded-xl px-6 h-11 font-bold text-white shadow-lg transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}
                >
                  ورود / ثبت‌نام
                </Link>
              </div>
            </div>
          )}

          {/* ══════════ HOME ══════════ */}
          {screen === "home" && (
            <div className="space-y-5">
              {/* draft ریکاوری */}
              {draftAvailable && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Timer className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-xs font-bold text-amber-700 truncate">جلسهٔ نیمه‌کاره‌ای داری — ادامه بده!</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        const t = ensureTracker();
                        if (t.resumeFromDraft()) {
                          setScreen("tracking");
                        } else {
                          setDraftAvailable(false);
                        }
                      }}
                      className="px-3 h-8 rounded-lg bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" /> ادامه
                    </button>
                    <button
                      onClick={() => {
                        new ActivityTracker().discardDraft();
                        setDraftAvailable(false);
                      }}
                      className="w-8 h-8 rounded-lg bg-white border border-amber-200 text-amber-600 flex items-center justify-center"
                      aria-label="دور انداختن جلسهٔ نیمه‌کاره"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* دکمهٔ شروع بزرگ */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-3xl p-6 text-center overflow-hidden border border-orange-100"
                style={{ background: "linear-gradient(165deg,#fffdf8 0%,#fff3e0 100%)" }}
              >
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-20" style={{ background: "#f97316" }} />
                <div className="relative">
                  <button
                    onClick={() => void startFlow()}
                    className="group relative mx-auto w-36 h-36 rounded-full flex items-center justify-center shadow-2xl transition-transform active:scale-95 hover:scale-[1.03]"
                    style={{ background: "linear-gradient(140deg,#fbbf24,#f97316 60%,#ea580c)" }}
                    aria-label="شروع پیاده‌روی یا دویدن"
                  >
                    <span className="absolute inset-0 rounded-full animate-ping bg-orange-400/25" aria-hidden />
                    <span className="absolute -inset-3 rounded-full border-2 border-orange-300/50" aria-hidden />
                    <span className="relative flex flex-col items-center gap-1.5">
                      <Play className="w-10 h-10 text-white" fill="white" />
                      <span className="text-white font-black text-lg">شروع</span>
                    </span>
                  </button>
                  <p className="mt-4 text-sm font-bold text-slate-700">پیاده‌روی و دویدن</p>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    GPS روشن می‌شود • صفحه روشن می‌ماند • گوشی را کنار بگذار و ادامه بده
                  </p>
                  {!ActivityTracker.isSupported() && (
                    <p className="mt-2 text-[11px] font-bold text-rose-500">
                      مرورگر فعلی از GPS پشتیبانی نمی‌کند — کروم را امتحان کن.
                    </p>
                  )}
                  {startError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-right"
                      role="alert"
                    >
                      <p className="text-xs font-bold text-rose-700 leading-relaxed">⚠️ {startError}</p>
                      <button
                        onClick={() => void startFlow()}
                        className="mt-2.5 px-4 h-9 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 mx-auto"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> تلاش دوباره
                      </button>
                    </motion.div>
                  )}
                </div>
              </motion.div>

              {/* آمار هفته */}
              <div className="grid grid-cols-4 gap-2.5">
                {[
                  { icon: Route, v: kmFmt(weekStats.distanceM), l: "کیلومتر (هفته)", c: "#f97316" },
                  { icon: Timer, v: fa(weekStats.minutes), l: "دقیقه فعالیت", c: "#8b5cf6" },
                  { icon: Flame, v: fa(weekStats.calories), l: "کالری سوزانده", c: "#ef4444" },
                  { icon: Trophy, v: fa(weekStats.count), l: "جلسه ثبت‌شده", c: "#10b981" },
                ].map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-2xl bg-white border border-slate-100 p-3 text-center shadow-sm"
                  >
                    <s.icon className="w-4 h-4 mx-auto mb-1.5" style={{ color: s.c }} />
                    <p className="text-base font-black text-slate-900 tabular-nums leading-none">{s.v}</p>
                    <p className="text-[9.5px] text-slate-400 mt-1 leading-tight">{s.l}</p>
                  </motion.div>
                ))}
              </div>

              {/* نشان‌ها */}
              <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                    <Medal className="w-4 h-4 text-amber-500" />
                    نشان‌های مسیر
                  </h3>
                  <span className="text-[10px] font-bold text-slate-400">
                    {fa(earnedBadges)} از {fa(badges.length)}
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {badges.map((b, i) => (
                    <div
                      key={i}
                      className={`flex flex-col items-center gap-1 rounded-xl p-2.5 text-center transition ${
                        b.earned ? "bg-amber-50 border border-amber-200" : "bg-slate-50 border border-slate-100 opacity-55"
                      }`}
                      title={b.label}
                    >
                      <span className={`text-xl ${b.earned ? "" : "grayscale"}`}>{b.emoji}</span>
                      <span className={`text-[9px] font-bold leading-tight ${b.earned ? "text-amber-700" : "text-slate-400"}`}>
                        {b.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* تاریخچه */}
              <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                    <Route className="w-4 h-4 text-orange-500" />
                    تاریخچهٔ مسیرها
                  </h3>
                  <button
                    onClick={() => void loadSessions()}
                    className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-orange-500 transition"
                    aria-label="به‌روزرسانی"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {sessionsLoading && sessions.length === 0 ? (
                  <div className="py-8 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-300" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-8 text-center">
                    <Footprints className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                    <p className="text-sm text-slate-400">هنوز مسیری ثبت نکردی — اولین قدم را بزن!</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[420px] overflow-y-auto custom-scrollbar pl-0.5">
                    {sessions.map((s) => {
                      const meta = TYPE_META[s.activityType] ?? TYPE_META.unknown;
                      return (
                        <button
                          key={s.id}
                          onClick={() => void openDetail(s.id)}
                          className="w-full text-right flex items-center gap-3 rounded-2xl border border-slate-100 bg-white hover:border-orange-300 hover:shadow-md transition p-3 active:scale-[0.99]"
                        >
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl"
                            style={{ background: `${meta.color}18` }}
                          >
                            {meta.emoji}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-slate-900 leading-tight">
                              {meta.label}
                              {s.photoUrl ? " 📷" : ""}
                            </p>
                            <p className="text-[10.5px] text-slate-400 mt-0.5">
                              {weekdayFa(s.startedAt)} • {dateFa(s.startedAt)} — ساعت {timeFa(s.startedAt)}
                            </p>
                          </div>
                          <div className="text-left shrink-0">
                            <p className="text-sm font-black tabular-nums" style={{ color: meta.color }}>
                              {kmFmt(s.distanceM)} km
                            </p>
                            <p className="text-[10px] text-slate-400 tabular-nums">
                              {formatClock(s.durationSec)} • {fa(s.calories)} kcal
                            </p>
                          </div>
                          <ChevronLeft className="w-4 h-4 text-slate-300 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* نوار پلن */}
              {!hasPlan && (
                <div className="rounded-2xl border border-orange-100 bg-gradient-to-l from-orange-50 to-amber-50/60 p-4 flex items-center gap-3">
                  <Crown className="w-5 h-5 text-orange-500 shrink-0" />
                  <p className="text-xs text-slate-600 leading-relaxed flex-1">
                    <b>می‌دونستی؟</b> اگر پلن فعال داشته باشی، همهٔ مسیرها و کالری‌ها به‌طور خودکار در
                    پروفایل ورزشی‌ات ثبت و هوش مصنوعی از آن‌ها استفاده می‌کند.
                  </p>
                  <Link
                    href="/?screen=panel&tab=plans"
                    className="shrink-0 px-3.5 h-8 rounded-lg text-white text-xs font-bold flex items-center shadow-sm"
                    style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}
                  >
                    دیدن پلن‌ها
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ══════════ GPS WAIT ══════════ */}
          {screen === "gps" && (
            <div className="py-20 flex flex-col items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 rounded-full animate-ping bg-orange-300/30" />
                <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}>
                  <MapPin className="w-9 h-9 text-white" />
                </div>
              </div>
              <p className="font-black text-slate-800">دریافت سیگنال GPS…</p>
              <p className="text-xs text-slate-400 text-center leading-relaxed max-w-xs">
                زیر آسمان باز بایست تا دقیق‌تر پیدا بشی. اگر پنجرهٔ مجوز موقعیت باز شد، «اجازه» را بزن.
              </p>
              {gpsHint && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center max-w-xs leading-relaxed"
                  role="status"
                >
                  بیش از حد انتظار طول کشید؟ پنجرهٔ «اجازه دسترسی به موقعیت» ممکن است بالای صفحه باشد — «اجازه» را بزن؛ یا کنار آدرس سایت روی 🔒 بزن و «موقعیت مکانی» را مجاز کن.
                </motion.p>
              )}
              <button onClick={cancelActivity} className="text-xs font-bold text-slate-400 hover:text-slate-600 transition">
                انصراف
              </button>
            </div>
          )}

          {/* ══════════ COUNTDOWN ══════════ */}
          {screen === "countdown" && (
            <div className="py-24 flex flex-col items-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={countdown}
                  initial={{ scale: 1.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.35 }}
                  className="w-28 h-28 rounded-full flex items-center justify-center shadow-2xl"
                  style={{ background: "linear-gradient(140deg,#fbbf24,#f97316)" }}
                >
                  <span className="text-5xl font-black text-white">{fa(countdown)}</span>
                </motion.div>
              </AnimatePresence>
              <p className="mt-6 text-sm font-bold text-slate-600">آماده باش…</p>
            </div>
          )}

          {/* ══════════ TRACKING HUD ══════════ */}
          {screen === "tracking" && (
            <div className="space-y-4">
              {/* نقشهٔ زنده */}
              <RouteMap
                points={livePoints}
                liveLast={trackerRef.current?.lastLatLng ?? null}
                liveAccuracy={snap.accuracyM}
                heightClass="h-[46vh] min-h-[300px]"
                interactive
              />

              {/* نوار وضعیت */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-bold text-emerald-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  در حال ضبط
                </span>
                <span className="flex items-center gap-2 text-slate-400">
                  <span>دقت GPS: ±{fa(snap.accuracyM)} متر</span>
                  {hasWakeLock && <span className="text-amber-500">🔒 صفحه روشن می‌ماند</span>}
                </span>
              </div>
              {snap.errorMessage && (
                <p className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {snap.errorMessage}
                </p>
              )}

              {/* آمار زنده */}
              <div className="rounded-3xl p-4 shadow-xl" style={{ background: "linear-gradient(160deg,#1c1917,#292524)" }}>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatChip icon={Timer} value={formatClock(snap.elapsedSec)} label="زمان" />
                  <StatChip icon={Route} value={kmFmt(snap.distanceM)} label="کیلومتر" accent="#fbbf24" />
                  <StatChip icon={Gauge} value={fa(snap.speedKmh.toFixed(1))} label="سرعت km/h" accent="#38bdf8" />
                </div>
                <div className="grid grid-cols-3 gap-2.5 mt-2.5">
                  <StatChip icon={Flame} value={fa(snap.caloriesKcal)} label="کالری" accent="#f87171" />
                  <StatChip icon={Footprints} value={fa(snap.steps)} label="گام" accent="#a3e635" />
                  <StatChip
                    icon={TYPE_META[snap.activityType]?.emoji ? Footprints : Footprints}
                    value={TYPE_META[snap.activityType]?.label ?? "—"}
                    label="نوع فعالیت"
                    accent="#c4b5fd"
                  />
                </div>
              </div>

              {/* دکمه‌های کنترل */}
              <div className="flex items-center justify-center gap-4 pb-4">
                <button
                  onClick={() => {
                    if (snap.status === "paused") {
                      trackerRef.current?.resume();
                    } else {
                      trackerRef.current?.pause();
                    }
                  }}
                  className="w-14 h-14 rounded-full bg-white border-2 border-amber-400 text-amber-600 flex items-center justify-center shadow-lg transition active:scale-95"
                  aria-label={snap.status === "paused" ? "ادامه" : "مکث"}
                >
                  {snap.status === "paused" ? <Play className="w-6 h-6" fill="currentColor" /> : <Pause className="w-6 h-6" />}
                </button>
                <button
                  onClick={stopFlow}
                  className="w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition active:scale-95"
                  style={{ background: "linear-gradient(140deg,#f43f5e,#dc2626)" }}
                  aria-label="پایان و ذخیره"
                >
                  <span className="flex flex-col items-center gap-1">
                    <Square className="w-7 h-7 text-white" fill="white" />
                    <span className="text-[10px] font-black text-white">پایان</span>
                  </span>
                </button>
                <button
                  onClick={cancelActivity}
                  className="w-14 h-14 rounded-full bg-white border-2 border-slate-200 text-slate-400 flex items-center justify-center shadow-lg transition active:scale-95"
                  aria-label="انصراف و حذف جلسه"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════ FINISH FORM ══════════ */}
          {screen === "finish" && (
            <div className="space-y-5">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-3xl p-6 text-center text-white shadow-2xl relative overflow-hidden"
                style={{ background: "linear-gradient(150deg,#f59e0b,#f97316 70%,#ea580c)" }}
              >
                <div className="absolute -top-8 -left-8 w-36 h-36 rounded-full bg-white/10 blur-2xl" />
                <p className="relative text-4xl">🏁</p>
                <h2 className="relative font-black text-xl mt-2">تمام شد — آفرین!</h2>
                <p className="relative text-white/85 text-sm mt-1">
                  {TYPE_META[snap.activityType]?.label ?? "فعالیت"} تو آمادهٔ ثبت است
                </p>
                <button
                  onClick={() => {
                    trackerRef.current?.resume();
                    setScreen("tracking");
                  }}
                  className="relative mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white/90 hover:text-white transition"
                >
                  <Play className="w-3.5 h-3.5" />
                  ادامهٔ ضبط (برگشت)
                </button>
              </motion.div>

              <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { icon: Route, v: `${kmFmt(snap.distanceM)} km`, l: "مسافت", c: "#f97316" },
                    { icon: Timer, v: formatClock(snap.elapsedSec), l: "زمان", c: "#8b5cf6" },
                    { icon: Flame, v: `${fa(snap.caloriesKcal)}`, l: "کالری", c: "#ef4444" },
                    { icon: Gauge, v: `${fa(snap.speedKmh.toFixed(1))} km/h`, l: "میانگین سرعت", c: "#38bdf8" },
                    { icon: Footprints, v: fa(snap.steps), l: "گام", c: "#84cc16" },
                    { icon: Mountain, v: fa(snap.pointsCount), l: "نقطهٔ GPS", c: "#64748b" },
                  ].map((s, i) => (
                    <div key={i} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center">
                      <s.icon className="w-4 h-4 mx-auto mb-1.5" style={{ color: s.c }} />
                      <p className="text-sm font-black text-slate-900 tabular-nums leading-none">{s.v}</p>
                      <p className="text-[9.5px] text-slate-400 mt-1">{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* عکس یادبود */}
              <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <h3 className="font-black text-sm text-slate-900 mb-3 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-orange-500" />
                  عکس یادبود (اختیاری)
                </h3>
                {/* v179 — ماشین انتخابگر مشترک دوربین/گالری (inputهای مخفی + شیت) */}
                {photoPicker.machinery}
                {finishPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border border-orange-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={finishPreview} alt="عکس یادبود جلسه" className="w-full max-h-72 object-cover" />
                    <button
                      onClick={() => {
                        setFinishFile(null);
                        URL.revokeObjectURL(finishPreview);
                        setFinishPreview("");
                      }}
                      className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur"
                      aria-label="حذف عکس"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={pickPhoto}
                    className="w-full h-24 rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/50 text-orange-500 font-bold text-sm flex flex-col items-center justify-center gap-1.5 hover:border-orange-400 transition"
                  >
                    <Camera className="w-5 h-5" />
                    گرفتن عکس یا انتخاب از گالری
                  </button>
                )}
              </div>

              {/* یادداشت */}
              <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <h3 className="font-black text-sm text-slate-900 mb-2">یادداشت (اختیاری)</h3>
                <textarea
                  value={finishNote}
                  onChange={(e) => setFinishNote(e.target.value)}
                  rows={2}
                  maxLength={450}
                  placeholder="مثلاً: هوای عالی بود، مسیر پارک…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 resize-none"
                />
              </div>

              {saveError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {saveError}
                </p>
              )}

              <div className="flex items-center gap-3 pb-4">
                <button
                  onClick={() => void saveSession()}
                  disabled={saving}
                  className="flex-1 h-12 rounded-2xl font-black text-white shadow-xl flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-70"
                  style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {saving ? "در حال ذخیره…" : "ذخیره در فیتاپ"}
                </button>
                <button
                  onClick={discardFinish}
                  disabled={saving}
                  className="h-12 px-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 text-sm transition hover:text-rose-500 hover:border-rose-200 disabled:opacity-60"
                >
                  حذف جلسه
                </button>
              </div>
            </div>
          )}

          {/* ══════════ SAVED ══════════ */}
          {screen === "saved" && savedResult.current && (
            <div className="space-y-5">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-3xl p-7 text-center text-white shadow-2xl relative overflow-hidden"
                style={{ background: "linear-gradient(150deg,#059669,#10b981)" }}
              >
                <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/10 blur-2xl" />
                <p className="relative text-4xl">🎉</p>
                <h2 className="relative font-black text-xl mt-2">مسیرت ثبت شد!</h2>
                <p className="relative text-white/85 text-sm mt-1">
                  {kmFmt(savedResult.current.distanceM)} کیلومتر • {fa(savedResult.current.calories)} کالری •{" "}
                  {TYPE_META[savedResult.current.activityType]?.label ?? "فعالیت"}
                </p>
                {hasPlan ? (
                  <p className="relative mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-white/15 rounded-full px-3 py-1.5">
                    <Crown className="w-3.5 h-3.5" />
                    در پروفایل ورزشی‌ات ذخیره شد — هوش مصنوعی فیتاپ هم می‌بیند ✓
                  </p>
                ) : (
                  <p className="relative mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-white/15 rounded-full px-3 py-1.5">
                    <Wallet className="w-3.5 h-3.5" />
                    در حافظهٔ فیتاپ ثبت شد
                  </p>
                )}
              </motion.div>

              {/* پیام «می‌دونستی؟» برای بدون‌پلن‌ها — دیرکتیو مالک */}
              {!hasPlan && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl p-5 border-2 border-amber-200 relative overflow-hidden"
                  style={{ background: "linear-gradient(165deg,#fffbeb,#fef3c7)" }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-400/25 flex items-center justify-center shrink-0">
                      <Sparkles className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-amber-800">می‌دونستی…؟</p>
                      <p className="text-[13px] text-amber-900/80 leading-relaxed mt-1">
                        اگر پلن فعال داشته باشی، همهٔ پیاده‌روی‌ها و دویدن‌هایت به‌طور خودکار در
                        <b> پروفایل ورزشی‌ات</b> ثبت می‌شود و هوش مصنوعی فیتاپ در طراحی برنامه و چت،
                        از آن‌ها استفاده می‌کند — همه‌چیز یکپارچه.
                      </p>
                      <Link
                        href="/?screen=panel&tab=plans"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 h-9 text-white text-xs font-bold shadow-md"
                        style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}
                      >
                        <Crown className="w-3.5 h-3.5" />
                        دیدن پلن‌ها
                      </Link>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="grid grid-cols-2 gap-3 pb-4">
                <button
                  onClick={() => {
                    savedResult.current = null;
                    setScreen("home");
                  }}
                  className="h-12 rounded-2xl font-black text-white shadow-lg transition active:scale-[0.98]"
                  style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}
                >
                  مسیر جدید
                </button>
                <button
                  onClick={() => {
                    const last = sessions[0];
                    savedResult.current = null;
                    if (last) void openDetail(last.id);
                    else setScreen("home");
                  }}
                  className="h-12 rounded-2xl font-bold bg-white border border-slate-200 text-slate-600 text-sm transition hover:border-orange-300 hover:text-orange-600 active:scale-[0.98]"
                >
                  دیدن تاریخچه
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ══════════ جزئیات جلسه (تاریخچه) ══════════ */}
      <AnimatePresence>
        {detail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={() => setDetail(null)}
            role="dialog"
            aria-modal="true"
            aria-label="جزئیات جلسه"
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "tween", duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto custom-scrollbar bg-slate-50 rounded-t-3xl sm:rounded-3xl"
            >
              {(() => {
                const meta = TYPE_META[detail.activityType] ?? TYPE_META.unknown;
                const avgPace = detail.distanceM > 0 ? (detail.movingSec / (detail.distanceM / 1000)) : 0;
                return (
                  <div className="p-4 space-y-4">
                    {/* هدر */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: `${meta.color}18` }}>
                          {meta.emoji}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-slate-900 text-sm">{meta.label}</p>
                          <p className="text-[11px] text-slate-400">
                            {weekdayFa(detail.startedAt)} {dateFa(detail.startedAt)} • {timeFa(detail.startedAt)} تا {timeFa(detail.endedAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setDetail(null)}
                        className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition shrink-0"
                        aria-label="بستن"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* نقشهٔ مسیر */}
                    <div className="relative">
                      {detailLoading || detailPoints.length < 2 ? (
                        <div className="h-56 rounded-2xl bg-slate-100 flex items-center justify-center">
                          {detailLoading ? (
                            <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
                          ) : (
                            <p className="text-xs text-slate-400">مسیر GPS ثبت‌شده‌ای برای این جلسه نیست</p>
                          )}
                        </div>
                      ) : (
                        <RouteMap
                          points={detailPoints.map((p) => [p[0], p[1]])}
                          heightClass="h-56"
                          interactive
                        />
                      )}
                    </div>

                    {/* آمار کامل */}
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { icon: Route, v: `${kmFmt(detail.distanceM)} km`, l: "مسافت", c: "#f97316" },
                        { icon: Timer, v: formatClock(detail.durationSec), l: "زمان کل", c: "#8b5cf6" },
                        { icon: Flame, v: fa(detail.calories), l: "کالری", c: "#ef4444" },
                        { icon: Gauge, v: `${fa(detail.avgSpeedKmh.toFixed(1))} km/h`, l: "میانگین سرعت", c: "#38bdf8" },
                        { icon: Timer, v: formatPace(avgPace), l: "ریتم min/km", c: "#10b981" },
                        { icon: Footprints, v: fa(detail.steps), l: "گام", c: "#84cc16" },
                        { icon: Mountain, v: `${fa(detail.maxSpeedKmh.toFixed(1))}`, l: "بیشینه km/h", c: "#a78bfa" },
                        { icon: Timer, v: formatClock(detail.movingSec), l: "زمان متحرک", c: "#64748b" },
                        { icon: MapPin, v: fa(detail.pointsCount), l: "نقطهٔ GPS", c: "#94a3b8" },
                      ].map((s, i) => (
                        <div key={i} className="rounded-2xl bg-white border border-slate-100 p-3 text-center shadow-sm">
                          <s.icon className="w-4 h-4 mx-auto mb-1.5" style={{ color: s.c }} />
                          <p className="text-[13px] font-black text-slate-900 tabular-nums leading-none">{s.v}</p>
                          <p className="text-[9px] text-slate-400 mt-1">{s.l}</p>
                        </div>
                      ))}
                    </div>

                    {/* عکس */}
                    {detail.photoUrl && (
                      <div className="rounded-2xl overflow-hidden border border-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={detail.photoUrl} alt={`عکس یادبود ${meta.label}`} className="w-full max-h-80 object-cover" />
                      </div>
                    )}

                    {/* یادداشت */}
                    {detail.note && (
                      <div className="rounded-2xl bg-white border border-slate-100 p-3.5 shadow-sm">
                        <p className="text-[11px] font-bold text-slate-400 mb-1">یادداشت</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{detail.note}</p>
                      </div>
                    )}

                    {/* حذف */}
                    <div className="flex justify-center pb-2">
                      <button
                        onClick={() => void deleteDetail()}
                        className="px-4 h-9 rounded-xl text-xs font-bold text-rose-500 bg-white border border-rose-200 flex items-center gap-1.5 hover:bg-rose-50 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        حذف از تاریخچه
                      </button>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* v143 — در تب پنل فوتر لندینگ (خانه/مقالات/تماس) معنا ندارد */}
      {!embedded && <SiteFooter />}
    </div>
  );
}
