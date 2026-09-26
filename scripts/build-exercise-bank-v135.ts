/**
 * ─────────────────────────────────────────────────────────────────────────
 * build-exercise-bank-v135.ts — بازسازی جامع بانک حرکات (دیرکتیو مالک v135)
 * ─────────────────────────────────────────────────────────────────────────
 * مأموریت مالک: «بانک حرکات را جامع کن که ۹۹٪ بانک حرکات باشه» + حذف حرکات
 * الکی + هر حرکت ویدیوی یوتیوب «مختص خودش» (نه ویدیوی مشترک/نامرتبط).
 *
 * ورودی: کاتالوگ‌های تحقیق‌شده از منابع معتبر (ExRx / Bodybuilding.com /
 * Muscle&Strength / CrossFit / TRX / Pilates Anytime / ACE) در
 * scripts/exercise-research/ — هر ورودی با ویدیوی oEmbed-راستی‌آزمایی‌شده.
 *
 * عملیات (idempotent — دو بار اجرا = صفر تغییر):
 *   ۰) CONSOLIDATE: جفت‌های «یک حرکت با دو نام» (قدیمی بانک + جدید کاتالوگ)
 *      ادغام می‌شوند. قانون حفاظت (خط قرمز مالک: «ویدیوی اختصاصی ساختم پاک نشه»):
 *        • اگر ردیف قدیمی videoUrl اختصاصی دارد یا در برنامهٔ کاربران ارجاع دارد
 *          → قدیمی حفظ می‌شود، ردیف تکراری جدید حذف، youtubeUrl قدیمی با
 *            ویدیوی تأییدشده به‌روز می‌شود (یوتیوب = fallback اختصاصی).
 *        • وگرنه ردیف کانونیکال (با پسوند انگلیسی/محتوای غنی‌تر) می‌ماند.
 *   ۱) FIX-VIDEO: حرکتِ موجودِ بانک که ورودی تحقیقِ هم‌نام دارد → ویدیوی
 *      تأییدشدهٔ همان حرکت (اگر videoUrl اختصاصی ندارد).
 *   ۲) DELETE-JUNK: فهرست صریح حرکات الکی/مبهم + گارد ارجاع برنامه‌ها.
 *   ۳) ADD-NEW: ورودی‌های تحقیق که در بانک نیستند (با alias) → اضافه.
 *
 * اجرا:  bun scripts/build-exercise-bank-v135.ts          (dry-run)
 *        bun scripts/build-exercise-bank-v135.ts --apply
 * ─────────────────────────────────────────────────────────────────────────
 */
import { db } from "../src/lib/db";
import { normalizePersianText } from "../src/lib/fitness/persian-search";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const RESEARCH_DIR = join(__dirname, "exercise-research");

/* ─── نرمال‌سازی نام — هم‌سو با squeezeExerciseName قفل بانک (v117) ─── */
function squeeze(input: string): string {
  return normalizePersianText(input)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\s\u200C\-–—_]+/g, "")
    .replace(/[.,،؛:!؟?"'«»\[\]]+/g, "")
    .toLowerCase()
    .trim();
}

/** کلید alias: حذف حروف اضافه + ترتیب‌بی‌تفاوتی توکن‌ها */
const STOPWORDS = new Set(["با", "از", "روی", "برای", "در", "به"]);
function aliasKey(input: string): string {
  const bare = input.replace(/\s*\([^)]*\)\s*$/, " ").replace(/[()]/g, " ");
  const tokens = bare
    .split(/[\s\u200C\-–—_]+/)
    .map((t) => normalizePersianText(t))
    .filter((t) => t && !STOPWORDS.has(t))
    .sort()
    .join("|");
  return tokens;
}

function videoIdOf(url: string): string {
  const m = url.match(/embed\/([\w-]{6,})/) || url.match(/[?&]v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/);
  return m ? m[1] : "";
}

