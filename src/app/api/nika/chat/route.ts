import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError, buildUserDto } from "@/lib/fitness/auth";
import { nikaChat } from "@/lib/fitness/ai";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { fixPersianTypographySafe } from "@/lib/fitness/persian-typography";
import { getTehranDayKey, tehranDayKeyToUtcMidnight } from "@/lib/fitness/day";
import { PLAN_LABELS, type Plan } from "@/lib/fitness/types";

// Task 2-d — سقف طول پیام: از ۲۰۰۰ نویسهٔ کدِ مرده به ۸۰۰۰ نویسه ارتقا یافت.
// دیرکتیو مالک: «AI بدون سقف در تحلیل» — ۸۰۰۰ نویسه هم همچنان حفاظ سوءاستفاده
// (هزینهٔ LLM) است و هم برای کاربر حس محدودیت ندارد.
const MAX_MESSAGE_CHARS = 8000;

/**
 * Task 2-d — دیرکتیو مالک: «چت نیکا نباید گیج جواب بده؛ به همه‌چیز اشراف داشته باشد».
 * این تابع وضعیت واقعی و زندهٔ پنل کاربر را می‌سازد (اشتراک، برنامهٔ تمرینی،
 * تغذیهٔ امروز، پیشرفت، ۷ روز اخیر) تا نیکا به‌جای حدس زدن، با دادهٔ واقعی پاسخ دهد.
 * هر کوئری در try/catch جداگانه است تا خرابیِ هر بخش فقط «حذف همان خط» باشد و
 * چتِ نیکا هرگز به‌خاطر ساخت کانتکست fail نکند.
 */
async function buildNikaLiveContext(userId: string): Promise<string> {
  const lines: string[] = [];

  // ① اشتراک فعال — پلن، تاریخ پایان، روزهای مانده
  try {
    const sub = await db.subscription.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: { plan: true, endDate: true },
    });
    if (sub) {
      const label = PLAN_LABELS[sub.plan as Plan] ?? sub.plan;
      let tail = "";
      if (sub.endDate) {
        const daysLeft = Math.max(
          0,
          Math.ceil((sub.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        );
        tail = ` — تا ${sub.endDate.toLocaleDateString("fa-IR")} (${daysLeft} روز مانده)`;
      }
      lines.push(`- اشتراک فعال: پلن ${label}${tail}`);
    } else {
      lines.push("- اشتراک فعال: ندارد");
    }
  } catch {}

  // ② برنامهٔ تمرینی — برنامهٔ فعال + آخرین وضعیت درخواست تولید (فقط فیلدهای کمینه)
  try {
    const [plan, req] = await Promise.all([
      db.workoutPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
        select: { weekIndex: true },
      }),
      db.programRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      }),
    ]);
    if (plan) {
      lines.push(`- برنامهٔ تمرینی فعال: دارد (هفتهٔ ${plan.weekIndex})`);
    } else if (req?.status === "generating" || req?.status === "pending") {
      lines.push("- برنامهٔ تمرینی فعال: در حال تولید است");
    } else {
      lines.push("- برنامهٔ تمرینی فعال: ندارد");
    }
  } catch {}

  // ③ تغذیهٔ امروز — تعداد ثبت غذا + مجموع کالری (مرز روز = روز تهران، هم‌الگوی /api/nutrition/log)
  try {
    const dayStart = tehranDayKeyToUtcMidnight(getTehranDayKey());
    if (dayStart) {
      const agg = await db.foodLog.aggregate({
        where: { userId, day: dayStart },
        _count: { _all: true },
        _sum: { calories: true },
      });
      const count = agg._count?._all ?? 0;
      if (count > 0) {
        lines.push(`- تغذیهٔ امروز: ${count} ثبت غذا — مجموع کالری ${agg._sum.calories ?? 0} کیلوکالری`);
      } else {
        lines.push("- تغذیهٔ امروز: هنوز چیزی ثبت نکرده");
      }
    }
  } catch {}

  // ④ پیشرفت — تعداد عکس‌های پیشرفت + آخرین وزن ثبت‌شده
  try {
    const [photoCount, lastWeight] = await Promise.all([
      db.progressPhoto.count({ where: { userId } }),
      db.weightLog.findFirst({
        where: { userId },
        orderBy: { loggedAt: "desc" },
        select: { weight: true, loggedAt: true },
      }),
    ]);
    lines.push(`- عکس‌های پیشرفت: ${photoCount} عکس`);
    if (lastWeight) {
      lines.push(
        `- آخرین وزن ثبت‌شده: ${lastWeight.weight} کیلوگرم (${lastWeight.loggedAt.toLocaleDateString("fa-IR")})`
      );
    }
  } catch {}

  // ⑤ ۷ روز اخیر — روزهای کامل‌شده (جدول DayCompletion؛ تاریخ رشته‌ای YYYY-MM-DD تهران)
  try {
    const from = getTehranDayKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
    const [doneAll, doneWorkout, doneNutrition] = await Promise.all([
      db.dayCompletion.count({ where: { userId, date: { gte: from } } }),
      db.dayCompletion.count({ where: { userId, date: { gte: from }, workoutDone: true } }),
      db.dayCompletion.count({ where: { userId, date: { gte: from }, nutritionDone: true } }),
    ]);
    lines.push(
      `- ۷ روز اخیر: ${doneAll} روز کامل‌شده (${doneWorkout} تمرین، ${doneNutrition} تغذیه)`
    );
  } catch {}

  if (lines.length === 0) return "";
  return `\n\n📊 وضعیت فعلی کاربر (داده‌های زندهٔ پنل او — فقط همین اعداد واقعی را به کار ببر، هرگز عدد جدید نساز):\n${lines.join("\n")}`;
}

