/**
 * ─── برچسب‌های فارسی مشترک پنل مدیر (v157-a بازطراحی مدیریت کاربران) ───
 *
 * همهٔ برچسب‌ها/فرمت‌های تکرارشوندهٔ بخش «مدیریت کاربران» در یک نقطه جمع شده‌اند
 * تا هیچ متن انگلیسی یا نگاشت تکراری بین کامپوننت‌ها نمانَد.
 *
 * قاعدهٔ مالک: در UI پنل مدیر هیچ کلمهٔ انگلیسی مجاز نیست (فقط اعداد فارسی).
 * نگاشت منبع تولید برنامه، هم‌الگوی PLAN_SOURCE_LABELS در programs-view.tsx است.
 */

// ─── منبع تولید هر نسخهٔ برنامه (WorkoutPlan/MealPlan.generatedSource) ───
export const ADMIN_PLAN_SOURCE_LABELS: Record<string, string> = {
  purchase: "خرید اولیه",
  checkup: "به‌روزرسانی چکاپ",
  admin_rewrite: "بازنویسی مدیر",
  chat_request: "بازطراحی از چت با فیتاپ",
  weight_update: "به‌روزرسانی وزن",
};

export function adminPlanSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return ADMIN_PLAN_SOURCE_LABELS[source] ?? null;
}

// ─── وضعیت درخواست برنامه (ProgramRequest.status) ───
export const PROGRAM_REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار پرداخت",
  pending_body_photo: "در انتظار عکس بدن",
  pending_generation: "در صف ساخت",
  generating: "در حال ساخت",
  ready: "آماده",
  failed: "ناموفق",
};

export function programRequestStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PROGRAM_REQUEST_STATUS_LABELS[status] ?? status;
}

// ─── وضعیت اشتراک (Subscription.status) ───
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "فعال",
  pending: "در انتظار",
  cancelled: "لغوشده",
  expired: "منقضی",
};

export function subscriptionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status;
}

// ─── وضعیت پرداخت (Payment.status) ───
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  success: "موفق",
  pending: "در انتظار",
  failed: "ناموفق",
  refunded: "بازگشت‌خورده",
  expired: "منقضی",
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

// ─── منبع نصب اپ (User.appInstallSource) ───
export const APP_INSTALL_SOURCE_LABELS: Record<string, string> = {
  panel: "اپ اختصاصی فیتاپ",
  bazaar: "اپ کافه‌بازار",
  pwa: "وب‌اپ (PWA)",
};

export function appInstallSourceLabel(source: string | null | undefined): string {
  if (!source) return "وب مرورگر";
  return APP_INSTALL_SOURCE_LABELS[source] ?? source;
}

// ─── v214 — منبع ورود کاربر در «یک نگاه» (دیرکتیو مالک) ───
// زیر نام هر کاربر در جدول کاربران: اینستاگرام / گوگل / کافه‌بازار / اپ اختصاصی / وب
// اولویت: signupSource (منبع بازاریابی ثبت‌نام) → appInstallSource (منبع نصب اپ) → وب
export const SIGNUP_SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  instagram: { label: "اینستاگرام", cls: "bg-pink-500/15 text-pink-600 dark:text-pink-400" },
  google: { label: "گوگل", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  cafebazaar: { label: "کافه‌بازار", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  app_panel: { label: "اپ اختصاصی", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  web: { label: "وب", cls: "bg-muted text-muted-foreground" },
  direct: { label: "ورود مستقیم", cls: "bg-muted text-muted-foreground" },
};

const APP_INSTALL_BADGES: Record<string, { label: string; cls: string }> = {
  panel: { label: "اپ اختصاصی", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  bazaar: { label: "اپ کافه‌بازار", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  pwa: { label: "وب‌اپ", cls: "bg-muted text-muted-foreground" },
};

export function userEntrySourceBadge(
  signupSource: string | null | undefined,
  appInstallSource: string | null | undefined
): { label: string; cls: string } {
  if (signupSource && SIGNUP_SOURCE_BADGES[signupSource]) return SIGNUP_SOURCE_BADGES[signupSource];
  if (appInstallSource && APP_INSTALL_BADGES[appInstallSource]) return APP_INSTALL_BADGES[appInstallSource];
  // v214 — کاربران قدیمی (پیش از v178) منبعی ثبت‌شده ندارند — «وب مرورگر» ادعای
  // نادرست است؛ صادقانه «نامشخص» نشان داده می‌شود.
  return { label: "نامشخص", cls: "bg-muted text-muted-foreground" };
}

/** تاریخ شمسی کوتاه: «۱۴۰۴/۰۷/۰۶» */
export function adminFaDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
}

/** ساعت و دقیقهٔ فارسی: «۱۴:۳۰» */
export function adminFaTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran",  hour: "2-digit", minute: "2-digit" });
}

/** تاریخ و ساعت شمسی کامل: «۱۴۰۴/۰۷/۰۶ — ۱۴:۳۰» */
export function adminFaDateTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })} — ${adminFaTime(d)}`;
}

/** «چند روز پیش» — فاصلهٔ نسبی فارسی برای آخرین فعالیت */
export function adminFaRelativeDays(v: unknown): string {
  if (!v) return "هرگز";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return adminFaDateTime(d);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${Math.floor(minutes).toLocaleString("fa-IR")} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString("fa-IR")} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days.toLocaleString("fa-IR")} روز پیش`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months.toLocaleString("fa-IR")} ماه پیش`;
  return `${Math.floor(months / 12).toLocaleString("fa-IR")} سال پیش`;
}
