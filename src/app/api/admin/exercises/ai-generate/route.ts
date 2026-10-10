import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { createChatCompletionWithRetry, TEXT_MODEL, TEXT_TASK_MODEL } from "@/lib/fitness/ai";
import { normalizeYoutubeEmbedUrl } from "@/lib/fitness/exercise-video";
import { db } from "@/lib/db";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * POST /api/admin/exercises/ai-generate — «ساخت حرکت با هوش مصنوعی» (v135)
 * ─────────────────────────────────────────────────────────────────────────
 * دیرکتیو مالک: «اسم یک حرکت را می‌نویسیم، ساخت هوش مصنوعی را می‌زنیم —
 * هوش مصنوعی باید تحقیق کند و همه‌چیزِ درستِ آن حرکت را بنویسد» + «همهٔ
 * حرکات باید لینک یوتیوب مختص همان حرکت داشته باشند».
 *
 * جریان:
 *   ۱) اعتبارسنجی نام + جلوگیری از تکرار
 *   ۲) پیدا کردن ویدیوی یوتیوب «مختص همان حرکت»: جست‌وجوی سمت سرور در
 *      یوتیوب → کاندیدها → راستی‌آزمایی oEmbed (عنوان/کانال واقعی — بدون حدس)
 *      → امتیاز تطبیق عنوان با نام حرکت + کانال‌های معتبر → بهترین
 *   ۳) تولید محتوا با AI (نام استاندارد، عضله، دسته، تجهیزات، سختی،
 *      توضیح اجرا، نکات ایمنی — همه فارسی با نیم‌فاصلهٔ واقعی)
 *   ۴) برگرداندن «پیش‌نویس» — ذخیرهٔ نهایی با همان POST موجود پنل انجام
 *      می‌شود تا ادمین قبل از ثبت ببیند و تأیید کند (تک‌مسیرِ نوشتن).
 *
 * اگر ویدیوی مطمئنی پیدا نشد، پیش‌نویسِ متن برمی‌گردد و youtubeUrl خالی است
 * (ادمین دستی لینک می‌گذارد) — هیچ ویدیوی نامرتبطی ذخیره نمی‌شود.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MAX_NAME = 100;
const VALID_CATEGORIES = ["push", "pull", "legs", "core", "cardio", "fullbody"];
const VALID_DIFFICULTIES = ["beginner", "intermediate", "advanced"];
const MUSCLES = ["سینه", "سرشانه", "پشت", "جلو بازو", "پشت بازو", "پا", "باسن", "ساق", "شکم", "کل بدن", "گردن و کول"];

