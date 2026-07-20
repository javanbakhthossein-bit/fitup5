import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  validateMobile,
  setSession,
  apiError,
  buildUserDto,
  getCurrentTermsVersion,
  clearTermsPendingCookie,
} from "@/lib/fitness/auth";

// Admin auto-login configuration
const ADMIN_MOBILE = "09300083803";
const ADMIN_PLAN = "ultimate";
const ADMIN_PLAN_DURATION_DAYS = 365; // 1 year
const ADMIN_WALLET_BALANCE = 10_000_000; // 10 million Toman

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Max attempts to verify before invalidating the OTP record
const OTP_MAX_ATTEMPTS = 5;

function isValidOtpCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

async function createAdminPerks(userId: string, now: Date) {
  const endDate = new Date(now.getTime() + ADMIN_PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);

  // Update user with admin perks
  await db.user.update({
    where: { id: userId },
    data: {
      role: "ADMIN",
      onboardingDone: true,
      walletBalance: ADMIN_WALLET_BALANCE,
      planName: ADMIN_PLAN,
      planStartedAt: now,
      planExpiresAt: endDate,
    },
  });

  // Ensure an active "ultimate" subscription exists (buildUserDto uses Subscription rows)
  const existingSub = await db.subscription.findFirst({
    where: {
      userId,
      status: "active",
      plan: ADMIN_PLAN,
      endDate: { gt: now },
    },
    orderBy: { endDate: "desc" },
  });

  if (!existingSub) {
    await db.subscription.create({
      data: {
        userId,
        plan: ADMIN_PLAN,
        status: "active",
        startDate: now,
        endDate,
        durationDays: ADMIN_PLAN_DURATION_DAYS,
        pricePaid: 0,
      },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mobile = String(body?.mobile || "").replace(/\s/g, "");
    const code = String(body?.code || "").replace(/\s/g, "");
    // کد معرفی (اختیاری) — از localStorage کاربر ارسال می‌شود
    const referralCode = body?.referralCode ? String(body.referralCode).trim().toUpperCase() : "";

    if (!validateMobile(mobile)) {
      return Response.json(
        { error: "شماره موبایل نامعتبر است." },
        { status: 400 }
      );
    }
    if (!isValidOtpCode(code)) {
      return Response.json(
        { error: "کد تأیید باید ۴ رقم باشد." },
        { status: 400 }
      );
    }

    const now = new Date();

    // Find the latest valid (unused + non-expired) OTP for this mobile.
    // We don't mark as used yet — we mark it on successful verification.
    const otp = await db.otpCode.findFirst({
      where: {
        mobile,
        used: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      return Response.json(
        { error: "کد تأیید معتبر نیست یا منقضی شده است. لطفاً کد جدید درخواست کنید." },
        { status: 400 }
      );
    }

    // Compare code
    if (otp.code !== code) {
      return Response.json(
        { error: "کد تأیید اشتباه است." },
        { status: 400 }
      );
    }

    // Mark OTP as used
    await db.otpCode.update({
      where: { id: otp.id },
      data: { used: true },
    });

    // Find or create user
    let user = await db.user.findUnique({ where: { mobile } });
    const isNewUser = !user;
    const isAdminMobile = mobile === ADMIN_MOBILE;

    if (isNewUser) {
      // Fetch the active TermsVersion to stamp on the new user (OTP = consent)
      const activeTerms = await db.termsVersion.findFirst({
        where: { isActive: true },
        orderBy: { version: "desc" },
      });
      const acceptedTermsVersion = activeTerms?.version ?? null;

      // --- پردازش کد معرفی (رفرال) ---
      // اگر کاربر کد معرفی ارسال کرده، معرف را پیدا کن.
      // کاربر نمی‌تواند خودش را معرفی کند (شماره موبایل یکسان).
      let referredById: string | null = null;
      if (referralCode) {
        const referrer = await db.user.findUnique({
          where: { referralCode },
          select: { id: true, mobile: true },
        });
        if (referrer && referrer.mobile !== mobile) {
          referredById = referrer.id;
        }
      }

      user = await db.user.create({
        data: {
          mobile,
          passwordHash: "", // OTP-based — no password
          name: null,
          acceptedTermsVersion,
          onboardingDone: isAdminMobile, // admin skips onboarding
          role: isAdminMobile ? "ADMIN" : "USER",
          walletBalance: isAdminMobile ? ADMIN_WALLET_BALANCE : 0,
          referredById: isAdminMobile ? null : referredById,
        },
      });

      // Welcome notification (in-app only)
      await db.notification.create({
        data: {
          userId: user.id,
          type: "welcome",
          title: "خوش آمدید! 🎉",
          body: `سلام! به فیتاپ خوش آمدی. برای ساخت برنامه تمرینی و غذایی اختصاصی، اطلاعات آنبوردینگ را تکمیل کن.`,
          read: false,
        },
      });

      // اگر کاربر با کد معرفی ثبت‌نام کرده، نوتیفیکیشن خوش‌آمدگویی به معرف بده
      if (referredById) {
        await db.notification.create({
          data: {
            userId: referredById,
            type: "system",
            title: "معرفی جدید! 🎁",
            body: `یک دوست با لینک معرفی شما به فیتاپ پیوست! وقتی اولین پلن خود را خرید کند، هر دو ۱۵۰,۰۰۰ تومان پاداش می‌گیرید.`,
            read: false,
          },
        });
      }

      // Admin perks: ensure ultimate plan + 1-year subscription record
      if (isAdminMobile) {
        await createAdminPerks(user.id, now);
      }
    } else if (isAdminMobile) {
      // Existing admin mobile — ensure role is ADMIN + perks (idempotent safety net).
      await db.user.update({
        where: { id: user.id },
        data: {
          role: "ADMIN",
          onboardingDone: true,
          walletBalance: ADMIN_WALLET_BALANCE,
          planName: ADMIN_PLAN,
          planExpiresAt: new Date(now.getTime() + ADMIN_PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000),
          planStartedAt: now,
        },
      });
      // Ensure active subscription exists
      const existingSub = await db.subscription.findFirst({
        where: { userId: user.id, status: "active" },
      });
      if (!existingSub) {
        await createAdminPerks(user.id, now);
      }
    }

    if (user.isBlocked) {
      return Response.json(
        { error: "حساب کاربری شما مسدود شده است. با پشتیبانی تماس بگیرید." },
        { status: 403 }
      );
    }

    // ─── Terms version update for EXISTING users ───
    // For new users, acceptedTermsVersion was already set above (when creating
    // the user). For existing users who logged in again, OTP verification is
    // considered implicit consent to the current TermsVersion — so we bump
    // their acceptedTermsVersion to the latest active version. This unblocks
    // users who were logged out due to outdated terms.
    if (!isNewUser) {
      const currentVersion = await getCurrentTermsVersion();
      const userVersion = user.acceptedTermsVersion ?? 0;
      if (currentVersion > 0 && userVersion < currentVersion) {
        await db.user.update({
          where: { id: user.id },
          data: { acceptedTermsVersion: currentVersion },
        });
      }
    }

    // Clear the sc_terms_pending marker cookie — successful OTP = user has
    // re-accepted the terms, so we no longer need to flag the auth screen.
    await clearTermsPendingCookie();

    await setSession(user.id);
    const dto = await buildUserDto(user.id);
    if (!dto) {
      return Response.json({ error: "خطا در ساخت اطلاعات کاربر." }, { status: 500 });
    }
    return Response.json(dto);
  } catch (e) {
    return apiError(e);
  }
}
