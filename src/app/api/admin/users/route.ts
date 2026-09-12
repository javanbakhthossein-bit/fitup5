import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError, validateMobile } from "@/lib/fitness/auth";

// تبدیل ارقام فارسی/عربی به انگلیسی (ورودی موبایل ممکن است از کیبورد فارسی باشد)
function toEnglishDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function normalizeMobile(raw: string): string {
  return toEnglishDigits(String(raw || "")).replace(/\s/g, "");
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    // پارس امن صفحه‌بندی — Number(abc) → NaN → skip/take نامعتبر و ۵۰۰ پراسیما (ممیزی 2-c)
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || 1) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize") || 15) || 15)));
    const role = searchParams.get("role") || "";
    const plan = searchParams.get("plan") || "";
    const onboarding = searchParams.get("onboarding") || ""; // "done" | "pending" | ""
    const now = new Date();

    const where: any = {};
    if (search) {
      where.OR = [{ mobile: { contains: search } }, { name: { contains: search } }];
    }
    if (role && role !== "all") {
      where.role = role;
    }
    if (plan && plan !== "all") {
      if (plan === "none") {
        where.planName = null;
      } else {
        where.planName = plan;
      }
    }
    if (onboarding === "done") where.onboardingDone = true;
    if (onboarding === "pending") where.onboardingDone = false;

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          mobile: true,
          name: true,
          role: true,
          isBlocked: true,
          onboardingDone: true,
          createdAt: true,
          planName: true,
          walletBalance: true,
          planExpiresAt: true,
        },
      }),
    ]);

    // Attach active subscription info
    const userIds = users.map((u) => u.id);
    const subs = await db.subscription.findMany({
      where: { userId: { in: userIds }, status: "active", endDate: { gt: now } },
    });
    const subMap = new Map(subs.map((s) => [s.userId, s]));

    return Response.json({
      total,
      page,
      pageSize,
      users: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
        hasActiveSubscription: subMap.has(u.id),
        subscriptionEnd: subMap.get(u.id)?.endDate?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// Block / unblock / delete user
// شماره موبایل سوپرادمین — همان ثابت permissions/route.ts
const SUPER_ADMIN_MOBILE = "09300083803";

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { userId, action, newMobile } = await req.json();
    if (userId === admin.id) {
      return Response.json({ error: "نمی‌توانید حساب خود را تغییر دهید." }, { status: 400 });
    }
    if (action === "block") {
      await db.user.update({ where: { id: userId }, data: { isBlocked: true } });
    } else if (action === "unblock") {
      await db.user.update({ where: { id: userId }, data: { isBlocked: false } });
    } else if (action === "makeAdmin") {
      // امنیت (ممیزی 2-c P1): ارتقای کاربر به ادمین فقط توسط سوپرادمین.
      // نکته‌ی طراحی: طبق permissions/route.ts:61-72 اگر رکورد AdminPermission برای
      // ادمین جدید وجود نداشته باشد، همه‌ی دسترسی‌ها ALL_TRUE فرض می‌شود (سبک مالک).
      // یعنی makeAdmin توسط هر ادمینی = ساخت ادمینِ دسترسی‌کامل (stealth escalation).
      // رکورد AdminPermission خالی هم ساخته نمی‌شود چون آن‌جا قفل کامل می‌شود؛
      // پس محدودسازی درستِ حداقلی این است که فقط سوپرادمین بتواند ادمین کند.
      if (admin.mobile !== SUPER_ADMIN_MOBILE) {
        return Response.json(
          { error: "ارتقای کاربر به ادمین فقط توسط سوپرادمین مجاز است." },
          { status: 403 }
        );
      }
      await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    } else if (action === "makeUser") {
      await db.user.update({ where: { id: userId }, data: { role: "USER" } });
    } else if (action === "changeMobile") {
      // تغییر شماره موبایل کاربر — تمام داده‌های کاربر userId-keyed هستند پس با
      // به‌روزرسانی User.mobile همه‌چیز به شماره جدید منتقل می‌شود. فقط آثار
      // شماره‌محور (OtpCode) باید پاک شوند تا کد پیامک‌شده روی شماره قدیم دیگر
      // به حساب دسترسی ندهد و کد قدیمی شماره جدید هم مزاحم نباشد.
      const mobile = normalizeMobile(newMobile);
      if (!validateMobile(mobile)) {
        return Response.json(
          { error: "شماره موبایل جدید نامعتبر است. مثال: 09123456789" },
          { status: 400 }
        );
      }
      const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, mobile: true } });
      if (!target) {
        return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
      }
      if (target.mobile === mobile) {
        return Response.json(
          { error: "شماره جدید با شماره فعلی کاربر یکسان است." },
          { status: 400 }
        );
      }
      const existing = await db.user.findUnique({ where: { mobile }, select: { id: true } });
      if (existing) {
        return Response.json(
          { error: "این شماره موبایل قبلاً در سیستم ثبت شده است." },
          { status: 400 }
        );
      }
      try {
        await db.$transaction(async (tx) => {
          await tx.user.update({ where: { id: userId }, data: { mobile } });
          // ابطال همه کدهای OTP شماره قدیم و جدید (سشن فعلی کاربر حفظ می‌شود)
          await tx.otpCode.deleteMany({ where: { mobile: { in: [target.mobile, mobile] } } });
        });
      } catch (txErr: any) {
        // P2002 = unique constraint روی User.mobile (مسابقه هم‌زمان دو ادمین)
        if (txErr?.code === "P2002") {
          return Response.json(
            { error: "این شماره موبایل قبلاً در سیستم ثبت شده است." },
            { status: 400 }
          );
        }
        throw txErr;
      }
      return Response.json({ ok: true, mobile });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("id");
    if (!userId) return Response.json({ error: "ID نیاز است." }, { status: 400 });
    if (userId === admin.id) {
      return Response.json({ error: "نمی‌توانید خود را حذف کنید." }, { status: 400 });
    }
    const force = searchParams.get("force") === "1";
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, mobile: true },
    });
    if (!user) {
      return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
    }
    // گارد مالی (ممیزی 2-c P2): رکوردهای Payment/Subscription/WalletTransaction با
    // onDelete: Cascade هستند — حذف کاربر تاریخچه‌ی مالی قانونی را برای همیشه پاک می‌کند.
    // حالت force=1: ادمین صریحاً حذف رکوردهای مالی را در UI تأیید کرده است.
    const [paymentCount, subCount, walletCount] = await Promise.all([
      db.payment.count({ where: { userId } }),
      db.subscription.count({ where: { userId } }),
      db.walletTransaction.count({ where: { userId } }),
    ]);
    const hasFinancial = paymentCount + subCount + walletCount > 0;
    if (hasFinancial && !force) {
      return Response.json(
        {
          error:
            "این کاربر سابقه مالی دارد — برای حذف کامل، تأیید حذف رکوردهای مالی نیز لازم است.",
          code: "FINANCIAL_RECORDS",
          financialCounts: {
            payments: paymentCount,
            subscriptions: subCount,
            walletTransactions: walletCount,
          },
        },
        { status: 400 }
      );
    }
    await db.$transaction(async (tx) => {
      // ۱) مدل‌های بدون FK که cascade نمی‌شوند — باید دستی پاک شوند
      await tx.planAiAnalysis.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.smsShortLink.deleteMany({ where: { userId } });
      // Feedback هم userId و هم mobile اختیاری دارد — فقط با userId پاک می‌کنیم
      // تا بازخوردهای ناشناسِ هم‌شماره بی‌ربط حذف نشوند
      await tx.feedback.deleteMany({ where: { userId } });
      // ۲) کدهای OTP شماره‌محور هستند — با حذف کاربر باطل شوند
      await tx.otpCode.deleteMany({ where: { mobile: user.mobile } });
      // ۳) رکوردهای مالی فقط در حالت force (تأیید صریح ادمین)
      // SmsLog عمداً نگه داشته می‌شود (تاریخچه پیامکی قانونی)
      if (hasFinancial) {
        await tx.payment.deleteMany({ where: { userId } });
        await tx.subscription.deleteMany({ where: { userId } });
        await tx.walletTransaction.deleteMany({ where: { userId } });
      }
      // ۴) حذف خود کاربر — بقیه روابط با onDelete: Cascade پاک می‌شوند
      // (ErrorLog/Article با SetNull باقی می‌مانند — عمدی)
      await tx.user.delete({ where: { id: userId } });
    });
    return Response.json({
      ok: true,
      message: hasFinancial
        ? "کاربر و تمام اطلاعات او همراه با رکوردهای مالی برای همیشه حذف شد."
        : "کاربر و تمام اطلاعات او برای همیشه حذف شد.",
    });
  } catch (e) {
    return apiError(e);
  }
}
