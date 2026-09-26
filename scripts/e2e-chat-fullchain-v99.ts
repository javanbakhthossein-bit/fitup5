/**
 * ═══════════════════════════════════════════════════════════════════════════
 * e2e-chat-fullchain-v99 — اثبات زندهٔ «تمام زنجیرهٔ چت با فیتاپ» روی سرور تولید
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * diagnose-chat-media-v99 حلقه‌های زیرین را اثبات کرد (env/ffmpeg/sharp/فایل/کال ویژن).
 * این اسکریپت **حلقهٔ آخر** را اثبات می‌کند — همان چیزی که کاربر در اپ می‌بیند:
 *
 *   پیام رسانه‌دار واقعی DB (همان کاربر واقعی)
 *     → ساخت dataUrls دقیقاً مثل مسیر v99 route (نقشهٔ mime کامل / فریم‌های ذخیره‌شده)
 *     → کال ۱: analyzeChatMedia با ownerId واقعی (همان امضای runMediaAnalysisJob)
 *       → گارد ضدکور روی تحلیل
 *     → تاریخچهٔ واقعی کاربر (مثل generateCoachAiResponse)
 *     → تزریق تحلیل دقیقاً با همان قالب route
 *     → کال ۲: aiChat (مربی دیپ‌سیک) با همان امضای مسیر تولید
 *       → گارد ضدکور روی «پاسخ نهایی مربی» ← اگر این سبز شود، مربی هرگز
 *         «فایل به دستم نرسید» نمی‌گوید چون رسانه را از گزارش بینایی می‌بیند.
 *     → نمایش هر دو خروجی برای راستی‌آزمایی چشمی مهندس
 *
 * اجرا (فقط روی سرور پروداکشن — سندباکس کلید واقعی ندارد):
 *   bun run scripts/e2e-chat-fullchain-v99.ts                 # خشک — بدون هیچ کال AI
 *   bun run scripts/e2e-chat-fullchain-v99.ts --live          # دو کال واقعی روی آخرین عکس
 *   bun run scripts/e2e-chat-fullchain-v99.ts --live --video  # دو کال واقعی روی آخرین ویدیو
 *
 * هزینه: یک کال ویژن (~۸s) + یک کال متن (~۵s) — ناچیز.
 */
import { PrismaClient } from "@prisma/client";
import { readFile, stat } from "fs/promises";

const db = new PrismaClient();
const LIVE = process.argv.includes("--live");
const WANT_VIDEO = process.argv.includes("--video");

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

/** v99 — عین نقشهٔ mime مسیر تولید (route.ts imageMimeFromUrl) */
function imageMimeFromUrl(url: string): string {
  const ext = (url.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] || "image/webp";
}

