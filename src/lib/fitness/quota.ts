import "server-only";
import { db } from "@/lib/db";
import { getTehranDayKey } from "./day";

/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 4-a — سیستم سهمیهٔ مصرف رسانه (QUOTA ENGINE)
 * ═══════════════════════════════════════════════════════════════
 *
 *  سه دستهٔ سهمیه بر اساس مدل QuotaUsage (اسکیما v53):
 *    • chat_photo     — عکس در چت با فیتاپ (سقف دوره‌ای از SiteSetting + سقف روزانه)
 *    • meal_photo     — تحلیل عکس غذا (سقف = تعداد روزهای پلن فعال — پیش‌فرض ۴۵)
 *    • movement_video — تحلیل ویدیو حرکات (سقف = تعداد کل حرکات برنامهٔ تمرینی فعال؛ نبود → پیش‌فرض)
 *
 *  مقادیر پایه از SiteSetting (الگوی key/value رشته‌ای مثل costs.ts):
 *    quota_chat_photo_total          → پیش‌فرض "90"
 *    quota_chat_photo_daily          → پیش‌فرض "2"
 *    quota_meal_photo_use_plan_days  → پیش‌فرض "1" (۱ یعنی سقف = روزهای پلن)
 *    quota_meal_photo_total          → پیش‌فرض "45" (فقط وقتی use_plan_days غیرفعال باشد)
 *    quota_movement_video_default    → پیش‌فرض "10" (وقتی برنامه/حرکتی نیست)
 *
 *  سهمیهٔ اضافه (bonus) توسط ادمین مستقیماً در QuotaUsage.bonus داده می‌شود و
 *  با شروع دورهٔ پلن جدید (تغییر planStartedAt) صفر می‌شود — ریست دوره در
 *  هر خواندن/افزایش به‌صورت تنبل انجام می‌شود (lazy reset با مقایسهٔ periodStart).
 *
 *  ریاضیات:
 *    total     = baseTotal + bonus   (سقف مؤثر دوره)
 *    remaining = max(0, total − used)
 *    daily     = فقط chat_photo (مرز روز تهران — getTehranDayKey)
 *
 *  این ماژول هرگز throw نمی‌کند (به‌جز خطاهای نامنتظره DB که caller با
 *  apiError مدیریت می‌کند) — همهٔ پارس‌ها fallback امن دارند.
 * ═══════════════════════════════════════════════════════════════
 */

export type QuotaCategory = "chat_photo" | "meal_photo" | "movement_video";

export const QUOTA_CATEGORIES: QuotaCategory[] = ["chat_photo", "meal_photo", "movement_video"];

// ─── کلیدهای SiteSetting + پیش‌فرض‌ها ───

export const QUOTA_SETTING_KEYS = {
  chatPhotoTotal: "quota_chat_photo_total",
  chatPhotoDaily: "quota_chat_photo_daily",
  mealPhotoUsePlanDays: "quota_meal_photo_use_plan_days",
  mealPhotoTotal: "quota_meal_photo_total",
  movementVideoDefault: "quota_movement_video_default",
} as const;

const QUOTA_SETTING_DEFAULTS: Record<string, number> = {
  [QUOTA_SETTING_KEYS.chatPhotoTotal]: 90,
  [QUOTA_SETTING_KEYS.chatPhotoDaily]: 2,
  [QUOTA_SETTING_KEYS.mealPhotoUsePlanDays]: 1,
  [QUOTA_SETTING_KEYS.mealPhotoTotal]: 45,
  [QUOTA_SETTING_KEYS.movementVideoDefault]: 10,
};

/** تعداد روزهای پلن وقتی هیچ راهی برای محاسبه نبود (fallback) */
const FALLBACK_PLAN_DAYS = 45;

// ─── تایپ‌های خروجی ───

export interface QuotaLimits {
  /** سقف پایهٔ دوره (بدون bonus) */
  baseTotal: number;
  /** سقف مؤثر دوره = baseTotal + bonus */
  total: number;
  /** سهمیهٔ اضافهٔ ادمین */
  bonus: number;
  /** مصرف دورهٔ جاری */
  used: number;
  /** باقی‌ماندهٔ دوره (≥ 0) */
  remaining: number;
  /** سقف روزانه — فقط chat_photo؛ بقیه ۰ */
  dailyTotal: number;
  /** مصرف امروز — فقط chat_photo؛ بقیه ۰ */
  dailyUsed: number;
  /** باقی‌ماندهٔ امروز (≥ 0) — فقط chat_photo؛ بقیه ۰ */
  dailyRemaining: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  total: number;
  dailyRemaining?: number;
  /** پیام فارسی زیبا برای نمایش در toast وقتی سهمیه تمام شده */
  messageFa?: string;
  /** kind سهمیه‌ای که تمام شده — برای پیام‌های متفاوت روزانه/دوره */
  exhaustedKind?: "daily" | "period" | "no_plan";
  code?: "QUOTA_EXHAUSTED";
}

