import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/fitness/auth";

/**
 * گارد مرکزی دسترسی‌های جزئی ادمین — فیکس F3 ممیزی امنیتی (۱-د):
 * قبلاً پرمیشن‌های زیر-ادمین فقط سمت کلاینت اعمال می‌شدند (۵۲/۵۶ مسیر ادمین
 * فقط requireAdmin داشتند)؛ اکنون مسیرهای /api/admin/** روی این هلپر تکیه می‌کنند.
 *
 * معناشناسی دسترسی — دقیقاً مطابق GET /api/admin/permissions:
 *  ۱) سوپرادمین (mobile === SUPER_ADMIN_MOBILE) → همهٔ دسترسی‌ها (مالک)
 *  ۲) ادمین بدون رکورد AdminPermission (ادمین قدیمی/legacy) → همهٔ دسترسی‌ها
 *  ۳) در غیر این صورت، همهٔ کلیدهای خواسته‌شده باید true باشند
 *
 * خطای دسترسی = همان Error("FORBIDDEN") که requireAdmin می‌اندازد؛
 * apiError در auth.ts آن را به ۴۰۳ «دسترسی غیرمجاز.» نگاشت می‌کند —
 * یعنی بدون تغییر قرارداد catch/apiError مسیرهای فعلی.
 */

// شماره موبایل سوپرادمین (مالک) — همان ثابت permissions/route.ts
export const SUPER_ADMIN_MOBILE = "09300083803";

// کلیدهای دسترسی — مطابق مدل AdminPermission در prisma/schema.prisma
export type AdminPermKey =
  | "canViewDashboard"
  | "canManageUsers"
  | "canViewFinance"
  | "canManagePrograms"
  | "canManageCheckups"
  | "canManageArticles"
  | "canManageHeadCodes"
  | "canManageTerms"
  | "canUseCopilot"
  | "canManageAdmins"
  | "canManageTickets";

// نوع کاربر ادمین بازگشتی از requireAdmin (کاربر Prisma)
export type AdminUser = Awaited<ReturnType<typeof requireAdmin>>;

/**
 * requireAdmin + بررسی پرمیشن‌های جزئی (سطح دوم گارد — روی هم، نه جایگزین).
 * ابتدا requireAdmin (نقش ADMIN + وضعیت blocked) و بعد رکورد AdminPermission.
 * اگر هر یک از کلیدهای خواسته‌شده false بود → Error("FORBIDDEN") → ۴۰۳.
 *
 * نمونه:
 *   const admin = await requireAdmin();
 *   await requireAdminPerm("canManageUsers");
 *   await requireAdminPerm(["canManageUsers", "canViewFinance"]); // هر دو لازم
 */
export async function requireAdminPerm(
  perm: AdminPermKey | AdminPermKey[],
  // رزرو برای بررسی‌های وابسته به درخواست در آینده — الان استفاده نمی‌شود
  _req?: Request
): Promise<AdminUser> {
  const admin = await requireAdmin();

  // ۱) سوپرادمین — دسترسی کامل (مالک)
  if (admin.mobile === SUPER_ADMIN_MOBILE) return admin;

  // ۲) ادمین بدون رکورد پرمیشن = ادمین قدیمی/بدون محدودیت — الگوی permissions/route.ts
  const record = await db.adminPermission.findUnique({ where: { userId: admin.id } });
  if (!record) return admin;

  // ۳) همهٔ کلیدهای خواسته‌شده باید true باشند (منطق AND)
  const keys = Array.isArray(perm) ? perm : [perm];
  for (const key of keys) {
    if (!record[key]) {
      throw new Error("FORBIDDEN");
    }
  }

  return admin;
}
