import { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/fitness/cron-auth";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  DISCIPLINE_EXERCISES,
  REMOVED_KICKBOXING_SEED_IDS,
} from "@/lib/fitness/seed-exercises-disciplines";
import { EXTRA_EXERCISES } from "@/lib/fitness/seed-exercises-extra-data";
import { isJunkExerciseName } from "@/lib/fitness/exercise-bank-junk";

/**
 * GET /api/cron/db-selfheal?secret=CRON_SECRET
 *
 * ─── خودترمیمی ستون‌های گم‌شده دیتابیس (DB schema drift guard) ───
 *
 * ریشه‌ی باگ: وقتی کد جدید (با فیلد تازه در Prisma schema) روی سرور
 * دیپلوی می‌شود ولی `bun run db:push` اجرا نشود، کلاینت Prisma در
 * «هر» findUnique/select فیلد جدید را هم کوئری می‌کند → P2022
 * (The column ... does not exist) → کل جریان لاگین می‌شکند.
 * (اتفاق واقعی: ستون User.lastActiveAt در v9 اضافه شد و لاگین
 * سرور پروداکشن بدون db:push قطع شد.)
 *
 * FIX ریشه‌ای: این route در boot (و هر ۶ ساعت) توسط instrumentation
 * صدا زده می‌شود؛ ستون‌های مورد انتظارِ نسخه‌ی فعلی کد را با PRAGMA
 * table_info چک می‌کند و هر ستونِ گم‌شده را با ALTER TABLE ADD COLUMN
 * اضافه می‌کند (nullable، بدون دست زدن به داده‌های موجود — ایمن).
 *
 * - Idempotent: اجرای مکرر بی‌اثر است.
 * - Fail-secure: بدون CRON_SECRET درست → 401.
 * - فهرست EXPECTED_COLUMNS باید با هر فیلد جدیدِ Prisma همگام شود
 *   (فقط فیلدهایی که بعد از آخرین دیپلوی پروداکشن اضافه شده‌اند).
 *
 * گام ۳ (v95): پاک‌سازی idempotent حرکات کیک‌بوکسینگ حذف‌شده.
 * گام ۴ (v96): درج idempotent حرکات رشته‌های ترند (بانک حرکات) — فیکس
 *   «حرکات به بانک حرکات اضافه نشده»: بچ v94 فقط دستی seed می‌شد و روی
 *   پروداکشن اجرا نشده بود؛ حالا با بوت سرور خودکار اضافه می‌شود.
 */

// [table, column, sqliteType] — فیلدهای افزودنی نسخه‌های جدید کد
const EXPECTED_COLUMNS: Array<{ table: string; column: string; sqliteType: string }> = [
  // v9: ردیابی فعالیت برای ریشه‌ی نوتیف «چند روزی نیستی»
  { table: "User", column: "lastActiveAt", sqliteType: "DATETIME" },
  // v38: قابلیت اطمینان تولید برنامه — خطای واقعی + شمارش تلاش‌ها
  { table: "ProgramRequest", column: "lastError", sqliteType: "TEXT" },
  { table: "ProgramRequest", column: "attempts", sqliteType: "INTEGER" },
  { table: "ProgramRequest", column: "lastAttemptAt", sqliteType: "DATETIME" },
  // v135 — کلید فعال/غیرفعال بانک حرکات (میرور Prisma Boolean → BOOLEAN DEFAULT 1)
  { table: "ExerciseLibrary", column: "isActive", sqliteType: "BOOLEAN DEFAULT 1" },
];

// جداول جدید که باید روی پروداکشن هم (بدون db:push) ساخته شوند — idempotent.
// DDL باید دقیقاً آینه‌ی Prisma schema باشد (همان نام ستون‌ها/ایندکس‌ها).
const EXPECTED_TABLES: Array<{ table: string; ddl: string; indexDdl: string }> = [
  // v15+: توضیحات مدیر — تاریخچه یادداشت‌های ادمین برای هر کاربر
  {
    table: "UserAdminNote",
    ddl: `CREATE TABLE IF NOT EXISTS "UserAdminNote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authorMobile" TEXT,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
)`,
    indexDdl: `CREATE INDEX IF NOT EXISTS "UserAdminNote_userId_createdAt_idx" ON "UserAdminNote"("userId", "createdAt")`,
  },
];

