import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  validateMobile,
  validatePassword,
  setSession,
  apiError,
} from "@/lib/fitness/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mobile = String(body.mobile || "").replace(/\s/g, "");
    const password = String(body.password || "");
    const name = body.name ? String(body.name) : null;
    const acceptedTerms = Boolean(body.acceptedTerms);

    if (!validateMobile(mobile)) {
      return Response.json(
        { error: "شماره موبایل نامعتبر است. مثال: 09123456789" },
        { status: 400 }
      );
    }
    if (!validatePassword(password)) {
      return Response.json(
        { error: "رمز عبور باید حداقل ۶ کاراکتر باشد." },
        { status: 400 }
      );
    }
    if (!acceptedTerms) {
      return Response.json(
        { error: "پذیرش شرایط و قوانین الزامی است" },
        { status: 400 }
      );
    }

    const existing = await db.user.findUnique({ where: { mobile } });
    if (existing) {
      return Response.json(
        { error: "این شماره موبایل قبلاً ثبت شده است. وارد شوید." },
        { status: 409 }
      );
    }

    // Fetch the active TermsVersion to stamp on the new user
    const activeTerms = await db.termsVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: "desc" },
    });
    const acceptedTermsVersion = activeTerms?.version ?? null;

    const user = await db.user.create({
      data: {
        mobile,
        passwordHash: hashPassword(password),
        name,
        acceptedTermsVersion,
      },
    });

    await setSession(user.id);

    // Create welcome notification (in-app only, NO SMS)
    await db.notification.create({
      data: {
        userId: user.id,
        type: "welcome",
        title: "خوش آمدید! 🎉",
        body: `سلام${name ? " " + name : ""}! به فیتاپ خوش آمدی. برای ساخت برنامه تمرینی و غذایی اختصاصی، اطلاعات آنبوردینگ را تکمیل کن.`,
        read: false,
      },
    });

    return Response.json({
      id: user.id,
      mobile: user.mobile,
      name: user.name,
      role: user.role,
      onboardingDone: user.onboardingDone,
      hasActiveSubscription: false,
      subscriptionEnd: null,
      planName: null,
      planExpiresAt: null,
      walletBalance: 0,
      acceptedTermsVersion,
    });
  } catch (e) {
    return apiError(e);
  }
}
