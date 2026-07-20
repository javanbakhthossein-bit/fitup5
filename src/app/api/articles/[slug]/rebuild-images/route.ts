import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { generateImage, type AspectRatio } from "@/lib/fitness/avalai-image";
import {
  processAndSaveArticleImage,
  processAndSaveInlineImage,
} from "@/lib/fitness/image-processing";

/**
 * POST /api/articles/[slug]/rebuild-images
 *
 * برای مقالاتی که با ایجنت سئو ساخته شده‌اند (و یک SeoArticlePlan دارند):
 *  ۱. اگر تصویر کاور ندارد یا URL آن خراب/خالی است → با coverImagePrompt یک کاور جدید تولید کن.
 *  ۲. اگر در متن مقاله تصویری ![alt](url) دارد که URL آن خالی/خراب است → با یک پرامپت مرتبط تولید کن.
 *  ۳. اگر تصویری alt text ندارد (alt خالی) → یک alt توصیفی فارسی (حاوی کلمه کلیدی) بگذار.
 *  ۴. اگر در متن هیچ تصویری نیست ولی مقاله SEO است → یک تصویر مرتبط تولید کن و در جای مناسب (بعد از H1) درج کن.
 *
 * body (optional):
 *  - force: boolean → اگر true باشد، حتی اگر تصویر کاور وجود داشت، دوباره تولید شود.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const body = await req.json().catch(() => ({} as any));
    const force = Boolean((body as any)?.force);

    const article = await db.article.findUnique({ where: { slug } });
    if (!article) {
      return Response.json({ error: "مقاله یافت نشد." }, { status: 404 });
    }

    // Find linked SEO plan (if any) — gives us coverImagePrompt, keyword, etc.
    const seoPlan = await db.seoArticlePlan.findFirst({
      where: { articleId: article.id },
    });

    const keyword = seoPlan?.keyword || article.tags?.split(",")[0]?.trim() || article.title;
    const coverPrompt =
      seoPlan?.coverImagePrompt ||
      `Professional fitness photograph of ${keyword}, natural bright daylight, modern gym environment, realistic colors, athletic person in natural pose, proper form, photorealistic, high quality, sharp focus, no text, no watermark, no weird anatomy, no extra limbs, no distorted faces, magazine editorial style`;

    const log: string[] = [];
    let newCoverUrl = article.coverImage;
    let newOgImage = article.ogImage;
    let newContent = article.content;

    // ─── ۱. بررسی / تولید تصویر کاور ───
    const coverMissing = !article.coverImage || article.coverImage.trim() === "" || force;
    if (coverMissing) {
      try {
        const coverImg = await generateImage({
          prompt: coverPrompt,
          aspectRatio: "16:9" as AspectRatio,
          timeoutMs: 120000,
        });
        const processed = await processAndSaveArticleImage({
          buffer: coverImg.buffer,
          articleSlug: article.slug,
          descriptiveName: keyword.replace(/\s+/g, "-").slice(0, 40),
        });
        newCoverUrl = processed.cover.url;
        newOgImage = processed.cover.url;
        log.push(`✅ تصویر کاور تولید شد: ${newCoverUrl}`);
      } catch (e: any) {
        log.push(`❌ خطا در تولید تصویر کاور: ${e.message}`);
      }
    } else {
      log.push("ℹ تصویر کاور از قبل وجود داشت (skip).");
    }

    // ─── ۲. پردازش تصاویر داخل متن (![](url)) ───
    // پارسر regex برای markdown image syntax
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const imgMatches: { alt: string; url: string; fullMatch: string; index: number }[] = [];
    let m;
    let idxCounter = 0;
    while ((m = imgRegex.exec(newContent)) !== null) {
      imgMatches.push({
        alt: m[1] || "",
        url: m[2] || "",
        fullMatch: m[0],
        index: ++idxCounter,
      });
    }

    // Heuristic: a URL is "broken/empty" if it is empty, "IMAGE_PLACEHOLDER_N", or doesn't start with /, http
    const isBrokenUrl = (url: string) =>
      !url ||
      url.trim() === "" ||
      /^IMAGE_PLACEHOLDER_\d+$/i.test(url.trim()) ||
      (!url.startsWith("/") && !url.startsWith("http"));

    let inlineRebuilt = 0;
    let altFixed = 0;

    for (const img of imgMatches) {
      let newAlt = img.alt;
      let newUrl = img.url;
      let needsReplace = false;

      // ۲-الف) اصلاح alt text خالی
      if (!newAlt || newAlt.trim() === "") {
        newAlt = buildAltText(keyword, article.title, img.index);
        altFixed++;
        needsReplace = true;
      }

      // ۲-ب) اگر URL خراب است → حذف کن (تولید عکس جدید = هزینه اضافی API)
      // مهم: برای صرفه‌جویی در هزینه API، inline خراب را حذف می‌کنیم به‌جای تولید مجدد.
      // کاربر می‌تواند با دکمه «بازسازی تصاویر» در پنل مدیر، فقط کاور را بازسازی کند.
      if (isBrokenUrl(newUrl)) {
        log.push(`🗑 حذف inline خراب (بدون تولید مجدد — صرفه‌جویی API): ${img.url}`);
        newContent = newContent.replace(img.fullMatch, "");
        continue;
      }

      if (needsReplace) {
        const replacement = `![${newAlt}](${newUrl})`;
        newContent = newContent.replace(img.fullMatch, replacement);
      }
    }

    // ۳. حذف شده — دیگر inline جدید اضافه نمی‌کنیم
    // قبلاً اگر مقاله inline نداشت، یک inline جدید تولید می‌کردیم که هزینه API داشت.
    // حالا: اگر inline ندارد، هیچ inline اضافه نمی‌کنیم — کاور کافی است.
    // این کار هزینه API را به حداقل می‌رساند.

    // ─── ذخیره در دیتابیس ───
    const updateData: any = {};
    if (newCoverUrl !== article.coverImage) {
      updateData.coverImage = newCoverUrl;
    }
    if (newOgImage !== article.ogImage) {
      updateData.ogImage = newOgImage;
    }
    if (newContent !== article.content) {
      updateData.content = newContent;
    }

    if (Object.keys(updateData).length > 0) {
      await db.article.update({
        where: { id: article.id },
        data: updateData,
      });
      log.push("✓ مقاله در دیتابیس به‌روزرسانی شد.");
    } else {
      log.push("ℹ تغییری لازم نبود (همه چیز سالم بود).");
    }

    return Response.json({
      ok: true,
      slug: article.slug,
      coverImage: newCoverUrl,
      inlineRebuilt,
      altFixed,
      log,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * ساخت alt text فارسی توصیفی حاوی کلمه کلیدی
 * حداقل ۵ کلمه — برای سئوی تصویر (Google Image SEO)
 */
function buildAltText(keyword: string, articleTitle: string, index: number): string {
  // تعداد محدودی الگو برای تنوع
  const templates = [
    `تصویر ${keyword} — ${articleTitle.slice(0, 40)}`,
    `${keyword} در عمل — تصویر آموزشی شماره ${index}`,
    `نمونه تصویری ${keyword} برای راهنمای جامع`,
    `${articleTitle.slice(0, 30)} — ${keyword} (تصویر ${index})`,
  ];
  return templates[index % templates.length];
}

// (buildInlinePrompt حذف شد — دیگر inline جدید تولید نمی‌کنیم)
