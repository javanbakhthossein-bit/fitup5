/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تشخیص ریشه‌ای «چت با فیتاپ نمی‌تواند عکس/ویدیو را ببیند» — v99
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ این اسکریپت باید «روی سرور پروداکشن» اجرا شود (همان‌جایی که .env واقعی و
 * بیلد واقعی زندگی می‌کند) — در سندباکس نتیجه‌اش معنای تولیدی ندارد.
 *
 * اجرا:  bun run scripts/diagnose-chat-media-v99.ts
 * زنده:  bun run scripts/diagnose-chat-media-v99.ts --live   (یک کال ویژن واقعی — هزینهٔ ناچیز)
 *
 * حلقه‌هایی که یکی‌یکی آزموده می‌شوند (اولین ❌ = ریشهٔ مشکل):
 *   ۱) env — مدل ویژن اصلی/فال‌بکِ مؤثرِ همین بیلد + کلید AvalAI
 *   ۲) ffmpeg/ffprobe — بدون آن ویدیو هرگز فریم نمی‌دهد (عکس سالم می‌ماند)
 *   ۳) sharp — بدون آن بهینه‌سازی عکس می‌شکند (۴۰۰ به کلاینت برمی‌گردد)
 *   ۴) DB — آخرین پیام‌های رسانه‌دار چت + کش mediaAnalysis (کشِ مسموم؟)
 *   ۵) فایل — آیا فایل مدیا واقعاً روی دیسک هست و قابل خواندن است؟
 *   ۶) فریم — استخراج فریم از آخرین ویدیو (بدون کال AI)
 *   ۷) زنده (--live) — یک کال ویژن واقعی روی آخرین رسانه + حکم گارد ضدکور
 */
import { PrismaClient } from "@prisma/client";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, stat } from "fs/promises";

const execFileAsync = promisify(execFile);
const db = new PrismaClient();
const LIVE = process.argv.includes("--live");

