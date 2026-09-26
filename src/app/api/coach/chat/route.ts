import { NextRequest } from "next/server";
import { stat, readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { aiChat, analyzeChatMedia, extractVideoFramesAsDataUrls, rejectBlindMediaResponse, hasBlindMediaClaim } from "@/lib/fitness/ai";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { fixPersianTypographySafe } from "@/lib/fitness/persian-typography";
import { savePrivateMediaFile, absolutePathForUploadUrl } from "@/lib/fitness/private-media";
import { compressVideoFileInPlace, formatBytes } from "@/lib/fitness/media-compress";
import { checkQuota, consumeQuotaAtomically } from "@/lib/fitness/quota";
import { processImageSafe } from "@/lib/fitness/image-process";
import { buildSportsProfileContext } from "@/lib/fitness/sports-profile-context";
// v77 — تشخیص و اجرای «تغییر برنامه از چت» (تیکت‌های مالک — صداقت چت + اعمال واقعی)
import { applyPlanChangeRequest } from "@/lib/fitness/plan-change-intent";
import type { OnboardingData } from "@/lib/fitness/types";

/** حداکثر تعداد فریم ویدیویی که کلاینت می‌تواند از مسیر multipart بفرستد */
const MAX_CLIENT_FRAMES = 8;
/** حداکثر طول هر فریم data URL از کلاینت (فریم‌ها ~۱۰۲۴px JPEG — مرز امن) */
const MAX_CLIENT_FRAME_CHARS = 2 * 1024 * 1024;

/**
 * v71 سینک رسانه — پنجرهٔ جمع‌آوری تحلیل‌های کش‌شدهٔ مدل بینایی:
 * اگر مدیای کاربر (عکس/ویدیو) در ۶ پیام آخر تاریخچه باشد، تحلیل متنیِ کش‌شده‌اش
 * (ChatMessage.mediaAnalysis) به پیام متنی بعدی تزریق می‌شود تا «عکس/ویدیو بعد
 * متن» همیشه توسط دیپ‌سیک و با آگاهی کامل از مدیا سینک بماند؛ پیام‌های قدیمی‌تر
 * فقط توضیح متنی دارند (کنترل هزینه — بدون کال ویژن تکراری).
 */
const MEDIA_SYNC_WINDOW = 6;

/**
 * v70 — ذخیره فریم‌های ویدیو (data URL) روی دیسک برای استفادهٔ مجدد در پیام‌های بعدی.
 * خروجی: آرایهٔ URL نسبی (زیر uploads/chat/) — fail-safe: فریم خراب حذف می‌شود.
 */
async function saveFramesToDisk(dataUrls: string[]): Promise<string[]> {
  const urls: string[] = [];
  const stamp = Date.now();
  for (let i = 0; i < dataUrls.length; i++) {
    try {
      const parsed = parseDataUrl(dataUrls[i], "image/jpeg");
      const ext = parsed.mime === "image/png" ? "png" : parsed.mime === "image/webp" ? "webp" : "jpg";
      const buffer = Buffer.from(parsed.base64, "base64");
      if (buffer.length === 0) continue;
      const fileName = `chat-vframe-${stamp}-${Math.random().toString(36).slice(2, 8)}-${i}.${ext}`;
      const { url } = await savePrivateMediaFile("chat", fileName, buffer);
      urls.push(url);
    } catch (frameErr) {
      console.error("[chat] frame save failed (skipping):", frameErr);
    }
  }
  return urls;
}

/**
 * v71 — بارگذاری مدیای یک پیام تاریخی به‌صورت data URL (برای تحلیل روی‌تقاضا).
 * عکس: فایل بهینه‌شده روی دیسک. ویدیو: فریم‌های ذخیره‌شده (v70) یا استخراج دوباره ffmpeg.
 * هیچ‌جا throw نمی‌کند — شکست یعنی آرایهٔ خالی.
 */
async function loadMediaDataUrls(m: {
  mediaUrl: string | null;
  mediaType: string | null;
  mediaFrames: string | null;
}): Promise<string[]> {
  try {
    if (!m.mediaUrl) return [];
    if (m.mediaType === "image") {
      const buf = await readFile(absolutePathForUploadUrl(m.mediaUrl));
      if (buf.length === 0) return [];
      // v99 — نقشهٔ کامل mime (باگ نهان: قبلاً هر چیز غیر png → image/webp برچسب می‌خورد؛
      // عکس .jpg/.jpeg دوربین‌های قدیمی و به‌ویژه فال‌بک HEIC آیفون (v79) با mime اشتباه
      // به مدل ویژن می‌رفت → مدل بلاک را decode نمی‌کرد → «فایل به دستم نرسید»!)
      const mime = imageMimeFromUrl(m.mediaUrl);
      return [`data:${mime};base64,${buf.toString("base64")}`];
    }
    // ویدیو — اولویت: فریم‌های ذخیره‌شده (URL فایل) → استخراج دوباره از فایل
    let frameFileUrls: string[] = [];
    if (m.mediaFrames) {
      try {
        const parsedFrames = JSON.parse(m.mediaFrames);
        if (Array.isArray(parsedFrames)) frameFileUrls = parsedFrames.filter((u: unknown): u is string => typeof u === "string");
      } catch {
        // JSON خراب → فال‌بک به استخراج دوباره
      }
    }
    if (frameFileUrls.length === 0) {
      // extractVideoFramesAsDataUrls خودش data URL برمی‌گرداند
      return await extractVideoFramesAsDataUrls(absolutePathForUploadUrl(m.mediaUrl), 6);
    }
    const dataUrls: string[] = [];
    for (const u of frameFileUrls.slice(0, MAX_CLIENT_FRAMES)) {
      try {
        const buf = await readFile(absolutePathForUploadUrl(u));
        if (buf.length === 0) continue;
        const mime = u.endsWith(".png") ? "image/png" : u.endsWith(".webp") ? "image/webp" : "image/jpeg";
        dataUrls.push(`data:${mime};base64,${buf.toString("base64")}`);
      } catch {
        // فریم حذف‌شده از دیسک — رد شو
      }
    }
    return dataUrls;
  } catch (err) {
    console.error("[chat] loadMediaDataUrls failed:", err);
    return [];
  }
}

/** v99 — mime درست از پسوند فایل رسانهٔ چت (فال‌بک نهایی: image/webp مثل قبل) */
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

function formatMediaAnalysisPart(
  m: { content: string; mediaType: string | null },
  analysis: string
): string {
  const kind = m.mediaType === "video" ? "ویدیو" : "عکس";
  const hasCaption = m.content && !m.content.startsWith("📷") && !m.content.startsWith("🎬");
  const cap = hasCaption ? ` (متن همراه: «${m.content.slice(0, 120)}»)` : "";
  return `• ${kind}${cap}: ${analysis}`;
}

/**
 * v71 سینک رسانه (دیریکتیو مالک: «فقط تحلیل عکس/ویدیو جمنای است و بقیه دیپ‌سیک») —
 * به‌جای پیوست مجدد فایل مدیا به مدل ویژن (v70)، تحلیلِ متنیِ کش‌شدهٔ جمنای
 * (ChatMessage.mediaAnalysis) از ۶ پیام آخر جمع می‌شود تا به کال متنیِ دیپ‌سیک
 * تزریق شود — بدون هیچ هزینهٔ ویژن تکراری. اگر مدیای اخیر تحلیل کش‌شده نداشت
 * (پیام قدیمی‌تر از v71)، یک‌بار روی‌تقاضا تحلیل و کش می‌شود (بودجه: حداکثر ۱
 * تحلیل جدید در هر پیام — کنترل هزینه/زمان).
 */
async function collectHistoryMediaAnalyses(
  userId: string,
  history: {
    id: string;
    content: string;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFrames: string | null;
    mediaAnalysis: string | null;
  }[]
): Promise<string> {
  try {
    const recent = history.slice(-MEDIA_SYNC_WINDOW);
    const mediaMsgs = recent.filter((m) => m.mediaUrl && m.mediaType);
    if (mediaMsgs.length === 0) return "";

    const parts: string[] = [];
    let onDemandBudget = 1;
    for (const m of mediaMsgs) {
      if (m.mediaAnalysis?.trim()) {
        const cached = m.mediaAnalysis.trim();
        // ─── v93 — پالایش کشِ مسموم (گزارش مالک: «تحلیل ویدیو در یک سری پیام‌ها
        // هم نمیگه که نمی‌بینم یا نرسیده») ───
        // در دورهٔ v91 (ویژن کور) پاسخ‌های کور مثل «ویدیویی به من نرسیده» به‌عنوان
        // تحلیل موفق در mediaAnalysis کش شده بودند و اینجا در تک‌تک پیام‌های بعدی
        // گفتگو به مربی تزریق می‌شدند → مربی در کل سری پیام‌ها «نمی‌بینم/نرسیده»
        // می‌گفت. حالا هر کشِ کور = نامعتبر: تزریق نمی‌شود و در سقف بودجه دوباره
        // با مدل بینایی سالم تحلیل می‌شود.
        if (rejectBlindMediaResponse(cached)) {
          console.warn(`[chat] poisoned blind mediaAnalysis in cache — ignoring (msg=${m.id})`);
        } else {
          parts.push(formatMediaAnalysisPart(m, cached));
          continue;
        }
      }
      if (onDemandBudget <= 0) continue;
      onDemandBudget--;
      try {
        const dataUrls = await loadMediaDataUrls(m);
        if (dataUrls.length === 0) continue;
        const text = await analyzeChatMedia(
          m.mediaType === "video" ? "video-frames" : "image",
          dataUrls,
          m.content,
          userId
        );
        parts.push(formatMediaAnalysisPart(m, text));
        // کش روی همان پیام تاریخی — دفعات بعد بدون کال ویژن
        try {
          await db.chatMessage.update({ where: { id: m.id }, data: { mediaAnalysis: text } });
        } catch (cacheErr) {
          console.error("[chat] mediaAnalysis cache update failed:", cacheErr);
        }
      } catch (anErr) {
        console.error("[chat] on-demand media analysis failed (skipping):", anErr);
      }
    }
    if (parts.length === 0) return "";
    return `\n\n[تحلیل رسانه‌های اخیر کاربر در همین گفتگو — تولید مدل بینایی فیتاپ — برای مرجع تو:\n${parts.join("\n")}\nاگر پرسش فعلی دربارهٔ همین رسانه‌هاست، پاسخت را بر اساس این تحلیل‌ها بده؛ رسانه‌ها خودشان پیوست نشده‌اند و لازم نیست بگویی «نمی‌توانم ببینم».]`;
  } catch (err) {
    console.error("[chat] collectHistoryMediaAnalyses failed (continuing without sync):", err);
    return "";
  }
}

/**
 * اعتبارسنجی videoUrl مسیر multipart — فقط فایل ذخیره‌شده توسط خود این سیستم
 * در uploads/chat/ پذیرفته می‌شود (بدون traversal) و باید واقعاً روی دیسک باشد.
 */
async function validateChatVideoUrl(userId: string, url: string): Promise<string | null> {
  if (!url.startsWith("/uploads/chat/")) return null;
  if (url.includes("..")) return null;
  // مالکیت: نام فایل ویدیوی مسیر multipart الگوی chat-video-{uid}-… دارد
  const fileName = url.split("/").pop() || "";
  if (!fileName.startsWith(`chat-video-${userId}-`)) return null;
  const filePath = absolutePathForUploadUrl(url);
  try {
    const st = await stat(filePath);
    if (!st.isFile() || st.size === 0) return null;
  } catch {
    return null;
  }
  return url;
}

/**
 * پارس امن JSON محتوای برنامه از DB (L7) — ردیف خراب نباید کل مسیر چت را با 500 بکشد.
 */
function safeParsePlanContent(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    console.error("[chat] invalid plan JSON content in DB, skipping:", (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  v85 — کانتکست «برنامهٔ جاری» با جزئیات کامل + کش در-حافظه
//  (فیکس باگ بزرگ مالک: فیتاپ نمی‌دانست حرکت سوم روز شنبه کاربر چیست)
// ═══════════════════════════════════════════════════════════════

/**
 * v85 — کش در-حافظهٔ کانتکست برنامهٔ جاری هر کاربر (دیریکتیو مالک: از پاسخ‌های
 * کش‌شده استفاده کن تا مصرف هوش مصنوعی زیاد نشود ولی در خود روند کار مشکلی
 * پیش نیاید). این کانتکست «رایگان» است (فقط کوئری DB — بدون هیچ کال AI) و
 * کش ۹۰ ثانیه‌ای فقط جلوی کوئری تکراری در پیام‌های پشت‌سرهم را می‌گیرد.
 */
const programCtxCache = new Map<string, { value: string; at: number }>();
const PROGRAM_CTX_TTL_MS = 90_000;
const PROGRAM_CTX_MAX_CHARS = 7000;

/** قالب‌بندی امن متن کوتاه از فیلد ناشناختهٔ JSON */
function shortText(v: unknown, max = 60): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return s.trim().slice(0, max);
}

/**
 * ساخت «پروندهٔ کامل برنامهٔ جاری کاربر» برای تزریق به چت مربی:
 *  • برنامهٔ تمرینی فعال — همهٔ روزها + همهٔ حرکات با ست×تکرار/استراحت/سوپرست
 *  • برنامهٔ غذایی فعال — همهٔ وعده‌ها با ترکیب آیتم‌ها و کالری
 *  • مکمل‌های فعلی (از هر دو برنامه)
 * شکست هر بخش فقط همان بخش را حذف می‌کند — هرگز throw نمی‌کند.
 */
async function buildCurrentProgramContext(userId: string): Promise<string> {
  const cached = programCtxCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.at < PROGRAM_CTX_TTL_MS) return cached.value;

  let value = "";
  try {
    const [workoutPlan, mealPlan] = await Promise.all([
      db.workoutPlan
        .findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" }, select: { content: true } })
        .catch(() => null),
      db.mealPlan
        .findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" }, select: { content: true } })
        .catch(() => null),
    ]);

    const parts: string[] = [];

    if (workoutPlan?.content) {
      const wc = safeParsePlanContent(workoutPlan.content);
      if (wc && Array.isArray(wc.days) && wc.days.length > 0) {
        const dayLines: string[] = [];
        for (const day of wc.days) {
          if (!day) continue;
          const dayTitle = [shortText(day.day, 20), shortText(day.title, 40)].filter(Boolean).join(" — ") || "روز";
          const exercises = Array.isArray(day.exercises) ? day.exercises : [];
          const exParts = exercises.map((ex: any, i: number) => {
            const name = shortText(ex?.name || ex?.title, 50) || "حرکت";
            const bits: string[] = [];
            const sets = Array.isArray(ex?.sets) ? ex.sets.length : Number(ex?.sets) || 0;
            const firstReps = Array.isArray(ex?.sets) && ex.sets[0]?.reps ? shortText(ex.sets[0].reps, 12) : "";
            const restSec = Array.isArray(ex?.sets) && Number(ex.sets[0]?.restSec) ? Number(ex.sets[0].restSec) : 0;
            if (sets) bits.push(`${toFaDigits(sets)} ست`);
            if (firstReps) bits.push(`${toFaDigits(firstReps)} تکرار`);
            if (restSec) bits.push(`استراحت ${toFaDigits(restSec)} ثانیه`);
            if (ex?.supersetGroup) bits.push(`گروه ${shortText(ex.supersetGroup, 4)} (سوپرست/تریت‌ست)`);
            if (ex?.rpe) bits.push(`RPE ${toFaDigits(ex.rpe)}`);
            return `${toFaDigits(i + 1)}) ${name}${bits.length ? ` (${bits.join("، ")})` : ""}`;
          });
          dayLines.push(`  • ${dayTitle}:\n${exParts.length ? exParts.map((s: string) => `    ${s}`).join("\n") : "    بدون حرکت"}`);
        }
        if (dayLines.length) {
          parts.push(
            `📅 برنامهٔ تمرینی فعال کاربر — جزئیات کامل همهٔ روزها (وقتی کاربر دربارهٔ هر حرکتی از هر روزی پرسید — مثل «حرکت سوم روز شنبه» — دقیق از همین لیست جواب بده و هرگز نگو به برنامه دسترسی نداری):\n${dayLines.join("\n")}` +
              (wc.notes ? `\n  نکات برنامه: ${shortText(wc.notes, 300)}` : "")
          );
        }
      }
    }

    if (mealPlan?.content) {
      const mc = safeParsePlanContent(mealPlan.content);
      if (mc && Array.isArray(mc.meals) && mc.meals.length > 0) {
        const mealLines = mc.meals.map((m: any) => {
          const label = [shortText(m?.label, 24), shortText(m?.type, 16)].filter(Boolean).join(" (") ;
          const labelOut = label.includes("(") ? label + ")" : label || "وعده";
          const items = Array.isArray(m?.items)
            ? m.items.map((it: any) => shortText(it?.name, 30)).filter(Boolean).slice(0, 8)
            : [];
          const kcal = Number(m?.totalCalories) || 0;
          return `  • ${labelOut}: ${items.length ? items.join(" + ") : "—"}${kcal ? ` — حدود ${toFaDigits(kcal)} کالری` : ""}`;
        });
        parts.push(
          `🍽 برنامهٔ غذایی فعال کاربر — جزئیات کامل وعده‌ها (هدف روزانه: ${toFaDigits(mc.totalCalories || 0)} کالری، پروتئین ${toFaDigits(mc.totalProtein || 0)}گرم):\n${mealLines.join("\n")}`
        );
        if (Array.isArray(mc.supplements) && mc.supplements.length > 0) {
          parts.push(`💊 مکمل‌های برنامهٔ فعلی: ${mc.supplements.map((s: any) => `${shortText(s?.name, 30)} (${shortText(s?.dose, 20)})`).join("، ")}`);
        }
      }
    }

    value = parts.join("\n\n");
    if (value.length > PROGRAM_CTX_MAX_CHARS) {
      value = value.slice(0, PROGRAM_CTX_MAX_CHARS) + "\n  (بخش‌های انتهایی برنامه برای کوتاه‌ماندن پرامپت حذف شد)";
    }
  } catch (e) {
    console.error("[chat] buildCurrentProgramContext failed (continuing without it):", e);
  }

  programCtxCache.set(userId, { value, at: now });
  return value;
}

/** تبدیل ارقام لاتین یک رشتهٔ عددی به ارقام فارسی (برای کانتکست فارسی) */
function toFaDigits(input: string | number): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(input).replace(/\d/g, (d) => fa[Number(d)]);
}

/**
 * v85 — پاک‌سازی ظاهری پاسخ مربی قبل از ذخیره (باگ ظاهری گزارش مالک):
 * خطوط تزئینی مثل «----------» ، «========» ، «******» که مدل گاهی می‌سازد
 * در چت زشت نمایش داده می‌شوند — حذف کامل + فشرده‌سازی خطوط خالی اضافه.
 * جدول‌های مارک‌داون (خط جداکنندهٔ سلول‌ها با |) دست‌نخورده می‌مانند.
 *
 * v93 — پاک‌سازی «ادعای کوری» (دیرکتیو مالک: «تحلیل ویدیو در یک سری پیام‌ها هم
 * نمیگه که نمی‌بینم یا نرسید»): هر خطِ پاسخ مربی که صریحاً بگوید ویدیو/عکسِ کاربر
 * به او نرسیده/نمی‌تواند ببیند، با جملهٔ صادقانهٔ «دریافت شده اما پردازش نشد»
 * جایگزین می‌شود. رسانهٔ کاربر واقعاً در DB ذخیره شده — «نرسیدن» هرگز صحیح نیست.
 * (الگوی عمداً محدودتر از گارد rejectBlindMediaResponse است تا خطِ سالمِ
 * «دسترسی به تصویر پرونده‌ات داشتم…» خراب نشود.)
 */
function scrubBlindMediaClaims(raw: string): string {
  if (!raw) return raw;
  // v94 — «فریم» هم به اسم‌های رسانه اضافه شد + الگوی «پیوست/ارسال نشد»
  // (عین ادعاهای کورِ مشاهده‌شده در پرب زندهٔ v94)
  // v95 — الگوهای «ارائه نشد / تحویل نشد» + «محتوای بصری قابل تشخیص نیست» +
  // «دادهٔ بصری نرسیده» (عین پاسخ کور جدیدِ پرب زندهٔ v95 که باعث شده بود تحلیلِ
  // کور «موفق» پنداشته شود و سهمیه کم شود)
  const N = "(?:ویدیو|عکس|تصویر|فایل|رسانه|لینک|فریم)(?:یی|ی)?";
  const blind = new RegExp(
    // «ویدیویی به من نرسیده / عکسی دریافت نشد / فایلی نرسید» — صریح‌ترین ادعای کور
    // v99-b — واریانت «به دست من» عین جملهٔ مالک: «فایل به دست من نرسیده است»
    `${N} ?(?:به من |به دستم |به دست من )?(?:نرسید|نرسیده|دریافت نشد|دریافت نشده|دریافت نکردم|نگرفتم)` +
    // «ویدیویی/عکسی نمی‌بینم» — الگوی کلاسیک مدلِ بدون بلاک تصویر
    `|${N} (?:را )?نمی‌?بینم` +
    // «نمی‌توانم ویدیو/عکس را ببینم/مشاهده کنم»
    `|نمی‌[ ‌]?توانم (?:هیچ )?${N}[^.،\n]{0,12}(?:ببینم|مشاهده کنم|ببین)` +
    // v94/v95 — «تصویری پیوست/ارسال/ضمیمه/ارائه/تحویل نشده» — ادعاهای کورِ مدل بومی
    `|${N}[^.،\n]{0,30}(?:پیوست|ارسال|ضمیمه|ارائه|تحویل) نشد` +
    // v95 — «محتوای بصری قابل تشخیص نیست» (دنبالهٔ منفی الزامی — خط سالمِ
    // «محتوای بصری ویدیو نشان می‌دهد…» دست نخورده می‌ماند)
    `|محتوای بصری[^.،\n]{0,30}قابل (?:تشخیص|بازیابی|مشاهده) نیست` +
    // v95 — «دادهٔ بصری به تحلیل‌گر/من نرسیده»
    `|داده[ٔ‌]? ?بصری[^.،\n]{0,25}نرسید` +
    // v99-b — الگوهای عین ادعاهای زندهٔ پرب تولیدی 2026-09-14 که از scrub فرار
    //     کرده بودند: «این پیام هم بدون فایل رسیده» + «عکس یا ویدیویی همراهش
    //     نیامده» + «نه عکسی، نه ویدیویی» + «همراه پیام نبود»
    `|بدون ${N}[^.،\n]{0,12}(?:رسید|رسیده)` +
    `|${N}[^.،\n]{0,20}(?:همراهش|با خودش|در پیام)[^.。\n]{0,8}نیامد` +
    `|نه ${N}[،,] ?نه ${N}` +
    `|${N}[^.،\n]{0,15}همراه (?:پیام|درخواست)[^.。\n]{0,8}(?:نبود|نیست)` +
    // v100 — همگام‌سازی با گارد ai.ts: زمان حال «نمی‌رسد» (فاصلهٔ اختیاری — «به دستم» هم) + «ارسال کامل نشد»
    `|${N}[^.،\n]{0,60}به دست ?(?:من|م) نمی[‌ـ]?(?:رسد|رسه|رسید|آمد)` +
    `|ارسال[^.،\n]{0,20}(?:کامل|درست|موفق) نشد` +
    // انگلیسی — فقط با ذکر صریح رسانه
    `|cannot (?:see|view) (?:the |any |your )?(?:image|video|media|attachment)` +
    `|(?:unable|not able) to (?:see|view|open|process) (?:the |any |your )?(?:image|video|media|attachment)` +
    `|no (?:image|video|media|frames?) (?:was|were|is|are) (?:received|attached|found|visible)`,
    "i"
  );
  return raw
    .split("\n")
    .map((line) => {
      const m = blind.exec(line);
      if (!m) return line;
      // v99-b — لاگ ممیزی: هر پاک‌سازی باید در ترمینال قابل مشاهده باشد
      console.warn(`[chat] blind claim scrubbed: ${line.slice(0, 100).replace(/\s+/g, " ")}`);
      // اسم رسانهٔ ذکرشده حفظ شود تا جملهٔ جایگزین طبیعی بماند
      const nounMatch = /ویدیو|عکس|تصویر|فایل|رسانه|لینک|فریم/i.exec(m[0]);
      const noun = nounMatch ? nounMatch[0] : "رسانه";
      return `${noun} شما دریافت شده است؛ اگر تحلیل کامل آن انجام نشده، لطفاً دوباره بفرستش تا دقیق بررسی کنم.`;
    })
    .join("\n");
}

function sanitizeCoachResponse(raw: string): string {
  if (!raw) return raw;
  const lines = scrubBlindMediaClaims(raw)
    .split("\n")
    // v96 — دیرکتیو مالک: «درشت استخوان رو بدون فاصله نوشته (درشتاستخوان)» —
    // مدل گاهی برچسب قاب بدن را چسبیده (بدون فاصله یا با نیم‌فاصله) کپی می‌کند؛
    // در خروجی مربی همیشه با فاصلهٔ کامل نوشته می‌شود.
    .map((line) =>
      line
        .replace(/درشت[\u200c\s]?استخوان/g, "درشت استخوان")
        .replace(/ریز[\u200c\s]?استخوان/g, "ریز استخوان")
    );
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*[-–—=_*~•·─━─═]{3,}\s*$/.test(line)) continue; // خط تزئینی → حذف
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * پارس data URL به mime و base64.
 * پشتیبانی از هر دو فرمت:
 *  - "data:image/jpeg;base64,...."
 *  - raw base64 با mime جداگانه
 */
function parseDataUrl(value: string, fallbackMime = "image/jpeg"): { mime: string; base64: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mime: match[1], base64: match[2] };
  }
  return { mime: fallbackMime, base64: value };
}

