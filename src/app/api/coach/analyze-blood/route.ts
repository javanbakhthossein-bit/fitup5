import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeBloodTest, buildUserContext } from "@/lib/fitness/ai";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/fitness/types";
import { startProgramGenerationInBackground, buildOnboardingData } from "@/lib/fitness/program-generation";
import { processImageSafe } from "@/lib/fitness/image-process";

/**
 * POST /api/coach/analyze-blood
 *  - نیازمند پلن حرفه‌ای (Ultimate) — قابلیت bloodTestAnalysis (آلیاس bloodTest)
 *  - محدودیت پلن: bloodTestLimit (۱ بار در پلن Ultimate)
 *  - پس از تحلیل موفق، نتیجه در AnalysisResult ذخیره می‌شود و شمارنده bloodTestUsed افزایش می‌یابد.
 *
 * GET /api/coach/analyze-blood
 *  - آخرین نتیجه ذخیره‌شده کاربر را برمی‌گرداند (تا رفرش صفحه اطلاعات را از دست ندهد).
 */
// v202 ممیزی (M8) — سقف مدیا (فایل خام): ۳۰MB عکس. ثابت بر حسب نویسهٔ base64 (~۱.۳۳x).
// کلاینت عکس را به ۲۰۰۰px کوچک می‌کند (چند MB — downscaleImage در blood-test-view)؛
// این سقف فقط درخواست‌های غیرمعقول را رد می‌کند. گارد زودهنگام content-length هم هست.
const MAX_BASE64_CHARS = Math.ceil((30 * 1024 * 1024 * 4) / 3);

