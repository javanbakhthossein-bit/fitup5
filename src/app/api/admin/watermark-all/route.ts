import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { addFitUpWatermark } from "@/lib/fitness/image-processing";
import { UPLOADS_ROOT } from "@/lib/fitness/uploads-config";
import { readFile, writeFile, readdir, stat } from "fs/promises";
import path from "path";
import sharp from "sharp";

const ARTICLES_DIR = path.join(UPLOADS_ROOT, "articles");

/**
 * تشخیص اینکه آیا فایل واترمارک FitUp دارد یا نه.
 *
 * واترمارک "FitUp" با fontSize = 6% عرض تصویر در گوشه پایین-راست قرار دارد.
 * برای یک تصویر ۱۲۰۰×۶۷۵، fontSize ≈ ۷۲px است و متن از y ≈ height-108 تا y ≈ height-36
 * کشیده می‌شود. پس باید یک نوار بزرگ‌تر از پایین تصویر را بررسی کنیم.
 *
 * روش: استخراج نوار ۱۰۰×۱۰۰ از گوشه پایین-راست و شمارش پیکسل‌های نارنجی-طلایی.
 * اگر حداقل ۲۰ پیکسل نارنجی پیدا شد → واترمارک دارد.
 */
async function hasFitUpWatermark(filePath: string): Promise<boolean> {
  try {
    const buffer = await readFile(filePath);
    const meta = await sharp(buffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width < 50 || height < 50) return false;

    const regionW = Math.min(100, width);
    const regionH = Math.min(100, height);
    const region = await sharp(buffer)
      .extract({
        left: Math.max(0, width - regionW),
        top: Math.max(0, height - regionH),
        width: regionW,
        height: regionH,
      })
      .raw()
      .toBuffer();

    let orangePixels = 0;
    const channels = meta.channels || 3;
    for (let i = 0; i < region.length; i += channels) {
      const r = region[i];
      const g = region[i + 1];
      const b = region[i + 2] || 0;
      if (r > 180 && g > 100 && g < 200 && b < 100) {
        orangePixels++;
      }
    }
    return orangePixels >= 20;
  } catch {
    return false;
  }
}

async function processDirectory(
  dirPath: string,
  stats: { processed: number; skipped: number; failed: number },
  limit: { value: number }
) {
  if (limit.value <= 0) return;
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (limit.value <= 0) return;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await processDirectory(fullPath, stats, limit);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (![".webp", ".png", ".jpg", ".jpeg"].includes(ext)) continue;

    try {
      if (await hasFitUpWatermark(fullPath)) {
        stats.skipped++;
        continue;
      }
      const buffer = await readFile(fullPath);
      const watermarked = await addFitUpWatermark(buffer);
      await writeFile(fullPath, watermarked);
      stats.processed++;
    } catch {
      stats.failed++;
    }
    limit.value--;
  }
}

/**
 * POST /api/admin/watermark-all
 * افزودن واترمارک FitUp به همه تصاویر موجود در public/uploads/articles/ که هنوز
 * واترمارک ندارند. این یک عملیات زمان‌بر است (ممکن است چند دقیقه طول بکشد).
 *
 * body:
 *  - limit?: number — حداکثر تعداد فایل برای پردازش (پیش‌فرض ۲۰۰)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({} as any));
    const limitNum = Math.min(Math.max(Number((body as any)?.limit) || 200, 1), 1000);

    try {
      await stat(ARTICLES_DIR);
    } catch {
      return Response.json({ error: "پوشه uploads/articles وجود ندارد." }, { status: 404 });
    }

    const stats = { processed: 0, skipped: 0, failed: 0 };
    const limit = { value: limitNum };
    await processDirectory(ARTICLES_DIR, stats, limit);

    return Response.json({
      ok: true,
      processed: stats.processed,
      skipped: stats.skipped,
      failed: stats.failed,
      limit: limitNum,
      message: `پردازش کامل شد — ${stats.processed} واترمارک اضافه شد، ${stats.skipped} از قبل داشتند، ${stats.failed} ناموفق`,
    });
  } catch (e) {
    return apiError(e);
  }
}
