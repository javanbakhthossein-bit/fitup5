import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/fitness/notifications";

/**
 * GET /api/cron/check-exercise-videos?secret=CRON_SECRET
 *
 * ─── گارد همیشگی «هیچ حرکتی بدون ویدیوی آموزشی» (v28 — درخواست مالک) ───
 *
 * زمینه: ۲۱۲ حرکت از ۲۶۰ حرکت، ویدیوی یوتیوب خراب (ID ساختگی ۴۰۴) داشتند و
 * مشتریان ناراضی بودند. با v28 همه تعمیر شدند (scripts/fix-exercise-videos.ts).
 * این cron هفتگی تضمین می‌کند اگر روزی ویدیویی توسط یوتیوب حذف شد یا کسی
 * ویدیوی بدی ثبت کرد، «مدیر بلافاصله بداند» — دیگر هیچ‌وقت مشکلی پنهان نمی‌ماند.
 *
 * چک‌ها:
 *   ۱) حرکت بدون youtubeUrl خالی
 *   ۲) ID ساختگی/نامعتبر (یوتیوب همیشه ۱۱ کاراکتری است)
 *   ۳) [--آنلاین اگر دسترسی بود] ویدیوی حذف‌شده توسط یوتیوب (oEmbed 404)
 *      — oEmbed با timeout کوتاه؛ در سرورهایی که یوتیوب فیلتر است، این بخش
 *      خودکار skip می‌شود و چک‌های آفلاین همچنان انجام می‌شوند.
 *
 * اگر مشکلی پیدا شود → یک Notification برای همهٔ ادمین‌ها با فهرست حرکات.
 * ضد-اسپم: اگر در ۳ روز گذشته نوتیف مشابهی ساخته شده، دوباره نمی‌سازد.
 *
 * پیشنهاد زمان‌بندی: هفتگی (مثلاً شنبه‌ها ۰۶:۰۰) در پنل cron سرور:
 *   0 6 * * 6  curl -s "http://localhost:3000/api/cron/check-exercise-videos?secret=$CRON_SECRET"
 * (یا هر فاصله‌ای که مالک بخواهد — idempotent و ضد-اسپم است.)
 */
const VALID_ID = /^[\w-]{11}$/;

function idOf(url: string | null | undefined): string | null {
  const m = /embed\/([\w-]+)/.exec(url || "");
  return m ? m[1] : null;
}

async function oembedOk(id: string): Promise<boolean | null> {
  // null = دسترسی شبکه نبود (فیلتر/timeout) — چک زنده skip شود
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}&format=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    return r.ok;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret") || request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const problems: string[] = [];
  const missing: string[] = [];
  const malformed: string[] = [];
  const dead: string[] = [];

  const rows = await db.exerciseLibrary.findMany({
    select: { name: true, youtubeUrl: true },
    orderBy: { name: "asc" },
  });

  for (const r of rows) {
    if (!r.youtubeUrl || r.youtubeUrl.trim() === "") { missing.push(r.name); continue; }
    const id = idOf(r.youtubeUrl);
    if (!id || !VALID_ID.test(id)) { malformed.push(r.name); continue; }
  }

  // چک زندهٔ حذف‌شدگی — فقط اگر حداقل یک oEmbed جواب داد (وگرنه سرور فیلتر است)
  const uniqIds = [...new Set(rows.map((r) => idOf(r.youtubeUrl)).filter((v): v is string => !!v))];
  let onlineChecked = 0;
  for (const id of uniqIds) {
    const ok = await oembedOk(id);
    if (ok === null) { onlineChecked = 0; break; } // شبکه نیست — کل چک زنده را رها کن
    onlineChecked++;
    if (!ok) {
      const owners = rows.filter((r) => idOf(r.youtubeUrl) === id).map((r) => r.name);
      dead.push(...owners);
    }
    await new Promise((s) => setTimeout(s, 150));
  }

  problems.push(
    ...missing.map((n) => `«${n}» ویدیو ندارد`),
    ...malformed.map((n) => `«${n}» ویدیوی نامعتبر دارد`),
    ...dead.map((n) => `ویدیوی «${n}» توسط یوتیوب حذف/خصوصی شده`)
  );

  const result = {
    checkedAt: new Date().toISOString(),
    totalExercises: rows.length,
    missingCount: missing.length,
    malformedCount: malformed.length,
    deadCount: dead.length,
    onlineCheckedIds: onlineChecked,
    ok: problems.length === 0,
  };

  if (problems.length === 0) {
    return Response.json({ ...result, message: "همهٔ ویدیوها سالم ✓" });
  }

  // ─── ضد-اسپم: در ۳ روز گذشته نوتیف مشابه ساخته نشده باشد ───
  const admins = await db.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const recent = await db.notification.findFirst({
    where: {
      type: "system",
      title: { contains: "ویدیوی آموزشی" },
      createdAt: { gte: since },
    },
    select: { id: true },
  });

  let notified = false;
  if (!recent && admins.length > 0) {
    const preview = problems.slice(0, 8).join(" • ");
    for (const a of admins) {
      await createNotification(
        a.id,
        "system",
        `⚠ ${problems.length} مشکل در ویدیوی آموزشی حرکات`,
        `${preview}${problems.length > 8 ? ` • و ${problems.length - 8} مورد دیگر` : ""} — پنل مدیریت → بانک حرکات را چک کنید.`,
        "/?screen=admin-exercises",
        { videoCheck: true, missing: missing.length, malformed: malformed.length, dead: dead.length }
      );
    }
    notified = true;
  }

  return Response.json({ ...result, problems: problems.slice(0, 50), notified });
}
