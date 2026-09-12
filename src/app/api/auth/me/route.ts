import { cookies, headers } from "next/headers";
import { getCurrentUserWithMeta, apiError, buildUserDto } from "@/lib/fitness/auth";
import { db } from "@/lib/db";
import { recordAppInstall } from "@/lib/fitness/app-install";

// Marker cookie name — must match the one set in lib/fitness/auth.ts
const TERMS_PENDING_COOKIE = "sc_terms_pending";

export async function GET() {
  try {
    // v51 (درخواست مالک — مسدودسازی): getCurrentUserWithMeta به‌جای getCurrentUser
    // تا کاربرِ مسدود (isBlocked) قابل تشخیص باشد: user=null ولی blocked=true
    const meta = await getCurrentUserWithMeta();
    const user = meta.user;
    const cookieStore = await cookies();
    // NOTE: next/headers cookies() reflects mutations done within the same
    // request (e.g. by getCurrentUser), so this read picks up the marker
    // cookie even if it was just set in this same request.
    const termsPending = cookieStore.get(TERMS_PENDING_COOKIE)?.value === "1";

    if (!user) {
      // v51: کاربر مسدود — نه لاگین است نه لاگ‌اوت: صفحهٔ زیبای «مسدود» نشان داده می‌شود.
      // سشن سالم است ولی همهٔ APIها ۴۰۱ می‌دهند (auth.ts getCurrentUserWithMeta).
      if (meta.blocked) {
        return Response.json({ user: null, blocked: true }, { status: 200 });
      }
      // If the marker cookie is set, the user was logged out due to
      // outdated TermsVersion — tell the frontend to show the modal.
      if (termsPending) {
        return Response.json(
          { user: null, termsUpdateRequired: true },
          { status: 200 }
        );
      }
      return Response.json({ user: null }, { status: 200 });
    }
    const dto = await buildUserDto(user.id);

    // ─── لمس آخرین فعالیت کاربر (رفع ریشه‌ای نوتیف «چند روزی نیستی») ───
    // /api/auth/me در هر باز شدن اپ/سایت صدا زده می‌شود — بهترین سیگنال
    // «کاربر آنلاین است». نوشتن با throttle انجام می‌شود (حداکثر هر ۳۰ دقیقه
    // یکبار) تا DB در هر بازدید write نگیرد. سناریو re_engagement در
    // cron رفتاری از همین فیلد می‌فهمد کاربر مداوم از اپ استفاده می‌کند.
    try {
      const stale =
        !user.lastActiveAt ||
        Date.now() - new Date(user.lastActiveAt).getTime() > 30 * 60 * 1000;
      if (stale) {
        await db.user.update({
          where: { id: user.id },
          data: { lastActiveAt: new Date() },
        });
      }
    } catch {
      // نباید جریان auth را بشکند
    }

    // ─── ثبت نصب اپ نیتیو (v47) ───
    // اپ اختصاصی و اپ کافه‌بازار پسوند UA اختصاصی دارند؛ در هر باز شدن اپ
    // این روت صدا زده می‌شود → اولین بار در User ثبت می‌شود تا داشبورد ادمین
    // «چند نفر اپ ما / چند نفر اپ بازار» را نشان دهد (throttle داخل helper).
    try {
      const ua = (await headers()).get("user-agent");
      await recordAppInstall(user.id, ua);
    } catch {
      // نباید جریان auth را بشکند
    }

    // ─── v52: ثبت نصب وب‌اپ iOS ───
    // سافاری هرگز رویداد appinstalled نمی‌فرستد (فقط کروم) → با حذف manifest
    // عمومی، نصب‌های وب‌اپ دیگر شمرده نمی‌شدند. راه‌حل: کوکی pwa_standalone=1
    // (که head script در حالت standalone ست می‌کند) نشانهٔ «کاربر داخل وب‌اپ
    // نصب‌شده است» — اولین بار که کاربر لاگین و standalone بود → pwaInstalledAt ثبت.
    try {
      if (cookieStore.get("pwa_standalone")?.value === "1" && !user.pwaInstalledAt) {
        await db.user.update({
          where: { id: user.id },
          data: { pwaInstalledAt: new Date() },
        });
      }
    } catch {
      // نباید جریان auth را بشکند
    }

    return Response.json({
      user: dto,
      // v32: قوانین جدید دیگر لاگ‌اوت نمی‌کند — فلگ از DTO کاربر می‌آید و
      // کلاینت مودال پذیرش درجا نشان می‌دهد (سشن حفظ می‌شود)
      termsUpdateRequired: dto?.termsUpdateRequired === true,
    });
  } catch (e) {
    return apiError(e);
  }
}
