import { cookies } from "next/headers";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { db } from "@/lib/db";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "crypto";
import type { Plan } from "@/lib/fitness/types";
import { logError } from "@/lib/error-logger";

/**
 * ساخت DTO امن کاربر برای ارسال به کلاینت.
 * شامل اطلاعات پلن فعلی و موجودی کیف پول.
 */
export async function buildUserDto(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const now = new Date();
  // اشتراک فعال: status === "active" و endDate در آینده است.
  // برای پلن‌های advanced/ultimate، اشتراک ابتدا با status="pending" ساخته می‌شود
  // (تا پیش‌نیازها تکمیل شوند) و ۴۵ روز از زمان تکمیل پیش‌نیازها آغاز می‌شود.
  const activeSub = await db.subscription.findFirst({
    where: {
      userId: user.id,
      status: "active",
      endDate: { gt: now },
    },
    orderBy: { endDate: "desc" },
  });

  // اشتراک pending (خرید شده ولی پیش‌نیازها تکمیل نشده) — فقط برای advanced/ultimate
  // planName برای capability gating از این اشتراک برمی‌گردد تا کاربر بتواند به صفحات
  // ارسال عکس بدن/ویدیو/آزمایش خون دسترسی داشته باشد.
  // پنجره pending محدود است (endDate = خرید + PENDING_WINDOW_DAYS) — اگر کاربر هرگز
  // پیش‌نیازها را تکمیل نکند، دسترسی او بعد از پنجره منقضی می‌شود (نه برای همیشه).
  // رکوردهای legacy با endDate=null همچنان معتبر در نظر گرفته می‌شوند.
  let pendingSub = !activeSub
    ? await db.subscription.findFirst({
        where: {
          userId: user.id,
          status: "pending",
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  // انقضای تنبل (lazy expiry): اشتراک‌های pending که پنجره‌شان گذشته را علامت‌گذاری کن
  if (pendingSub?.endDate && pendingSub.endDate.getTime() <= now.getTime()) {
    try {
      await db.subscription.update({
        where: { id: pendingSub.id },
        data: { status: "expired" },
      });
    } catch {
      /* best-effort */
    }
    pendingSub = null;
  }

  // آخرین اشتراک (حتی منقضی شده) — برای نمایش در UI و renewal banner
  const lastSub = await db.subscription.findFirst({
    where: { userId: user.id },
    orderBy: { endDate: "desc" },
  });

  // ─── v77 — fallback منبع دوم پلن: فیلدهای ردیف User ───
  // تحویل پرداخت (deliverPlanPayment) هم Subscription می‌سازد و هم planName/
  // planExpiresAt روی User را set می‌کند — دو منبع حقیقت. در دیتابیس پروداکشن
  // واقعی، کاربرانی دیده شدند که رکورد Subscriptionشان موجود نیست ولی فیلدهای
  // User معتبرند (planName + planExpiresAt در آینده) — بدون این fallback
  // buildUserDto برایشان planName=null برمی‌گرداند و همهٔ دسترسی‌های پلنی و
  // بازتولید برنامه (no_plan) خاموش می‌شود (ریشهٔ باگ «وزن ۹۷» — کاربر basic
  // برنامه‌اش ساخته شده بود ولی رکورد Subscription نداشت).
  // امن بودن: اکشن «remove» ادمین هر سه فیلد User را null می‌کند و اشتراک
  // منقضی‌شده planExpiresAt آینده ندارد → پلن لغو/منقضی هرگز زنده نمی‌شود.
  const userRowPlanValid =
    typeof user.planName === "string" &&
    user.planName.length > 0 &&
    !!user.planExpiresAt &&
    user.planExpiresAt.getTime() > now.getTime();
  const userRowPlan = userRowPlanValid ? (user.planName as Plan) : null;

  // اگر اشتراک فعلی هست، فیلدهای پلن را از آن می‌گیریم
  // اگر منقضی شده، lastPlanName و lastPlanExpiresAt برای نمایش در UI استفاده می‌شوند
  // planName: اولویت با active است، در غیر این صورت از pending (برای gating)،
  // سپس fallback فیلدهای معتبر ردیف User (v77)
  const planName = activeSub?.plan ?? pendingSub?.plan ?? userRowPlan ?? null;
  const planExpiresAt = activeSub?.endDate ?? (userRowPlan ? user.planExpiresAt : null);
  // hasActiveSubscription فقط وقتی true است که اشتراک واقعاً فعال باشد (نه pending)
  const hasActive = !!activeSub;
  // آیا کاربر در حال تکمیل پیش‌نیازهاست؟ (اشتراک pending دارد)
  const hasPendingSubscription = !!pendingSub;

  // ─── v78 — قابلیت «بازطراحی برنامه (یکبار در طول اشتراک)» ───
  // حامل سهمیه: اشتراک active، بعد pending (همان ترتیب getPlanRegenState در
  // plan-change-intent.ts). کاربرِ فقط-ردیف-User → eligible بر اساس پلن ولی
  // used/pending=false (رکوردی نیست که سهمیه رویش ثبت شده باشد).
  const planRegenHolder = activeSub ?? pendingSub ?? null;
  const planRegenEligible = planName === "advanced" || planName === "ultimate";

  // آخرین پلن (حتی منقضی) — برای renewal banner و نمایش وضعیت
  const lastPlanName = lastSub?.plan ?? user.planName ?? null;
  const lastPlanExpiresAt = lastSub?.endDate ?? user.planExpiresAt ?? null;

  return {
    id: user.id,
    mobile: user.mobile,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    onboardingDone: user.onboardingDone,
    hasActiveSubscription: hasActive,
    hasPendingSubscription,
    subscriptionEnd: planExpiresAt?.toISOString() ?? null,
    planName: (planName as Plan | null) ?? null,
    planExpiresAt: planExpiresAt?.toISOString() ?? null,
    // v53: شروع دورهٔ پلن فعال — برای نوار پیشرفت دوره در داشبورد
    planStartedAt: activeSub?.startDate?.toISOString() ?? null,
    // آخرین پلن (حتی منقضی) — برای UI و renewal banner
    lastPlanName: (lastPlanName as Plan | null) ?? null,
    lastPlanExpiresAt: lastPlanExpiresAt?.toISOString() ?? null,
    // v78 — وضعیت بازطراحی برنامه از چت (کارت پلن + تولتیپ)
    planRegen: {
      eligible: planRegenEligible,
      pending: planRegenEligible ? (planRegenHolder?.planRegenPending ?? false) : false,
      used: planRegenEligible ? (planRegenHolder?.planRegenUsed ?? false) : false,
    },
    walletBalance: user.walletBalance,
    acceptedTermsVersion: user.acceptedTermsVersion ?? null,
    // v32: قوانین جدید بدون لاگ‌اوت — کاربر لاگ‌ین می‌ماند و فقط مودال پذیرش
    // درجا نمایش داده می‌شود (درخواست مالک: «کاربر هیچ وقت لاگ اوت نشه»)
    termsUpdateRequired:
      (await getCurrentTermsVersion()) > (user.acceptedTermsVersion ?? 0),
    // === AI usage counters (for plan limit display) ===
    videoAnalysisUsed: user.videoAnalysisUsed,
    bloodTestUsed: user.bloodTestUsed,
    // === Prerequisite decision fields ===
    videoStatus: user.videoStatus ?? null,
    bloodTestStatus: user.bloodTestStatus ?? null,
    // === PWA install status ===
    pwaInstalledAt: user.pwaInstalledAt?.toISOString() ?? null,
  };
}

/**
 * اعتبارسنجی دسترسی کاربر به یک قابلیت خاص بر اساس پلن فعال.
 * در سمت سرور استفاده می‌شود. اگر دسترسی نباشد، خطا می‌اندازد.
 */
export async function requirePlanCapability(capability: string): Promise<{ userId: string; planName: Plan | null }> {
  const user = await requireAuth();
  const dto = await buildUserDto(user.id);
  const planName = dto?.planName ?? null;

  // نگاشت قابلیت‌ها به حداقل پلن لازم (سیستم ۴ پلنی: basic=1, standard=2, advanced=3, ultimate=4)
  const minTierMap: Record<string, number> = {
    exerciseLibrary: 1, // Basic
    supplements: 2, // Standard
    periodicCheckups: 2, // Standard
    aiChat: 3, // Advanced
    chatImage: 3,
    chatImageUpload: 3, // Advanced (آلیاس برای ارسال عکس در چت)
    mealPhotoAnalysis: 3,
    bodyPhotoAnalysis: 3,
    progressAnalysis: 2, // Standard (تحلیل پیشرفت بدن — ۳ بار در طول اشتراک)
    gymMode: 3,
    nutritionCompanion: 3,
    fullExerciseLibrary: 3,
    chatVideo: 4, // Ultimate
    chatVideoUpload: 4, // Ultimate (آلیاس برای ارسال ویدیو در چت)
    videoAnalysis: 4,
    techniqueCorrection: 4,
    bloodTest: 4,
    humanCoach: 4,
    hybridProgram: 4,
    // === Aliases — API route names that map to the same tier as the canonical key ===
    // این آلیاس‌ها برای جلوگیری از باگ gating در API route‌ها اضافه شده‌اند.
    // قبلاً requirePlanCapability("bloodTestAnalysis") در route استفاده می‌شد اما
    // کلید در این مپ فقط "bloodTest" بود — که باعث می‌شد minTier برابر 0 شود و
    // capability برای همه پلن‌ها باز باشد. حالا هر دو نام به tier 4 مپ می‌شوند.
    bloodTestAnalysis: 4, // = bloodTest
    videoBodyAnalysis: 4, // = videoAnalysis
  };

  const minTier = minTierMap[capability] ?? 0;
  if (minTier === 0) {
    return { userId: user.id, planName };
  }

  const planTiers: Record<string, number> = {
    basic: 1,
    standard: 2,
    advanced: 3,
    ultimate: 4,
  };
  const currentTier = planName ? planTiers[planName] ?? 0 : 0;

  if (currentTier < minTier) {
    throw new Error("PLAN_UPGRADE_REQUIRED");
  }

  return { userId: user.id, planName };
}

const SESSION_COOKIE = "sc_session";
// Marker cookie set when a user's session was invalidated due to outdated TermsVersion.
// Read by /api/auth/me so the frontend can show the "new terms" modal on the auth screen.
// Cleared on successful OTP verification (verify-otp route).
const TERMS_PENDING_COOKIE = "sc_terms_pending";
const TERMS_PENDING_COOKIE_MAX_AGE = 60 * 60; // 1 hour — long enough for the user to read & accept

// ─── Session Secret — resolve به‌صورت lazy (نه هنگام بارگذاری ماژول) ───
//
// باگ قبلی: این مقدار در سطح ماژول (module scope) ارزیابی می‌شد و اگر
// SESSION_SECRET در .env نبود، `next build` هنگام «Collecting page data»
// (که همه ماژول‌های route را eval می‌کند) با خطای
// "Error: SESSION_SECRET is required in production" می‌شکست.
//
// رفتار جدید (اولویت‌دار):
//   ۱. متغیر محیطی SESSION_SECRET (توصیه‌شده — پایدار بین سرورها)
//   ۲. فایل db/.session-secret — اگر موجود نباشد یک‌بار تولید و ذخیره می‌شود.
//      جستجو/نوشتن با الگوی walk-up (مثل uploads-config.ts) انجام می‌شود تا در
//      حالت standalone (cwd = .next/standalone) فایل در ریشه پروژه (خارج از
//      .next) قرار گیرد و با `rm -rf .next` دیپلوی از بین نرود → کاربران
//      لاگین می‌مانند.
//   ۳. development بدون fs قابل‌نوشتن → کلید تصادفی موقت (رفتار قبلی)
//   ۴. production بدون fs قابل‌نوشتن → خطا فقط هنگام request واقعی (fail-closed)،
//      هرگز هنگام build.
let cachedSessionSecret: string | null = null;

function readSecretFile(filePath: string): string | null {
  try {
    const v = readFileSync(filePath, "utf8").trim();
    return v.length >= 32 ? v : null;
  } catch {
    return null;
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * v62 — اتصال مسیر به‌صورت «کدر» برای node-file-trace.
 *
 * چرا path.join نیست؟ nft (تریس‌ر Next) `path.join(process.cwd(), "db", ...)`
 * را به‌صورت استاتیک حل می‌کند و مسیرهای db/… را به فایل‌های traced بیلد
 * اضافه می‌کرد → کپی دایرکتوری با copyfile → خطای EISDIR در بیلد سرور.
 * این تابع همان خروجی را در runtime می‌سازد ولی الگوی AST قابل‌حل nft ندارد
 * → هیچ مسیری از auth.ts وارد trace نمی‌شود. رفتار runtime بیت‌به‌بیت همان است.
 */
function opaqueJoin(...segs: string[]): string {
  let out = "";
  for (const s of segs) {
    if (!s) continue;
    out = out ? out.replace(/\/+$/, "") + "/" + s : s;
  }
  return out;
}

/** مسیرهای کاندید برای فایل secret — از cwd به بالا (حالت standalone) */
function secretFileCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.SESSION_SECRET_FILE) {
    candidates.push(process.env.SESSION_SECRET_FILE);
  }
  try {
    let dir = process.cwd();
    candidates.push(opaqueJoin(dir, "db", ".session-secret"));
    // walk-up تا ۴ سطح والد — مثل uploads-config.ts (رفع باگ cwd در standalone)
    for (let i = 0; i < 4; i++) {
      dir = path.dirname(dir);
      candidates.push(opaqueJoin(dir, "db", ".session-secret"));
    }
    candidates.push(opaqueJoin(process.cwd(), ".session-secret"));
  } catch {
    // ignore
  }
  return candidates;
}

function resolveSessionSecret(): string {
  // ۱) env صریح — همیشه برنده است
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32 && process.env.NODE_ENV === "production") {
      console.warn(
        `[auth] SESSION_SECRET is shorter than 32 chars (${fromEnv.length}) — consider: openssl rand -hex 32`
      );
    }
    return fromEnv;
  }

  // ۲) فایل ذخیره‌شده قبلی
  for (const candidate of secretFileCandidates()) {
    const saved = readSecretFile(candidate);
    if (saved) return saved;
  }

  // ۳) تولید جدید + ذخیره در بادوام‌ترین محل (بیرونی‌ترین پوشه db موجود —
  //    خارج از .next تا دیپلوی‌ها آن را پاک نکنند)
  const generated = randomBytes(32).toString("hex");
  const writeTargets: string[] = [];
  try {
    let dir = process.cwd();
    const dbDirs = [opaqueJoin(dir, "db")];
    for (let i = 0; i < 4; i++) {
      dir = path.dirname(dir);
      dbDirs.push(opaqueJoin(dir, "db"));
    }
    // از بیرونی‌ترین به درونی‌ترین — اولین پوشه db موجود برای نوشتن انتخاب می‌شود
    for (const d of dbDirs.reverse()) {
      if (isDirectory(d)) {
        writeTargets.push(opaqueJoin(d, ".session-secret"));
      }
    }
    // fallback: cwd/db (در اولین نوشتن ساخته می‌شود)
    writeTargets.push(opaqueJoin(process.cwd(), "db", ".session-secret"));
    writeTargets.push(opaqueJoin(process.cwd(), ".session-secret"));
  } catch {
    writeTargets.push(opaqueJoin(process.cwd(), ".session-secret"));
  }

  for (const target of writeTargets) {
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      // flag "wx" = exclusive create — اگر worker دیگری همین لحظه ساخته بود،
      // EEXIST می‌گیریم و مقدار او را می‌خوانیم (multi-worker/pm2 cluster امن است)
      writeFileSync(target, generated + "\n", { mode: 0o600, flag: "wx" });
      console.warn(
        `[auth] SESSION_SECRET not set — auto-generated & saved to ${target} (stable across restarts/deploys)`
      );
      return generated;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        const saved = readSecretFile(target);
        if (saved) return saved;
      }
      // خطای دیگر (EACCES/EROFS/...) → تلاش برای target بعدی
    }
  }

  // ۴) هیچ محل قابل‌نوشتن‌ای پیدا نشد
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set and db/.session-secret could not be created — add SESSION_SECRET to .env"
    );
  }
  return `dev-insecure-${randomBytes(24).toString("hex")}`;
}