/* ─── ۲) فهرست صریح حذف — حرکات الکی/مبهم/مرده (دیرکتیو مالک) ─── */
const DELETE_EXACT = [
  "زیرآرنج‌گیر", // نام غلط — همان چین‌آپ است؛ «بارفیکس دست‌جمع» درستش در بانک هست
  "راوت", // نام مبهم + ویدیوی مرده
  "راوت با کابل", // همان
  "تو-تاچ", // نام مبهم — خانوادهٔ کرانچ استاندارد در کاتالوگ هست
  "خرس رویال (خرس‌گردی)", // نام گمنام + ویدیوی مرده (Bear Crawl استاندارد در کاتالوگ)
  "پرس سینه روی لبه نیمکت", // ویدیوی فلای (نامرتبط) — حرکت شناخته‌شدهٔ دیتابیس‌ها نیست
];

/** الگوهای نام‌سازی (مکمل فهرست v115) */
const DELETE_PATTERNS: RegExp[] = [/\bبامکس\b/u, /با\s*مکس\b/u];

/* ─── ۰) ادغام هم‌معنی‌ها — keep + deleteها (یک حرکت = یک ردیف) ─── */
const CONSOLIDATE: { keep: string; delete: string[] }[] = [
  { keep: "پرس سینه دمبل (Dumbbell Bench Press)", delete: ["پرس سینه با دمبل"] },
  { keep: "پرس زیر سینه هالتر (Decline Barbell Bench Press)", delete: ["پرس زیرسینه با هالتر"] },
  { keep: "قفسه بالا سینه دمبل (Incline Dumbbell Fly)", delete: ["فلای بالاسینه با دمبل"] },
  { keep: "پرس بالا سینه دمبل (Incline Dumbbell Bench Press)", delete: ["پرس بالاسینه با دمبل"] },
  { keep: "پرس زیر سینه دمبل (Decline Dumbbell Bench Press)", delete: ["پرس زیرسینه با دمبل"] },
  { keep: "شنا سوئدی شیب منفی (Decline Push-Up)", delete: ["شنا با پای بالا"] },
  { keep: "شنا سوئدی دست‌باز (Wide-Grip Push-Up)", delete: ["شنا با دست‌باز"] },
  { keep: "شنا سوئدی پایک (Pike Push-Up)", delete: ["شنا پایک"] },
  { keep: "شنا سوئدی کمان‌دار (Archer Push-Up)", delete: ["شنا آرچر"] },
  { keep: "زیربغل سیم‌کش از جلو (Lat Pulldown)", delete: ["زیربغل سیم‌کش بالا"] },
  { keep: "زیربغل قایقی سیم‌کش (Seated Cable Row)", delete: ["زیربغل قایقی نشسته", "زیربغل سیم‌کش پایین نشسته", "زیربغل طناب نشسته سیم‌کش"] },
  { keep: "زیربغل پندلی (Pendlay Row)", delete: ["پندلی رو"] },
  { keep: "زیربغل هالتر خم (Barbell Bent-Over Row)", delete: ["زیربغل هالتر خم ۴۵ درجه"] },
  { keep: "زیربغل یک‌دست هالتر مدوز", delete: ["مدوز رو"] },
  { keep: "روئینگ با کش (Band Row)", delete: ["زیربغل با کش مقاومتی"] },
  { keep: "هاک اسکوات دستگاه (Hack Squat)", delete: ["هک اسکوات"] },
  { keep: "اسکوات گابلت (Goblet Squat)", delete: ["اسکوات گابلت کتل‌بل (Goblet Squat)", "اسکات گابلت (Goblet Squat)"] },
  { keep: "جامپ اسکوات (Jump Squat)", delete: ["اسکوات پرشی زانو بلند"] },
  { keep: "ساق ایستاده دستگاه (Standing Calf Raise)", delete: ["ساق پا ایستاده"] },
  { keep: "ساق نشسته دستگاه (Seated Calf Raise)", delete: ["ساق پا نشسته دستگاه"] },
  { keep: "ساق ایستاده دمبل (Dumbbell Standing Calf Raise)", delete: ["ساق پا با دمبل"] },
  { keep: "پشت پا دستگاه نشسته (Seated Leg Curl)", delete: ["پشت پا نشسته دستگاه"] },
  { keep: "پرس سرشانه دمبل (Dumbbell Shoulder Press)", delete: ["پرس سرشانه با دمبل"] },
  { keep: "پرس سرشانه دمبل نشسته (Seated Dumbbell Shoulder Press)", delete: ["پرس سرشانه نشسته با دمبل"] },
  { keep: "پرس سرشانه دستگاه (Machine Shoulder Press)", delete: ["پرس سرشانه نشسته دستگاه"] },
  { keep: "پرس سرشانه هالتر (Barbell Overhead Press)", delete: ["پرس سرشانه ایستاده با هالتر"] },
  { keep: "پرس آرنولد (Arnold Press)", delete: ["آرنولد پرس", "پرس آرنولد نشسته"] },
  { keep: "نشر جلو دمبل (Dumbbell Front Raise)", delete: ["نشر از جلو"] },
  { keep: "نشر جانب سیم‌کش (Cable Lateral Raise)", delete: ["نشر جانب با کابل"] },
  { keep: "نشر جانب دستگاه (Machine Lateral Raise)", delete: ["نشر جانب با دستگاه"] },
  { keep: "نشر معکوس دستگاه (پک‌دک معکوس) (Reverse Pec Deck)", delete: ["نشر خماری با دستگاه پک‌دک"] },
  { keep: "کراس اور معکوس سیم‌کش (Cable Rear Delt Fly)", delete: ["نشر خماری با کابل"] },
  { keep: "نشر خم دمبل (Bent-Over Dumbbell Rear Delt Raise)", delete: ["نشر جانب با زاویه خم"] },
  { keep: "شراگ دمبل (Dumbbell Shrug)", delete: ["شراگ"] },
  { keep: "شراگ هالتر (Barbell Shrug)", delete: ["شراگ با هالتر"] },
  { keep: "جلو بازو لاری (Preacher Curl)", delete: ["جلو بازو اسکات"] },
  { keep: "جلو بازو هالتر زیگزاگ (EZ-Bar Curl)", delete: ["جلو بازو هالتر EZ"] },
  { keep: "جلو بازو دمبل اینکلاین (Incline Dumbbell Curl)", delete: ["جلو بازو دمبل روی نیمکت شیب‌دار"] },
  { keep: "جلو بازو دستگاه (Machine Biceps Curl)", delete: ["جلو بازو پیش‌خم دستگاه"] },
  { keep: "جلو بازو با کش (Band Biceps Curl)", delete: ["جلو بازو با کش مقاومتی"] },
  { keep: "پشت بازو هالتر خوابیده (Lying Triceps Extension)", delete: ["پشت بازو درازخواب"] },
  { keep: "پشت بازو پوش‌داون با کش (Band Triceps Pushdown)", delete: ["پشت بازو با کش مقاومتی"] },
  { keep: "کیک‌بک دمبل (پشت بازو) (Dumbbell Kickback)", delete: ["پشت بازو کیک‌بک"] },
  { keep: "قفسه سینه پروانه (پک‌دک) (Pec Deck Fly)", delete: ["پک دک دستگاه"] },
  { keep: "دیپ روی نیمکت (Bench Dip)", delete: ["دیپس سینه روی نیمکت"] },
  { keep: "پرس پشت‌بازو دست‌جمع", delete: ["پرس سینه دست‌جمع", "پرس سینه دست جمع (پشت بازو) (Close-Grip Bench Press)"] },
  { keep: "بارفیکس دست‌جمع", delete: ["بارفیکس برعکس (چین‌آپ)"] },
  { keep: "پشت بازو دمبل بالای سر (Overhead Dumbbell Triceps Extension)", delete: ["پشت بازو بالای سر"] },
  { keep: "پشت بازو سیم‌کش بالای سر (Overhead Cable Triceps Extension)", delete: ["پشت بازو سیم‌کش دو دست از بالا بالای سر"] },
  { keep: "ددلیفت رومانیایی دمبل (Dumbbell Romanian Deadlift)", delete: ["ددلیفت رومانیایی با دمبل"] },
  { keep: "لانژ راه‌رفتنی دمبل (Walking Dumbbell Lunge)", delete: ["لانژ رفتنی", "لانژ راه‌رونده (Walking Lunge)"] },
  { keep: "لانژ هالتر (Barbell Lunge)", delete: ["لانژ با هالتر"] },
  { keep: "مانتین کلایمبر (Mountain Climber)", delete: ["کوهنوردی"] },
  { keep: "رول‌اوت شکم (Ab Wheel Rollout)", delete: ["اب‌ریتر"] },
  { keep: "مچ دمبل (Dumbbell Wrist Curl)", delete: ["مچ دمبل از جلو"] },
  { keep: "اسنچ (Snatch)", delete: ["اسنچ با هالتر"] },
  { keep: "تراستر دمبل (Thruster)", delete: ["تهرست با دمبل"] },
  { keep: "ترکیش گت‌آپ (Turkish Get-Up)", delete: ["تورکیش گت‌آپ با کتل‌بل"] },
  { keep: "وال‌بال ترو (Wall Ball Shot)", delete: ["وال‌بال"] },
  { keep: "پرش روی جعبه (Box Jump)", delete: ["جامپ باکس"] },
];