/** ذخیره فایل base64 رسانه چت در uploads/chat/ (خارج از public — سرو با احراز هویت) و بازگرداندن URL نسبی */
async function saveBase64File(
  base64: string,
  mime: string,
  kind: "image" | "video"
): Promise<{ url: string; mime: string; size: number }> {
  const buffer = Buffer.from(base64, "base64");
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    // v79 — HEIC/HEIF آیفون: پسوند درست برای سرو با content-type صحیح
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
  };
  const ext = extMap[mime] || (kind === "image" ? "jpg" : "mp4");
  const fileName = `chat-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { url } = await savePrivateMediaFile("chat", fileName, buffer);
  return { url, mime, size: buffer.length };
}

/**
 * ذخیره عکس با کاهش حجم خودکار:
 *  - resize به حداکثر 1600px
 *  - تبدیل به WebP (کیفیت ۷۵)
 *  - حذف فایل اصلی (فقط نسخه بهینه‌شده نگه داشته می‌شود)
 *  - بازگرداندن URL و base64 بهینه‌شده برای ارسال به VLM
 *
 * Task 4-a: محدودیت پیکسل ورودی (~۶۰ مگاپیکسل) — عکس‌های خیلی بزرگ قبل از
 * decode کامل رد می‌شوند تا حافظه/پردازنده ایمن بماند؛ خطا → null (نه throw).
 *
 * v79 — فال‌بک HEIF/HEIC (رفع خطای «heif Security limit» در همهٔ مسیرهای
 * رسانه): عکس HEIC آیفون که sharp آن را decode نمی‌کند، خام با MIME واقعی
 * ذخیره و به VLM ارسال می‌شود (Gemini از image/heic پشتیبانی رسمی دارد).
 */
const MAX_IMAGE_INPUT_PIXELS = 60_000_000;

async function saveOptimizedImage(
  base64: string,
  mime: string
): Promise<{ url: string; mime: string; size: number; optimizedBase64: string } | null> {
  const buffer = Buffer.from(base64, "base64");
  const processedImage = await processImageSafe(buffer, mime, {
    maxDim: 1600,
    quality: 75,
    limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
  });
  if (!processedImage) {
    console.error("[chat] image optimization failed (too large/corrupt) — no fallback possible");
    return null;
  }
  const processed = processedImage.buffer;

  const fileName = `chat-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${processedImage.fileExtension}`;
  const { url } = await savePrivateMediaFile("chat", fileName, processed);

  const optimizedBase64 = processed.toString("base64");
  return {
    url,
    mime: processedImage.mimeType,
    size: processed.length,
    optimizedBase64,
  };
}

// ═══════════════════════════════════════════════════════════════
//  v73.4 — دوفازی + Idempotency (دیریکتیو مالک: ①پیام دوبار نمایش پیدا می‌شد
//  ②تحلیل مدیا باید پس‌زمینه باشد چون گیت‌وی ~۱۲۰s قطع می‌کند)
// ═══════════════════════════════════════════════════════════════

/** پیام خطای دوستانه‌ای که در placeholder assistant ثبت می‌شود (ردیف کاربر هرگز حذف نمی‌شود) */
const MEDIA_PENDING_ERROR_TEXT = "تحلیل این پیام با خطا مواجه شد — لطفاً دوباره بفرست.";

/**
 * v84 — TTL اعتبار placeholderهای pending در GET:
 * پیام assistant با محتوای خالیِ قدیمی‌تر از این یعنی کار پس‌زمینهٔ تحلیل به هر
 * دلیل (کرش پروسه/ری‌استارت سرور/OOM) هرگز تمام نشد. بدون این ریکاوری حباب
 * «در حال تحلیل و پاسخ…» برای همیشه می‌ماند و کاربر فکر می‌کند مدیایش خوانده
 * نشده (باگ مالک: «یک وقتا می‌خونه یک وقتا نمی‌خونه»). هم‌سقف TTL آنالیز بدن.
 */
const PENDING_PLACEHOLDER_TTL_MS = 15 * 60_000;

/** نوع کاربر برگشتی از requireAuth (برای امضای هلپرهای مشترک) */
type AuthUser = Awaited<ReturnType<typeof requireAuth>>;

/**
 * v73.4 — اعتبارسنجی clientId کلاینت (tempId الگوی prefix_time_random دارد).
 * فقط الگوی امن [A-Za-z0-9_-] با طول ۸ تا ۱۲۸ پذیرفته می‌شود.
 */
function sanitizeClientId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 8 || s.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

/** حداقل ساختار ردیف پیام کاربر که بین مسیرهای create/reuse مشترک است */
interface UserMsgRow {
  id: string;
  userId: string;
  role: string;
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  /** v95 — فریم‌های ذخیره‌شدهٔ ویدیو (فریم اول = poster حباب) */
  mediaFrames: string | null;
  createdAt: Date;
}

/**
 * DTO پیام برای پاسخ POST (بدون فیکس تایپوگرافی — رفتار قبلی POST حفظ شده؛
 * فیکس تایپوگرافی فقط در GET انجام می‌شود).
 */
/**
 * v95 — poster ویدیو = فریم اول ذخیره‌شده (mediaFrames).
 * ریشهٔ «رندر ویدیو بعد از آپلود خیلی طول می‌کشد»: حباب ویدیو بدون poster باید
 * متادیتای ویدیوی بزرگ را از serve-upload بگیرد تا فریم اول رندر شود (برای
 * ویدیوهای ۵۰-۹۰MB روی موبایل دقیقه‌ای به طول می‌انجامد). فریم‌های استخراج‌شدهٔ
 * پس‌زمینه (فریم اول ~۱۰۰KB JPEG) همان تصویر را فوری می‌سازند.
 * fail-safe: هر شکست → null (رفتار قبلی).
 */
function posterFromFrames(mediaFrames: string | null | undefined): string | null {
  if (!mediaFrames) return null;
  try {
    const parsed = JSON.parse(mediaFrames);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0]) return parsed[0];
  } catch {
    // JSON خراب — بدون poster
  }
  return null;
}

function toPostMessageDto(
  m: {
    id: string;
    role: string;
    content: string;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: Date;
  },
  /** v95 — mediaFrames ردیف (در دسترس بودن → poster ویدیو از فریم اول) */
  mediaFrames?: string | null
) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    mediaUrl: m.mediaUrl ?? null,
    mediaType: m.mediaType ?? null,
    createdAt: m.createdAt.toISOString(),
    // ─── v95 — فیکس «رندر کند ویدیو بعد از آپلود» ───
    poster: m.mediaType === "video" ? posterFromFrames(mediaFrames) : null,
  };
}

/**
 * v73.4 — مونتاژ کامل کانتکست کاربر + کال aiChat — مشترک بین مسیر متنی (sync)
 * و مسیر مدیا (پس‌زمینه). از POST قبلی استخراج شده با دو افزودن:
 *  ① تزریق specialConditions پروفایل (قبلاً در مونتاژ دستی جا مانده بود)
 *  ② تزریق nutritionNotes پروفایل (ستون v73.3 — یادداشت‌های دستیار تغذیه)
 * در فیلتر تاریخچه، پیام‌های با محتوای خالی (placeholderهای pending) مستثنی
 * می‌شوند تا مدل متنی هرگز حباب خالی نبیند.
 */
async function generateCoachAiResponse(opts: {
  user: AuthUser;
  userMsgId: string;
  finalMessage: string;
  currentMediaAnalysis?: string;
  attachmentKind?: "image" | "video-frames" | null;
  /** v77 — یادداشت سیستمی وضعیت بازتولید برنامه (از applyPlanChangeRequest) */
  planChangeNote?: string;
}): Promise<string> {
  const user = opts.user;
  const userId = user.id;
  const userPlan = (user.planName as any) ?? null;

  // Load onboarding profile for context
  const profile = await db.onboardingProfile.findUnique({
    where: { userId },
  });

  // Helper برای پارس کردن فیلدهای لیستی ذخیره‌شده به‌صورت JSON
  const safeParseList = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return p.map((x) => String(x));
      if (typeof p === "string") return p.split(",").map((s) => s.trim()).filter(Boolean);
      return [];
    } catch {
      return t.split(",").map((s) => s.trim()).filter(Boolean);
    }
  };

  let onboarding: OnboardingData | null = null;
  if (profile) {
    // ─── buildUserContext() تمام فیلدها را می‌خواند. برای اینکه مربی هوشمند
    // همیشه به آخرین اطلاعات کاربر (شامل فیلدهای اختیاری حرفه‌ای) دسترسی داشته
    // باشد، تمام فیلدهای ذخیره‌شده در OnboardingProfile را اینجا می‌گذاریم. ───
    // v73.4 — specialConditions (جاافتادهٔ قدیمی) و nutritionNotes (v73.3 دستیار
    // تغذیه) هم تزریق می‌شوند؛ nutritionNotes هنوز در OnboardingData تایپ نشده
    // (همکار مالک types/ai است) → با spread + cast تزریق می‌شود تا به‌محض خواندن
    // آن در buildUserContext، مقدار همین حالا در دسترس مدل باشد.
    onboarding = {
      gender: profile.gender as OnboardingData["gender"],
      age: profile.age,
      height: profile.height,
      weight: profile.weight,
      targetWeight: profile.targetWeight ?? undefined,
      goal: profile.goal as OnboardingData["goal"],
      activityLevel: profile.activityLevel as OnboardingData["activityLevel"],
      workoutDays: profile.workoutDays,
      workoutDaysList: safeParseList(profile.workoutDaysList),
      workoutPlace: profile.workoutPlace as OnboardingData["workoutPlace"],
      equipment: safeParseList(profile.equipment),
      diseases: profile.diseases,
      injuries: profile.injuries,
      allergies: profile.allergies,
      dietType: profile.dietType as OnboardingData["dietType"],
      // Professional advanced fields
      trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
      previousTrainingType: profile.previousTrainingType ?? undefined,
      drugAllergies: profile.drugAllergies ?? undefined,
      currentMedications: profile.currentMedications ?? undefined,
      maxLifts: profile.maxLifts ?? undefined,
      // Comprehensive professional fields
      bodyFrame: (profile.bodyFrame ?? undefined) as OnboardingData["bodyFrame"],
      sleepHours: profile.sleepHours ?? undefined,
      stressLevel: profile.stressLevel ?? undefined,
      waterHabit: profile.waterHabit ?? undefined,
      targetDate: profile.targetDate ?? undefined,
      workoutTime: (profile.workoutTime ?? undefined) as OnboardingData["workoutTime"],
      medicalConditions: safeParseList(profile.medicalConditions) as OnboardingData["medicalConditions"],
      currentSupplements: profile.currentSupplements ?? undefined,
      dislikedFoods: profile.dislikedFoods ?? undefined,
      preferredCuisine: (profile.preferredCuisine ?? undefined) as OnboardingData["preferredCuisine"],
      // ─── v73.4 — فیلدهای جاافتاده/جدید پروفایل ───
      specialConditions: profile.specialConditions ?? undefined,
      ...(profile.nutritionNotes && profile.nutritionNotes.trim()
        ? { nutritionNotes: profile.nutritionNotes.trim() }
        : {}),
    } as OnboardingData;
  }

  // ─── Build comprehensive athletic profile for long-term memory ───
  // فیتاپ هوشمند به تمام پرونده ورزشی کاربر دسترسی دارد.
  // خلاصه‌های برنامهٔ فعال (ارزان و خارج از پروندهٔ تاریخی) اینجا نگه داشته می‌شوند؛
  // وزن/چکاپ به buildSportsProfileContext منتقل شد (پوشش کامل‌تر با بودجهٔ سخت).
  const [workoutPlan, mealPlan, programRequests] = await Promise.all([
    db.workoutPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" } }),
    db.mealPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" } }),
    db.programRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);

  // Build athletic profile context string
  const athleticProfile: string[] = [];
  if (workoutPlan) {
    // L7: پارس امن — ردیف خراب فقط این بخش کانتکست را حذف می‌کند نه کل چت را
    const wc = safeParsePlanContent(workoutPlan.content);
    if (wc) {
      athleticProfile.push(`\n📋 برنامه تمرینی فعلی:\n- هدف هفته: ${wc.weeklyGoal || "نامشخص"}\n- تعداد روزهای تمرین: ${wc.days?.length || 0}\n- نکات هفته: ${wc.notes?.slice(0, 100) || "ندارد"}`);
    }
  }
  if (mealPlan) {
    const mc = safeParsePlanContent(mealPlan.content);
    if (mc) {
      athleticProfile.push(`\n🍽 برنامه غذایی فعلی:\n- کالری هدف: ${mc.totalCalories || "نامشخص"} کالری\n- تعداد وعده‌ها: ${mc.meals?.length || 0}\n- پروتئین: ${mc.totalProtein || 0}g، کربو: ${mc.totalCarbs || 0}g، چربی: ${mc.totalFat || 0}g\n- آب روزانه: ${mc.waterLiters || 2.5} لیتر`);
      if (mc.supplements?.length) {
        athleticProfile.push(`\n💊 مکمل‌های فعلی: ${mc.supplements.map((s: any) => `${s.name} (${s.dose})`).join("، ")}`);
      }
    }
  }
  if (programRequests.length > 0) {
    athleticProfile.push(`\n📝 تاریخچه برنامه‌ها: ${programRequests.length} دوره تمرینی (${programRequests[0].status === "ready" ? "آماده" : programRequests[0].status === "pending" ? "در انتظار" : "نامشخص"})`);
  }

  // ─── v85 — فیکس باگ بزرگ: جزئیات کامل برنامهٔ جاری (همهٔ روزها/حرکات/وعده‌ها) ───
  // قبلاً فقط «تعداد روزها» به مدل می‌رسید و مدل واقعاً نمی‌دانست حرکت سوم روز
  // شنبه چیست (گزارش دقیق مالک). حالا لیست کامل با کش ۹۰ثانیه‌ای (رایگان —
  // فقط کوئری DB، بدون هیچ کال AI اضافه) تزریق می‌شود.
  try {
    const programCtx = await buildCurrentProgramContext(userId);
    if (programCtx) {
      athleticProfile.push(`\n${programCtx}`);
    }
  } catch (pcErr) {
    console.error("[chat] buildCurrentProgramContext failed (continuing):", pcErr);
  }

  // ─── v73.2 — اطلاعات حساب (درخواست مالک: «فیتاپ هوشمند به تمام اطلاعاتی که
  // باید دسترسی داشته باشد دسترسی داشته باشد») — نام کاربر + وضعیت اشتراک:
  // مربی بداند با کی حرف می‌زند و اشتراک چقدر مانده (برای راهنمایی تمدید/چکاپ).
  {
    const PLAN_FA: Record<string, string> = { basic: "اقتصادی", standard: "استاندارد", advanced: "پیشرفته", ultimate: "حرفه‌ای" };
    const expIso = (user as any).planExpiresAt as Date | null;
    let expiryText = "بدون پلن فعال";
    if (expIso) {
      const exp = new Date(expIso);
      const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
      expiryText = `${PLAN_FA[(user as any).planName as string] ?? "پلن"} — پایان: ${exp.toLocaleDateString("fa-IR")}${daysLeft > 0 ? ` (${daysLeft} روز مانده)` : " (منقضی شده)"}`;
    }
    athleticProfile.push(`\n👤 حساب کاربر: نام «${user.name || "ثبت‌نشده"}» — اشتراک: ${expiryText}`);
  }

  // ─── v53: پرونده ورزشی کامل و بودجه‌دار (تزریق تاریخچهٔ واقعی کاربر به مربی) ───
  // قبلاً فقط آخرین وزن + آخرین چکاپ به چت می‌رسید و تغذیهٔ ثبت‌شده (FoodLog) و
  // وضعیت تمرین‌های روزانه (DayCompletion/WorkoutDayStatus) هرگز به AI داده
  // نمی‌شد. حالا buildSportsProfileContext کل تاریخچه را می‌سازد:
  //   ۳۰ روز اخیر روزبه‌روز (کالری/درشت‌مغذی/وعده + تمرین + وزن) + جمع‌بندی
  //   ماهانه (ماه ۲ تا ۱۲) + خلاصهٔ فصلی قدیمی‌ترها + چکاپ‌ها + استریک.
  // سقف سخت ۹۰۰۰ کاراکتر: کاربر ۲ ساله هم پرامپت را منفجر نمی‌کند (قدیمی‌ترین
  // بخش‌ها مرحله‌به‌مرحله خلاصه می‌شوند).
  // پروفایل ثابت عمداً اینجا حذف شده (includeStaticProfile:false) چون aiChat
  // خودش buildUserContext را در system prompt تزریق می‌کند — دوباره‌گویی ممنوع.
  // شکست بیلدر هرگز چت را نمی‌شکند؛ فقط کانتکست تاریخی حذف می‌شود.
  let sportsFileCtx = "";
  try {
    sportsFileCtx = await buildSportsProfileContext(userId, { includeStaticProfile: false });
  } catch (ctxErr) {
    console.error("[chat] buildSportsProfileContext failed (continuing without it):", ctxErr);
  }
  if (sportsFileCtx) {
    athleticProfile.push(sportsFileCtx);
  }

  // Load recent history (v85 — حافظهٔ قوی: ۴۰ پیام آخر به‌جای ۱۵ — دیریکتیو مالک:
  // «برای هر کاربر مموری و حافظهٔ خیلی قوی داشته باشه و از چت‌های قبلی اطلاع داشته باشه»)
  // ─── H3: الگوی درست: desc + take → آخرین پیام‌ها، سپس reverse برای ترتیب زمانی.
  // پیام جاری (userMsg) حذف می‌شود چون جداگانه به‌عنوان پیام آخر به AI پاس داده می‌شود.
  // v73.4 — پیام‌های با محتوای خالی (placeholderهای pending مدیا) هم مستثنی‌اند.
  const recentHistory = await db.chatMessage.findMany({
    where: { userId, id: { not: opts.userMsgId }, content: { not: "" } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const history = recentHistory.reverse();

  // ─── v99-b — ضدعفونی تاریخچه (ریشهٔ «مربی می‌گوید نرسیده» با وجود تزریق تحلیل) ───
  // پرب زندهٔ تولیدی 2026-09-14 اثبات کرد: وقتی تاریخچه پر از پاسخ‌های کورِ دوره‌های
  // خراب قبلی است («چند بار است که فایل به دست من نمی‌رسد»)، الگوی تاریخچه بر
  // تزریق سیستم غلبه می‌کند و مربی باز هم «نرسیده» می‌گوید — حتی با گزارش بینایی
  // معتبر. حالا هر پاسخ قبلی مربی که ادعای کوری دارد، با همان پاک‌سازِ خروجی زنده
  // اصلاح می‌شود تا مدل دیگر الگوی دروغ را از تاریخچه یاد نگیرد.
  let historyScrubbed = 0;
  const cleanHistory = history.map((h) => {
    if (h.role !== "assistant") return h;
    const cleaned = scrubBlindMediaClaims(h.content);
    if (cleaned !== h.content) {
      historyScrubbed++;
      console.warn(
        `[chat] history blind claim scrubbed: id=${h.id} head=${h.content.slice(0, 90).replace(/\s+/g, " ")}`
      );
      return { ...h, content: cleaned };
    }
    return h;
  });
  const historyForAi = cleanHistory;

  // ─── v71 سینک رسانه — دیریکتیو مالک: «متن‌ها با دیپ‌سیک پاسخ داده بشه و
  // رسانه‌ها با جمنای تحلیل بشن و این تنوع با هم سینک باشه» ───
  // تحلیل‌های متنیِ کش‌شدهٔ جمنای (mediaAnalysis) از ۶ پیام آخر جمع می‌شود و
  // به کال متنیِ دیپ‌سیک تزریق می‌شود — بدون هیچ کال ویژن تکراری. مدیای اخیر
  // بدون کش (پیام قدیمی v70) یک‌بار روی‌تقاضا تحلیل و کش می‌شود (بودجه: ۱).
  const historyMediaAnalyses = await collectHistoryMediaAnalyses(
    userId,
    historyForAi.map((h) => ({
      id: h.id,
      content: h.content,
      mediaUrl: h.mediaUrl,
      mediaType: h.mediaType,
      mediaFrames: h.mediaFrames,
      mediaAnalysis: h.mediaAnalysis,
    }))
  );

  // Get AI response — pass user's plan tier + full athletic profile for comprehensive guidance
  // v71: پاسخ نهایی همیشه دیپ‌سیک (aiChat) — تحلیل جمنایِ مدیای همین پیام +
  // تحلیل‌های کش‌شدهٔ رسانه‌های قبلی، به‌صورت متن تزریق می‌شوند.
  const fullContext = athleticProfile.join("\n");
  const mediaAnalysisForAi = [
    historyMediaAnalyses,
    opts.currentMediaAnalysis
      ? `\n\n[تحلیل ${opts.attachmentKind === "image" ? "عکس" : "ویدیو"}ی که کاربر در همین پیام فرستاده است — تولید مدل بینایی فیتاپ:\n${opts.currentMediaAnalysis}]`
      : "",
  ].filter(Boolean).join("");

  // v99-b — لاگ ممیزی: هر کال مربی باید در ترمینال قابل ردگیری باشد
  console.log(
    `[chat] aiChat call: user=${userId} history=${historyForAi.length} historyScrubbed=${historyScrubbed} mediaAnalysisChars=${(mediaAnalysisForAi || "").length}`
  );

  // ─── v100 — لاگ «پاسخ خام مربی» — حلقهٔ گم‌شدهٔ ممیزی ترمینال مالک ───
  // پرب زندهٔ مالک (2026-09-14) ثابت کرد تا v99 بین «aiChat call» و «job COMPLETED»
  // هیچ لاگی نشان نمی‌داد مربی دقیقاً چه گفته — اگر deepseek ادعای کوری می‌گفت
  // در لاگ دیده نمی‌شد و ریشه‌یابی غیرممکن بود. حالا متنِ خام (قبل از پاک‌سازی)
  // با پرچم کوری و ۱۶۰ نویسهٔ اول لاگ می‌شود.
  const rawCoachReply = await aiChat(
    onboarding,
    historyForAi.map((h) => ({ role: h.role, content: h.content })),
    opts.finalMessage + (fullContext ? `\n\n[سیستم - پرونده ورزشی کاربر]:\n${fullContext}` : ""),
    userPlan,
    mediaAnalysisForAi || null,
    userId,
    // v77 — وضعیت بازتولید برنامه (در پرامپت سیستم تزریق می‌شود — تبعیت بالاتر از پیام کاربر)
    opts.planChangeNote || null
  );
  const rawBlindFlag = hasBlindMediaClaim(rawCoachReply);
  console.log(
    `[chat] coach reply: user=${userId} len=${rawCoachReply.length} blindFlag=${rawBlindFlag ? "YES ⚠️" : "no"} mediaInjectionChars=${(mediaAnalysisForAi || "").length} head=${rawCoachReply.slice(0, 160).replace(/\s+/g, " ")}`
  );
  if (rawBlindFlag) {
    console.error(
      `[chat] ⚠️ ادعای کور در پاسخ خام مربی — aiChat باید ری‌تای/جایگزینی کرده باشد؛ متن نهایی بعد از sanitize باید سالم باشد (v100)`
    );
  }
  return sanitizeCoachResponse(rawCoachReply);
}

/**
 * v73.4 — کار پس‌زمینهٔ پیام مدیا‌دار (fire-and-forget):
 *   فشرده‌سازی/فریم‌سازی ویدیو (در صورت نیاز) → تحلیل رسانه با مدل بینایی
 *   (analyzeChatMedia با همان کدهای قبلی) → پاسخ دیپ‌سیک (generateCoachAiResponse)
 *   → پر کردن ردیف placeholder.
 * catch: placeholder پیام خطای دوستانه می‌گیرد؛ ردیف کاربر هرگز حذف نمی‌شود.
 * حالت retry: اگر dataUrls آماده نبود (تلاش مجدد با همان clientId)، مدیا از
 * ردیف ذخیره‌شدهٔ کاربر بارگذاری می‌شود (loadMediaDataUrls).
 */
async function runMediaAnalysisJob(ctx: {
  user: AuthUser;
  userMsgId: string;
  placeholderId: string;
  message: string;
  kind: "image" | "video-frames" | null;
  dataUrls: string[] | null;
  /**
   * v84 — برای «همهٔ» ویدیوها (مسیر base64 و مسیر multipart آپلود) فعال است:
   * فشرده‌سازی درجا + استخراج فریم + مصرف سهمیه، همگی پس‌زمینه‌ای (گیت‌وی ~۱۲۰s
   * قطع می‌کند — هیچ پردازش سنگینی در هیچ هندلر sync نیست).
   */
  needsVideoProcessing: boolean;
  videoUrl: string | null;
}): Promise<void> {
  const auditStart = Date.now();
  /**
   * v90 ممیزی ریشه‌ای (گزارش مالک: «انگار فریم‌های ویدیو به هوش مصنوعی ارسال نمی‌شود») —
   * ترتیب قدیمی برای ویدیو: فشرده‌سازی ffmpeg (برای ویدیوی بزرگ چند دقیقه!) → بعد
   * استخراج فریم → بعد تحلیل. یعنی تحلیل بینایی و پاسخ مربی «دقیقه‌ها» عقب می‌افتاد،
   * پول کلاینت به ددلاین می‌خورد و کاربر فکر می‌کرد ویدیو خوانده نشد.
   *
   * ترتیب جدید (v90):
   *   ۱) استخراج فریم (ثانیه‌ها — روش fps تک‌فراخوانی) → ذخیره روی دیسک
   *   ۲) تحلیل بینایی + پاسخ مربی — در سریع‌ترین حالت (حذف کامل انتظار فشرده‌سازی)
   *   ۳) فشرده‌سازی درجا به‌صورت موازی (fire-and-forget) — فقط بهینه‌سازی نگهداری؛
   *      هرگز جلوی تحلیل را نمی‌گیرد. با گارد anti-دوبله برای همان فایل.
   * هر مرحله با برچسب [chat][media-audit] لاگ می‌شود تا ممیزی تولیدی ممکن باشد.
   */
  let kind = ctx.kind;
  let dataUrls: string[] = ctx.dataUrls ?? [];
  let imageAnalysisNote = "";
  let videoAnalysisNote = "";
  try {
    // ۱) استخراج فریم — «قبل از» هر کار سنگین دیگری (فیکس تأخیر v90)
    if (ctx.needsVideoProcessing && ctx.videoUrl && dataUrls.length === 0) {
      const frameStart = Date.now();
      try {
        const frameDataUrls = await extractVideoFramesAsDataUrls(absolutePathForUploadUrl(ctx.videoUrl), 6);
        console.log(
          `[chat][media-audit] frames extracted: count=${frameDataUrls.length} tookMs=${Date.now() - frameStart} video=${ctx.videoUrl}`
        );
        if (frameDataUrls.length > 0) {
          kind = "video-frames";
          dataUrls = frameDataUrls;
          const frameUrls = await saveFramesToDisk(frameDataUrls);
          await db.chatMessage.update({
            where: { id: ctx.userMsgId },
            data: { mediaFrames: frameUrls.length > 0 ? JSON.stringify(frameUrls) : null },
          });
          console.log(`[chat][media-audit] frames saved to disk: ${frameUrls.length}`);
        } else {
          // v75 — استخراج فریم حتی بعد از fallback ریموکس ناموفق بود؛ پیام صادقانه
          // (دیگر مدل عذرخواهیِ «ویدیو همراهش نبود» نمی‌کند — صریح می‌گوییم ویدیو
          // رسیده ولی پردازشش نشده و باید دوباره بفرستد)
          videoAnalysisNote = `\n\n[ویدیوی کاربر دریافت شده اما استخراج فریم از آن ممکن نشد (فرمت/کدک پشتیبانی‌نشده یا فایل خراب). صادقانه به کاربر بگو ویدیوش پردازش نشد و از او بخواه با فرمت mp4/H.264 دوباره ضبط و ارسال کند یا حرکت را توضیح بدهد. هرگز نگو ویدیویی ارسال نشده است.]`;
          console.error(`[chat][media-audit] frame extraction produced 0 frames — honest note injected. video=${ctx.videoUrl}`);
        }
      } catch (err) {
        console.error("[chat][media-audit] video frame extraction failed (background):", err);
        videoAnalysisNote = `\n\n[ویدیوی کاربر دریافت شده اما استخراج فریم از آن ممکن نشد (خطای پردازش). صادقانه به کاربر بگو ویدیوش پردازش نشد و از او بخواه دوباره بفرستد یا حرکت را توضیح بدهد. هرگز نگو ویدیویی ارسال نشده است.]`;
      }

      // ۱-پ) فشرده‌سازی درجا — «موازی» با تحلیل (فقط بهینه‌سازی نگهداری — v90)
      // هرگز throw نمی‌کند و هرگز منتظرش نمی‌مانیم؛ پاسخ مربی مستقل از آن است.
      compressVideoInBackground(ctx.videoUrl);
    }

    // ۲) حالت retry (تلاش مجدد با همان clientId بدون dataUrls آماده) —
    //    مدیا از ردیف ذخیره‌شده بارگذاری می‌شود
    if (dataUrls.length === 0 && !ctx.needsVideoProcessing) {
      const row = await db.chatMessage.findUnique({ where: { id: ctx.userMsgId } });
      if (row?.mediaUrl && row.mediaType) {
        kind = row.mediaType === "video" ? "video-frames" : "image";
        dataUrls = await loadMediaDataUrls(row);
        console.log(`[chat][media-audit] retry path loaded media: kind=${kind} dataUrls=${dataUrls.length}`);
        // ─── v99 — فیکس «ردِ بی‌صدا» (ریشهٔ دومِ «فایل به دستم نرسید») ───
        // اگر مدیا در ردیف هست ولی خواندن/استخراجش ممکن نشد (فایل حذف/خراب/فریم ۰)،
        // قبلاً هیچ تحلیلی و هیچ یادداشتی تولید نمی‌شد → مربیِ بی‌خبر می‌گفت «نرسیده».
        // حالا یادداشت صادقانهٔ صریح تزریق می‌شود.
        if (dataUrls.length === 0) {
          const note =
            kind === "video-frames"
              ? `\n\n[ویدیوی کاربر دریافت شده اما استخراج فریم از آن ممکن نشد (فایل در دسترس نیست یا فرمت پشتیبانی‌نشده است). صادقانه به کاربر بگو ویدیوش پردازش نشد و از او بخواه دوباره با فرمت mp4/H.264 بفرستد. هرگز نگو ویدیویی ارسال نشده است.]`
              : `\n\n[عکس کاربر دریافت شده اما فایل آن در دسترس نیست (حذف یا خراب شده). صادقانه به کاربر بگو عکسش پردازش نشد و از او بخواه دوباره بفرستد. هرگز نگو عکسی ارسال نشده است.]`;
          if (kind === "video-frames") videoAnalysisNote = note;
          else imageAnalysisNote = note;
          console.error(`[chat][media-audit] media row exists but dataUrls=0 — honest note injected (msg=${ctx.userMsgId})`);
        }
      }
    }

    // ۳) ─── v71 مرحلهٔ ۱: تحلیل رسانهٔ همین پیام توسط مدل بینایی (همان کد قبلی) ───
    // خروجی در mediaAnalysis کش می‌شود و به مرحلهٔ ۲ (دیپ‌سیک) تزریق می‌شود.
    // v75 — یک retry داخلی هم اضافه شد: خطای گذرای گیت‌وی/مدل دیگر مستقیماً به
    // «نتونستم ببینم» نمی‌رسد؛ اول یک‌بار دوباره تلاش می‌شود (درخواست مالک:
    // «ویدیو همراهش نبود» دیگر در هیچ‌جا نباید رخ بدهد).
    let currentMediaAnalysis = "";
    if (dataUrls.length > 0 && kind) {
      console.log(`[chat][media-audit] vision analysis starting: kind=${kind} frames=${dataUrls.length} approxKB=${Math.round(dataUrls.reduce((a, u) => a + u.length, 0) * 0.75 / 1024)}`);
      let anErrLast: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          currentMediaAnalysis = await analyzeChatMedia(kind, dataUrls, ctx.message, ctx.user.id);
          anErrLast = null;
          break;
        } catch (anErr) {
          anErrLast = anErr;
          console.error(`[chat][media-audit] analyzeChatMedia failed (attempt ${attempt}/2):`, anErr);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      console.log(
        `[chat][media-audit] vision analysis done: ok=${anErrLast == null && !!currentMediaAnalysis} tookMs=${Date.now() - auditStart} totalMs`
      );
      if (anErrLast == null && currentMediaAnalysis) {
        // ─── v85 — گارد idempotent (قبل از کش‌کردن می‌خوانیم!) ───
        let alreadyCounted = false;
        try {
          const msgRow = await db.chatMessage.findUnique({
            where: { id: ctx.userMsgId },
            select: { mediaAnalysis: true },
          });
          alreadyCounted = !!msgRow?.mediaAnalysis;
        } catch (readErr) {
          console.error("[chat] pre-quota read failed:", readErr);
        }
        try {
          await db.chatMessage.update({ where: { id: ctx.userMsgId }, data: { mediaAnalysis: currentMediaAnalysis } });
          console.log(
            `[chat][media-audit] mediaAnalysis cached: len=${currentMediaAnalysis.length} userMsg=${ctx.userMsgId}`
          );
        } catch (cacheErr) {
          console.error("[chat] current media analysis cache failed:", cacheErr);
        }
        // ─── v85 — مصرف سهمیه فقط بعد از تحلیل موفق (دیریکتیو مالک) ───
        // رسانه‌ای که هوش مصنوعی نتوانست بخواند/تحلیل کند، هیچ سهمیه‌ای کم نمی‌کند
        // و کاربر آزاد است دوباره بفرستد. اگر mediaAnalysis همین ردیف از قبل
        // پر شده بود، دیگر مصرف نمی‌کنیم تا retry دوباره‌شماری نکند.
        if (!alreadyCounted) {
          try {
            // ممیزی 1-b#1 — مصرف «اتمیک شرطی» به‌جای incrementQuota بدون سقف‌چک:
            // درخواست‌های موازی دیگر نمی‌توانند از سقف دوره عبور کنند (updateMany
            // شرطی used < total). false = سهمیه در پنجرهٔ چک→تحلیل تمام شده؛
            // تحلیل این یکی رایگان می‌ماند (دیرکتیو مالک: مصرف فقط بعد از تحلیل
            // موفق — گارد idempotent بالاتر هم دست‌نخورده است).
            const consumed = await consumeQuotaAtomically(
              ctx.user.id,
              kind === "video-frames" ? "movement_video" : "chat_photo"
            );
            if (!consumed) {
              console.warn("[chat] post-analysis atomic quota consume refused (exhausted in race window)");
            }
          } catch (quotaErr) {
            console.error("[chat] post-analysis quota consume failed:", quotaErr);
          }
        }
      }
      if (anErrLast != null) {
        // هر دو تلاش شکست خورد — نکتهٔ صادقانه و کاربردی (بدون جملاتی که مدل را
        // به انکار دیدن رسانه وادار کند):
        if (kind === "video-frames") {
          videoAnalysisNote = `\n\n[ویدیوی کاربر دریافت شده است اما پردازش خودکار آن در این لحظه ناموفق بود (خطای موقت سرویس). صادقانه به کاربر بگو پردازش ویدیو الان ممکن نشد و از او بخواه ویدیو را دوباره بفرستد یا حرکت را توضیح بدهد. هرگز نگو ویدیویی ارسال نشده است.]`;
        } else {
          imageAnalysisNote = `\n\n[عکس کاربر دریافت شده است اما پردازش خودکار تصویر در این لحظه ناموفق بود (خطای موقت سرویس). صادقانه به کاربر بگو پردازش عکس الان ممکن نشد و از او بخواه عکس را دوباره بفرستد. هرگز نگو عکسی دریافت نشده است.]`;
        }
      }
    }

    // ۴) ساخت محتوای نهایی پیام کاربر (شامل یادداشت‌های شکست تحلیل در صورت وجود)
    let finalMessage = ctx.message;
    if (imageAnalysisNote) {
      finalMessage = `${ctx.message || "(بدون متن)"}${imageAnalysisNote}`;
    }
    if (videoAnalysisNote) {
      finalMessage = `${finalMessage}${ctx.message || imageAnalysisNote ? "\n\n" : ""}${videoAnalysisNote}`;
    }
    // ─── v84 — فیکس ریشه‌ای «مدل می‌گوید پرونده‌ات را نگاه می‌کنم» ───
    // قبلاً وقتی کاربر رسانه را «بدون متن» می‌فرستاد، پیام کاربرِ رسیده به مدل
    // متنی (deepseek) رشتهٔ خالی ("") بود — مدل گیج می‌شد و جواب‌های توخالی مثل
    // «الان پرونده‌ت را نگاه می‌کنم» می‌داد (گزارش دقیق مالک). حالا دستور صریح
    // بر اساس گزارش بینایی.
    if (!finalMessage.trim()) {
      finalMessage =
        kind === "video-frames"
          ? "ویدیویی که فرستادم را بر اساس گزارش بینایی پیوست‌شده در پیام سیستم تحلیل کن: فرم اجرا، خطاهای تکنیکی و اصلاحات دقیق را به من بده."
          : "عکسی که فرستادم را بر اساس گزارش بینایی پیوست‌شده در پیام سیستم تحلیل کن و بازخورد کامل و کاربردی بده.";
    }

    // ۴-پ) v77 — تشخیص و اجرای درخواست تغییر برنامه از متنِ همراه رسانه
    // (مثلاً عکس غذا + «اینو توی برنامه‌ام جایگزین کن») — یادداشت سیستمیِ
    // وضعیت بازتولید به مدل پاسخ‌نویس تزریق می‌شود
    let planChangeNote = "";
    if (ctx.message && ctx.message.trim()) {
      try {
        const pcr = await applyPlanChangeRequest(ctx.user.id, ctx.message);
        planChangeNote = pcr.systemNote;
      } catch (pcErr) {
        console.error("[chat] plan-change intent handling failed (media path):", pcErr);
      }
    }

    // ۵) مرحلهٔ ۲: پاسخ دیپ‌سیک → پر کردن placeholder
    const aiResponse = await generateCoachAiResponse({
      user: ctx.user,
      userMsgId: ctx.userMsgId,
      finalMessage,
      currentMediaAnalysis,
      attachmentKind: kind,
      planChangeNote,
    });
    await db.chatMessage.update({
      where: { id: ctx.placeholderId },
      data: { content: aiResponse },
    });
    console.log(`[chat][media-audit] job COMPLETED: userMsg=${ctx.userMsgId} kind=${kind} totalMs=${Date.now() - auditStart}`);
  } catch (err) {
    console.error("[chat] background media analysis job failed:", err);
    // دیریکتیو مالک: هرگز ردیف کاربر حذف نمی‌شود — placeholder پیام خطای دوستانه می‌گیرد
    try {
      await db.chatMessage.update({
        where: { id: ctx.placeholderId },
        data: { content: MEDIA_PENDING_ERROR_TEXT },
      });
    } catch (upErr) {
      console.error("[chat] failed to write error into pending placeholder:", upErr);
    }
  }
}

// ─── v90 — گارد ضد دوبلهٔ فشرده‌سازی (همان فایل همزمان دو بار فشرده نشود) ───
const compressionInFlight = new Set<string>();

/**
 * v90 — فشرده‌سازی پس‌زمینه‌ای ویدیوی چت (فقط بهینه‌سازی نگهداری).
 * از مسیر بحرانی تحلیل «کاملاً خارج» شد؛ نتیجه‌اش هیچ‌جا await نمی‌شود.
 */
function compressVideoInBackground(videoUrl: string): void {
  if (compressionInFlight.has(videoUrl)) return;
  compressionInFlight.add(videoUrl);
  void (async () => {
    try {
      const cmp = await compressVideoFileInPlace(absolutePathForUploadUrl(videoUrl));
      if (cmp.compressed) {
        console.log(`[chat][media-audit] video compressed (background): ${formatBytes(cmp.sizeBefore)} → ${formatBytes(cmp.sizeAfter)} — ${videoUrl}`);
      }
    } catch (cmpErr) {
      console.error("[chat] compression step failed (keeping original):", cmpErr);
    } finally {
      compressionInFlight.delete(videoUrl);
    }
  })();
}
export async function GET() {
  try {
    const user = await requireAuth();
    // ─── H1: قبلاً asc + take 100 «قدیمی‌ترین» ۱۰۰ پیام را برمی‌گرداند — بعد از
    // ۱۰۰ پیام، پیام‌های جدید در تاریخچه هرگز نمایش داده نمی‌شدند. الگوی درست
    // (مثل POST): desc + take → آخرین پیام‌ها، سپس reverse برای ترتیب زمانی.
    const recentMessages = await db.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const messages = recentMessages.reverse();

    // ─── v84 — ریکاوری placeholderهای یتیم (فیکس «در حال تحلیل» ابدی) ───
    // پیام assistant با محتوای خالیِ قدیمی‌تر از TTL یعنی کار پس‌زمینهٔ تحلیل
    // (به هر دلیل: کرش/ری‌استارت سرور/OOM) هرگز تمام نشد → پیام خطای دوستانه
    // ثبت می‌شود تا حباب اسپینر برای همیشه نماند و کاربر بداند باید دوباره بفرستد.
    const staleCutoff = new Date(Date.now() - PENDING_PLACEHOLDER_TTL_MS);
    const stalePendingIds = messages
      .filter(
        (m) =>
          m.role === "assistant" &&
          m.content === "" &&
          m.createdAt < staleCutoff
      )
      .map((m) => m.id);
    if (stalePendingIds.length > 0) {
      try {
        await db.chatMessage.updateMany({
          where: { id: { in: stalePendingIds } },
          data: { content: MEDIA_PENDING_ERROR_TEXT },
        });
        // در پاسخ همین‌جا هم منعکس شود (بدون انتظار برای خواندن دوباره از DB)
        for (const m of messages) {
          if (stalePendingIds.includes(m.id)) m.content = MEDIA_PENDING_ERROR_TEXT;
        }
      } catch (recErr) {
        console.error("[chat] stale pending recovery failed:", recErr);
      }
    }

    // اگر هیچ پیامی وجود ندارد → پیام خوش‌آمدگویی شخصی‌سازی شده بساز
    // (type annotation برای strict mode — قبلاً `= null` به‌تنهایی خطای TS می‌داد)
    let welcomeMessage: {
      id: string;
      role: string;
      content: string;
      mediaUrl: string | null;
      mediaType: string | null;
      createdAt: string;
    } | null = null;
    if (messages.length === 0) {
      // دریافت اطلاعات کاربر برای شخصی‌سازی
      const profile = await db.onboardingProfile.findUnique({ where: { userId: user.id } });
      // v76 — وزن فعال با رزولور مرکزی (حل تعارض پروفایل/WeightLog — باگ ۴۶/۹۷)
      const { resolveActiveWeight } = await import("@/lib/fitness/active-weight");
      const activeW = await resolveActiveWeight(user.id);
      const sub = await db.subscription.findFirst({
        where: { userId: user.id, status: "active" },
        orderBy: { endDate: "desc" },
      });

      const userName = user.name || "ورزشکار";
      const goal = profile?.goal === "fat_loss" ? "کاهش چربی" :
                   profile?.goal === "cut" ? "کات (چربی‌سوزی با حفظ عضله)" :
                   profile?.goal === "muscle_gain" ? "عضله‌سازی" :
                   profile?.goal === "bulk" ? "افزایش حجم" :
                   profile?.goal === "endurance" ? "استقامت" :
                   profile?.goal === "strength" ? "قدرت" : "تناسب اندام";
      const currentWeight = activeW.weight ?? profile?.weight ?? null;
      const planName = sub?.plan || user.planName || null;

      welcomeMessage = {
        id: "welcome_coach",
        role: "assistant",
        content: `سلام ${userName} عزیز! 👋💪\n\nمن فیتاپ هوشمندتم — مربی شخصی تو که ۲۴ ساعته اینجام.\n\n` +
          `✅ هدف تو: ${goal}\n` +
          (currentWeight ? `✅ وزن فعلی: ${currentWeight} کیلو\n` : "") +
          (planName ? `✅ پلن: ${planName}\n` : "") +
          `\nهر سوالی درباره تمرین، تغذیه، مکمل، فرم حرکات یا هر چیز دیگه داری بپرس. حتی می‌تونی عکس از غذات بفرستی تا کالری‌ش رو بگم! 📸\n\n` +
          `🤖 من به تمام اطلاعات پروفایل تو دسترسی دارم — وزن، قد، هدف، آسیب‌دیدگی‌ها، تجهیزات و برنامه‌هات. پس کاملاً شخصی‌سازی شده جواب می‌دم.\n\n` +
          `شروع کنیم؟ 🚀`,
        mediaUrl: null,
        mediaType: null,
        createdAt: new Date().toISOString(),
      };
    }

    return Response.json({
      messages: messages.length > 0 ? messages.map((m) => ({
        id: m.id,
        role: m.role,
        // v59 — ضد چسبیدگی در زمان خواندن، فقط برای پاسخ‌های مربی (URL-safe)
        content: m.role === "assistant" ? fixPersianTypographySafe(m.content) : m.content,
        mediaUrl: m.mediaUrl ?? null,
        mediaType: m.mediaType ?? null,
        createdAt: m.createdAt.toISOString(),
        // ─── v95 — poster ویدیو از فریم اول استخراج‌شده — فیکس «رندر کند ویدیو
        // بعد از آپلود»: حباب بدون این poster باید متادیتای ویدیوی بزرگ را کامل
        // بگیرد تا فریم اول را رندر کند (ویدیوی ۵۰-۹۰MB روی موبایل = دقیقه‌ها) ───
        poster: m.mediaType === "video" ? posterFromFrames(m.mediaFrames) : null,
        // ─── v73.4 دوفازی مدیا ───
        // پیام assistant با محتوای خالی = placeholder در انتظار تحلیل پس‌زمینه؛
        // به‌جای حذف، با فلگ pending برمی‌گردد تا UI اسپینر «در حال تحلیل و پاسخ…»
        // نشان دهد و poll کلاینت ادامه یابد (بعد از رفرش صفحه هم کار می‌کند).
        pending: m.role === "assistant" && m.content === "",
      })) : (welcomeMessage ? [welcomeMessage] : []),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    // گیت پلن: چت با مربی هوشمند فقط برای پلن پیشرفته و حرفه‌ای
    const { userId } = await requirePlanCapability("aiChat");
    // ─── H2/H6: محدودیت نرخ — ۳۰ پیام در دقیقه برای هر کاربر ───
    const rl = rateLimit(`coach-chat:${userId}`, 30, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }
    const user = await requireAuth();
    const body = await req.json();
    const message: string = typeof body.message === "string" ? body.message : "";
    const imageBase64: string | undefined = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
    const videoBase64: string | undefined = typeof body.videoBase64 === "string" ? body.videoBase64 : undefined;
    // ─── مسیر multipart جدید (ویدیوهای بدون محدودیت حجم — Task 4-a) ───
    // کلاینت ابتدا POST /api/coach/chat/upload را صدا می‌زند (فایل ذخیره + فشرده‌سازی
    // + استخراج فریم + مصرف سهمیه) و بعد اینجا videoUrl/videoFrames را می‌فرستد.
    const clientVideoUrl: string | undefined = typeof body.videoUrl === "string" ? body.videoUrl : undefined;
    const clientVideoFrames: string[] | undefined = Array.isArray(body.videoFrames)
      ? body.videoFrames.filter((f: unknown): f is string => typeof f === "string")
      : undefined;

    if (!message && !imageBase64 && !videoBase64 && !clientVideoUrl) {
      return Response.json({ error: "پیام خالی است." }, { status: 400 });
    }
    // v72 حسابداری — سقف طول پیام متنی: پاسخ‌های کپی‌پیست‌شدهٔ چند صفحه‌ای
    // (مثل مقاله) پرامپت را متورم و هزینه را بی‌کران می‌کنند؛ ۸ هزار نویسه
    // برای هر پیام چت بیش از حد کافی است و UI هم محدودتر نمایش می‌دهد.
    const CHAT_MESSAGE_MAX_CHARS = 8000;
    if (message.length > CHAT_MESSAGE_MAX_CHARS) {
      return Response.json(
        { error: `پیام خیلی طولانی است — حداکثر ${CHAT_MESSAGE_MAX_CHARS} نویسه.` },
        { status: 400 }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ① v73.4 — Idempotency با clientId (فیکس «پیام یک‌بار فرستاده شد، دوبار
    // نمایش یافت»): اگر همین clientId قبلاً ثبت شده، همان پاسخ قبلی عیناً
    // برگردانده می‌شود (بدون ساخت ردیف جدید). اگر ردیف کاربر هست ولی هنوز
    // پاسخی ثبت نشده، پردازش با «همان ردیف» ادامه می‌یابد (retry واقعی).
    // ═══════════════════════════════════════════════════════════
    const clientId = sanitizeClientId(body.clientId);
    let reusedUserMsg: UserMsgRow | null = null;
    if (clientId) {
      const existing = await db.chatMessage.findUnique({ where: { clientId } });
      if (existing && existing.userId === user.id) {
        const prevAi = await db.chatMessage.findFirst({
          where: { userId: user.id, role: "assistant", createdAt: { gt: existing.createdAt } },
          orderBy: { createdAt: "asc" },
        });
        if (prevAi) {
          // پاسخ قبلی موجود → عیناً برگردان (کامل یا هنوز pending)
          return Response.json({
            userMessage: toPostMessageDto(existing, existing.mediaFrames),
            aiMessage: toPostMessageDto(prevAi, prevAi.mediaFrames),
            pending: prevAi.content.trim().length === 0,
          });
        }
        // هنوز پاسخی ثبت نشده → بدون ردیف تکراری ادامه بده
        reusedUserMsg = existing;
      }
    }
    const isReplay = !!reusedUserMsg;

    // متغیرهای مدیا
    // (در حالت replay بدنهٔ جدید نادیده گرفته می‌شود — مدیا از ردیف قبلی بارگذاری می‌شود)
    let imageUrl: string | null = null;
    let videoUrl: string | null = null;
    // v70 — URL فریم‌های ذخیره‌شده روی دیسک (برای سینک رسانه در پیام‌های بعدی)
    let frameUrls: string[] = [];
    // ─── v71 معماری دومرحله‌ای مالک: «تحلیل رسانه جمنای، نوشتن پاسخ دیپ‌سیک» ───
    // عکس/فریم‌ها اول با analyzeChatMedia (جمنای) تحلیل و کش می‌شوند؛ بعد متنِ
    // تحلیل به aiChat (دیپ‌سیک) تزریق می‌شود تا پاسخ نهایی را بنویسد. مدیا
    // هرگز مستقیم به کال پاسخ پیوست نمی‌شود (دیپ‌سیک تصویر نمی‌فهمد و پیام
    // متنی هم نباید به جمنای برود — دیریکتیو صریح مالک).
    // v73.4 — خودِ این تحلیل هم به پس‌زمینه منتقل شد (دوفازی) چون گیت‌وی ~۱۲۰s
    // قطع می‌کند؛ این متغیر فقط داده‌های آمادهٔ تحلیل را به کار پس‌زمینه می‌دهد.
    let attachment: { dataUrls: string[]; kind: "image" | "video-frames" } | undefined;

    // پردازش عکس (نیازمند قابلیت chatImageUpload) — v73.4: در حالت replay نادیده گرفته می‌شود
    if (!isReplay && imageBase64) {
      // گیت پلن برای ارسال عکس در چت
      await requirePlanCapability("chatImageUpload");
      // گارد فنی حجم (۲۰۰MB base64 ≈ ۱۵۰MB فایل — نادر؛ ضد OOM/درخواست مخرب).
      // دیرکتیو مالک: سقف کاربر-پسند حذف شد — عکس در saveOptimizedImage با sharp
      // به ۱۶۰۰px کاهش می‌یابد و فقط نسخهٔ بهینه نگه داشته می‌شود.
      const MAX_IMG = 200 * 1024 * 1024; // base64 ~۱.۳۳x
      if (imageBase64.length > MAX_IMG) {
        return Response.json(
          { error: "فایل تصویر بسیار بزرگ است." },
          { status: 413 }
        );
      }
      const parsed = parseDataUrl(imageBase64, "image/jpeg");
      if (!parsed.mime.startsWith("image/")) {
        return Response.json({ error: "فقط فایل تصویری مجاز است." }, { status: 400 });
      }
      // ─── سهمیهٔ عکس چت (Task 4-a) — بعد از گیت پلن و قبل از پردازش ───
      // (مصرف واقعی اتمیک است — consumeQuotaAtomically در کار پس‌زمینه ممیزی 1-b#1)
      const quota = await checkQuota(user.id, "chat_photo");
      if (!quota.allowed) {
        return Response.json(
          { error: quota.messageFa ?? "سهمیهٔ ارسال عکس تمام شده است.", code: quota.code },
          { status: 429 }
        );
      }
      // ─── بهینه‌سازی عکس با sharp: resize + WebP ───
      const saved = await saveOptimizedImage(parsed.base64, parsed.mime);
      if (!saved) {
        return Response.json(
          { error: "پردازش عکس ناموفق بود — حجم/ابعاد عکس خیلی زیاد است. عکس کوچک‌تری امتحان کن." },
          { status: 400 }
        );
      }
      imageUrl = saved.url;

      // ─── v85 — مصرف سهمیهٔ chat_photo دیگر اینجا انجام نمی‌شود (قبلاً بلافاصله
      // بعد از ذخیرهٔ عکس بود؛ اگر تحلیل AI شکست می‌خورد سهمیهٔ کاربر سوخته بود —
      // گزارش دقیق مالک: «باید حتماً تحلیل بشه بعد از سهمیه کم بشه»).
      // مصرف اکنون در کار پس‌زمینهٔ runMediaAnalysisJob فقط بعد از تحلیل موفق
      // مدل بینایی انجام می‌شود (با گارد idempotent). ───

      // پیوست مستقیم عکس بهینه‌شده به کال مربی (بدون VLM جدا)
      attachment = {
        dataUrls: [`data:${saved.mime};base64,${saved.optimizedBase64}`],
        kind: "image",
      };
    }

    // پردازش ویدیو — مسیر قدیمی base64 (ویدیوهای <۱۲MB — دست‌نخورده)
    // v73.4: در حالت replay نادیده گرفته می‌شود؛ فشرده‌سازی/استخراج فریم به
    // پس‌زمینه منتقل شد (گیت‌وی ~۱۲۰s قطع می‌کند) — اینجا فقط ذخیرهٔ فایل.
    if (!isReplay && videoBase64) {
      // گیت پلن برای ارسال ویدیو در چت
      await requirePlanCapability("chatVideoUpload");
      // گارد فنی حجم (۲۰۰MB base64 — نادر)؛ مسیر اصلی ویدیوهای بزرگ همان
      // multipart /api/coach/chat/upload است (تا ۲GB، فشرده‌سازی ffmpeg سمت سرور).
      const MAX_VID = 200 * 1024 * 1024;
      if (videoBase64.length > MAX_VID) {
        return Response.json(
          { error: "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید." },
          { status: 413 }
        );
      }
      const parsed = parseDataUrl(videoBase64, "video/mp4");
      if (!parsed.mime.startsWith("video/")) {
        return Response.json({ error: "فقط فایل ویدیویی مجاز است." }, { status: 400 });
      }
      // ─── سهمیهٔ تحلیل ویدیو حرکات (Task 4-a) — قبل از استخراج فریم‌ها ───
      const quota = await checkQuota(user.id, "movement_video");
      if (!quota.allowed) {
        return Response.json(
          { error: quota.messageFa ?? "سهمیهٔ ارسال ویدیو تمام شده است.", code: quota.code },
          { status: 429 }
        );
      }
      const saved = await saveBase64File(parsed.base64, parsed.mime, "video");
      videoUrl = saved.url;

      // ─── v73.4 دوفازی — فشرده‌سازی درجا + استخراج فریم به کار پس‌زمینهٔ
      // runMediaAnalysisJob منتقل شد (گیت‌وی ~۱۲۰s قطع می‌کند). سهمیهٔ
      // movement_video هم در پس‌زمینه و فقط بعد از استخراج موفق فریم مصرف
      // می‌شود (همان ترتیب قبلی). ───
    }

    // پردازش ویدیو — مسیر multipart جدید (فایل در /api/coach/chat/upload ذخیره
    // شده؛ فشرده‌سازی/استخراج فریم/مصرف سهمیه در کار پس‌زمینهٔ runMediaAnalysisJob
    // انجام می‌شود — اینجا فقط اعتبارسنجی مالکیت و گارد سهمیه)
    // v73.4: در حالت replay نادیده گرفته می‌شود.
    if (!isReplay && clientVideoUrl && !videoBase64) {
      await requirePlanCapability("chatVideoUpload");
      // گارد سهمیه (دومین لایه — اولی در خود روت آپلود fail-fast است؛ مصرف واقعی
      // در کار پس‌زمینه انجام می‌شود)
      const vQuota = await checkQuota(user.id, "movement_video");
      if (!vQuota.allowed) {
        return Response.json(
          { error: vQuota.messageFa ?? "سهمیهٔ ارسال ویدیو تمام شده است.", code: vQuota.code },
          { status: 429 }
        );
      }
      const validUrl = await validateChatVideoUrl(user.id, clientVideoUrl);
      if (!validUrl) {
        return Response.json(
          { error: "فایل ویدیو پیدا نشد. لطفاً دوباره آپلود کن." },
          { status: 400 }
        );
      }
      videoUrl = validUrl;
      const frames = (clientVideoFrames ?? [])
        .filter((f) => f.startsWith("data:image/") && f.length <= MAX_CLIENT_FRAME_CHARS)
        .slice(0, MAX_CLIENT_FRAMES);
      if (frames.length > 0) {
        attachment = { dataUrls: frames, kind: "video-frames" };
        // v70 — ذخیره فریم‌های سمت کلاینت روی دیسک برای سینک رسانه در پیام‌های بعدی
        frameUrls = await saveFramesToDisk(frames);
      }
      // v73.4 — بدون فریم کلاینت: کار پس‌زمینه از ردیف (استخراج دوباره ffmpeg)
      // تلاش می‌کند و در شکست، یادداشت صادقانه به مدل متنی می‌دهد.
    }

    // ═══════════════════════════════════════════════════════════
    // ② v73.4 — ساخت/استفادهٔ مجدد ردیف پیام کاربر (با clientId)
    // ═══════════════════════════════════════════════════════════
    let userMsg: UserMsgRow;
    if (isReplay && reusedUserMsg) {
      // retry بدون پاسخ ثبت‌شده → همان ردیف قبلی، بدون ردیف تکراری
      userMsg = reusedUserMsg;
    } else {
      try {
        userMsg = await db.chatMessage.create({
          data: {
            userId: user.id,
            role: "user",
            content: message || (imageUrl ? "📷 عکس" : videoUrl ? "🎬 ویدیو" : ""),
            mediaUrl: imageUrl ?? videoUrl,
            mediaType: imageUrl ? "image" : videoUrl ? "video" : null,
            mediaFrames: frameUrls.length > 0 ? JSON.stringify(frameUrls) : null,
            clientId: clientId ?? null,
          },
        });
      } catch (createErr) {
        // P2002 — دو درخواست همزمان با یک clientId (دبل‌سند واقعی):
        // برندهٔ unique constraint را پیدا کن و همان پاسخ را برگردان
        if ((createErr as { code?: string }).code === "P2002" && clientId) {
          const winner = await db.chatMessage.findUnique({ where: { clientId } });
          if (winner && winner.userId === user.id) {
            const winnerAi = await db.chatMessage.findFirst({
              where: { userId: user.id, role: "assistant", createdAt: { gt: winner.createdAt } },
              orderBy: { createdAt: "asc" },
            });
            if (winnerAi) {
              return Response.json({
                userMessage: toPostMessageDto(winner, winner.mediaFrames),
                aiMessage: toPostMessageDto(winnerAi, winnerAi.mediaFrames),
                pending: winnerAi.content.trim().length === 0,
              });
            }
          }
        }
        throw createErr;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // ③ v73.4 — دوفازی برای مدیا (دیریکتیو مالک: «آپلود/تحلیل مدیا در چت باید
    // پس‌زمینه باشد — گیت‌وی ~۱۲۰s قطع می‌کند»):
    // پاسخ فوری = ردیف کاربر + assistant placeholder (content خالی = pending)؛
    // تحلیل رسانه + پاسخ دیپ‌سیک در پس‌زمینه placeholder را پر می‌کند.
    // پروتکل pending: پیام assistant با content=="" یعنی «در انتظار تحلیل».
    // ═══════════════════════════════════════════════════════════
    const hasMedia = !!(imageUrl || videoUrl) || (isReplay && !!reusedUserMsg?.mediaUrl);
    if (hasMedia) {
      // v99-b — لاگ ورود پیام مدیا (اولین خط قابل مشاهده در تماشای زندهٔ ترمینال)
      console.log(
        `[chat] POST media received: user=${user.id} kind=${attachment?.kind ?? (videoUrl ? "video-await-frames" : "?")} hasImage=${!!imageUrl} hasVideo=${!!videoUrl} dataUrls=${attachment?.dataUrls?.length ?? 0} msgLen=${message.length}`
      );
      const placeholder = await db.chatMessage.create({
        data: { userId: user.id, role: "assistant", content: "" },
      });

      // fire-and-forget — همهٔ خطاها داخل job گرفته می‌شوند (placeholder پیام
      // خطای دوستانه می‌گیرد؛ ردیف کاربر هرگز حذف نمی‌شود)
      runMediaAnalysisJob({
        user,
        userMsgId: userMsg.id,
        placeholderId: placeholder.id,
        message,
        kind: attachment?.kind ?? null,
        dataUrls: attachment ? attachment.dataUrls : null,
        // v84 — فشرده‌سازی/فریم‌سازی برای «همهٔ» ویدیوها (base64 و multipart
        // /api/coach/chat/upload) در پس‌زمینه — قبلاً ویدیوی multipart هرگز
        // فشرده و فریم‌سازی نمی‌شد
        needsVideoProcessing: !isReplay && !!videoUrl,
        videoUrl: videoUrl ?? null,
      }).catch((jobErr) => console.error("[chat] media analysis job crashed:", jobErr));

      return Response.json({
        userMessage: toPostMessageDto(userMsg, userMsg.mediaFrames),
        aiMessage: toPostMessageDto(placeholder),
        pending: true,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // ④ مسیر متنی ساده (بدون مدیا) — sync می‌ماند (سریع است) و idempotent است
    // ═══════════════════════════════════════════════════════════
    // v77 — تشخیص و اجرای درخواست تغییر برنامه از چت:
    //   ذخیرهٔ ماندگار درخواست (nutritionNotes/currentSupplements)
    //   + شروع بازتولید واقعی (source: chat_request)
    //   + یادداشت سیستمیِ صادقانه برای پاسخ مدل.
    // فقط برای پیام تازه — replay (تلاش مجدد با همان clientId) هرگز دوباره trigger نمی‌کند.
    let planChangeNote = "";
    if (!isReplay && message.trim()) {
      try {
        const pcr = await applyPlanChangeRequest(user.id, message);
        planChangeNote = pcr.systemNote;
      } catch (pcErr) {
        console.error("[chat] plan-change intent handling failed:", pcErr);
      }
    }
    let aiResponse: string;
    try {
      aiResponse = await generateCoachAiResponse({
        user,
        userMsgId: userMsg.id,
        finalMessage: message,
        planChangeNote,
      });
    } catch (err) {
      // ─── حذف ردیف پیام کاربر تا یتیم نماند (باگ ممیزی 2-b — رفتار قبلی) ───
      // فقط برای ردیف تازه‌ساخته؛ در حالت replay ردیف قبلی نگه داشته می‌شود تا
      // تلاش مجدد با همان clientId دوباره به همین مسیر برسد و پاسخ تولید شود.
      if (!isReplay) {
        try {
          await db.chatMessage.delete({ where: { id: userMsg.id } });
        } catch (delErr) {
          console.error("[chat] failed to delete orphaned user message:", delErr);
        }
      }
      throw err;
    }

    // Save AI response
    // ─── Task 4-a: تولید TTS حذف شد — پاسخ فقط متن است ───
    const aiMsg = await db.chatMessage.create({
      data: { userId: user.id, role: "assistant", content: aiResponse },
    });

    return Response.json({
      userMessage: toPostMessageDto(userMsg, userMsg.mediaFrames),
      aiMessage: toPostMessageDto(aiMsg, aiMsg.mediaFrames),
    });
  } catch (e) {
    return apiError(e);
  }
}