export async function GET(req: NextRequest) {
  const rl = rateLimit(`cron-db-selfheal:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const url = new URL(req.url);

  // 🔒 ممیزی امنیتی F5 — fail-secure: فقط راز رسمی یا توکن درون‌پردازه‌ای بوت.
  // (الگوی قبلی «نبودن هدر پروکسی = محلی = مجاز» fail-open بود.)
  if (!isAuthorizedCronRequest(req, new URL(req.url))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const added: string[] = [];
  const alreadyOk: string[] = [];
  const errors: string[] = [];
  const tablesCreated: string[] = [];
  const removedRows: string[] = [];
  const exercisesSeeded: number[] = [];

  // --- گام ۱: ستون‌های گم‌شده (ALTER TABLE ADD COLUMN) ---
  for (const { table, column, sqliteType } of EXPECTED_COLUMNS) {
    try {
      // چک وجود ستون (PRAGMA table_info — اسم جدول/ستون هاردکدِ امن)
      const rows = (await db.$queryRawUnsafe(
        `PRAGMA table_info("${table}")`
      )) as Array<{ name: string }>;
      const exists = rows.some((r) => r.name === column);
      if (exists) {
        alreadyOk.push(`${table}.${column}`);
        continue;
      }
      // جدول وجود ندارد؟ (DB تازه) — prisma db push وظیفه‌ی ساختش است؛ رد شو
      if (rows.length === 0) {
        errors.push(`table "${table}" not found — run bun run db:push`);
        continue;
      }
      // افزودن ستون گم‌شده — nullable پس بی‌خطر برای ردیف‌های موجود
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${sqliteType}`
      );
      added.push(`${table}.${column}`);
      console.log(
        `[db-selfheal] ✅ ستون گم‌شده اضافه شد: ${table}.${column} (${sqliteType})`
      );
    } catch (e) {
      errors.push(`${table}.${column}: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
      console.error(`[db-selfheal] ❌ خطا روی ${table}.${column}:`, e);
    }
  }

  // --- گام ۲: جداول جدید (CREATE TABLE IF NOT EXISTS) ---
  // تاریخچه سرور پروداکشن: جدول‌های جدید بعد از دیپلوی ساخته نمی‌شدند (db:push
  // فراموش می‌شد). این بخش بعد از حلقه‌ی ستون‌ها اجرا می‌شود و جدول + ایندکس را
  // idempotent می‌سازد — اگر از قبل موجود باشد هیچ دستی به داده‌ها نمی‌زند.
  for (const { table, ddl, indexDdl } of EXPECTED_TABLES) {
    try {
      const existed = (await db.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      )) as Array<{ name: string }>;
      const wasMissing = existed.length === 0;

      await db.$executeRawUnsafe(ddl);
      await db.$executeRawUnsafe(indexDdl);

      if (wasMissing) {
        tablesCreated.push(table);
        console.log(`[db-selfheal] ✅ جدول گم‌شده ساخته شد: ${table}`);
      }
    } catch (e) {
      errors.push(`${table}: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
      console.error(`[db-selfheal] ❌ خطا روی جدول ${table}:`, e);
    }
  }

  // --- گام ۲.۵ (ممیزی 1-f#6): قید «یک اشتراک فعال به‌ازای هر کاربر» ---
  // قاعدهٔ business تا حالا فقط با کد تضمین می‌شد (expiry/cancel قبلی‌ها هنگام
  // خرید جدید). Prisma ایندکس partial (WHERE status='active') ندارد؛ با DDL خام
  // idempotent ساخته می‌شود — اگر از قبل موجود باشد هیچ دستی نمی‌زند و اگر
  // db:push روزی آن را حذف کند، اجرای بعدی همین route دوباره می‌سازد.
  // (ساخت ایندکس فقط وقتی شکست می‌خورد که از الان تخلف موجود باشد — DB زنده صفر.)
  try {
    const subIdxName = "Subscription_active_user_unique";
    const subIdxExists = (await db.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='${subIdxName}'`
    )) as Array<{ name: string }>;
    if (subIdxExists.length > 0) {
      alreadyOk.push(subIdxName);
    } else {
      await db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${subIdxName}" ON "Subscription"("userId") WHERE status = 'active'`
      );
      added.push(subIdxName);
      console.log(
        `[db-selfheal] ✅ ممیزی 1-f#6 — ایندکس یکتای «یک اشتراک فعال به‌ازای هر کاربر» ساخته شد: ${subIdxName}`
      );
    }
  } catch (e) {
    errors.push(`subscription-active-unique: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
    console.error("[db-selfheal] ❌ خطا در ساخت ایندکس یکتای اشتراک فعال:", e);
  }

  // --- گام ۳ (v95): پاک‌سازی رکورد‌های رشتهٔ حذف‌شده — دیرکتیو مالک: «ما فقط در
  // زمینهٔ ورزشهای تناسب اندام کار میکنیم» → کیک‌بوکسینگ (ورزش رزمی) از کل سیستم
  // حذف شد؛ ۱۰ حرکت seed_dx_31..40 آن از کتابخانهٔ DBهای موجود هم idempotent پاک
  // می‌شود (اگر از قبل نباشند، بی‌اثر است).
  try {
    const del = await db.exerciseLibrary.deleteMany({
      where: { id: { in: REMOVED_KICKBOXING_SEED_IDS } },
    });
    if (del.count > 0) {
      removedRows.push(`ExerciseLibrary(kickboxing)=${del.count}`);
      console.log(`[db-selfheal] ✅ v95 — ${del.count} حرکت کیک‌بوکسینگ حذف شد (رشتهٔ رزمی از سیستم خارج شد)`);
    }
  } catch (e) {
    errors.push(`v95-kickboxing-cleanup: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
    console.error("[db-selfheal] ❌ خطا در پاک‌سازی کیک‌بوکسینگ:", e);
  }

  // --- گام ۳ب (v135): پاک‌سازی idempotent حرکات الکی/تکراری بانک — دیرکتیو مالک:
  // «حرکات الکی مثل بامکس برداشته شود؛ حرکات اصلی و اصولی بماند». لیست سیاه در
  // src/lib/fitness/exercise-bank-junk.ts — تطبیق دقیق + الگو؛ حرکتی که در
  // برنامهٔ کاربران ارجاع دارد حذف نمی‌شود (گارد لینک‌شکسته).
  try {
    const plans = await db.workoutPlan.findMany({ select: { content: true } });
    const planText = plans.map((p) => JSON.stringify(p.content)).join(" ");
    const allEx = await db.exerciseLibrary.findMany({ select: { id: true, name: true, videoUrl: true } });
    const junkIds = allEx
      .filter(
        (e) =>
          isJunkExerciseName(e.name) &&
          !(e.videoUrl && e.videoUrl.trim()) && // حرکتِ ویدیوی اختصاصیِ ساختهٔ مالک هرگز حذف نمی‌شود
          !(planText && planText.includes(e.name.replace(/\s*\([^)]*\)\s*$/, "").trim()))
      )
      .map((e) => e.id);
    if (junkIds.length > 0) {
      const del = await db.exerciseLibrary.deleteMany({ where: { id: { in: junkIds } } });
      removedRows.push(`ExerciseLibrary(junk)=${del.count}`);
      console.log(`[db-selfheal] ✅ v135 — ${del.count} حرکت الکی/تکراری از بانک حذف شد (لیست سیاه)`);
    }
  } catch (e) {
    errors.push(`v135-junk-cleanup: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
    console.error("[db-selfheal] ❌ خطا در پاک‌سازی حرکات الکی:", e);
  }

  // --- گام ۴ (v96): درج خودکار حرکات رشته‌های ترند در کتابخانهٔ DBهای موجود —
  // ریشهٔ گزارش مالک: «حرکات به بانک حرکات من اضافه نشده و عددش در صفحه اصلی
  // هم تغییر نکرده» — بچ ۵۰ حرکتهٔ v94 فقط با اسکریپت دستی وارد DB می‌شد و روی
  // پروداکشن هرگز اجرا نشده بود. حالا مثل خودترمیمی اسکیما، در بوت سرور (و هر
  // ۶ ساعت) idempotent درج می‌شود: فقط idهای غایب ساخته می‌شوند و هیچ ردیف
  // موجودی دست نمی‌خورد؛ اجرای مکرر بی‌اثر است.
  try {
    let seeded = 0;
    for (const ex of DISCIPLINE_EXERCISES) {
      // v135 — حرکات لیست سیاه (الکی/تکراری) هرگز دوباره seed نمی‌شوند
      if (isJunkExerciseName(ex.name)) continue;
      const exists = await db.exerciseLibrary.findUnique({
        where: { id: ex.id },
        select: { id: true },
      });
      if (exists) continue;
      await db.exerciseLibrary.create({
        data: {
          id: ex.id,
          name: ex.name,
          muscle: ex.muscle,
          category: ex.category,
          equipment: ex.equipment,
          description: ex.description,
          tips: ex.tips,
          mediaUrl: "",
          youtubeUrl: "",
          difficulty: ex.difficulty,
        },
      });
      seeded++;
    }
    if (seeded > 0) {
      exercisesSeeded.push(seeded);
      console.log(
        `[db-selfheal] ✅ v96 — ${seeded} حرکت رشته‌های ترند (پیلاتس/TRX/هییت/فانکشنال/بالنس) به بانک حرکات اضافه شد`
      );
    }
  } catch (e) {
    errors.push(`v96-discipline-exercises: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
    console.error("[db-selfheal] ❌ خطا در درج حرکات رشته‌های ترند:", e);
  }

  // --- گام ۵ (v130): بهداشت لینک‌های داخلی مقالات — دیرکتیو مالک: «هیچ لینک
  // شکسته‌ای نباید وجود داشته باشد». گزارش واقعی brokenlinkcheck پروداکشن:
  // ۹ لینک /exercise/seed_ex_* که اسکریپت seed آن‌ها فقط در سندباکس اجرا شده
  // بود + ۲ لینک به اسلاگ قدیمی مقاله (free-bodybuilding-apps-2026).
  // این گام idempotent در بوت و هر ۶ ساعت:
  //  ① حرکتِ لینک‌شده در مقاله ولی غایب در DB — اگر در کاتالوگ seed باشد → درج
  //  ② لینک‌های legacy (?article=/?exercise=/?food=) به فرم مسیر واقعی بازنویسی
  //     می‌شوند (هم‌تراز با تولید مقالات جدید در seo-agent)
  //  ③ لینک مقاله به اسلاگِ تغییرنام‌کرده → با نگاشت شناخته‌شده اصلاح
  //  ④ هر لینک داخلی دیگری به محتوای غایب → لینک حذف ولی متن لنگر می‌ماند
  //     (هیچ‌وقت ۴۰۴ نمی‌شود؛ صفحات هم به‌عنوان تور ایمن 308 به آرشیو می‌دهند)
  const linkHygiene: Record<string, unknown> = {};
  try {
    const RENAMED_ARTICLE_SLUGS: Record<string, string> = {
      "free-bodybuilding-apps-2026": "free-bodybuilding-apps-2024",
    };
    // فقط لینک‌های مارک‌داون با هدف نسبی داخلی — خارجی (https://) دست نمی‌خورد
    const MD_LINK = /\[([^\]]*)\]\((\/(?:[^)\s])*)\)/g;

    // همهٔ مقالات (منتشرشده + draft) اسکن می‌شوند — draft امروز ممکن است فردا
    // منتشر شود؛ لینک‌هایش باید همین حالا سالم شوند (liveSlugs فقط منتشرشده‌هاست)
    const published = await db.article.findMany({
      select: { id: true, slug: true, content: true },
    });
    const liveSlugs = new Set(
      (
        await db.article.findMany({
          where: { status: "published" },
          select: { slug: true },
        })
      ).map((a) => a.slug)
    );
    const exerciseIds = new Set(
      (
        await db.exerciseLibrary.findMany({ select: { id: true } })
      ).map((e) => e.id)
    );
    const foodIds = new Set(
      (await db.foodLibrary.findMany({ select: { id: true } })).map((f) => f.id)
    );
    const seedById = new Map(EXTRA_EXERCISES.map((e) => [e.id, e]));

    let articlesFixed = 0;
    let exercisesCreated = 0;
    let linksRewritten = 0;
    let linksUnlinked = 0;

    // معماری سه‌پاسی (replace callback نمی‌تواند async باشد):
    //  پاس ۱ — همهٔ هدف‌های داخلی یکتا را جمع کن
    //  پاس ۲ — برای هر هدف «یک» تصمیم بگیر (درج حرکت غایب اینجا با await مجاز است)
    //  پاس ۳ — محتوای هر مقاله را به‌صورت سنکرون بازنویسی کن
    type Decision = { action: "keep" } | { action: "rewrite"; to: string } | { action: "unlink" };
    const SLUG_KEY = /^[a-zA-Z0-9_-]+$/;
    const classify = (
      target: string
    ): { kind: "article" | "exercise" | "food"; key: string; valid: boolean } | null => {
      let m = target.match(/^\/?\?article=(.*)$/);
      if (m) return { kind: "article", key: m[1], valid: SLUG_KEY.test(m[1]) };
      m = target.match(/^\/article\/([^\/?#]*)\/?$/);
      if (m) return { kind: "article", key: m[1], valid: SLUG_KEY.test(m[1]) };
      m = target.match(/^\/?\?exercise=([^)&]*)$/);
      if (m) return { kind: "exercise", key: m[1], valid: SLUG_KEY.test(m[1]) };
      m = target.match(/^\/exercise\/([^\/?#]*)\/?$/);
      if (m) return { kind: "exercise", key: m[1], valid: SLUG_KEY.test(m[1]) };
      m = target.match(/^\/?\?food=([^)&]*)$/);
      if (m) return { kind: "food", key: m[1], valid: SLUG_KEY.test(m[1]) };
      m = target.match(/^\/food\/([^\/?#]*)\/?$/);
      if (m) return { kind: "food", key: m[1], valid: SLUG_KEY.test(m[1]) };
      return null;
    };

    const uniqueTargets = new Set<string>();
    for (const a of published) {
      for (const mm of a.content?.matchAll(MD_LINK) ?? []) {
        let t = mm[2];
        try {
          t = decodeURIComponent(mm[2]);
        } catch {}
        if (classify(t)) uniqueTargets.add(t);
      }
    }

    const decisions = new Map<string, Decision>();
    for (const target of uniqueTargets) {
      const c = classify(target);
      if (!c) continue; // unreachable
      // هدف داخلی ولی نامعتبر (اسلاگ خالی مثل ?article=/ — آرتیفکت تولید) → حذف لینک
      if (!c.valid) {
        decisions.set(target, { action: "unlink" });
        continue;
      }
      const modern =
        c.kind === "article"
          ? `/article/${c.key}`
          : c.kind === "exercise"
            ? `/exercise/${c.key}`
            : `/food/${c.key}`;

      if (c.kind === "article") {
        if (liveSlugs.has(c.key)) {
          decisions.set(target, modern === target ? { action: "keep" } : { action: "rewrite", to: modern });
          continue;
        }
        const mapped = RENAMED_ARTICLE_SLUGS[c.key];
        if (mapped && liveSlugs.has(mapped)) {
          decisions.set(target, { action: "rewrite", to: `/article/${mapped}` });
          continue;
        }
        decisions.set(target, { action: "unlink" }); // محتوای غایب بدون نگاشت
        continue;
      }

      if (c.kind === "exercise") {
        if (exerciseIds.has(c.key)) {
          decisions.set(target, modern === target ? { action: "keep" } : { action: "rewrite", to: modern });
          continue;
        }
        const seed = seedById.get(c.key);
        if (seed) {
          // v135 — حرکات لیست سیاه هرگز برای لینک مقاله دوباره ساخته نمی‌شوند
          if (isJunkExerciseName(seed.name)) {
            decisions.set(target, { action: "unlink" });
            continue;
          }
          await db.exerciseLibrary.create({
            data: {
              id: seed.id,
              name: seed.name,
              muscle: seed.muscle,
              category: seed.category,
              equipment: seed.equipment,
              description: seed.description,
              tips: seed.tips,
              mediaUrl: "",
              youtubeUrl: seed.youtubeUrl,
              difficulty: seed.difficulty,
            },
          });
          exerciseIds.add(c.key);
          exercisesCreated++;
          decisions.set(target, { action: "rewrite", to: modern });
          continue;
        }
        decisions.set(target, { action: "unlink" }); // خارج از کاتالوگ
        continue;
      }

      // food
      if (foodIds.has(c.key)) {
        decisions.set(target, modern === target ? { action: "keep" } : { action: "rewrite", to: modern });
      } else {
        decisions.set(target, { action: "unlink" });
      }
    }

    for (const a of published) {
      const content = a.content ?? "";
      if (!content || uniqueTargets.size === 0) continue;
      let touched = false;
      const next = content.replace(
        MD_LINK,
        (full: string, text: string, rawTarget: string): string => {
          let target = rawTarget;
          try {
            target = decodeURIComponent(rawTarget);
          } catch {}
          const d = decisions.get(target);
          if (!d || d.action === "keep") return full; // سالم یا بیرون از scope — دست نمی‌خورد
          if (d.action === "rewrite") {
            touched = true;
            linksRewritten++;
            return `[${text}](${d.to})`;
          }
          touched = true;
          linksUnlinked++;
          return text; // لینک حذف، متن لنگر می‌ماند
        }
      );
      if (touched && next !== content) {
        await db.article.update({ where: { id: a.id }, data: { content: next } });
        articlesFixed++;
      }
    }

    linkHygiene.articlesScanned = published.length;
    linkHygiene.articlesFixed = articlesFixed;
    linkHygiene.exercisesCreated = exercisesCreated;
    linkHygiene.linksRewritten = linksRewritten;
    linkHygiene.linksUnlinked = linksUnlinked;
    if (articlesFixed > 0 || exercisesCreated > 0) {
      console.log(
        `[db-selfheal] ✅ v130 بهداشت لینک‌ها — ${articlesFixed} مقاله اصلاح شد، ${exercisesCreated} حرکت ساخته شد، ${linksRewritten} لینک بازنویسی، ${linksUnlinked} لینک حذف`
      );
    }
  } catch (e) {
    errors.push(`v130-link-hygiene: ${(e as Error).message?.slice(0, 200) ?? "unknown"}`);
    console.error("[db-selfheal] ❌ خطا در بهداشت لینک‌های مقالات:", e);
  }

  return Response.json({
    ok: errors.length === 0,
    checked: EXPECTED_COLUMNS.length,
    added,
    alreadyOk,
    tablesCreated,
    created: tablesCreated.length > 0,
    removedRows,
    exercisesSeeded,
    linkHygiene,
    errors,
    runAt: new Date().toISOString(),
  });
}