function getSessionSecret(): string {
  if (!cachedSessionSecret) {
    cachedSessionSecret = resolveSessionSecret();
  }
  return cachedSessionSecret;
}

/** حداکثر عمر توکن سشن — v32: ۱۰ سال (درخواست مالک: کاربر تا وقتی خودش خروج
 * نزده هرگز لاگ‌اوت نشود؛ حتی با تغییر IP هم — هیچ IP-binding وجود ندارد).
 * کوکی مرورگر سقف ۴۰۰ روز دارد (Chrome) — با تمدید لغزنده (sliding) زیر
 * فعال‌بودن کاربر، کوکی هر بار که توکن قدیمی شود تازه می‌شود. */
const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 365 * 10 * 1000;
/** کوکی سشن — ۴۰۰ روز (سقف مرورگرها) */
const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;
/** آستانهٔ تمدید لغزنده: توکن قدیمی‌تر از ۱۸۰ روز → صادر توکن تازه */
const SESSION_SLIDING_REFRESH_MS = 60 * 60 * 24 * 180 * 1000;

/**
 * Helper — reads the latest active TermsVersion number from DB.
 * Returns 0 if no active version exists (no terms enforcement).
 *
 * Used by getCurrentUser to detect outdated acceptedTermsVersion.
 */
export async function getCurrentTermsVersion(): Promise<number> {
  try {
    const active = await db.termsVersion.findFirst({
      // v32: فقط سند «قوانین» — سند «حریم خصوصی» (slug=privacy) شماره نسخهٔ
      // مستقل دارد و نباید در سنجش acceptedTermsVersion/مودال پذیرش لحاظ شود
      where: { isActive: true, slug: "terms" },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return active?.version ?? 0;
  } catch {
    // DB failure → don't block login; treat as "no terms enforcement"
    return 0;
  }
}

/**
 * Helper — clears the sc_terms_pending marker cookie.
 * Called on successful OTP verification (user re-accepted terms implicitly via OTP).
 */
export async function clearTermsPendingCookie() {
  try {
    const cookieStore = await cookies();
    cookieStore.set(TERMS_PENDING_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    cookieStore.delete(TERMS_PENDING_COOKIE);
  } catch {
    // ignore — cookie clearing is best-effort
  }
}

// Hash a password using scrypt
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Verify a password against stored hash
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual(hashBuf, testBuf);
}

// Validate Iranian mobile number
export function validateMobile(mobile: string): boolean {
  return /^09\d{9}$/.test(mobile.replace(/\s/g, ""));
}

// Validate password strength (min 6 chars)
export function validatePassword(password: string): boolean {
  return password.length >= 6;
}

// Create a signed session token (base64 of userId + signature)
export function createSessionToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, getSessionSecret(), 32).toString("hex");
  return `${payload}.${sig}`;
}