let issues = 0;
function ok(label: string, detail?: string) {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label: string, detail?: string) {
  issues++;
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}
function info(label: string, detail?: string) {
  console.log(`  ℹ️  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("═".repeat(64));
  console.log(`تشخیص رسانهٔ چت فیتاپ — ${new Date().toISOString()}${LIVE ? " (زنده)" : " (خشک)"}`);
  console.log("═".repeat(64));

  // ─── ۱) env و مدل مؤثر ───
  console.log("\n── ۱) env و مدل مؤثر ──");
  const key = process.env.AVALAI_API_KEY;
  if (!key || key.includes("placeholder")) bad("AVALAI_API_KEY تنظیم نشده", "بدون کلید هیچ کال ویژنی ممکن نیست");
  else ok("AVALAI_API_KEY تنظیم شده", `طول=${key.length} شروع=${key.slice(0, 6)}…`);

  // مدل مؤثر را از خود کد می‌خوانیم (نه از env خام) تا مقدارِ همان بیلد دیده شود
  try {
    const ai = await import("../src/lib/fitness/ai");
    info("VISION_MODEL مؤثر کد", String((ai as any).VISION_MODEL));
    info("FALLBACK_VISION_MODEL مؤثر کد", String((ai as any).FALLBACK_VISION_MODEL));
    info("TEXT_MODEL مؤثر کد", String((ai as any).TEXT_MODEL));
    if (String((ai as any).VISION_MODEL).includes("deepseek")) {
      bad(
        "مدل ویژن هنوز deepseek است",
        "این مدل از AvalAI تصویر را نمی‌بیند (کور) — خط AVALAI_VISION_MODEL را در .env سرور روی gemini-3.8-flash بگذار و سرویس را ری‌استارت کن (bash deploy.sh یا pm2 restart)"
      );
    }
  } catch (e) {
    bad("import ماژول ai شکست خورد", String((e as Error).message).slice(0, 160));
  }
  info("AVALAI_BASE_URL", process.env.AVALAI_BASE_URL || "(پیش‌فرض SDK)");

  // ─── ۲) ffmpeg / ffprobe ───
  console.log("\n── ۲) ffmpeg / ffprobe (لازمِ ویدیو) ──");
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      await execFileAsync(bin, ["-version"], { timeout: 8000 });
      ok(`${bin} در دسترس است`);
    } catch {
      bad(`${bin} نصب نیست`, "بدون آن استخراج فریم ویدیو صفر فریم می‌دهد → مربی «نرسیده» می‌گوید. نصب: apt install -y ffmpeg");
    }
  }

  // ─── ۳) sharp ───
  console.log("\n── ۳) sharp (لازمِ عکس) ──");
  try {
    const sharp = (await import("sharp")).default;
    const probe = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).webp().toBuffer();
    ok("sharp کار می‌کند", `خروجی آزمایشی ${probe.length}B`);
  } catch (e) {
    bad("sharp شکسته است", String((e as Error).message).slice(0, 160));
  }

  // ─── ۴) DB — آخرین پیام‌های رسانه‌دار ───
  console.log("\n── ۴) آخرین پیام‌های رسانه‌دار چت ──");
  const mediaMsgs = await db.chatMessage.findMany({
    where: { mediaUrl: { not: null }, role: "user" },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, mediaType: true, mediaUrl: true, mediaAnalysis: true, createdAt: true },
  });
  if (mediaMsgs.length === 0) {
    info("هیچ پیام رسانه‌داری در DB نیست — بعد از ارسال یک عکس/ویدیو در چت دوباره اجرا کن");
  } else {
    for (const m of mediaMsgs) {
      const cached = m.mediaAnalysis?.trim();
      const poison = cached ? /نرسید|پیوست نشده|دسترسی ندارم|قابل تشخیص نیست|cannot see/i.test(cached) : false;
      console.log(
        `  • ${m.createdAt.toISOString()} [${m.mediaType}] ${m.mediaUrl} — کش: ${cached ? (poison ? "⚠️ مسموم/کور" : "✓ دارد") : "— خالی"}`
      );
    }
    if (mediaMsgs.some((m) => /نرسید|پیوست نشده|دسترسی ندارم/i.test(m.mediaAnalysis?.trim() || ""))) {
      bad(
        "کش mediaAnalysis مسموم (پاسخ کور دورهٔ مدل قبلی) وجود دارد",
        "با فیکس v93 این کش‌ها نادیده و دوباره تحلیل می‌شوند؛ اگر هنوز رخ می‌دهد یعنی تحلیلِ نو هم شکست می‌خورد — گام ۵/۶/۷ را ببین"
      );
    }
  }

  // ─── ۵) فایل رسانه روی دیسک ───
  console.log("\n── ۵) فایل آخرین رسانه روی دیسک ──");
  const { absolutePathForUploadUrl } = await import("../src/lib/fitness/private-media");
  const last = mediaMsgs[0];
  let lastAbs: string | null = null;
  if (last) {
    lastAbs = absolutePathForUploadUrl(last.mediaUrl!);
    try {
      const st = await stat(lastAbs);
      ok("فایل روی دیسک هست", `${lastAbs} (${Math.round(st.size / 1024)}KB)`);
    } catch {
      bad("فایل مدیا روی دیسک نیست", `${lastAbs} — فایل حذف/پاک‌سازی شده؛ رسانهٔ جدید بفرست و دوباره اجرا کن`);
    }
  }

  // ─── ۶) استخراج فریم (بدون کال AI) ───
  if (last?.mediaType === "video" && lastAbs) {
    console.log("\n── ۶) استخراج فریم از آخرین ویدیو ──");
    try {
      const ai = await import("../src/lib/fitness/ai");
      const frames = await (ai as any).extractVideoFramesAsDataUrls(lastAbs, 6);
      if (frames.length > 0) ok(`فریم استخراج شد (${frames.length})`, "مسیر ویدیو سالم است");
      else bad("استخراج فریم صفر فریم داد", "ffmpeg هست؟ کدک پشتیبانی نمی‌شود؟ لاگ بالا را ببین");
    } catch (e) {
      bad("استخراج فریم خطا داد", String((e as Error).message).slice(0, 200));
    }
  }

  // ─── ۷) کال ویژن زنده ───
  if (LIVE && last && lastAbs) {
    console.log("\n── ۷) کال ویژن زنده روی آخرین رسانه (واقعی — هزینهٔ ناچیز) ──");
    try {
      const ai = await import("../src/lib/fitness/ai");
      const dataUrls =
        last.mediaType === "image"
          ? [`data:${last.mediaUrl!.endsWith(".png") ? "image/png" : "image/webp"};base64,${(await readFile(lastAbs)).toString("base64")}`]
          : await (ai as any).extractVideoFramesAsDataUrls(lastAbs, 6);
      console.log(`  ℹ️ ارسال ${dataUrls.length} تصویر به مدل…`);
      const t0 = Date.now();
      const out = await (ai as any).analyzeChatMedia(
        last.mediaType === "video" ? "video-frames" : "image",
        dataUrls,
        "(تشخیص خودکار سرور)",
        null
      );
      const verdict = (ai as any).rejectBlindMediaResponse(out);
      console.log(`  ⏱ ${Date.now() - t0}ms`);
      console.log(`  حکم گارد ضدکور: ${verdict ? "❌ " + verdict : "✅ غیرکور"}`);
      console.log(`  ── پاسخ مدل ──\n${out.slice(0, 600)}`);
      if (verdict) bad("حتی کال زنده پاسخ کور داد", "مشکل در سمت AvalAI/کلید/مدل است — با پشتیبانی AvalAI وضعیت gemini-3.8-flash اکانت را چک کن");
      else ok("کال زنده: مدل واقعاً دید ✅ — کد و کلید و مدل همگی سالم‌اند");
    } catch (e) {
      bad("کال ویژن زنده شکست خورد", String((e as Error).message).slice(0, 300));
    }
  }

  console.log("\n" + "═".repeat(64));
  console.log(
    issues === 0
      ? "✅ همهٔ حلقه‌های زیرین سالم‌اند. اگر باز هم «نرسیده» دیدی: خروجی همین اسکریپت با --live را برای مهندس بفرست."
      : `❌ ${issues} مورد مشکل پیدا شد — بالاترین ❌ ریشهٔ فعلی است.`
  );
  console.log("═".repeat(64));
  await db.$disconnect();
  process.exit(issues === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("تشخیص شکست خورد:", e);
  process.exit(1);
});