// ─── کمکی‌های داخلی ───

function parsePositiveInt(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(String(raw).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

async function readQuotaSetting(key: string): Promise<number> {
  const fallback = QUOTA_SETTING_DEFAULTS[key] ?? 0;
  try {
    const row = await db.siteSetting.findUnique({ where: { key } });
    return parsePositiveInt(row?.value, fallback);
  } catch {
    return fallback;
  }
}

async function readQuotaSettings(keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await db.siteSetting.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    for (const key of keys) {
      out.set(key, parsePositiveInt(map.get(key), QUOTA_SETTING_DEFAULTS[key] ?? 0));
    }
  } catch {
    for (const key of keys) out.set(key, QUOTA_SETTING_DEFAULTS[key] ?? 0);
  }
  return out;
}

export interface PlanPeriod {
  /** آیا پلن فعال (active یا pending — سازگار با gating قابلیت‌ها) دارد؟ */
  hasPlan: boolean;
  planName: string | null;
  /** شروع دورهٔ پلن — مبنای periodStart در QuotaUsage (null ممکن) */
  startedAt: Date | null;
  expiresAt: Date | null;
  /** تعداد روزهای پلن (durationDays یا فاصلهٔ شروع→انقضا) */
  planDays: number;
}

/**
 * تشخیص دورهٔ پلن — اولویت با Subscription فعال (status=active و endDate در آینده).
 * برای سازگاری با requirePlanCapability (که pending را هم مجاز می‌کند)،
 * اشتراک pending معتبر هم hasPlan=true می‌دهد (startDate null → periodStart null).
 * اگر Subscription نبود، از planStartedAt/planExpiresAt خود کاربر استفاده می‌شود.
 */
export async function resolvePlanPeriod(userId: string): Promise<PlanPeriod> {
  try {
    const now = new Date();
    const [sub, user] = await Promise.all([
      db.subscription.findFirst({
        where: { userId, status: "active", endDate: { gt: now } },
        orderBy: { endDate: "desc" },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { planName: true, planStartedAt: true, planExpiresAt: true },
      }),
    ]);

    if (sub && sub.endDate && sub.endDate.getTime() > now.getTime()) {
      const startedAt = sub.startDate ?? user?.planStartedAt ?? null;
      let planDays = sub.durationDays ?? 0;
      if (!planDays || planDays <= 0) {
        planDays = startedAt
          ? Math.max(1, Math.ceil((sub.endDate.getTime() - startedAt.getTime()) / 86_400_000))
          : FALLBACK_PLAN_DAYS;
      }
      return {
        hasPlan: true,
        planName: sub.plan ?? user?.planName ?? null,
        startedAt,
        expiresAt: sub.endDate,
        planDays,
      };
    }

    // اشتراک pending (خرید شده ولی پیش‌نیازها ناقص) — قابلیت‌ها باز است ولی دوره شروع نشده
    const pendingSub = await db.subscription
      .findFirst({
        where: {
          userId,
          status: "pending",
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      })
      .catch(() => null);

    if (pendingSub) {
      return {
        hasPlan: true,
        planName: pendingSub.plan ?? user?.planName ?? null,
        startedAt: user?.planStartedAt ?? null,
        expiresAt: user?.planExpiresAt ?? pendingSub.endDate ?? null,
        planDays: pendingSub.durationDays || FALLBACK_PLAN_DAYS,
      };
    }

    // بدون اشتراک — اگر planExpiresAt کاربر هنوز در آینده است (legacy) پلن در نظر بگیر
    const legacyExpires = user?.planExpiresAt ?? null;
    const legacyActive = !!legacyExpires && legacyExpires.getTime() > now.getTime() && !!user?.planName;
    return {
      hasPlan: legacyActive,
      planName: legacyActive ? user?.planName ?? null : null,
      startedAt: legacyActive ? user?.planStartedAt ?? null : null,
      expiresAt: legacyActive ? legacyExpires : null,
      planDays: FALLBACK_PLAN_DAYS,
    };
  } catch {
    return {
      hasPlan: false,
      planName: null,
      startedAt: null,
      expiresAt: null,
      planDays: FALLBACK_PLAN_DAYS,
    };
  }
}

/**
 * شمارش کل حرکات برنامهٔ تمرینی فعال کاربر (روی همهٔ روزها/جلسات).
 * ساختار محتوای WorkoutPlan: { days: [{ day, exercises: [...] , ... }], ... }
 * برنامه نیست / JSON خراب است / days نیست → 0.
 */
export async function countActiveWorkoutPlanExercises(userId: string): Promise<number> {
  try {
    const plan = await db.workoutPlan.findFirst({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (!plan?.content) return 0;
    const parsed = JSON.parse(plan.content);
    if (!parsed || !Array.isArray(parsed.days)) return 0;
    let count = 0;
    for (const day of parsed.days) {
      if (day && Array.isArray(day.exercises)) count += day.exercises.length;
    }
    return count;
  } catch {
    return 0;
  }
}

// ─── ردیف QuotaUsage با ریست تنبل دوره/روز ───

interface EffectiveQuotaRow {
  used: number;
  bonus: number;
  dailyUsed: number;
  /** آیا ردیف در این فراخوانی ریست شد (فقط برای لاگ) */
  resetPeriod: boolean;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/**
 * خواندن ردیف سهمیه با اعمال ریست تنبل:
 *  • اگر periodStart ردیف با planStartedAt فعلی فرق دارد → used=0, dailyUsed=0, bonus=0
 *    (دورهٔ جدید پلن — bonus ادمین هم ریست می‌شود چون دوره عوض شده؛ ادمین دوباره می‌دهد)
 *  • اگر dailyKey با امروزِ تهران فرق دارد → dailyUsed=0
 * ریست درجا (update) انجام می‌شود تا شمارنده‌ها همیشه منسجم باشند.
 */
async function getEffectiveQuotaRow(
  userId: string,
  category: QuotaCategory,
  period: PlanPeriod
): Promise<EffectiveQuotaRow> {
  const today = getTehranDayKey();
  const empty: EffectiveQuotaRow = { used: 0, bonus: 0, dailyUsed: 0, resetPeriod: false };

  let row;
  try {
    row = await db.quotaUsage.findUnique({
      where: { userId_category: { userId, category } },
    });
  } catch {
    return empty;
  }
  if (!row) return empty;

  const periodChanged = !sameInstant(row.periodStart, period.startedAt);
  const dayChanged = row.dailyKey !== today;

  if (!periodChanged && !dayChanged) {
    return { used: row.used, bonus: row.bonus, dailyUsed: row.dailyUsed, resetPeriod: false };
  }

  // ریست درجا — updateMany (نه update) تا در رقابت، ردیفِ تازه‌ساخت نمی‌شکند
  const data = periodChanged
    ? { used: 0, dailyUsed: 0, bonus: 0, dailyKey: today, periodStart: period.startedAt }
    : { dailyUsed: 0, dailyKey: today };
  try {
    await db.quotaUsage.updateMany({
      where: { userId, category },
      data,
    });
  } catch {
    // ریست شکست خورد → مقادیر قبلی را برگردان (شمارش کمی محافظه‌کارانه‌تر می‌شود)
    return { used: row.used, bonus: row.bonus, dailyUsed: dayChanged ? 0 : row.dailyUsed, resetPeriod: periodChanged };
  }

  return {
    used: periodChanged ? 0 : row.used,
    bonus: periodChanged ? 0 : row.bonus,
    dailyUsed: 0,
    resetPeriod: periodChanged,
  };
}

// ─── محاسبهٔ سقف‌ها ───

/** سقف پایهٔ هر دسته (بدون bonus) — بر اساس SiteSetting/پلن/حرکات برنامه */
async function computeBaseTotal(
  userId: string,
  category: QuotaCategory,
  period: PlanPeriod
): Promise<number> {
  if (!period.hasPlan) return 0;

  if (category === "chat_photo") {
    return readQuotaSetting(QUOTA_SETTING_KEYS.chatPhotoTotal);
  }

  if (category === "meal_photo") {
    const settings = await readQuotaSettings([
      QUOTA_SETTING_KEYS.mealPhotoUsePlanDays,
      QUOTA_SETTING_KEYS.mealPhotoTotal,
    ]);
    const usePlanDays = settings.get(QUOTA_SETTING_KEYS.mealPhotoUsePlanDays) === 1;
    if (usePlanDays) {
      // سقف = تعداد روزهای پلن فعال (fallback ۴۵)
      return Math.max(1, period.planDays || FALLBACK_PLAN_DAYS);
    }
    return settings.get(QUOTA_SETTING_KEYS.mealPhotoTotal) ?? QUOTA_SETTING_DEFAULTS[QUOTA_SETTING_KEYS.mealPhotoTotal];
  }

  // movement_video — به تعداد حرکات برنامهٔ فعال؛ نبود برنامه/حرکت → پیش‌فرض
  const exerciseCount = await countActiveWorkoutPlanExercises(userId);
  if (exerciseCount > 0) return exerciseCount;
  return readQuotaSetting(QUOTA_SETTING_KEYS.movementVideoDefault);
}

/**
 * سقف‌های هر سه دسته برای کاربر — برای رندر UI و منطق سمت سرور.
 * اگر پلن فعال نباشد همهٔ سقف‌ها ۰ هستند (UI چیپ را مخفی/قفل می‌کند).
 */
export async function getQuotaLimits(userId: string): Promise<Record<QuotaCategory, QuotaLimits>> {
  const period = await resolvePlanPeriod(userId);
  const chatDaily = period.hasPlan ? await readQuotaSetting(QUOTA_SETTING_KEYS.chatPhotoDaily) : 0;

  const result = {} as Record<QuotaCategory, QuotaLimits>;
  for (const category of QUOTA_CATEGORIES) {
    try {
      const [baseTotal, row] = await Promise.all([
        computeBaseTotal(userId, category, period),
        getEffectiveQuotaRow(userId, category, period),
      ]);
      const total = baseTotal + row.bonus;
      const dailyTotal = category === "chat_photo" ? chatDaily : 0;
      result[category] = {
        baseTotal,
        total,
        bonus: row.bonus,
        used: row.used,
        remaining: Math.max(0, total - row.used),
        dailyTotal,
        dailyUsed: Math.min(row.dailyUsed, dailyTotal || row.dailyUsed),
        dailyRemaining: category === "chat_photo" ? Math.max(0, dailyTotal - row.dailyUsed) : 0,
      };
    } catch {
      result[category] = {
        baseTotal: 0,
        total: 0,
        bonus: 0,
        used: 0,
        remaining: 0,
        dailyTotal: 0,
        dailyUsed: 0,
        dailyRemaining: 0,
      };
    }
  }
  return result;
}

// ─── پیام‌های فارسی ───

function exhaustedMessageFa(category: QuotaCategory, kind: "daily" | "period" | "no_plan", dailyTotal: number): string {
  if (kind === "no_plan") {
    return "برای استفاده از این قابلیت باید پلن فعالی داشته باشی. پلن خود را ارتقا بده 💪";
  }
  if (category === "chat_photo") {
    if (kind === "daily") {
      return `سهمیهٔ روزانهٔ ارسال عکس (${dailyTotal} عکس در روز) تمام شد؛ فردا دوباره می‌توانی عکس بفرستی 🌙`;
    }
    return "سهمیهٔ ارسال عکس این دورهٔ پلن شما تمام شد؛ مدیر می‌تواند سهمیهٔ اضافه فعال کند 🙏";
  }
  if (category === "meal_photo") {
    return "سهمیهٔ تحلیل عکس غذا این دورهٔ پلن شما تمام شد؛ مدیر می‌تواند سهمیهٔ اضافه فعال کند 🙏";
  }
  return "سهمیهٔ تحلیل ویدیو حرکات این دورهٔ پلن شما تمام شد؛ مدیر می‌تواند سهمیهٔ اضافه فعال کند 🙏";
}

// ─── API اصلی ───

/**
 * بررسی اجازهٔ مصرف یک واحد از سهمیه (بدون مصرف کردن).
 * خروجی شامل پیام فارسی دقیق برای toast است (دو پیام جدا: روز پر است / دوره تمام است).
 */
export async function checkQuota(userId: string, category: QuotaCategory): Promise<QuotaCheckResult> {
  try {
    const limits = await getQuotaLimits(userId);
    const q = limits[category];

    if (q.total <= 0 && q.used === 0) {
      return {
        allowed: false,
        remaining: 0,
        total: 0,
        messageFa: exhaustedMessageFa(category, "no_plan", q.dailyTotal),
        exhaustedKind: "no_plan",
        code: "QUOTA_EXHAUSTED",
      };
    }

    if (category === "chat_photo" && q.dailyTotal > 0 && q.dailyRemaining <= 0) {
      return {
        allowed: false,
        remaining: q.remaining,
        total: q.total,
        dailyRemaining: 0,
        messageFa: exhaustedMessageFa(category, "daily", q.dailyTotal),
        exhaustedKind: "daily",
        code: "QUOTA_EXHAUSTED",
      };
    }

    if (q.remaining <= 0) {
      return {
        allowed: false,
        remaining: 0,
        total: q.total,
        dailyRemaining: q.dailyRemaining,
        messageFa: exhaustedMessageFa(category, "period", q.dailyTotal),
        exhaustedKind: "period",
        code: "QUOTA_EXHAUSTED",
      };
    }

    return {
      allowed: true,
      remaining: category === "chat_photo" ? Math.min(q.remaining, q.dailyRemaining || q.remaining) : q.remaining,
      total: q.total,
      dailyRemaining: category === "chat_photo" ? q.dailyRemaining : undefined,
    };
  } catch (e) {
    // خطای زیرساختی → fail-closed با پیام مهربان (سهمیه نباید در خطا بی‌نهایت شود)
    console.error(`[quota] checkQuota failed (${category}):`, e);
    return {
      allowed: false,
      remaining: 0,
      total: 0,
      messageFa: "خطا در بررسی سهمیه. لطفاً دوباره تلاش کنید.",
      code: "QUOTA_EXHAUSTED",
    };
  }
}

function isUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

/**
 * مصرف یک واحد سهمیه — upsert با مدیریت رقابت (unique [userId, category]):
 *  ۱) updateMany روی ردیفِ هم‌دوره/هم‌روز (مسیر سریع)
 *  ۲) updateMany با ریست روزانه (روز عوض شده)
 *  ۳) create (ردیف نیست یا دوره عوض شده — bonus/used صفر شروع می‌شود)
 *  ۴) P2002 (ردیف همزمان ساخته شد) → تلاش مجدد مسیرهای ۱-۲ و در نهایت ریست دوره
 */
export async function incrementQuota(userId: string, category: QuotaCategory): Promise<void> {
  const today = getTehranDayKey();
  const period = await resolvePlanPeriod(userId);
  const periodStart = period.startedAt;

  const updateSameDay = () =>
    db.quotaUsage.updateMany({
      where: { userId, category, periodStart: periodStart ?? null, dailyKey: today },
      data: { used: { increment: 1 }, dailyUsed: { increment: 1 }, updatedAt: new Date() },
    });

  const updateNewDay = () =>
    db.quotaUsage.updateMany({
      where: { userId, category, periodStart: periodStart ?? null },
      data: { used: { increment: 1 }, dailyUsed: 1, dailyKey: today, updatedAt: new Date() },
    });

  const resetAndCount = () =>
    db.quotaUsage.updateMany({
      where: { userId, category },
      data: { used: 1, dailyUsed: 1, dailyKey: today, bonus: 0, periodStart, updatedAt: new Date() },
    });

  const createRow = () =>
    db.quotaUsage.create({
      data: { userId, category, used: 1, dailyUsed: 1, dailyKey: today, bonus: 0, periodStart },
    });

  try {
    let res = await updateSameDay();
    if (res.count === 0) res = await updateNewDay();
    if (res.count === 0) {
      try {
        await createRow();
      } catch (e) {
        if (!isUniqueConstraintError(e)) throw e;
        // ردیف همزمان ساخته شد — مسیرهای update را دوباره امتحان کن
        res = await updateSameDay();
        if (res.count === 0) res = await updateNewDay();
        if (res.count === 0) await resetAndCount();
      }
    }
  } catch (e) {
    // increment هرگز جریان اصلی را نمی‌شکند — فقط لاگ (مصرف نشدن یک واحد بهتر از شکست ارسال است)
    console.error(`[quota] incrementQuota failed (${category}):`, e);
  }
}

// ─── خلاصهٔ کامل برای UI ───

export interface QuotaPartSummary {
  used: number;
  total: number;
  baseTotal: number;
  bonus: number;
  dailyUsed: number;
  dailyTotal: number;
  remaining: number;
}

export interface QuotaSummary {
  hasPlan: boolean;
  planName: string | null;
  planDays: number;
  /** تعداد کل حرکات برنامهٔ تمرینی فعال (منبع سقف movement_video) */
  workoutExerciseCount: number;
  chatPhoto: QuotaPartSummary;
  mealPhoto: QuotaPartSummary;
  movementVideo: QuotaPartSummary;
}

function toPartSummary(limits: QuotaLimits): QuotaPartSummary {
  return {
    used: limits.used,
    total: limits.total,
    baseTotal: limits.baseTotal,
    bonus: limits.bonus,
    dailyUsed: limits.dailyUsed,
    dailyTotal: limits.dailyTotal,
    remaining: limits.remaining,
  };
}

/**
 * آبجکت کامل سهمیه‌ها برای GET /api/user/quota و بنر UI.
 * برای کاربر بدون پلن همهٔ سقف‌ها صفر است (UI مخفی/قفل می‌کند).
 */
export async function getUserQuotaSummary(userId: string): Promise<QuotaSummary> {
  const period = await resolvePlanPeriod(userId);
  const limits = await getQuotaLimits(userId);
  const workoutExerciseCount = period.hasPlan
    ? await countActiveWorkoutPlanExercises(userId)
    : 0;

  return {
    hasPlan: period.hasPlan,
    planName: period.planName,
    planDays: period.planDays,
    workoutExerciseCount,
    chatPhoto: toPartSummary(limits.chat_photo),
    mealPhoto: toPartSummary(limits.meal_photo),
    movementVideo: toPartSummary(limits.movement_video),
  };
}

// ─── بونوس ادمین (v53 — تسک 6-a) ───

export interface GrantBonusResult {
  ok: boolean;
  /** پیام فارسی خطا — وقتی ok=false */
  error?: string;
}

/**
 * افزودن سهمیهٔ بونوس توسط ادمین — به‌روزرسانی QuotaUsage با همان قواعد ریست دوره:
 *  • اگر ردیف دورهٔ جاری را نشان دهد (periodStart برابر planStartedAt فعلی) → bonus += amount
 *  • اگر ردیف قدیمی/متعلق به دورهٔ قبلی است → با ریست دوره ساخته می‌شود (used=0, dailyUsed=0,
 *    bonus=amount, periodStart=شروع دورهٔ فعلی) — عین رفتار ریست تنبل getEffectiveQuotaRow
 *  • اگر ردیف نیست → upsert می‌سازد
 * گارد مقدار: 1..500 (ادمین از UI همین محدوده را می‌فرستد؛ سرور هم clamp می‌کند).
 */
export async function grantQuotaBonus(
  userId: string,
  category: QuotaCategory,
  amount: number
): Promise<GrantBonusResult> {
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt < 1 || amt > 500) {
    return { ok: false, error: "مقدار بونوس باید عددی بین ۱ تا ۵۰۰ باشد." };
  }
  if (!QUOTA_CATEGORIES.includes(category)) {
    return { ok: false, error: "دستهٔ سهمیه نامعتبر است." };
  }

  const period = await resolvePlanPeriod(userId);
  const periodStart = period.startedAt;
  const today = getTehranDayKey();

  // مسیر سریع: ردیفِ هم‌دوره → افزایش bonus
  const samePeriod = await db.quotaUsage
    .updateMany({
      where: { userId, category, periodStart: periodStart ?? null },
      data: { bonus: { increment: amt }, updatedAt: new Date() },
    })
    .catch(() => ({ count: 0 }));
  if (samePeriod.count > 0) return { ok: true };

  // ردیف نیست یا دوره عوض شده → upsert با ریست کامل دوره (مطابق قواعد lib)
  try {
    await db.quotaUsage.upsert({
      where: { userId_category: { userId, category } },
      update: { used: 0, dailyUsed: 0, dailyKey: today, bonus: { increment: amt }, periodStart, updatedAt: new Date() },
      create: { userId, category, used: 0, dailyUsed: 0, dailyKey: today, bonus: amt, periodStart },
    });
    return { ok: true };
  } catch (e) {
    console.error(`[quota] grantQuotaBonus failed (${category}):`, e);
    return { ok: false, error: "ثبت سهمیهٔ بونوس ناموفق بود. لطفاً دوباره تلاش کنید." };
  }
}