export async function POST(req: NextRequest) {
  // ممیزی 1-b#10 — وضعیت claim سهمیه؛ در هر خروج/شکستِ بعد از claim، واحد
  // پس گرفته می‌شود تا «مصرف فقط با تحلیل موفق» (رفتار قبلی) حفظ شود
  let claimedBloodUnit = false;
  let claimedUserId: string | null = null;
  const releaseBloodClaim = async () => {
    if (!claimedBloodUnit || !claimedUserId) return;
    claimedBloodUnit = false;
    await db.user
      .updateMany({
        where: { id: claimedUserId, bloodTestUsed: { gt: 0 } },
        data: { bloodTestUsed: { decrement: 1 } },
      })
      .catch(() => {});
  };

  try {
    // ─── v202 ممیزی (M8) — گارد زودهنگام حجم: اگر content-length از سقف مجاز بزرگ‌تر
    // باشد، بدون خواندن بدنه ۴۱۳ بده (ضد OOM — تا این لحظه هیچ بادی خوانده نشده).
    const contentLen = Number(req.headers.get("content-length") || 0);
    if (contentLen > MAX_BASE64_CHARS + 1024 * 1024) {
      return Response.json({ error: "حجم فایل بیش از حد مجاز است." }, { status: 413 });
    }
    const { userId, planName } = await requirePlanCapability("bloodTestAnalysis");
    claimedUserId = userId;
    const { base64Image, mimeType } = await req.json();
    if (!base64Image || typeof base64Image !== "string")
      return Response.json({ error: "تصویر ارسال نشده." }, { status: 400 });

    // === گارد فنی حجم payload (base64 — v202 ممیزی (M8): سقف ۳۰MB فایل؛ ضد OOM) ===
    // کلاینت عکس را به ۲۰۰۰px کوچک می‌کند و سرور هم با sharp به همان هدف کاهش
    // می‌دهد (متن گزارش خوانا می‌ماند)؛ این گارد فقط درخواست‌های غیرمعقول را رد می‌کند.
    if (base64Image.length > MAX_BASE64_CHARS) {
      return Response.json(
        { error: "فایل تصویر بسیار بزرگ است." },
        { status: 413 }
      );
    }

    // === اعمال محدودیت واقعی پلن ===
    // ممیزی 1-b#10 — claim اتمیک سهمیه قبل از کال پرهزینه VLM (به‌جای read-then-write):
    // updateMany شرطی «used < limit → +1»؛ count=0 یعنی سقف پر است → 403 قبل از هزینه.
    // در شکست تحلیل، claim با releaseBloodClaim پس گرفته می‌شود (رفتار مسیر عادی
    // دست‌نخورده: مصرف فقط با تحلیل موفق ثبت می‌شود).
    const limit = getCapabilities(planName).bloodTestLimit;
    if (limit > 0) {
      const claim = await db.user.updateMany({
        where: { id: userId, bloodTestUsed: { lt: limit } },
        data: { bloodTestUsed: { increment: 1 } },
      });
      if (claim.count === 0) {
        return Response.json(
          { error: "سقف استفاده از این قابلیت پر شده است.", code: "LIMIT_REACHED" },
          { status: 403 }
        );
      }
      claimedBloodUnit = true;
    }

    // === فشرده‌سازی با sharp قبل از ارسال به VLM (همان الگوی بقیه جریان‌های مدیا) ===
    // عکس خام آزمایشگاه ۳-۸MB است؛ resize به حداکثر ۲۰۰۰px + WebP هم payload ارسالی
    // به AvalAI را کوچک می‌کند و هم خوانایی متن گزارش را حفظ می‌کند.
    // v79 — فال‌بک HEIF/HEIC: عکس‌های آیفونی که libheif آن‌ها را decode نمی‌کند
    // (خطای «Security limit exceeded») دیگر ۴۰۰ نمی‌گیرند — خام به VLM می‌رود.
    const raw = Buffer.from(base64Image, "base64");
    const processedImage = await processImageSafe(raw, mimeType, { maxDim: 2000, quality: 80, rotate: true });
    if (!processedImage) {
      // تصویر خراب/نامعتبر — پیام واضح بده تا VLM با خطای مبهم fail نکند
      // (ممیزی 1-b#10 — خروج زودهنگام بعد از claim → واحد پس گرفته می‌شود)
      await releaseBloodClaim();
      return Response.json(
        { error: "پردازش تصویر ناموفق بود. لطفاً یک تصویر معتبر (JPG/PNG/WebP/HEIC) ارسال کنید." },
        { status: 400 }
      );
    }
    const vlmBase64 = processedImage.buffer.toString("base64");
    const vlmMime = processedImage.mimeType;

    // v214 — پروفایل ورزشکار به تحلیل آزمایش خون تزریق می‌شود (دیرکتیو مالک:
    // «همه‌ی کانتکست‌ها به AI تزریق بشه») — توصیه‌ها/مکمل‌ها شخصی‌سازی‌شده و
    // سازگار با شرایط پزشکی/آسیب‌های کاربر می‌شوند.
    let bloodUserContext: string | undefined;
    try {
      const bloodPlanData = await buildOnboardingData(userId);
      if (bloodPlanData) {
        bloodUserContext = buildUserContext(bloodPlanData, planName as any);
      }
    } catch (bcErr) {
      console.warn("[analyze-blood] userContext build failed (non-fatal):", bcErr);
    }

    const result = await analyzeBloodTest(vlmBase64, vlmMime, bloodUserContext);

    // === ذخیره نتیجه در DB ===
    // (ممیزی 1-b#10 — شمارندهٔ bloodTestUsed بالاتر با claim اتمیک مصرف شده؛
    // اینجا فقط نتیجه + تعیین تکلیف پیش‌نیاز ثبت می‌شود)
    await db.$transaction([
      db.analysisResult.create({
        data: {
          userId,
          type: "blood_test",
          result: JSON.stringify(result),
          mediaUrl: null,
        },
      }),
      db.user.update({
        where: { id: userId },
        data: {
          // آپلود نتایج = تعیین تکلیف پیش‌نیاز آزمایش خون
          bloodTestStatus: "uploaded",
        },
      }),
    ]);

    // اگر آپلود آزمایش خون آخرین پیش‌نیاز بود → تولید برنامه در پس‌زمینه شروع شود
    let programStarted = false;
    try {
      const gen = await startProgramGenerationInBackground(userId);
      programStarted = gen.started || gen.reason === "already_generating";
    } catch (genErr) {
      console.error("[analyze-blood] failed to start background generation:", genErr);
    }

    return Response.json({ ...result, programStarted });
  } catch (e) {
    // ممیزی 1-b#10 — شکست بعد از claim (خطای VLM/DB/…) → واحد claimed پس گرفته می‌شود
    await releaseBloodClaim();
    return apiError(e);
  }
}

export async function GET() {
  try {
    // ─── مشاهده نتیجه ذخیره‌شده فقط نیازمند لاگین است (باگ 2-b) ───
    // تحلیل جدید (POST) همچنان قابلیت Ultimate می‌خواهد — فقط «مشاهده»
    // نتیجه‌ای که کاربر قبلاً برایش پول داده آزاد شد (داده در DB می‌ماند).
    const user = await requireAuth();
    const userId = user.id;
    const latest = await db.analysisResult.findFirst({
      where: { userId, type: "blood_test" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      return Response.json({ result: null });
    }
    try {
      return Response.json({
        result: JSON.parse(latest.result),
        createdAt: latest.createdAt.toISOString(),
      });
    } catch {
      return Response.json({ result: null });
    }
  } catch (e) {
    return apiError(e);
  }
}
