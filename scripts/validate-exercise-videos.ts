/**
 * validate-exercise-videos.ts — گزارش سلامت ویدیوهای بانک حرکات
 *
 * «هیچ حرکتی بدون ویدیوی آموزشی» — گارد مالکیت داده (v28):
 *   ۱) حرکت بدون youtubeUrl خالی
 *   ۲) ID نامعتبر (یوتیوب همیشه ۱۱ کاراکتر [A-Za-z0-9_-] — ID کوتاه/بلند =
 *      ساختگی و قطعاً خراب؛ ریشهٔ باگ اصلی ۲۱۲ حرکت همین بود)
 *   ۳) ویدیوی اشتراکی مشکوک (یک ویدیو روی ≥۵ حرکتِ متفاوت)
 *   ۴) [--online] صحت‌سنجی زندهٔ oEmbed — فقط اگر سرور به یوتیوب دسترسی دارد
 *
 * اجرا:
 *   bun run scripts/validate-exercise-videos.ts             # آفلاین
 *   bun run scripts/validate-exercise-videos.ts --online    # + چک زندهٔ یوتیوب
 *
 * خروجی مشکوک = exit 1 (برای cron/CI قابل استفاده).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ONLINE = process.argv.includes("--online");
const VALID_ID = /^[\w-]{11}$/;

function idOf(url: string | null | undefined): string | null {
  const m = /embed\/([\w-]+)/.exec(url || "");
  return m ? m[1] : null;
}

async function oembedOk(id: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}&format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false };
  }
}

async function main() {
  const rows = await db.exerciseLibrary.findMany({
    select: { name: true, category: true, muscle: true, youtubeUrl: true },
    orderBy: [{ category: "asc" }, { muscle: "asc" }, { name: "asc" }],
  });

  const missing = rows.filter((r) => !r.youtubeUrl || r.youtubeUrl.trim() === "");
  const malformed = rows.filter((r) => {
    if (!r.youtubeUrl || r.youtubeUrl.trim() === "") return false;
    const id = idOf(r.youtubeUrl);
    return !id || !VALID_ID.test(id);
  });

  const byId = new Map<string, string[]>();
  for (const r of rows) {
    const id = idOf(r.youtubeUrl);
    if (id) byId.set(id, [...(byId.get(id) ?? []), r.name]);
  }
  const heavyDups = [...byId.entries()].filter(([, names]) => names.length >= 5);

  console.log(`📊 سلامت ویدیوهای بانک حرکات — ${rows.length} حرکت`);
  console.log(`   بدون ویدیو: ${missing.length}`);
  console.log(`   ID نامعتبر (ساختگی): ${malformed.length}`);
  console.log(`   ویدیوی اشتراکی ≥۵ حرکت: ${heavyDups.length}`);
  console.log(`   ویدیوی یکتا: ${byId.size}`);

  if (missing.length) for (const m of missing) console.log("  ✗ بدون ویدیو:", m.name);
  if (malformed.length) for (const m of malformed) console.log("  ✗ ID نامعتبر:", m.name, "->", m.youtubeUrl);
  if (heavyDups.length)
    for (const [id, names] of heavyDups)
      console.log(`  ⚠ اشتراکی ${names.length}× ${id}: ${names.slice(0, 4).join("، ")}${names.length > 4 ? " …" : ""}`);

  if (ONLINE) {
    console.log("\n🌐 صحت‌سنجی زندهٔ oEmbed…");
    let dead = 0;
    for (const [id, names] of byId) {
      const r = await oembedOk(id);
      if (!r.ok) { dead++; console.log(`  ✗ مرده (${r.status ?? "network"}): ${id} — ${names[0]}${names.length > 1 ? ` (+${names.length - 1})` : ""}`); }
      await new Promise((s) => setTimeout(s, 200));
    }
    console.log(`   مرده: ${dead} از ${byId.size}`);
    if (dead > 0) {
      console.log("\n💡 برای تعمیر: ویدیوی جایگزین پیدا کن و scripts/exercise-video-fixes.json را تکمیل/به‌روز کن، سپس:");
      console.log("   bun run scripts/fix-exercise-videos.ts --apply");
    }
  }

  const problems = missing.length + malformed.length;
  console.log(problems === 0 ? "\n✅ همهٔ حرکات ویدیوی معتبر ساختاری دارند" : "\n❌ مشکلات بالا باید فیکس شوند");
  await db.$disconnect();
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
