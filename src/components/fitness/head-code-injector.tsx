import { db } from "@/lib/db";
import React from "react";
// v251-fix418 — اسکریپت‌های اجرایی ادمین بعد از هیدریشن تزریق می‌شوند (نه parse-time)
import { DeferredAdminScripts, type DeferredScript } from "./deferred-admin-scripts";

/**
 * HeadCodeInjector — Server Component
 *
 * Fetches active HeadCode entries from the DB and renders them.
 *
 * For "head" placement:
 * - <meta> and <link> tags are extracted and rendered as real React elements
 *   (so they appear directly in <head> without any wrapper).
 * - <script> tags are extracted and rendered as real React <script> elements.
 * - Any remaining HTML is rendered via dangerouslySetInnerHTML on a hidden span.
 *
 * For body placements: everything is rendered inside a <div> wrapper.
 */

export async function HeadCodeInjector({
  placement,
}: {
  placement: "head" | "body_start" | "body_end";
}) {
  let codes: { code: string }[] = [];
  try {
    codes = await db.headCode.findMany({
      where: { isActive: true, placement },
      orderBy: [{ createdAt: "asc" }],
      select: { code: true },
    });
  } catch (e) {
    console.error("[HeadCodeInjector] DB error:", e);
    return null;
  }

  if (codes.length === 0) return null;

  const combined = codes.map((c) => c.code).join("\n");

  if (placement === "head") {
    // Parse the HTML to extract specific tags and render them as React elements.
    const elements: React.ReactElement[] = [];

    // Extract <meta> tags
    const metaRegex = /<meta\s+([^>]*)\/?>/gi;
    let match;
    let key = 0;
    while ((match = metaRegex.exec(combined)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
      const contentMatch = attrs.match(/content=["']([^"']+)["']/i);
      const propertyMatch = attrs.match(/property=["']([^"']+)["']/i);
      const httpEquivMatch = attrs.match(/http-equiv=["']([^"']+)["']/i);
      const charsetMatch = attrs.match(/charset=["']([^"']+)["']/i);

      const metaProps: Record<string, string> = {};
      if (nameMatch) metaProps.name = nameMatch[1];
      if (contentMatch) metaProps.content = contentMatch[1];
      if (propertyMatch) metaProps.property = propertyMatch[1];
      if (httpEquivMatch) metaProps.httpEquiv = httpEquivMatch[1];
      if (charsetMatch) metaProps.charSet = charsetMatch[1];

      elements.push(React.createElement("meta", { key: `meta-${key++}`, ...metaProps }));
    }

    // Extract <link> tags
    const linkRegex = /<link\s+([^>]*)\/?>/gi;
    // v115 — بازگردانی کامل به رفتار امن (دستور مالک: «حذف فونت تکراری گوگل‌فونت
    // اشتباه بوده»). فیلتر v112 که لینک‌های fonts.googleapis.com را dedupe می‌کرد
    // حذف شد: هر لینکی که ادمین در «کدهای تحلیلی» ثبت کند عیناً و بدون هیچ
    // فیلتری رندر می‌شود — هیچ لینک فونتی دیگر مخفی/حذف نمی‌شود.
    const linkPropsList: Record<string, string>[] = [];
    while ((match = linkRegex.exec(combined)) !== null) {
      const attrs = match[1];
      const relMatch = attrs.match(/rel=["']([^"']+)["']/i);
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
      const typeMatch = attrs.match(/type=["']([^"']+)["']/i);

      const linkProps: Record<string, string> = {};
      if (relMatch) linkProps.rel = relMatch[1];
      if (hrefMatch) linkProps.href = hrefMatch[1];
      if (typeMatch) linkProps.type = typeMatch[1];

      linkPropsList.push(linkProps);
    }

    for (const linkProps of linkPropsList) {
      elements.push(React.createElement("link", { key: `link-${key++}`, ...linkProps }));
    }

    // Extract <script> tags
    // v251-fix418 — تکمیل زنجیرهٔ v240/v245: «هیچ» اسکریپت اجرایی ادمین دیگر در
    // parse-time رندر نمی‌شود. قبلاً فقط قطعهٔ ریسک کلاریتی پرش می‌شد و بقیه
    // (GA4/کلاریتیِ ویرایش‌شده/اسکریپت‌های آیندهٔ ادمین) همان‌جا اجرا می‌شدند —
    // همان ریس با هیدریشن (#418 روی موبایل کند و صفحات سنگین). حالا:
    //  • JSON-LD ادمین → عیناً SSR (داده است؛ صفر ریس هیدریشن؛ سئو مطمئن‌تر)
    //  • قطعهٔ ریسک کلاریتی (insertBefore) → مثل v245 هرگز رندر نمی‌شود (لودر
    //    گارددار v240 در layout صاحب انحصاری Clarity است)
    //  • هر اسکریپت اجرایی دیگر → DeferredAdminScripts (تزریق انتهای head بعد
    //    از هیدریشن — appendChild؛ نود انتها-افزوده هرگز walk را نمی‌شکند)
    const deferredScripts: DeferredScript[] = [];
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    while ((match = scriptRegex.exec(combined)) !== null) {
      const attrs = match[1];
      const content = match[2];
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
      const scriptType = typeMatch ? typeMatch[1] : "";

      // اسکریپت‌های داده‌ای (JSON-LD / importmap / template) — SSR بدون تغییر
      const isDataScript = /application\/ld\+json|importmap|text\/template/i.test(scriptType);
      if (isDataScript) {
        if (srcMatch) {
          // eslint-disable-next-line @next/next/no-sync-scripts
          elements.push(React.createElement("script", { key: `script-${key++}`, src: srcMatch[1], type: scriptType }));
        } else if (content && content.trim()) {
          elements.push(React.createElement("script", { key: `script-${key++}`, type: scriptType, dangerouslySetInnerHTML: { __html: content.trim() } }));
        }
        continue;
      }

      if (srcMatch) {
        deferredScripts.push({ src: srcMatch[1], type: scriptType || undefined });
      } else if (content && content.trim()) {
        // v245 — قطعهٔ ریسک کلاریتی (insertBefore وسط head) همچنان رندر نمی‌شود؛
        // لودر گارددار v240 در layout بعد از load + requestIdleCallback با
        // appendChild انتهایی آن را لود می‌کند (صاحب انحصاری Clarity).
        const isRiskyClarity =
          /clarity\.ms\/tag\//i.test(content) && /insertBefore/i.test(content);
        if (!isRiskyClarity) {
          deferredScripts.push({ html: content.trim() });
        }
      }
    }

    // Remove all extracted tags from combined to get remaining HTML
    let remaining = combined
      .replace(metaRegex, "")
      .replace(linkRegex, "")
      .replace(scriptRegex, "")
      .trim();

    if (remaining) {
      elements.push(
        React.createElement("span", {
          key: `remaining-${key++}`,
          style: { display: "none" },
          dangerouslySetInnerHTML: { __html: remaining },
          suppressHydrationWarning: true,
        })
      );
    }

    // v251-fix418 — اسکریپت‌های اجراییِ باقی‌مانده به‌صورت post-hydration تزریق می‌شوند
    if (deferredScripts.length > 0) {
      elements.push(
        React.createElement(DeferredAdminScripts, { key: `deferred-${key++}`, scripts: deferredScripts })
      );
    }

    return React.createElement(React.Fragment, null, ...elements);
  }

  // v259 — body placements هم دیگر «هیچ» اسکریپت اجرایی parse-time ندارند
  // (همان سیاست v251-fix418 برای head): اسکریپت‌های اجرایی استخراج و بعد از
  // هیدریشن تزریق می‌شوند (DeferredAdminScripts)؛ JSON-LD عیناً SSR می‌ماند و
  // بقیهٔ HTML (meta/link/متنی) مثل قبل داخل رندر می‌شود.
  // ریشهٔ باگ: <script> داخل dangerouslySetInnerHTML در body هنگام parse اجرا
  // می‌شود و اگر DOM را وسط walk هیدریشن دستکاری کند → #418 روی همهٔ صفحات.
  // v263-fix — مقایسهٔ «placement !== "head"» حذف شد: مسیر head بالاتر return
  // کرده و TS اینجا placement را به "body_start" | "body_end" نارو کرده بود؛
  // مقایسهٔ بی‌همتا → خطای TS2367 در next build پروداکشن. رفتار عیناً قبلی است.
  const bodyElements: React.ReactElement[] = [];
  const deferredScripts: DeferredScript[] = [];
  const bodyScriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let bodyMatch;
  let bodyKey = 0;
  while ((bodyMatch = bodyScriptRegex.exec(combined)) !== null) {
    const attrs = bodyMatch[1];
    const content = bodyMatch[2];
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    const scriptType = typeMatch ? typeMatch[1] : "";

    // اسکریپت‌های داده‌ای (JSON-LD / importmap / template) — SSR بدون تغییر
    const isDataScript = /application\/ld\+json|importmap|text\/template/i.test(scriptType);
    if (isDataScript) {
      if (srcMatch) {
        // eslint-disable-next-line @next/next/no-sync-scripts
        bodyElements.push(React.createElement("script", { key: `body-script-${bodyKey++}`, src: srcMatch[1], type: scriptType }));
      } else if (content && content.trim()) {
        bodyElements.push(React.createElement("script", { key: `body-script-${bodyKey++}`, type: scriptType, dangerouslySetInnerHTML: { __html: content.trim() } }));
      }
      continue;
    }

    if (srcMatch) {
      deferredScripts.push({ src: srcMatch[1], type: scriptType || undefined });
    } else if (content && content.trim()) {
      // قطعهٔ ریسک کلاریتی (insertBefore وسط head) هرگز رندر نمی‌شود —
      // لودر گارددار v240 در layout صاحب انحصاری Clarity است.
      const isRiskyClarity =
        /clarity\.ms\/tag\//i.test(content) && /insertBefore/i.test(content);
      if (!isRiskyClarity) {
        deferredScripts.push({ html: content.trim() });
      }
    }
  }

  const remainingBody = combined.replace(bodyScriptRegex, "").trim();
  if (remainingBody) {
    bodyElements.push(
      React.createElement("div", {
        key: `body-remaining-${bodyKey++}`,
        dangerouslySetInnerHTML: { __html: remainingBody },
        suppressHydrationWarning: true,
      })
    );
  }

  if (deferredScripts.length > 0) {
    bodyElements.push(
      React.createElement(DeferredAdminScripts, { key: `body-deferred-${bodyKey++}`, scripts: deferredScripts })
    );
  }

  return React.createElement(React.Fragment, null, ...bodyElements);
}