const PREFERRED_CHANNELS = [
  "athlean", "jeff nippard", "renaissance periodization", "calisthenicmovement", "jeremy ethier",
  "scottherman", "scott herman", "fitnessprogramer", "fitness programer", "muscle & strength",
  "bodybuilding.com", "nasm", "opex", "squat university", "alan thrall", "catalyst athletics",
  "trx", "blogilates", "madfit", "fitnessblender", "hasfit", "pilates anytime",
  "fitclub", "badankhooba", "tamrino", "chaghar", "mehdikazemifit", "سجاد رضایی",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** استخراج videoId از صفحهٔ نتایج جست‌وجوی یوتیوب (سرور ساید — همان الگوی ytfind) */
async function ytSearchCandidates(query: string, n = 10): Promise<{ id: string; title: string }[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
      { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,fa;q=0.8" }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const pairs = [...html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})".{0,600}?"title":\{"runs":\[\{"text":"(.*?)"/g)];
    const seen = new Set<string>();
    const out: { id: string; title: string }[] = [];
    for (const [, id, rawTitle] of pairs) {
      if (seen.has(id)) continue;
      seen.add(id);
      let title = rawTitle;
      try { title = JSON.parse(`"${rawTitle}"`) as string; } catch { /* همین رشته */ }
      out.push({ id, title });
      if (out.length >= n) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** راستی‌آزمایی oEmbed — وجود ویدیو + عنوان/کانال واقعی (بدون حدس) */
async function oEmbed(videoId: string): Promise<{ title: string; channel: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { title?: string; author_name?: string };
    if (!d.title) return null;
    return { title: d.title, channel: d.author_name || "" };
  } catch {
    return null;
  }
}

/** تطبیق عنوان ویدیو با نام حرکت — توکن‌های مشترک معنادار */
function relevanceScore(exName: string, videoTitle: string, channel: string, position: number): number {
  const STOP = new Set(["the", "how", "to", "do", "a", "an", "with", "for", "on", "of", "in", "and", "your", "proper", "form", "exercise", "workout", "اموزش", "آموزش", "حرکت", "تمرین", "اصولی", "صحیح", "اجرای", "درست", "به", "از", "با", "برای"]);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[یي]/g, "ی").replace(/[کك]/g, "ک")
      .replace(/[\s\u200C\-–—_,.:;!?()«»"']+/g, " ")
      .trim();
  const exTokens = norm(exName).split(" ").filter((t) => t && !STOP.has(t) && t.length > 1);
  const tTokens = new Set(norm(videoTitle).split(" "));
  let overlap = 0;
  for (const t of exTokens) if (tTokens.has(t)) overlap++;
  let score = overlap * 10 - position;
  const ch = norm(channel + " " + videoTitle);
  for (const p of PREFERRED_CHANNELS) if (ch.includes(p.toLowerCase())) { score += 6; break; }
  if (/shorts/i.test(videoTitle)) score -= 4;
  if (/full workout|workout music|challenge|compilation/i.test(videoTitle)) score -= 3;
  return score;
}

/** استخراج اولین بلوک JSON از پاسخ مدل */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManagePrograms");
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME) {
      return Response.json({ error: "نام حرکت را وارد کنید (حداکثر ۱۰۰ کاراکتر)." }, { status: 400 });
    }

    // جلوگیری از تکرار (همان گارد POST موجود)
    const existingNames = await db.exerciseLibrary.findMany({ select: { name: true } });
    if (existingNames.some((e) => e.name.trim().toLowerCase() === name.toLowerCase())) {
      return Response.json({ error: "همین نام قبلاً ثبت شده است" }, { status: 400 });
    }

    /* ─── ۲) ویدیوی مختص حرکت: جست‌وجو → oEmbed → امتیاز تطبیق ─── */
    const queries = [
      `${name} exercise proper form`,
      `${name} آموزش حرکت یوتیوب`,
      `${name} technique youtube`,
    ];
    const seen = new Set<string>();
    let best: { id: string; title: string; score: number } | null = null;
    for (const q of queries) {
      const cands = await ytSearchCandidates(q, 8);
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const score = relevanceScore(name, c.title, "", i);
        if (!best || score > best.score) best = { id: c.id, title: c.title, score };
      }
      if (best && best.score >= 20) break; // تطبیق قوی — کافی است
    }

    let video: { youtubeUrl: string; title: string; channel: string; verified: boolean } | null = null;
    if (best && best.score > 0) {
      const meta = await oEmbed(best.id);
      if (meta) {
        const finalScore = relevanceScore(name, meta.title, meta.channel, 0);
        if (finalScore > 0) {
          const normalized = normalizeYoutubeEmbedUrl(`https://www.youtube.com/watch?v=${best.id}`);
          if (normalized) {
            video = { youtubeUrl: normalized, title: meta.title, channel: meta.channel, verified: true };
          }
        }
      }
    }

    /* ─── ۳) محتوای تحقیق‌شده با AI ─── */
    const systemPrompt = [
      "تو متخصص حرکات اصلاحی و مربی ارشد بدنسازی و فیتنس پلتفرم فیتاپ هستی.",
      "برای نام حرکتی که کاربر می‌دهد، اطلاعات دقیق، اصولی و به‌روز بر اساس دانش تمرینی معتبر (منابع شناخته‌شدهٔ تمرینی) بنویس.",
      "قواعد نوشتاری: فارسی روان با «نیم‌فاصلهٔ واقعی» (U+200C) و ارقام فارسی؛ بدون ادعای پزشکی؛ بدون اغراق.",
      "پاسخ را «فقط» به‌صورت یک شیء JSON معتبر بده، بدون هیچ متن اضافه:",
      '{"name":"نام استاندارد حرکت به شکل فارسی (English)","muscle":"سینه|سرشانه|پشت|جلو بازو|پشت بازو|پا|باسن|ساق|شکم|کل بدن|گردن و کول","category":"push|pull|legs|core|cardio|fullbody","equipment":"barbell|dumbbell|machine|cable|bodyweight|kettlebell|band|bench|smith|medicine_ball|other","difficulty":"beginner|intermediate|advanced","description":"۲ تا ۳ جملهٔ فارسی دربارهٔ نحوهٔ اجرای صحیح حرکت","tips":"۱ تا ۲ جملهٔ فارسی نکات ایمنی و اشتباهات رایج"}',
    ].join("\n");
    const userPrompt = [
      `نام حرکت: ${name}`,
      video ? `(ویدیوی مرجع پیدا‌شده در یوتیوب: «${video.title}» — کانال ${video.channel})` : "",
      "اگر نام داده‌شده ناقص یا محاوره‌ای است، نام استاندارد و کامل همان حرکت را در فیلد name بنویس.",
      video ? "محتوا باید دقیقاً همان حرکتی باشد که در ویدیوی مرجع اجرا می‌شود." : "",
    ].filter(Boolean).join("\n");

    let draft = {
      name,
      muscle: "",
      category: "",
      equipment: "",
      difficulty: "",
      description: "",
      tips: "",
    };
    try {
      const aiText = await createChatCompletionWithRetry(
        {
          model: TEXT_TASK_MODEL,
          fallback_model: TEXT_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 900,
        },
        "exercise-ai-generate",
        2
      );
      const parsed = extractJson(aiText);
      if (parsed) {
        const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
        draft = {
          name: s(parsed.name, MAX_NAME) || name,
          muscle: MUSCLES.includes(s(parsed.muscle, 30)) ? s(parsed.muscle, 30) : "",
          category: VALID_CATEGORIES.includes(s(parsed.category, 20)) ? s(parsed.category, 20) : "",
          equipment: s(parsed.equipment, 30),
          difficulty: VALID_DIFFICULTIES.includes(s(parsed.difficulty, 20)) ? s(parsed.difficulty, 20) : "",
          description: s(parsed.description, 900),
          tips: s(parsed.tips, 500),
        };
      }
    } catch (e) {
      console.warn("[exercise-ai-generate] AI content failed — فقط ویدیو برمی‌گردد:", e instanceof Error ? e.message : e);
    }

    return Response.json({
      draft: {
        ...draft,
        youtubeUrl: video?.youtubeUrl ?? "",
        youtubeEnabled: true,
        isActive: true,
      },
      video: video ? { title: video.title, channel: video.channel, verified: true } : null,
      videoNote: video
        ? "ویدیوی یوتیوب راستی‌آزمایی شد (وجود + عنوان مرتبط با حرکت)."
        : "ویدیوی مطمئن و مرتبطی پیدا نشد — لینک یوتیوب را دستی وارد کنید (هیچ ویدیوی نامرتبطی ذخیره نمی‌شود).",
    });
  } catch (e) {
    return apiError(e);
  }
}
