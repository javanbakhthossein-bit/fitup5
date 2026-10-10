"use client";

/**
 * ─── v138 — موتور ردیابی «مسیریاب فیتاپ» (پیاده‌روی و دویدن) ───
 *
 * یک موتور مستقل از UI که با Geolocation API گوشی کار می‌کند:
 *  • watchPosition با دقت بالا — نقاط با فیلتر دقت (acc ≤ ۵۰m) نگه داشته می‌شوند
 *  • مسافت با Haversine + فیلتر پرش‌های نویز (>۱۲۰ متر در <۱۵ ثانیه)
 *  • سرعت لحظه‌ای: اولویت coords.speed دستگاه، fallback اختلاف دو نقطهٔ اخیر
 *  • زمان بر اساس «timestamp واقعی» محاسبه می‌شود (نه شمارندهٔ interval) —
 *    یعنی اگر مرورگر در پس‌زمینه خواب شود، با برگشت کاربر زمان/مسافت درست است
 *  • مکث خودکار: گپ > ۳ دقیقه بدون حرکت → از «زمان متحرک» حذف می‌شود
 *  • مکث/ادامه دستی + ریکاوری جلسه از sessionStorage (اگر پروسه کشته شد)
 *  • Wake Lock: صفحه روشن می‌ماند تا GPS در پس‌زمینه قطع نشود («گوشی رو بذار کنار»)
 *  • تشخیص نوع فعالیت (پیاده‌روی/دویدن) از میانگین سرعت متحرک
 *
 * هیچ وابستگی به React ندارد — کاملاً تست‌پذیر و ضدلرزش.
 */

export interface TrackPoint {
  lat: number;
  lng: number;
  /** ثانیه از شروع جلسه */
  t: number;
  /** دقت اعلامی GPS به متر */
  acc: number;
}

export interface TrackerSnapshot {
  status: "idle" | "starting" | "tracking" | "paused" | "finished" | "error";
  /** میلی‌ثانیه epoch شروع جلسه */
  startedAt: number;
  elapsedSec: number;
  movingSec: number;
  distanceM: number;
  /** سرعت لحظه‌ای km/h (نرم‌شده) */
  speedKmh: number;
  maxSpeedKmh: number;
  caloriesKcal: number;
  steps: number;
  activityType: "walk" | "jog" | "run" | "unknown";
  pointsCount: number;
  /** دقت فعلی GPS (متر) — 0 = نامشخص */
  accuracyM: number;
  errorMessage: string;
}

export type TrackerListener = (s: TrackerSnapshot) => void;

const MAX_ACC_M = 50; // نقاط با دقت بدتر از این برای مسافت کنار گذاشته می‌شوند
const MAX_JUMP_M = 120; // پرش نویز
const IDLE_PAUSE_SEC = 180; // ۳ دقیقه بی‌حرکت = مکث خودکار
const MAX_SPEED_KMH = 45;
const WALK_RUN_THRESHOLD = 6.5; // km/h
const CAL_WEIGHT_DEFAULT = 70;