/** الگوی alias صریح: نام کاتالوگ تحقیق → نام موجود بانک (جلوگیری از ساخت داپلیکیت) */
const ALIAS_EXTRA: [string, string][] = [
  ["پرس سینه دست جمع (پشت بازو) (Close-Grip Bench Press)", "پرس پشت‌بازو دست‌جمع"],
  ["پشت بازو سیم‌کش بالای سر (Overhead Cable Triceps Extension)", "پشت بازو سیم‌کش دو دست از بالا بالای سر"],
  ["پشت بازو دمبل بالای سر (Overhead Dumbbell Triceps Extension)", "پشت بازو بالای سر"],
  ["اسکات گابلت (Goblet Squat)", "اسکوات گابلت (Goblet Squat)"],
];

/** ویدیوی تأییدشدهٔ جایگزین برای حرکاتی که ویدیوی کاتالوگشان با هم‌خانواده تداخل دارد */
const VIDEO_OVERRIDE: Record<string, string> = {
  "پشت بازو دمبل بالای سر (Overhead Dumbbell Triceps Extension)": "dxdr8iSRLA8", // OPEX دورودست (تک‌دست نیست)
};

interface ResearchEntry {
  en: string;
  fa: string;
  name: string;
  muscle: string;
  secondary?: string[];
  equipment: string;
  category: string;
  pattern?: string;
  difficulty: string;
  core?: boolean;
  disciplines?: string[];
  ytVideoId: string;
  ytTitle: string;
  ytChannel: string;
  description?: string;
  tips?: string;
}