async function main() {
  console.log("═".repeat(64));
  console.log(`e2e کامل‌زنجیرهٔ چت فیتاپ — ${new Date().toISOString()}${LIVE ? " (زنده)" : " (خشک)"}`);
  console.log("═".repeat(64));

  // ─── ۱) آخرین پیام رسانه‌دار واقعی ───
  console.log("\n── ۱) آخرین پیام رسانه‌دار کاربران ──");
  const mediaMsgs = await db.chatMessage.findMany({
    where: {
      mediaUrl: { not: null },
      role: "user",
      mediaType: WANT_VIDEO ? "video" : "image",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      userId: true,
      mediaType: true,
      mediaUrl: true,
      mediaFrames: true,
      content: true,
      createdAt: true,
    },
  });
  if (mediaMsgs.length === 0) {
    bad("پیام رسانه‌دارِ مطابق فیلتر پیدا نشد", WANT_VIDEO ? "اول یک ویدیو در چت بفرست" : "اول یک عکس در چت بفرست (یا با --video ویدیو را تست کن)");
    await db.$disconnect();
    process.exit(1);
  }
  const m = mediaMsgs[0];
  info(`پیام ${m.createdAt.toISOString()} [${m.mediaType}]`, `${m.mediaUrl} — کاربر=${m.userId}`);

  // ─── ۲) وضعیت سهمیهٔ همان کاربر (سوسپیشون قدیمی مالک: «مشکل از سهمیه است؟») ───
  // نکتهٔ فنی: quota.ts دیرکتیو server-only دارد و با bun مستقیم ایمپورت نمی‌شود؛
  // همین‌جا مستقیم از QuotaUsage/SiteSetting می‌خوانیم (همان ریاضیاتِ موتور سهمیه).
  console.log("\n── ۲) وضعیت سهمیهٔ همان کاربر (خوانش مستقیم DB) ──");
  try {
    const cat = m.mediaType === "video" ? "movement_video" : "chat_photo";
    const row = await db.quotaUsage.findUnique({
      where: { userId_category: { userId: m.userId, category: cat } },
      select: { used: true, bonus: true, dailyUsed: true, periodStart: true, updatedAt: true },
    });
    let baseTotal = 90; // quota_chat_photo_total پیش‌فرض موتور
    if (cat === "chat_photo") {
      const s = await db.siteSetting.findUnique({ where: { key: "quota_chat_photo_total" } });
      const n = Number(s?.value?.replace(/[,\s]/g, "") ?? "");
      if (Number.isFinite(n) && n > 0) baseTotal = Math.round(n);
    }
    const total = baseTotal + (row?.bonus ?? 0);
    const remaining = Math.max(0, total - (row?.used ?? 0));
    if (cat === "chat_photo") {
      info(`سهمیهٔ ${cat}`, `used=${row?.used ?? 0}/${total} — باقی=${remaining}${row ? ` — آخرین تغییر=${row.updatedAt.toISOString()}` : " — ردیفی ندارد (هیچ مصرفی ثبت نشده)"}`);
    } else {
      info(`سهمیهٔ ${cat}`, `used=${row?.used ?? 0}+bonus=${row?.bonus ?? 0} — سقف این دسته = تعداد حرکات برنامهٔ فعال کاربر (در همین اسکریپت محاسبه نمی‌شود)`);
    }
    ok("یادآوری معماری سهمیه", "کسر فقط «بعد از تحلیل موفق» رخ می‌دهد (runMediaAnalysisJob) و allowed=false فقط پیام بعدی را با 429 می‌بندد — سهمیه هرگز عامل «نرسیده» نیست");
  } catch (e) {
    bad("خواندن سهمیه از DB شکست خورد", String((e as Error).message).slice(0, 160));
  }

  // ─── ۳) ساخت dataUrls — دقیقاً مثل مسیر v99 route ───
  console.log("\n── ۳) ساخت dataUrls (عین مسیر تولید) ──");
  const { absolutePathForUploadUrl } = await import("../src/lib/fitness/private-media");
  const ai = await import("../src/lib/fitness/ai");
  let dataUrls: string[] = [];
  const kind: "image" | "video-frames" = m.mediaType === "video" ? "video-frames" : "image";
  try {
    if (m.mediaType === "image") {
      const abs = absolutePathForUploadUrl(m.mediaUrl!);
      const buf = await readFile(abs);
      if (buf.length === 0) throw new Error("فایل صفر بایت است");
      const mime = imageMimeFromUrl(m.mediaUrl!);
      dataUrls = [`data:${mime};base64,${buf.toString("base64")}`];
      ok("عکس خوانده شد", `${mime} — ${Math.round(buf.length / 1024)}KB`);
    } else {
      // ویدیو: اول فریم‌های ذخیره‌شده (mediaFrames) → فال‌بک استخراج ffmpeg
      let frameFileUrls: string[] = [];
      if (m.mediaFrames) {
        try {
          const parsed = JSON.parse(m.mediaFrames);
          if (Array.isArray(parsed)) frameFileUrls = parsed.filter((u: unknown): u is string => typeof u === "string");
        } catch {
          /* JSON خراب → فال‌بک */
        }
      }
      if (frameFileUrls.length === 0) {
        dataUrls = await (ai as any).extractVideoFramesAsDataUrls(absolutePathForUploadUrl(m.mediaUrl!), 6);
        info("فریم‌ها از خود ویدیو استخراج شد (ffmpeg)");
      } else {
        for (const u of frameFileUrls.slice(0, 8)) {
          try {
            const buf = await readFile(absolutePathForUploadUrl(u));
            if (buf.length === 0) continue;
            const mime = u.endsWith(".png") ? "image/png" : u.endsWith(".webp") ? "image/webp" : "image/jpeg";
            dataUrls.push(`data:${mime};base64,${buf.toString("base64")}`);
          } catch {
            /* فریم حذف‌شده — رد */
          }
        }
        info(`فریم‌های ذخیره‌شدهٔ روی دیسک خوانده شد (${dataUrls.length})`);
      }
      ok("ویدیو به فریم تبدیل شد", `${dataUrls.length} فریم`);
    }
  } catch (e) {
    bad("ساخت dataUrls شکست خورد (عین حالت «فایل در دسترس نیست» مسیر تولید)", String((e as Error).message).slice(0, 200));
    console.log("\n" + "═".repeat(64));
    console.log("❌ بدون dataUrls هیچ تحلیلی ممکن نیست — همین ❌ ریشه است. رسانهٔ تازه بفرست و دوباره اجرا کن.");
    console.log("═".repeat(64));
    await db.$disconnect();
    process.exit(1);
  }

  if (!LIVE) {
    console.log("\n── (خشک) تا اینجا بدون کال AI ──");
    ok("زنجیرهٔ داده سالم است", "با --live دو کال واقعی (ویژن + مربی) اجرا می‌شود — هزینهٔ ناچیز");
    console.log("\n" + "═".repeat(64));
    console.log(issues === 0 ? "✅ خشک: آمادهٔ تست زنده (--live)" : `❌ ${issues} مشکل — بالاتر ببین`);
    console.log("═".repeat(64));
    await db.$disconnect();
    process.exit(issues === 0 ? 0 : 1);
  }

  // ─── ۴) کال ۱ — تحلیل بینایی با owner واقعی (همان امضای runMediaAnalysisJob) ───
  console.log("\n── ۴) کال ویژن زنده (analyzeChatMedia با ownerId واقعی) ──");
  const caption =
    m.content && !m.content.startsWith("📷") && !m.content.startsWith("🎬") ? m.content : "";
  let analysis = "";
  try {
    const t0 = Date.now();
    analysis = await (ai as any).analyzeChatMedia(kind, dataUrls, caption, m.userId);
    const blind = (ai as any).rejectBlindMediaResponse(analysis);
    console.log(`  ⏱ ${Date.now() - t0}ms`);
    if (blind) {
      bad("تحلیل بینایی کور بود", blind);
      console.log(`  ── خروجی مدل ──\n${analysis.slice(0, 400)}`);
    } else {
      ok("تحلیل بینایی: غیرکور — مدل واقعاً دید", `${analysis.length} نویسه`);
      console.log(`  ── گزارش بینایی ──\n${analysis.slice(0, 500)}${analysis.length > 500 ? " …" : ""}`);
    }
  } catch (e) {
    bad("analyzeChatMedia شکست خورد", String((e as Error).message).slice(0, 300));
    console.log("\n" + "═".repeat(64));
    console.log("❌ زنجیره در کال ویژن قطع شد — diagnose-chat-media-v99.ts --live را هم اجرا کن و خروجی هر دو را بفرست.");
    console.log("═".repeat(64));
    await db.$disconnect();
    process.exit(1);
  }

  // ─── ۵) پرامپت سیستم ذخیره‌شدهٔ DB (اگر با تزریق بجنگد اینجا دیده می‌شود) ───
  console.log("\n── ۵) پرامپت سیستم چت ذخیره‌شده در DB (AiConfig) ──");
  try {
    const cfg = await db.aiConfig.findUnique({ where: { key: "chat_system_prompt" } });
    if (!cfg) {
      info("chat_system_prompt در DB تنظیم نشده", "پرامپت پیش‌فرض کد استفاده می‌شود — هیچ تداخل DB وجود ندارد");
    } else {
      const poison = /نرسید|نمی‌توانم ببین|دسترسی ندارم|دسترسی به عکس|دسترسی به ویدیو|cannot see/i.test(cfg.value);
      if (poison) {
        bad("پرامپت DB ذخیره‌شده حاوی الگوی کوری/رسانه است", "ممیزی دستی: پنل ادمین → تنظیمات AI → پرامپت چت — عبارت رسانه‌ای را حذف کن");
        const idx = cfg.value.search(/نرسید|نمی‌توانم ببین|دسترسی ندارم|cannot see/i);
        if (idx >= 0) console.log(`  ⚠️ متن مشکوک: …${cfg.value.slice(Math.max(0, idx - 60), idx + 80).replace(/\s+/g, " ")}…`);
      } else {
        ok("پرامپت DB بدون الگوی کوری", `${cfg.value.length} نویسه — آخرین ویرایش=${cfg.updatedAt.toISOString()}`);
      }
    }
  } catch (e) {
    info("خواندن AiConfig ممکن نشد", String((e as Error).message).slice(0, 120));
  }

  // ─── ۶) کال مربی زنده (aiChat — همان امضای مسیر تولید + ضدعفونی تاریخچه v99-b) ───
  console.log("\n── ۶) کال مربی زنده (aiChat — همان امضای مسیر تولید) ──");
  let answer = "";
  try {
    const hist = await db.chatMessage.findMany({
      where: { userId: m.userId, id: { not: m.id }, content: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    hist.reverse();

    // v99-b — دید تاریخی: کدام پاسخ‌های قبلی مربی ادعای کوری دارند؟
    // (ریشه‌یابی: الگوی «چند بار است که فایل نمی‌رسد» از همین تاریخچهٔ آلوده می‌آید
    // و بر تزریق سیستم غلبه می‌کند — اثبات زندهٔ پرب تولیدی 2026-09-14)
    const poisoned = hist.filter(
      (h) => h.role === "assistant" && (ai as any).rejectBlindMediaResponse(h.content)
    );
    if (poisoned.length > 0) {
      console.log(`  ⚠️ ${poisoned.length} پاسخ قبلی مربی در تاریخچه ادعای کوری دارد (مسیر تولید آن‌ها را پاک می‌کند):`);
      for (const p of poisoned.slice(0, 3)) {
        console.log(`     • ${p.createdAt.toISOString()}: ${p.content.slice(0, 90).replace(/\s+/g, " ")}…`);
      }
    } else {
      ok("تاریخچه بدون ادعای کوری");
    }

    // v99-b — ضدعفونی تاریخچه عین مسیر تولید: خطوط کور از پاسخ‌های قبلی پاک می‌شوند
    const cleanHist = hist.map((h) => {
      if (h.role !== "assistant") return h;
      const lines = h.content.split("\n").map((line) => {
        const verdict = (ai as any).rejectBlindMediaResponse(line);
        if (!verdict) return line;
        const nounMatch = /ویدیو|عکس|تصویر|فایل|رسانه|لینک|فریم/i.exec(line);
        return `${nounMatch ? nounMatch[0] : "رسانه"} شما دریافت شده است؛ اگر تحلیل کامل آن انجام نشده، لطفاً دوباره بفرستش تا دقیق بررسی کنم.`;
      });
      return { ...h, content: lines.join("\n") };
    });
    const history = cleanHist.map((h) => ({ role: h.role, content: h.content }));
    info("تاریخچهٔ واقعی کاربر", `${history.length} پیام${poisoned.length > 0 ? ` (${poisoned.length} مورد پاک شد)` : ""}`);

    // عین قالب تزریق route.ts (mediaAnalysisForAi — پیام فعلی)
    const mediaAnalysisForAi = `\n\n[تحلیل ${kind === "image" ? "عکس" : "ویدیو"}ی که کاربر در همین پیام فرستاده است — تولید مدل بینایی فیتاپ:\n${analysis}]`;

    // عین finalMessage مسیر مدیا (پیام بدون متن → دستور تحلیل از روی گزارش بینایی)
    const finalMessage = caption
      ? caption
      : kind === "video-frames"
        ? "ویدیویی که فرستادم را بر اساس گزارش بینایی پیوست‌شده در پیام سیستم تحلیل کن: فرم اجرا، خطاهای تکنیکی و اصلاحات دقیق را به من بده."
        : "عکسی که فرستادم را بر اساس گزارش بینایی پیوست‌شده در پیام سیستم تحلیل کن و بازخورد کامل و کاربردی بده.";

    const userRow = await db.user.findUnique({
      where: { id: m.userId },
      select: { planName: true },
    });

    const t0 = Date.now();
    answer = await (ai as any).aiChat(
      null,
      history,
      finalMessage,
      (userRow?.planName as any) ?? null,
      mediaAnalysisForAi,
      m.userId,
      null
    );
    console.log(`  ⏱ ${Date.now() - t0}ms`);
    const blindAnswer = (ai as any).rejectBlindMediaResponse(answer);
    if (blindAnswer) {
      bad("پاسخ مربی ادعای کوری دارد", blindAnswer);
    } else if (!answer.trim()) {
      bad("پاسخ مربی خالی بود");
    } else {
      ok("پاسخ مربی: بدون هیچ ادعای کوری ✅");
    }
    console.log(`  ── پاسخ نهایی مربی (همان چیزی که کاربر می‌بیند) ──\n${answer.slice(0, 700)}${answer.length > 700 ? " …" : ""}`);
  } catch (e) {
    bad("aiChat شکست خورد", String((e as Error).message).slice(0, 300));
  }

  console.log("\n" + "═".repeat(64));
  if (issues === 0) {
    console.log("✅✅ کل زنجیرهٔ چت رسانه‌دار روی همین سرور اثبات شد:");
    console.log("   پیام DB → dataUrls (mime درست) → ویژن (می‌بیند) → تزریق → مربی (نمی‌گوید «نرسیده»)");
    console.log("   اگر در اپ باز هم دیدی «نرسیده»: سرویس بعد از آخرین دیپلوی ری‌استارت نشده یا اپ/کش قدیمی است — bash deploy.sh و تست دوباره.");
  } else {
    console.log(`❌ ${issues} حلقهٔ شکسته — بالاترین ❌ ریشهٔ فعلی است؛ خروجی کامل را برای مهندس بفرست.`);
  }
  console.log("═".repeat(64));
  await db.$disconnect();
  process.exit(issues === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("e2e شکست خورد:", e);
  process.exit(1);
});