/** فاصلهٔ هَوِرساین به متر */
export function haversineM(
  aLat: number, aLng: number, bLat: number, bLng: number
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** MET بر اساس سرعت */
function metFromSpeed(kmh: number): number {
  if (kmh < 3.2) return 2.0;
  if (kmh <= 6.5) return Math.max(2.5, 0.75 + 0.62 * kmh);
  return Math.max(5.0, 0.9 * kmh);
}

export function detectType(avgMovingKmh: number): "walk" | "jog" | "run" | "unknown" {
  if (avgMovingKmh <= 0) return "unknown";
  if (avgMovingKmh < 6.5) return "walk";
  if (avgMovingKmh < 8.5) return "jog";
  return "run";
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** فرمت ریتم دقیقه:ثانیه در هر کیلومتر */
export function formatPace(paceSecPerKm: number): string {
  if (!paceSecPerKm || !Number.isFinite(paceSecPerKm)) return "—";
  const m = Math.floor(paceSecPerKm / 60);
  const s = Math.round(paceSecPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };

/** آیا صفحه داخل اپ اندروید فیتاپ (WebView) باز شده؟ */
export function isFitupAppWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /fittup/i.test(ua) || /;\s*wv\)/i.test(ua);
}

/** v144 — راهنمای رفع «دسترسی موقعیت رد شد» — جدا برای مرورگر و اپ */
export function deniedGuideFa(): string {
  return isFitupAppWebView()
    ? "دسترسی موقعیت رد شد. تنظیمات گوشی ← اپلیکیشن‌ها ← فیتاپ ← مجوزها ← «موقعیت مکانی» را روی «مجاز» بگذار، اپ را کامل ببند و دوباره باز کن، بعد «تلاش دوباره» را بزن."
    : "دسترسی موقعیت رد شد. کنار آدرس سایت روی آیکون 🔒 بزن، «موقعیت مکانی» را «مجاز» کن و بعد «تلاش دوباره» را بزن.";
}

/**
 * نگاشت کدهای خطای Geolocation به پیام فارسی دقیق و راه‌گشا.
 * v144 — پیام PERMISSION_DENIED حالا جدا برای مرورگر/اپ راهنمایی می‌دهد.
 */
export function geolocationErrorFa(err: GeolocationPositionError): string {
  switch (err?.code) {
    case 1: // PERMISSION_DENIED
      return deniedGuideFa();
    case 2: // POSITION_UNAVAILABLE
      return "موقعیت مکانی در دسترس نیست. GPS گوشی را روشن کن، زیر آسمان باز برو و دوباره شروع کن.";
    case 3: // TIMEOUT
      return "گرفتن سیگنال GPS طول کشید. کنار پنجره یا فضای باز دوباره تلاش کن.";
    default:
      return "گرفتن موقعیت ناموفق بود. یک‌بار دیگر شروع کن.";
  }
}

export class ActivityTracker {
  private watchId: number | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private listener: TrackerListener | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private points: TrackPoint[] = [];
  private startedAt = 0;
  private pausedAt = 0; // 0 = در حال ردیابی
  private pausedAccumSec = 0; // مجموع مکث‌های دستی
  private movingSec = 0;
  private distanceM = 0;
  private maxSpeedKmh = 0;
  private calories = 0;
  private steps = 0;
  private lastFixAt = 0;
  private lastMovingAt = 0;
  private smoothSpeed = 0; // EMA سرعت
  private weightKg = CAL_WEIGHT_DEFAULT;
  private draftKey = "fitup-activity-draft";
  private status: TrackerSnapshot["status"] = "idle";
  private errorMessage = "";
  private accuracyM = 0;

  /** آخرین موقعیت خام برای نقشهٔ زنده */
  lastLatLng: { lat: number; lng: number } | null = null;

  setWeight(kg: number | null | undefined) {
    if (kg && Number.isFinite(kg) && kg >= 25 && kg <= 300) this.weightKg = kg;
  }

  getPoints(): TrackPoint[] {
    return [...this.points];
  }

  onStart(listener: TrackerListener) {
    this.listener = listener;
  }

  private emit() {
    if (!this.listener) return;
    const elapsed = this.currentElapsedSec();
    const avgMovingKmh =
      this.movingSec > 0 ? (this.distanceM / this.movingSec) * 3.6 : 0;
    this.listener({
      status: this.status,
      startedAt: this.startedAt,
      elapsedSec: elapsed,
      movingSec: Math.round(this.movingSec),
      distanceM: Math.round(this.distanceM),
      speedKmh: Math.round(this.smoothSpeed * 10) / 10,
      maxSpeedKmh: Math.round(this.maxSpeedKmh * 10) / 10,
      caloriesKcal: Math.round(this.calories),
      steps: Math.round(this.steps),
      activityType: detectType(avgMovingKmh),
      pointsCount: this.points.length,
      accuracyM: Math.round(this.accuracyM),
      errorMessage: this.errorMessage,
    });
  }

  private currentElapsedSec(): number {
    if (!this.startedAt) return 0;
    if (this.pausedAt) {
      return Math.max(0, Math.floor((this.pausedAt - this.startedAt) / 1000) - this.pausedAccumSec);
    }
    return Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000) - this.pausedAccumSec);
  }

  /** آیا گوشی از Geolocation پشتیبانی می‌کند؟ */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.geolocation?.watchPosition;
  }

  /**
   * v144 — گرفتن یک fix خام از Geolocation API (منطق تصمیم با acquireFirstFix)
   */
  private getRaw(
    opts: PositionOptions
  ): Promise<{ fix: GeolocationPosition | null; err: GeolocationPositionError | null }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (fix: GeolocationPosition | null, err: GeolocationPositionError | null) => {
        if (settled) return;
        settled = true;
        resolve({ fix, err });
      };
      navigator.geolocation.getCurrentPosition(
        (p) => done(p, null),
        (e) => done(null, e),
        opts
      );
    });
  }

  /**
   * v144 — گرفتن اولین fix با استراتژی دومرحله‌ای (ریشه‌کن‌کردن «رد شد» کاذب):
   *
   *  ۱) GPS دقیق — تا ۲۲ ثانیه (وقت خواندن پنجرهٔ مجوز مرورگر هم هست)
   *  ۲) موقعیت‌یاب شبکه (وای‌فای/دادهٔ سیم‌کارت) — داخل ساختمان هم سریع جواب می‌دهد
   *
   *  ⚠️ هیچ پیش‌سنجی مسدودکنندهٔ Permissions API وجود ندارد — این مهم‌ترین فیکس است:
   *  در خیلی از مرورگرها و WebViewها (سامسونگ، شیائومی، WebView اپ فیتاپ)
   *  permissions.query({name:'geolocation'}) اشتباهی «denied» برمی‌گرداند حتی
   *  وقتی کاربر دسترسی را داده — و نسخهٔ قبل همین‌جا بدون حتی یک تلاش واقعی
   *  پیام «دسترسی موقعیت قبلاً رد شده…» می‌داد (گزارش مالک: «حتی دستی مجوز دادم
   *  باز هم می‌گوید رد شد»). حالا همیشه تلاش واقعی انجام می‌شود و فقط شکستِ
   *  واقعیِ خود Geolocation پیام می‌گیرد.
   */
  private async acquireFirstFix(): Promise<GeolocationPosition | null> {
    // تلاش ۱ — GPS دقیق دستگاه
    const a = await this.getRaw({ enableHighAccuracy: true, timeout: 22_000, maximumAge: 30_000 });
    if (a.fix) return a.fix;
    if (a.err?.code === 1) {
      this.errorMessage = deniedGuideFa();
      return null;
    }

    // تلاش ۲ — موقعیت‌یاب شبکه (سریع، داخل ساختمان هم کار می‌کند)
    const b = await this.getRaw({ enableHighAccuracy: false, timeout: 12_000, maximumAge: 120_000 });
    if (b.fix) return b.fix;
    if (b.err?.code === 1) {
      this.errorMessage = deniedGuideFa();
      return null;
    }

    const err = b.err ?? a.err;
    this.errorMessage = err
      ? geolocationErrorFa(err)
      : "گرفتن سیگنال GPS طول کشید. کنار پنجره یا فضای باز دوباره تلاش کن.";
    return null;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!ActivityTracker.isSupported()) {
      return { ok: false, error: "مرورگر شما از موقعیت‌یاب (GPS) پشتیبانی نمی‌کند." };
    }
    if (this.status === "tracking" || this.status === "starting") return { ok: true };

    this.status = "starting";
    this.errorMessage = "";
    this.emit();

    // v144 — اولین fix با استراتژی دومرحله‌ای (بدون هیچ پیش‌سنجی مسدودکننده)
    const firstFix = await this.acquireFirstFix();

    if (!firstFix) {
      this.status = "idle";
      this.errorMessage =
        this.errorMessage ||
        "دسترسی به موقعیت (GPS) داده نشد. مجوز «موقعیت مکانی» را در مرورگر/اپ فعال کن و دوباره تلاش کن.";
      this.emit();
      return { ok: false, error: this.errorMessage };
    }

    this.points = [];
    this.distanceM = 0;
    this.movingSec = 0;
    this.maxSpeedKmh = 0;
    this.calories = 0;
    this.steps = 0;
    this.smoothSpeed = 0;
    this.pausedAccumSec = 0;
    this.pausedAt = 0;
    this.startedAt = Date.now();
    this.lastMovingAt = Date.now();
    this.status = "tracking";
    this.ingest(firstFix);
    this.startWatch();
    this.startTick();
    void this.requestWakeLock();
    this.emit();
    this.saveDraft();
    return { ok: true };
  }

  private startWatch() {
    if (this.watchId != null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.ingest(p),
      (err) => {
        // v144 — خطای حین جلسه هیچ‌وقت جلسه را نمی‌کُشد؛
        // زمان/مسافت ثبت‌شده تا اینجا محفوظ می‌ماند (فقط هشدار ملایم)
        if (err?.code === 1) {
          this.errorMessage =
            "دسترسی موقعیت قطع شد — مسیر دیگر ثبت نمی‌شود. مجوز را دوباره بده تا ادامه دهیم.";
          this.emit();
        } else {
          this.errorMessage = "سیگنال GPS ضعیف است — بی‌صبرانه نباش، دوباره قوی می‌شود.";
          this.emit();
        }
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
    );
  }

  private ingest(p: GeolocationPosition) {
    if (this.status !== "tracking") return;
    const lat = p.coords.latitude;
    const lng = p.coords.longitude;
    const acc = p.coords.accuracy ?? 25;
    this.accuracyM = acc;
    this.lastLatLng = { lat, lng };
    this.lastFixAt = Date.now();

    const t = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    const prev = this.points[this.points.length - 1];

    // سرعت دستگاه (m/s) اگر معتبر
    let deviceKmh = 0;
    if (p.coords.speed != null && Number.isFinite(p.coords.speed) && p.coords.speed >= 0) {
      deviceKmh = p.coords.speed * 3.6;
    }

    if (acc <= MAX_ACC_M) {
      this.points.push({ lat, lng, t, acc });
      if (prev) {
        const dt = t - prev.t;
        if (dt > 0 && dt <= 120) {
          const d = haversineM(prev.lat, prev.lng, lat, lng);
          const kmh = (d / dt) * 3.6;
          const plausible = !(d > MAX_JUMP_M && dt < 15) && kmh <= MAX_SPEED_KMH;
          if (plausible) {
            if (d > 1.5) {
              this.distanceM += d;
            }
            if (d > 2.5) {
              this.movingSec += Math.min(dt, 60);
              this.lastMovingAt = Date.now();
              if (dt >= 2 && kmh > this.maxSpeedKmh) this.maxSpeedKmh = kmh;
            }
            // کالری تجمعی: MET از سرعت نرم‌شده × وزن × زمان
            const segMet = metFromSpeed(Math.max(1, kmh));
            this.calories += (segMet * this.weightKg * Math.min(dt, 60)) / 3600;
          }
        }
      }
      // گام تخمینی زنده
      const avgMovingKmh = this.movingSec > 0 ? (this.distanceM / this.movingSec) * 3.6 : 0;
      const type = detectType(avgMovingKmh);
      const stride = type === "run" ? 1.1 : type === "jog" ? 0.95 : 0.72;
      this.steps = this.distanceM / stride;

      // سرعت نرم‌شده (EMA) — ترجیح سنسور دستگاه
      const rawKmh = deviceKmh > 0 ? deviceKmh : prev ? Math.min(45, ((haversineM(prev.lat, prev.lng, lat, lng) / Math.max(1, t - prev.t)) * 3.6)) : 0;
      this.smoothSpeed = this.smoothSpeed === 0 ? rawKmh : this.smoothSpeed * 0.7 + rawKmh * 0.3;
      if (this.smoothSpeed < 0.5) this.smoothSpeed = 0;
    }

    // مکث خودکار طولانی → برچسب «کم‌تحرک» (زمان کل می‌ماند ولی از متحرک قبلاً حذف شده)
    if (this.lastMovingAt && Date.now() - this.lastMovingAt > IDLE_PAUSE_SEC * 1000) {
      this.errorMessage = "";
    }
    this.emit();
    this.saveDraft();
  }

  private startTick() {
    if (this.tickTimer) return;
    // تیک نمایشی هر ثانیه — محاسبات اصلی از timestamp است نه این تیک
    this.tickTimer = setInterval(() => {
      if (this.status === "tracking") this.emit();
    }, 1000);
  }

  pause() {
    if (this.status !== "tracking") return;
    this.pausedAt = Date.now();
    this.status = "paused";
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.releaseWakeLock();
    this.emit();
    this.saveDraft();
  }

  resume() {
    if (this.status !== "paused" || !this.pausedAt) return;
    this.pausedAccumSec += Math.floor((Date.now() - this.pausedAt) / 1000);
    this.pausedAt = 0;
    this.status = "tracking";
    this.lastMovingAt = Date.now();
    this.startWatch();
    this.startTick();
    void this.requestWakeLock();
    this.emit();
    this.saveDraft();
  }

  /** خروجی نهایی برای ارسال به سرور */
  finish(): {
    startedAtIso: string;
    endedAtIso: string;
    durationSec: number;
    movingSec: number;
    distanceM: number;
    points: number[][];
    suggestedType: "walk" | "jog" | "run" | "unknown";
    clientCalories: number;
  } | null {
    if (!this.startedAt) return null;
    const endedAt = this.pausedAt || Date.now();
    const durationSec = Math.max(
      0,
      Math.floor((endedAt - this.startedAt) / 1000) - this.pausedAccumSec
    );
    const avgMovingKmh = this.movingSec > 0 ? (this.distanceM / this.movingSec) * 3.6 : 0;
    this.stopInternal(true);
    this.status = "finished";
    this.emit();
    return {
      startedAtIso: new Date(this.startedAt).toISOString(),
      endedAtIso: new Date(endedAt).toISOString(),
      durationSec,
      movingSec: Math.round(this.movingSec),
      distanceM: Math.round(this.distanceM),
      points: this.points.map((p) => [p.lat, p.lng, p.t, p.acc]),
      suggestedType: detectType(avgMovingKmh),
      clientCalories: Math.round(this.calories),
    };
  }

  private stopInternal(clearDraft: boolean) {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.releaseWakeLock();
    if (clearDraft) {
      try {
        sessionStorage.removeItem(this.draftKey);
      } catch {}
    }
  }

  /** رهاکردن کامل (بعد از ثبت یا انصراف) */
  reset() {
    this.stopInternal(true);
    this.status = "idle";
    this.points = [];
    this.distanceM = 0;
    this.movingSec = 0;
    this.calories = 0;
    this.steps = 0;
    this.maxSpeedKmh = 0;
    this.smoothSpeed = 0;
    this.pausedAccumSec = 0;
    this.pausedAt = 0;
    this.startedAt = 0;
    this.errorMessage = "";
    this.accuracyM = 0;
    this.lastLatLng = null;
    this.emit();
  }

  // ─── Wake Lock («گوشی رو بذار کنار» — صفحه روشن می‌ماند) ───
  private async requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      };
      if (!nav.wakeLock) return;
      this.wakeLock = await nav.wakeLock.request("screen");
      // اگر tab hidden شد و قفل آزاد شد، با برگشت دوباره بگیر
      this.wakeLock.addEventListener?.("release", () => {
        this.wakeLock = null;
      });
    } catch {
      // پشتیبانی نمی‌شود (مثلاً iOS Safari) — مشکلی نیست
    }
  }

  private releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch {}
    this.wakeLock = null;
  }

  /** بعد از برگشت به تب — اگر قفل افتاده، دوباره بگیر */
  async reacquireWakeLockIfTracking() {
    if (this.status === "tracking" && !this.wakeLock) {
      await this.requestWakeLock();
    }
  }

  // ─── Draft (ریکاوری اگر پروسه کشته شد) ───
  private saveDraft() {
    if (this.status !== "tracking" && this.status !== "paused") return;
    try {
      sessionStorage.setItem(
        this.draftKey,
        JSON.stringify({
          startedAt: this.startedAt,
          pausedAccumSec: this.pausedAccumSec,
          pausedAt: this.pausedAt,
          savedAt: Date.now(),
          distanceM: Math.round(this.distanceM),
          movingSec: Math.round(this.movingSec),
          points: this.points.slice(-4000),
          weightKg: this.weightKg,
        })
      );
    } catch {}
  }

  /** جلسهٔ نیمه‌کارهٔ اخیر (کمتر از ۴ ساعت) برای ادامه دادن */
  loadDraft(): { startedAt: number; distanceM: number; movingSec: number; points: TrackPoint[] } | null {
    try {
      const raw = sessionStorage.getItem(this.draftKey);
      if (!raw) return null;
      const d = JSON.parse(raw) as {
        startedAt: number;
        savedAt: number;
        distanceM: number;
        movingSec: number;
        points: number[][];
        weightKg?: number;
      };
      if (!d?.startedAt || Date.now() - d.savedAt > 4 * 3600 * 1000) return null;
      if (d.distanceM < 20) return null;
      if (d.weightKg) this.weightKg = d.weightKg;
      return {
        startedAt: d.startedAt,
        distanceM: d.distanceM,
        movingSec: d.movingSec,
        points: (d.points || []).map((p) => ({ lat: p[0], lng: p[1], t: p[2], acc: p[3] })),
      };
    } catch {
      return null;
    }
  }

  /** ادامهٔ جلسه از draft (پروسه ری‌استارت شده ولی جلسه زنده است) */
  resumeFromDraft(): boolean {
    const d = this.loadDraft();
    if (!d) return false;
    this.points = d.points;
    this.distanceM = d.distanceM;
    this.movingSec = d.movingSec;
    this.startedAt = d.startedAt;
    this.pausedAt = 0;
    this.pausedAccumSec = 0;
    this.status = "tracking";
    this.lastMovingAt = Date.now();
    this.startWatch();
    this.startTick();
    void this.requestWakeLock();
    this.emit();
    return true;
  }

  discardDraft() {
    try {
      sessionStorage.removeItem(this.draftKey);
    } catch {}
  }
}
