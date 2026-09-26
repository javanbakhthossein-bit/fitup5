/**
 * ═══════════════════════════════════════════════════════════════
 *  v137 — سیدر بانک غذاها (سندباکس/هر DB) — idempotent
 *
 *  ① ۵۰۰ غذای پایهٔ seed.ts (استخراج از سورس — همان idهای seed_food_N)
 *  ② ۵۸۰ غذای تکمیلی seed-foods-extra.ts (استخراج از سورس)
 *  ③ ۵۰۰ غذای «جدید» فیتاپ (foods-v137-part1/2/3) — فقط نام‌هایی که
 *     با هیچ ردیف موجود (نرمال‌شده) تکراری نباشند، تا سقف ۵۰۰.
 *
 *  اجرا: bun scripts/seed-foods-v137.ts
 *  هیچ ردیف موجودی تغییر نمی‌دهد — فقط insert (یا update کامل همان id رسمی).
 * ═══════════════════════════════════════════════════════════════
 */
import { db } from "../src/lib/db";
import fs from "node:fs";
import path from "node:path";
import { FOODS_PART1 } from "./foods-v137-part1.mjs";
import { FOODS_PART2 } from "./foods-v137-part2.mjs";
import { FOODS_PART3 } from "./foods-v137-part3.mjs";

/** نرمال‌سازی نام فارسی برای تطبیق تکراری‌ها (ZWNJ/ي/ك/آ/ه/فاصله) */
function norm(s: string): string {
  return String(s || "")
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface FoodRow {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
  isVegan: boolean;
}

async function main() {
  const existing = await db.foodLibrary.findMany({ select: { id: true, name: true } });
  const namesByNorm = new Map<string, string>();
  for (const r of existing) namesByNorm.set(norm(r.name), r.id);
  console.log(`📦 موجود فعلی: ${existing.length} غذا`);

  let added = 0;
  let updated = 0;

  // ─── ① غذاهای پایهٔ seed.ts ───
  const seedSrc = fs.readFileSync(path.join(__dirname, "../src/lib/fitness/seed.ts"), "utf8");
  const foodSection = seedSrc.slice(seedSrc.indexOf("const foodTuples"));
  const baseTuples: FoodRow[] = [];
  for (const m of foodSection.matchAll(
    /\[\s*"([^"]+)",\s*"(breakfast|lunch|dinner|snack)"\s*,\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*"([^"]+)"\s*\]/g
  )) {
    baseTuples.push({
      id: `seed_food_${baseTuples.length + 1}`,
      name: m[1],
      category: m[2],
      calories: Number(m[3]),
      protein: Number(m[4]),
      carbs: Number(m[5]),
      fat: Number(m[6]),
      servingSize: m[7],
      isVegan: false,
    });
  }
  for (const f of baseTuples) {
    const n = norm(f.name);
    const existingId = namesByNorm.get(n);
    if (existingId) continue;
    await db.foodLibrary.upsert({
      where: { id: f.id },
      create: { ...f, imageUrl: "" },
      update: {
        name: f.name, category: f.category, calories: f.calories,
        protein: f.protein, carbs: f.carbs, fat: f.fat, servingSize: f.servingSize,
      },
    });
    namesByNorm.set(n, f.id);
    added++;
  }
  console.log(`① پایهٔ seed.ts: ${baseTuples.length} تا → ${added} جدید`);

  // ─── ② غذاهای تکمیلی seed-foods-extra.ts ───
  const extraSrc = fs.readFileSync(
    path.join(__dirname, "../src/lib/fitness/seed-foods-extra.ts"),
    "utf8"
  );
  const extraRows: FoodRow[] = [];
  for (const m of extraSrc.matchAll(
    /makeFood\(\s*"(seed_food_\d+)",\s*"([^"]+)",\s*"(breakfast|lunch|dinner|snack)",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*"([^"]+)",\s*(true|false)\s*\)/g
  )) {
    extraRows.push({
      id: m[1],
      name: m[2],
      category: m[3],
      calories: Number(m[4]),
      protein: Number(m[5]),
      carbs: Number(m[6]),
      fat: Number(m[7]),
      servingSize: m[8],
      isVegan: m[9] === "true",
    });
  }
  let addedExtra = 0;
  for (const f of extraRows) {
    const n = norm(f.name);
    if (namesByNorm.has(n)) continue;
    const existsById = await db.foodLibrary.findUnique({ where: { id: f.id }, select: { id: true } });
    if (existsById) continue;
    await db.foodLibrary.create({ data: { ...f, imageUrl: "" } });
    namesByNorm.set(n, f.id);
    addedExtra++;
  }
  console.log(`② تکمیلی seed-foods-extra.ts: ${extraRows.length} تا → ${addedExtra} جدید`);
  added += addedExtra;

  // ─── ③ ۵۰۰ غذای جدید فیتاپ ───
  const candidates: FoodRow[] = [...(FOODS_PART1 as any[]), ...(FOODS_PART2 as any[]), ...(FOODS_PART3 as any[])].map(
    (f, i) => ({
      id: `fitup_v137_food_${i + 1}`,
      name: String(f[0]),
      category: String(f[1]),
      calories: Number(f[2]),
      protein: Number(f[3]),
      carbs: Number(f[4]),
      fat: Number(f[5]),
      servingSize: String(f[6]),
      isVegan: Number(f[7] ?? 0) === 1,
    })
  );

  const TARGET_NEW = 500;
  let addedNew = 0;
  let skippedDup = 0;
  const insertedNew: string[] = [];

  for (const f of candidates) {
    if (addedNew >= TARGET_NEW) break;
    const n = norm(f.name);
    if (namesByNorm.has(n)) {
      skippedDup++;
      continue;
    }
    await db.foodLibrary.create({
      data: {
        id: f.id,
        name: f.name,
        category: f.category,
        calories: f.calories,
        protein: f.protein,
        carbs: f.carbs,
        fat: f.fat,
        servingSize: f.servingSize,
        isVegan: f.isVegan,
        imageUrl: "",
      },
    });
    namesByNorm.set(n, f.id);
    insertedNew.push(f.name);
    addedNew++;
    added++;
  }
  console.log(`③ غذاهای جدید فیتاپ: ${addedNew} درج شد (ردشده به‌عنوان تکراری: ${skippedDup})`);

  const total = await db.foodLibrary.count();
  console.log(`\n✅ جمع بانک غذا: ${total} غذا (قبلاً ${existing.length} بود)`);
  console.log(`   جدید در این اجرا: ${added}`);
  console.log(`\nنمونهٔ جدیدها:`);
  for (const n of insertedNew.slice(0, 12)) console.log(`  • ${n}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌ خطا در سیدر غذاها:", e);
    await db.$disconnect();
    process.exit(1);
  });