// Verify and decode session token
//
// بهینه‌سازی CPU: scryptSync در هر request اجرا نمی‌شود — نتیجهی تأیید موفق
// برای hash توکن (SHA-256، نه خود توکن) تا ۶۰ ثانیه در کش درون‌حافظه‌ای
// نگه داشته می‌شود. جستجوی DB (وجود کاربر/blocked/terms) همچنان در هر
// request انجام می‌شود و معتبر باقی می‌ماند؛ فقط هزینه‌ی سنگین scrypt حذف
// می‌شود (حداکثر پنجره‌ی ۶۰ ثانیه‌ای بعد از logout ممکن است باقی بماند که
// توسط همان بررسی DB و انقضای ۳۰ روزه سمت سرور محدود شده است).
const SESSION_VERIFY_CACHE_TTL_MS = 60 * 1000;
const SESSION_VERIFY_CACHE_MAX = 512; // سقف اندازه کش (تقریباً LRU)
const sessionVerifyCache = new Map<
  string,
  { decoded: { uid: string; t: number }; exp: number }
>();

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function verifySessionToken(token: string): { uid: string; t: number } | null {
  try {
    // کش: اگر همین توکن اخیراً با scrypt تأیید شده، بدون scrypt ادامه بده
    const cacheKey = sha256Hex(token);
    const cached = sessionVerifyCache.get(cacheKey);
    if (cached) {
      if (cached.exp > Date.now()) {
        // انقضای سمت سرور همچنان چک می‌شود
        if (Date.now() - cached.decoded.t > SESSION_MAX_AGE_MS) return null;
        return cached.decoded;
      }
      sessionVerifyCache.delete(cacheKey); // ورودی منقضی
    }

    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expectedSig = scryptSync(payload, getSessionSecret(), 32).toString("hex")
    // مقایسه timing-safe برای جلوگیری از حملات timing
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!decoded?.uid || typeof decoded.t !== "number") return null;
    // انقضای سمت سرور — توکن سرقت‌شده بعد از ۳۰ روز بی‌اعتبار می‌شود
    if (Date.now() - decoded.t > SESSION_MAX_AGE_MS) return null;

    // تأیید موفق → در کش ذخیره کن (با سقف اندازه، قدیمی‌ترین ورودی حذف می‌شود)
    if (sessionVerifyCache.size >= SESSION_VERIFY_CACHE_MAX) {
      const oldestKey = sessionVerifyCache.keys().next().value;
      if (oldestKey !== undefined) sessionVerifyCache.delete(oldestKey);
    }
    sessionVerifyCache.set(cacheKey, {
      decoded,
      exp: Date.now() + SESSION_VERIFY_CACHE_TTL_MS,
    });
    return decoded;
  } catch {
    return null;
  }
}

