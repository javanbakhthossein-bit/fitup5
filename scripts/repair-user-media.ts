/**
 * repair-user-media.ts — ترمیم رسانه‌های گم‌شده کاربران (v15)
 *
 * ─── چرا این اسکریپت وجود دارد؟ ───
 * باگ گزارش‌شده مالک: «در گالری پیشرفت، عکس‌های آپلودشده کاربر به‌صورت عکس
 * شکسته نمایش داده می‌شوند — همین مشکل در پرونده ورزشی هم هست.»
 *
 * ریشه: رکوردهای دیتابیس (ProgressPhoto/AnalysisResult/ChatMessage/FoodLog)
 * به فایل‌هایی در `uploads/` اشاره می‌کنند که یا:
 *   ۱) هنوز در `public/uploads/` قدیمی مانده‌اند (مهاجرت اجرا نشده)، یا
 *   ۲) در دیپلوی‌های قبلی با `rm -rf public` حذف شده‌اند ولی در پشتیبان
 *      (`backups/uploads_full_backup` یا `backups/uploads_backup`) موجودند.
 *
 * این اسکریپت (در deploy.sh بعد از مهاجرت اجرا می‌شود):
 *   - همه‌ی URLهای رسانه‌ی DB را جمع می‌کند
 *   - اگر فایل در uploads/ نیست: از public/uploads/ یا backupها بازیابی می‌کند
 *   - گزارش کامل چاپ می‌کند (چند فایل سالم/ترمیم‌شده/گم‌شده)
 *   - هیچ رکوردی را حذف نمی‌کند — فقط فایل‌ها را ترمیم می‌کند
 *
 * اجرا: bun run scripts/repair-user-media.ts
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, copyFileSync, statSync } from "fs";
import path from "path";

const db = new PrismaClient();

/** مسیرهای جستجوی فایل (به ترتیب اولویت) */
function searchRoots(): string[] {
  const cwd = process.cwd();
  const roots = [path.join(cwd, "uploads")];
  // مکان‌های پشتیبان (deploy.sh) — فقط اگر موجود باشند
  for (const b of [
    path.join(cwd, "backups", "uploads_full_backup"),
    path.join(cwd, "backups", "uploads_backup"),
  ]) {
    if (existsSync(b)) roots.push(b);
  }
  // مسیر legacy
  roots.push(path.join(cwd, "public", "uploads"));
  return roots;
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** از یک URL رسانه، مسیر نسبی داخل uploads را استخراج کن */
function relFromUrl(url: string): string | null {
  if (!url) return null;
  const clean = url.split("?")[0].replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
  if (!clean.startsWith("uploads/")) return null;
  const rel = clean.slice("uploads/".length);
  if (!rel || rel.includes("..")) return null;
  return rel;
}

async function main() {
  const uploadsRoot = path.join(process.cwd(), "uploads");
  const roots = searchRoots();
  console.log("[repair-media] 🔧 ترمیم رسانه‌های کاربران — ریشه‌های جستجو:");
  roots.forEach((r) => console.log(`   • ${r}${existsSync(r) ? "" : " (نبود)"}`));

  // ─── جمع‌آوری همه‌ی رفرنس‌های رسانه از دیتابیس ───
  const refs: { table: string; id: string; url: string }[] = [];
  const [photos, analyses, chats, foods] = await Promise.all([
    db.progressPhoto.findMany({ select: { id: true, imageUrl: true } }),
    db.analysisResult.findMany({ where: { mediaUrl: { not: null } }, select: { id: true, mediaUrl: true } }),
    db.chatMessage.findMany({ where: { mediaUrl: { not: null } }, select: { id: true, mediaUrl: true } }),
    db.foodLog.findMany({ where: { imageUrl: { not: null } }, select: { id: true, imageUrl: true } }),
  ]);
  for (const p of photos) refs.push({ table: "ProgressPhoto", id: p.id, url: p.imageUrl });
  for (const a of analyses) refs.push({ table: `AnalysisResult(${(a as any).type ?? "?"})`, id: a.id, url: a.mediaUrl! });
  for (const c of chats) refs.push({ table: "ChatMessage", id: c.id, url: c.mediaUrl! });
  for (const f of foods) refs.push({ table: "FoodLog", id: f.id, url: f.imageUrl! });

  console.log(`[repair-media] ${refs.length} رفرنس رسانه در DB پیدا شد`);

  let ok = 0;
  let repaired = 0;
  const missing: { table: string; id: string; url: string }[] = [];

  for (const ref of refs) {
    const rel = relFromUrl(ref.url);
    if (!rel) {
      // URL خارجی (مثلاً OSS) — کاری با آن نداریم
      if (/^https?:\/\//i.test(ref.url)) {
        ok++;
        continue;
      }
      missing.push(ref);
      continue;
    }
    const target = path.join(uploadsRoot, rel);
    if (isFile(target)) {
      ok++;
      continue;
    }
    // در uploads نیست — از ریشه‌های دیگر بازیابی کن
    let foundIn: string | null = null;
    for (const root of roots.slice(1)) {
      const candidate = path.join(root, rel);
      if (isFile(candidate)) {
        foundIn = candidate;
        break;
      }
    }
    if (foundIn) {
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(foundIn, target);
        repaired++;
        console.log(`  ↩︎ ترمیم شد: ${rel} (از ${path.relative(process.cwd(), foundIn)})`);
      } catch (err) {
        console.error(`  ✗ کپی ناموفق: ${rel}`, err);
        missing.push(ref);
      }
    } else {
      missing.push(ref);
    }
  }

  console.log("──────────────────────────────────────");
  console.log(
    `[repair-media] نتیجه: سالم=${ok}، ترمیم‌شده=${repaired}، گم‌شده=${missing.length} (از ${refs.length})`
  );
  if (missing.length > 0) {
    console.log(`[repair-media] ⚠️ فایل‌های گم‌شده (رکورد DB مانده، فایل دیسک نه — در UI placeholder نشان داده می‌شود):`);
    for (const m of missing.slice(0, 30)) {
      console.log(`   • ${m.table} ${m.id} → ${m.url}`);
    }
    if (missing.length > 30) console.log(`   … و ${missing.length - 30} مورد دیگر`);
    console.log(
      `[repair-media] 💡 اگر فایل‌ها در پشتیبان دیگری (backups/) هستند، پوشه را کنار پروژه بگذارید و دوباره اجرا کنید.`
    );
  }
}

main()
  .catch((e) => {
    console.error("[repair-media] خطا:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