export async function GET() {
  try {
    const user = await requireAuth();
    // ─── H1: قبلاً asc + take 100 «قدیمی‌ترین» ۱۰۰ پیام را برمی‌گرداند — بعد از
    // ۱۰۰ پیام، پیام‌های جدید در تاریخچه هرگز نمایش داده نمی‌شدند. الگوی درست
    // (مثل POST): desc + take → آخرین پیام‌ها، سپس reverse برای ترتیب زمانی.
    const recentMessages = await db.nikaMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const messages = recentMessages.reverse();
    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        // v59 — ضد چسبیدگی در زمان خواندن (هم‌الگوی /api/notifications):
        // متن‌های قدیمی DB هم درست نمایش داده می‌شوند؛ نسخهٔ URL-safe تا
        // لینک‌ها/دامنه‌های داخل پیام نیکا نشکنند («fittup. ir» نشود).
        content: m.role === "assistant" ? fixPersianTypographySafe(m.content) : m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    // ─── M6: محدودیت نرخ — ۵ پیام در دقیقه برای هر کاربر (مسیر guest همین‌طور
    // محدود است؛ مسیر auth شده هم کال LLM + ۳ کوئری DB است و نباید بی‌سقف باشد).
    const rl = rateLimit(`nika-chat:${user.id}`, 5, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return Response.json({ error: "پیام خالی است." }, { status: 400 });
    }
    // ─── سقف طول پیام — ممیزی 1-b §2: قبلاً این چک «داخل» بلوک return بالایی
    // تو در تو شده بود و هرگز اجرا نمی‌شد (کد مرده). اکنون مستقل است.
    // Task 2-d: سقف ۸۰۰۰ نویسه (دیرکتیو مالک: AI بدون سقف در تحلیل).
    if (message.length > MAX_MESSAGE_CHARS) {
      return Response.json(
        { error: "پیام خیلی طولانی است — حداکثر ۸۰۰۰ نویسه." },
        { status: 400 }
      );
    }

    // ذخیره پیام کاربر
    const userMsg = await db.nikaMessage.create({
      data: { userId: user.id, role: "user", content: message },
    });

    // دریافت پلن کاربر
    const dto = await buildUserDto(user.id);
    const userPlan = (dto?.planName as Plan | null) ?? null;

    // دریافت اطلاعات کامل کاربر (برای شناخت کاربر توسط نیکا)
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: { name: true, mobile: true, planName: true, planExpiresAt: true, walletBalance: true },
    });
    const userInfo = {
      name: fullUser?.name || null,
      mobile: fullUser?.mobile || null,
      planName: fullUser?.planName || null,
      planExpiresAt: fullUser?.planExpiresAt?.toISOString() || null,
      walletBalance: fullUser?.walletBalance ?? 0,
    };

    // دریافت تاریخچه اخیر
    // ─── H3: قبلاً orderBy asc + take 20 «قدیمی‌ترین» ۲۰ پیام را می‌آورد (حافظه چت خراب بود).
    // الگوی درست: desc + take → آخرین پیام‌ها، سپس reverse برای ترتیب زمانی.
    // پیام جاری (userMsg) حذف می‌شود چون جداگانه به‌عنوان پیام آخر به nikaChat پاس داده می‌شود.
    const recentHistory = await db.nikaMessage.findMany({
      where: { userId: user.id, id: { not: userMsg.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const history = recentHistory.reverse();

    // دریافت پاسخ از نیکا
    // Task 2-d — بلوک داده‌های زندهٔ پنل (اشتراک/برنامه/تغذیه/پیشرفت/۷روز) ساخته و پاس
    // داده می‌شود؛ شکستش بی‌صدا رد می‌شود تا چت هرگز به‌خاطر کانتکست fail نکند.
    const liveContext = await buildNikaLiveContext(user.id);
    const nikaResponse = await nikaChat(
      history.map((h) => ({ role: h.role, content: h.content })),
      message,
      userPlan,
      userInfo,
      user.id,
      liveContext
    );

    // ذخیره پاسخ نیکا
    const nikaMsg = await db.nikaMessage.create({
      data: { userId: user.id, role: "assistant", content: nikaResponse },
    });

    return Response.json({
      userMessage: {
        id: userMsg.id,
        role: "user",
        content: userMsg.content,
        createdAt: userMsg.createdAt.toISOString(),
      },
      nikaMessage: {
        id: nikaMsg.id,
        role: "assistant",
        // v59 — ضد چسبیدگی در لحظهٔ نمایش (پیام در DB خام می‌ماند)
        content: fixPersianTypographySafe(nikaMsg.content),
        createdAt: nikaMsg.createdAt.toISOString(),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