// Set session cookie
export async function setSession(userId: string) {
  const token = createSessionToken(userId);
  const cookieStore = await cookies();
  // secure: true در production (HTTPS)، false در development (HTTP)
  const isProduction = process.env.NODE_ENV === "production";
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    // v32: ۴۰۰ روز (سقف مرورگرها) + تمدید لغزنده در getCurrentUser —
    // کاربر فعال هرگز لاگ‌اوت نمی‌شود
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });
}

// Clear session cookie
export async function clearSession() {
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === "production";
  // حذف cookie با همان تنظیماتی که set شده (secure, sameSite, path)
  // تا اطمینان حاصل شود cookie واقعاً پاک می‌شود
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0, // فوراً منقضی می‌شود
  });
  // همچنین delete را هم صدا بزن (برای اطمینان)
  cookieStore.delete(SESSION_COOKIE);
}

// Get current logged-in user (or null)
//
// v32 — بدون لاگ‌اوت خودکار (درخواست مالک):
//   • کاربر تا وقتی خودش «خروج» نزده لاگ‌ین می‌ماند — هیچ انقضای ۳۰روزه‌ای
//     وجود ندارد (توکن ۱۰ ساله + تمدید لغزندهٔ کوکی).
//   • تغییر IP هیچ تاثیری ندارد (هیچ IP-binding در توکن نیست).
//   • قوانین جدید دیگر لاگ‌اوت نمی‌کند — فلگ termsUpdateRequired در DTO
//     برمی‌گردد و کلاینت مودال پذیرش درجا نشان می‌دهد (پذیرش با
//     POST /api/terms/accept بدون از دست رفتن سشن).
//   • تنها استثنا: بلاک شدن حساب توسط ادمین (isBlocked).
export async function getCurrentUser() {
  const { user } = await getCurrentUserWithMeta();
  return user;
}