interface Report {
  consolidated: { kept: string; deleted: string[] }[];
  fixedVideos: string[];
  deleted: string[];
  deleteProtected: string[];
  added: string[];
  unverifiedVideoSkipped: string[];
}

type ExRow = { id: string; name: string; videoUrl: string; youtubeUrl: string };

async function main() {
  const report: Report = { consolidated: [], fixedVideos: [], deleted: [], deleteProtected: [], added: [], unverifiedVideoSkipped: [] };

  /* ─── بارگذاری کاتالوگ‌های تحقیق ─── */
  const groups = ["groupA-gym.json", "groupB-strength.json", "groupC-bodyweight.json", "groupD-pilates-balance.json", "groupE-hiit-core.json"];
  const research: ResearchEntry[] = [];
  for (const g of groups) {
    try {
      const arr = JSON.parse(readFileSync(join(RESEARCH_DIR, g), "utf8")) as ResearchEntry[];
      research.push(...arr);
      console.log(`📥 ${g}: ${arr.length}`);
    } catch {
      console.log(`⚠️ ${g} خوانده نشد — رد شد`);
    }
  }
  const bySqueeze = new Map<string, ResearchEntry>();
  const usedVideo = new Set<string>();
  for (const e of research) {
    if (!e.ytVideoId || !e.ytTitle) continue;
    const key = squeeze(e.fa) || squeeze(e.en);
    const prev = bySqueeze.get(key);
    if (prev) {
      if (!usedVideo.has(e.ytVideoId) && (!prev.description && e.description)) bySqueeze.set(key, e);
      continue;
    }
    if (usedVideo.has(e.ytVideoId)) continue;
    bySqueeze.set(key, e);
    usedVideo.add(e.ytVideoId);
  }
  // نمای aliasKey تحقیق
  const researchByAlias = new Map<string, ResearchEntry>();
  for (const [key, e] of bySqueeze) {
    const ak = aliasKey(e.name);
    if (!researchByAlias.has(ak)) researchByAlias.set(ak, e);
  }
  console.log(`📚 تحقیق پس از dedupe: ${bySqueeze.size} حرکت`);

  /* ─── بانک فعلی + گارد ارجاع برنامه‌ها ─── */
  let bank = (await db.exerciseLibrary.findMany()) as unknown as ExRow[];
  const plans = await db.workoutPlan.findMany({ select: { content: true } });
  const planText = plans.map((p) => JSON.stringify(p.content)).join(" ");
  const protectedCache = new Set<string>();
  const isProtected = (name: string) => {
    if (protectedCache.has(name)) return true;
    const bare = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const hit = !!planText && (planText.includes(bare) || planText.includes(name));
    if (hit) protectedCache.add(name);
    return hit;
  };
  const byName = new Map<string, ExRow>();
  const byAlias = new Map<string, ExRow>();
  const rebuildIndex = () => {
    byName.clear();
    byAlias.clear();
    for (const b of bank) {
      byName.set(squeeze(b.name), b);
      const ak = aliasKey(b.name);
      if (!byAlias.has(ak)) byAlias.set(ak, b);
    }
  };
  rebuildIndex();

  /* ─── ۰) CONSOLIDATE (explicit) ─── */
  for (const group of CONSOLIDATE) {
    if (group.delete.length === 0) continue;
    const keepRow = byName.get(squeeze(group.keep));
    if (!keepRow) continue;
    for (const d of group.delete) {
      const delRow = byName.get(squeeze(d));
      if (!delRow || delRow.id === keepRow.id) continue;
      // قانون حفاظت: قدیمیِ ویدیودار/ارجاع‌دار حفظ می‌شود
      const oldPrefersKeep = (delRow.videoUrl && delRow.videoUrl.trim()) || isProtected(delRow.name);
      const [kept, gone] = oldPrefersKeep ? [delRow, keepRow] : [keepRow, delRow];
      if (APPLY) {
        if (oldPrefersKeep) {
          // ویدیوی تأییدشده را روی ردیفِ حفظ‌شده می‌گذاریم (یوتیوب fallback)
          const rich = byName.get(squeeze(group.keep));
          const vid = rich && rich.id !== kept.id ? rich.youtubeUrl : kept.youtubeUrl;
          if (vid && !kept.videoUrl?.trim()) await db.exerciseLibrary.update({ where: { id: kept.id }, data: { youtubeUrl: vid } });
        }
        await db.exerciseLibrary.delete({ where: { id: gone.id } });
      }
      bank = bank.filter((b) => b.id !== gone.id);
      rebuildIndex();
      report.consolidated.push({ kept: kept.name, deleted: [gone.name] });
      console.log(`🔀 ادغام: حذف «${gone.name}» → ماند «${kept.name}»`);
    }
  }

  /* ─── ۰ب) CONSOLIDATE (auto-net: هم‌ارز توکنی) ─── */
  {
    const seen = new Map<string, ExRow>();
    for (const b of [...bank]) {
      const ak = aliasKey(b.name);
      const prev = seen.get(ak);
      if (prev && prev.id !== b.id) {
        const oldPrefersKeep = (b.videoUrl && b.videoUrl.trim()) || isProtected(b.name);
        const [kept, gone] = oldPrefersKeep ? [b, prev] : [prev, b];
        if (APPLY) await db.exerciseLibrary.delete({ where: { id: gone.id } });
        bank = bank.filter((x) => x.id !== gone.id);
        seen.set(ak, kept);
        rebuildIndex();
        report.consolidated.push({ kept: kept.name, deleted: [gone.name] });
        console.log(`🔀 ادغام خودکار: حذف «${gone.name}» → ماند «${kept.name}»`);
      } else {
        seen.set(ak, b);
      }
    }
  }

  /* ─── ۲) DELETE-JUNK ─── */
  for (const ex of [...bank]) {
    const junkExact = DELETE_EXACT.some((d) => squeeze(d) === squeeze(ex.name));
    const junkPattern = !junkExact && DELETE_PATTERNS.some((r) => r.test(ex.name));
    if (!junkExact && !junkPattern) continue;
    if (isProtected(ex.name)) {
      report.deleteProtected.push(ex.name);
      console.log(`🛡 حفاظت‌شده (در برنامهٔ کاربر): ${ex.name}`);
      continue;
    }
    if (APPLY) await db.exerciseLibrary.delete({ where: { id: ex.id } });
    bank = bank.filter((b) => b.id !== ex.id);
    rebuildIndex();
    report.deleted.push(ex.name);
    console.log(`🗑 حذف: ${ex.name}`);
  }

  /* ─── ۱) FIX-VIDEO + ۳) ADD-NEW ─── */
  rebuildIndex();
  for (const [key, e] of bySqueeze) {
    const byExact = byName.get(key);
    const bySyn = byExact ? undefined : byAlias.get(aliasKey(e.name));
    const aliasTarget = ALIAS_EXTRA.find(([r]) => squeeze(r) === key || aliasKey(r) === aliasKey(e.name));
    const existing = byExact ?? bySyn ?? (aliasTarget ? byName.get(squeeze(aliasTarget[1])) : undefined);
    if (existing) {
      // بازنویسی ویدیو فقط با تطبیق دقیق/مترادفِ درون‌زبان — تطبیق ALIAS_EXTRA فقط
      // جلوی داپلیکیت را می‌گیرد (وگرنه جفت‌های مترادف ویدیوی هم را دستکاری می‌کنند)
      if (byExact || bySyn) {
        const overrideVid = VIDEO_OVERRIDE[e.name] || VIDEO_OVERRIDE[existing.name];
        const wantVid = overrideVid || e.ytVideoId;
        const currentVid = videoIdOf(existing.youtubeUrl);
        if (currentVid && currentVid !== wantVid && !(existing.videoUrl && existing.videoUrl.trim())) {
          if (APPLY) await db.exerciseLibrary.update({ where: { id: existing.id }, data: { youtubeUrl: `https://www.youtube.com/embed/${wantVid}` } });
          report.fixedVideos.push(existing.name);
        }
      }
      continue;
    }
    if (!e.ytVideoId || !e.ytTitle) {
      report.unverifiedVideoSkipped.push(e.name);
      continue;
    }
    const finalVid = VIDEO_OVERRIDE[e.name] || e.ytVideoId;
    if (APPLY) {
      const created = await db.exerciseLibrary.create({
        data: {
          name: e.name,
          muscle: e.muscle || "",
          category: e.category || "fullbody",
          equipment: e.equipment || "",
          description: e.description || "",
          tips: e.tips || "",
          youtubeUrl: `https://www.youtube.com/embed/${finalVid}`,
          youtubeEnabled: true,
          difficulty: e.difficulty || "intermediate",
        },
      });
      bank.push(created as unknown as ExRow);
      rebuildIndex();
    }
    report.added.push(e.name);
  }

  /* ─── خلاصه ─── */
  const finalCount = APPLY ? await db.exerciseLibrary.count() : bank.length;
  console.log("\n─────── خلاصه v135 ───────");
  console.log(`• ادغام هم‌معنی: ${report.consolidated.length}`);
  console.log(`• ویدیو ترمیم‌شده: ${report.fixedVideos.length}`);
  console.log(`• حذف‌شده (الکی): ${report.deleted.length} (حفاظت‌شده: ${report.deleteProtected.length})`);
  console.log(`• افزوده‌شده: ${report.added.length}`);
  console.log(`• تعداد نهایی بانک: ${finalCount}`);
  writeFileSync(join(RESEARCH_DIR, "merge-report.json"), JSON.stringify(report, null, 2));
  if (!APPLY) console.log("\nℹ DRY-RUN — برای اعمال: bun scripts/build-exercise-bank-v135.ts --apply");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