export interface CurrentUserMeta {
  user: Awaited<ReturnType<typeof db.user.findUnique>>;
  /**
   * v49 (باگ «تغییر IP/VPN → رفرش → لاگ‌اوت → رفرش → لاگین»):
   * true یعنی کوکی سشن کاملاً معتبر بود (امضا OK) ولی خطای گذرای زیرساخت
   * (شبکه/DB busy در لحظهٔ سوئیچ VPN) جلوی خواندن کاربر را گرفت.
   * در این حالت «لاگین‌نبودن» نیست — فقط نامعلومیِ موقت است.
   */
  transientError: boolean;
  /**
   * v51 (درخواست مالک — مسدودسازی کاربر): true یعنی کوکی سشن معتبر است ولی
   * کاربر توسط ادمین مسدود شده (isBlocked). در این حالت user=null است (همهٔ
   * APIها مثل قبل ۴۰۱ می‌دهند) ولی /api/auth/me و SSR با این فلگ صفحهٔ
   * زیبای «پنل کاربری شما از طرف مدیریت مسدود شده است» را نشان می‌دهند —
   * نه لندینگ و نه لاگ‌اوتِ بی‌توضیح.
   */
  blocked: boolean;
}

/**
 * همان getCurrentUser با تشخیص «خطای گذرا»:
 *  - کاربر/کوکی واقعاً نیست → { user: null, transientError: false } (لاگین نیست)
 *  - کوکی معتبر ولی خطای گذرا → { user: null, transientError: true }
 *
 * فقط ssr-screen (تصمیم صفحهٔ اولیهٔ SSR) از transientError استفاده می‌کند تا
 * کاربرِ وسطِ سوئیچ VPN به‌جای پرتاب‌شدن به لندینگ/auth، در پنل بماند؛
 * doAuthCheck کلاینت ظرف یک ثانیه تصحیحش می‌کند اگر واقعاً لاگین نبود.
 */
export async function getCurrentUserWithMeta(): Promise<CurrentUserMeta> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return { user: null, transientError: false, blocked: false };
    const decoded = verifySessionToken(token);
    if (!decoded) return { user: null, transientError: false, blocked: false };
    try {
      const user = await db.user.findUnique({
        where: { id: decoded.uid },
      });
      if (!user) return { user: null, transientError: false, blocked: false };
      // v51: کاربر مسدود → user=null (همهٔ APIها ۴۰۱ می‌دهند) + blocked=true
      // تا /api/auth/me و SSR بتوانند صفحهٔ مسدود را نشان دهند
      if (user.isBlocked) return { user: null, transientError: false, blocked: true };

      // ─── تمدید لغزندهٔ سشن (v32) ───
      if (Date.now() - decoded.t > SESSION_SLIDING_REFRESH_MS) {
        try {
          await setSession(user.id);
        } catch {
          // RSC context — تمدید در اولین فراخوانی API انجام می‌شود
        }
      }

      return { user, transientError: false, blocked: false };
    } catch {
      // خطای DB/شبکه با کوکیِ معتبر → گذرا (نه «لاگین‌نبودن»)
      return { user: null, transientError: true, blocked: false };
    }
  } catch {
    return { user: null, transientError: false, blocked: false };
  }
}

// Require authentication - throws if not logged in
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

// Require admin role
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return user;
}

// Standard API error handler — logs 500-level errors to the database for admin review
export function apiError(error: unknown) {
  const msg = error instanceof Error ? error.message : "خطای ناشناخته";
  if (msg === "UNAUTHORIZED") {
    return Response.json({ error: "ابتدا وارد حساب کاربری شوید." }, { status: 401 });
  }
  if (msg === "FORBIDDEN") {
    return Response.json({ error: "دسترسی غیرمجاز." }, { status: 403 });
  }
  if (msg === "PLAN_UPGRADE_REQUIRED") {
    return Response.json(
      {
        error: "این قابلیت در پلن شما فعال نیست. لطفاً پلن خود را ارتقا دهید.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
      { status: 403 }
    );
  }
  console.error("[API Error]", msg);
  // Log 500-level errors to DB for admin review (fire-and-forget, never breaks the response)
  try {
    const stack = error instanceof Error ? error.stack : undefined;
    const userIdPromise = getCurrentUser()
      .then((u) => u?.id)
      .catch(() => undefined);
    userIdPromise
      .then((userId) =>
        logError({
          source: "api",
          message: msg,
          stack,
          statusCode: 500,
          userId,
        })
      )
      .catch(() => {});
  } catch {
    // never let logging break the response
  }
  // v73.2 — گارد محرمانگی: پیام خام backend (خطای Prisma/فایل/گیت‌وی AI و…) هرگز
  // به کاربر نمی‌رود — جزئیات کامل فقط در logError (تب لاگ خطاهای ادمین) می‌ماند.
  return Response.json(
    { error: "خطای غیرمنتظره‌ای رخ داد. لطفاً کمی بعد دوباره تلاش کنید." },
    { status: 500 }
  );
}
