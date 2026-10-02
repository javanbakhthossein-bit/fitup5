/**
 * آپدیت محتواها بر اساس گزارش Google Search Console (T4 — «آپدیت محتواها»)
 *
 * هدف: مقالات منتشر‌شده‌ای که برای کوئری‌های واقعی گوگل فاصله‌ی ضربه‌ای دارند
 * (striking distance) را هوش مصنوعی بازنویسی و غنی‌سازی می‌کند تا به رتبه‌ی
 * یک برسند — بر اساس داده‌ی واقعی کلیک/نمایش/جایگاه.
 *
 * ═══ v182 — ریشه‌درمانی نرخ بالای خطای AI در اجرای میدانی (لاگ ۱۹:۰۰ مالک: ۵ خطا از ۶ آپدیت) ═══
 *  ① قرارداد خروجی «کل مقاله داخل رشتهٔ JSON» حذف شد — یک escape خراب در متن
 *     فارسی/مارک‌داون کل خروجی را غیرقابل پارس می‌کرد («JSON نامعتبر»/«JSON یافت
 *     نشد»). جایگزین: پروتکل جداکنندهٔ متنی ===FITUP_*=== (متن خام بدون escape)
 *     + فال‌بک JSON با استخراج متعادل‌بریس و ترمیم کاما (اگر مدل JSON داد).
 *  ② فال‌بک مدل که هرگز اجرا نمی‌شد اصلاح شد (fallback_model=همان مدل اصلی بود).
 *  ③ تشخیص دقیق‌تر خطاها در لاگ پنل (علت واقعی به‌جای پیام‌های مبهم).
 *
 * ═══ v179 — بازنویسی اساسی (دیرکتیو مالک: «دکمهٔ آپدیت محتوا اصلاً کار نمی‌کند») ═══
 *
 * ریشهٔ باگ قبلی: گزارش پارس‌شده تا ۲۰۰۰ ردیف را می‌خواند ولی فقط «۵۰ کوئریِ
 * پرکلیک» ذخیره می‌شد و تطبیق هم فقط روی همین ۵۰ انجام می‌شد + قاعدهٔ تطبیق
 * «همهٔ کلمات کوئری باید در عنوان/slug/کلمات کلیدی باشد» آن‌قدری سخت‌گیر بود
 * که عملاً صفر فرصت پیدا می‌شد → پیام «هیچ فرصتی پیدا نشد».
 *
 * معماری جدید:
 *  ۱. دادهٔ کامل: همهٔ کوئری‌های فایل (تا ۲۰۰۰ — report.allQueries) + همهٔ صفحه‌ها
 *     (report.allPages) — برای گزارش‌های قدیمی فال‌بک به topQueries/pages.
 *  ۲. تطبیق زبان‌آگاه فارسی: نرمال‌سازی (ی/ک عربی، نیم‌فاصله، اعراب، اعداد)،
 *     حذف ایست‌واژه‌ها، ریشهٔ سبک (ها/های/ترین/…) و تطبیق توکن‌به‌توکن.
 *  ۳. تطبیق سه‌لایه برای هر کوئری → بهترین مقاله:
 *       لایهٔ ۱ (سطح بالا): همهٔ توکن‌ها ∈ عنوان+seoTitle
 *       لایهٔ ۲ (متوسط):    همهٔ توکن‌ها ∈ عنوان+کلیدواژه+slug+خلاصه
 *       لایهٔ ۳ (باز):      همهٔ توکن‌ها ∈ متن مقاله + حداقل یک توکن لنگر در عنوان/کلیدواژه
 *  ۴. لنگر صفحه: اگر URL مقاله در شیت صفحه‌های گزارش باشد، مقاله در انتخاب
 *     تطابق اولویت می‌گیرد (صفحه‌اش واقعاً در گوگل نمایش داشته).
 *  ۵. آبشار انتخاب فرصت (اگر پنجرهٔ استاندارد خالی بود خودبه‌خود گشاد می‌شود):
 *       گذر ۱: جایگاه ۳.۵–۲۵ با نمایش ≥۲۰  (استاندارد striking distance)
 *       گذر ۲: جایگاه ۳–۵۰ با نمایش ≥۵     (شل‌تر)
 *       گذر ۳: جایگاه ۳–۱۰۰ با نمایش ≥۱    (گسترده — هر کوئری واقعیِ بیرون از دو رتبهٔ اول)
 *     (رتبه‌های ۱ تا ۳ هرگز دست نمی‌خورند — بازنویسی مقالهٔ صدرنشین ریسک دارد)
 *  ۶. کول‌داون: مقاله‌ای که ۲۴ ساعت گذشته بازنویسی شده رد می‌شود تا اجراهای
 *     پشت‌سرهم به‌جای تکرار روی همان مقاله‌ها، در لیست فرصت‌ها پیشروی کنند.
 *  ۷. شفافیت کامل: آمار (تعداد کوئری اسکن‌شده / منطبق / فرصت / گذر فعال) در
 *     لاگ اجرا و پیام خطای ساخت‌یافتهٔ no-opportunity برمی‌گردد تا پنل دقیق
 *     بگوید چرا فرصتی نبود.
 */

import { db } from "@/lib/db";
import { createResilientCompletion, FALLBACK_TEXT_MODEL, TEXT_TASK_MODEL, withSystemDirectives } from "@/lib/fitness/ai";
import { getSeoReport, getSeoReportPromptBlock } from "@/lib/fitness/seo-report";
import { log, type RunContext } from "@/lib/fitness/seo-agent";

/* ─────────────── پیکربندی انتخاب فرصت ─────────────── */

/** حداقل جایگاه برای آپدیت — رتبه‌های ۱ تا ۳ هرگز بازنویسی نمی‌شوند (محافظت صدر) */
const MIN_POSITION = 3;

/** آبشار پنجرهٔ فرصت: اگر گذر قبلی فرصتی نداشت، گذر بعدی امتحان می‌شود */
const OPPORTUNITY_PASSES: ReadonlyArray<{ maxPosition: number; minImpressions: number; label: string }> = [
  { maxPosition: 25, minImpressions: 20, label: "استاندارد (جایگاه ۴–۲۵، نمایش ≥۲۰)" },
  { maxPosition: 50, minImpressions: 5, label: "گسترده (جایگاه ۴–۵۰، نمایش ≥۵)" },
  { maxPosition: 100, minImpressions: 1, label: "کامل (جایگاه ۴–۱۰۰، هر نمایش)" },
];

/** کول‌داون آپدیت: مقاله‌ای که این چند ساعت گذشته بازنویسی شده دوباره دست نمی‌خورد */
const REFRESH_COOLDOWN_HOURS = 24;

/** سقف احتیاطی بازنویسی در هر اجرا (هر مقاله یک فراخوانی سنگین AI است) */
const MAX_ARTICLES_PER_RUN = 20;

/** سقف پیمایش لیست فرصت‌ها در حلقهٔ اجرا (skip کول‌داون ارزان است ولی بی‌نهایت نه) */
const MAX_OPPORTUNITY_SCAN = 150;

interface Opportunity {
  articleId: string;
  slug: string;
  title: string;
  matchedQueries: { query: string; clicks: number; impressions: number; position: number }[];
}

/** ردیف کوئری/صفحه — از گزارش آپلودشدهٔ سرچ‌کنسول */
interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** آمار شفاف تطبیق — در لاگ اجرا و پیام no-opportunity استفاده می‌شود */
export interface RefreshMatchMeta {
  queriesScanned: number;
  matchedQueries: number;
  articlesMatched: number;
  passLabel: string | null;
  passIndex: number;
  opportunities: number;
  skippedCooldown: number;
  dataSource: "full-2000" | "legacy-top50";
}

/* ═══════════════ نرمال‌سازی و ریشهٔ فارسی ═══════════════ */

/** نرمال‌سازی متن فارسی برای تطبیق — ی/ک عربی، همزه، نیم‌فاصله، علائم، اعداد عربی */
function normalizeFa(s: string): string {
  return s
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "") // اعراب
    .replace(/[\u06F0-\u06F9]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) // ارقام فارسی → لاتین
    .replace(/[\u0660-\u0669]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))) // ارقام عربی → لاتین
    .replace(/[\u200c\u200f\u200e]/g, " ") // نیم‌فاصله و کنترل‌ها
    .replace(/[«»"'«».،؛:!?؟()\[\]{}\-–—+*\/\\|%#$&@_=~^…]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** ایست‌واژه‌های پرتکرار کوئری‌های فارسی — در تطبیق نادیده گرفته می‌شوند */
const FA_STOPWORDS = new Set([
  "برای", "با", "از", "در", "به", "و", "که", "این", "آن", "را", "است", "هست",
  "می", "هم", "یک", "تا", "رو", "شده", "شود", "دارد", "دارم", "کنم", "کن",
  "کنید", "باید", "چطور", "چگونه", "چیست", "چه", "هر", "ها", "خیلی", "بسیار",
  "اگر", "یا", "اما", "نیز", "وقتی", "کجا", "چند", "چندتا", "آیا", "من", "شما",
  "ما", "خود", "همه", "بی", "بدون", "درباره", "دربارهٔ", "عکس", "فیلم", "دانلود",
  "بهترین", "بهترین‌ها",
]);

/**
 * ریشهٔ سبک فارسی — فقط حذف پسوندهای پرتکرار (نه ریشه‌یابی واقعی).
 * طول حداقل ۴ پس از برش، تا ریشه‌های کوتاه خراب نشوند (مثلاً «ها» از «دست»).
 */
function lightStem(w: string): string {
  const suffixes = ["هایی", "هایم", "هایت", "هایش", "هایمان", "هایتان", "های", "ها", "ترین", "تر", "اتی", "ات", "انش", "ان"];
  for (const suf of suffixes) {
    if (w.length >= suf.length + 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

/** توکن‌های معنادار یک متن/کوئری برای تطبیق */
function meaningfulTokens(s: string): string[] {
  return normalizeFa(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !FA_STOPWORDS.has(w))
    .map(lightStem);
}

/** مجموعهٔ توکن‌های ریشه‌شدهٔ یک متن بزرگ (عنوان/کلیدواژه/متن مقاله) */
function tokenSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeFa(s).split(" ")) {
    if (w.length < 2) continue;
    out.add(lightStem(w));
  }
  return out;
}

/* ═══════════════ تطبیق کوئری → مقاله ═══════════════ */

interface ArticleIndexEntry {
  id: string;
  slug: string;
  title: string;
  titleTokens: Set<string>;
  coreTokens: Set<string>; // عنوان + seoTitle + کلیدواژه + slug + خلاصه
  contentTokens: Set<string> | null; // فقط در صورت نیاز — تنبل
  pageAnchored: boolean;
}

/** پیدا کردن مقاله‌ی مرتبط برای کوئری‌های سرچ‌کنسول — نسخهٔ v179 با کل جدول (export فقط برای تست scripts-tmp) */
export async function findOpportunities(): Promise<{
  opportunities: Opportunity[];
  meta: RefreshMatchMeta;
}> {
  const meta: RefreshMatchMeta = {
    queriesScanned: 0,
    matchedQueries: 0,
    articlesMatched: 0,
    passLabel: null,
    passIndex: 0,
    opportunities: 0,
    skippedCooldown: 0,
    dataSource: "full-2000",
  };

  // منبع داده: گزارش آپلودشدهٔ اکسل/CSV سرچ کنسول (تب «سئو هوشمند»)
  // (درخواست مالک: GSC API حذف شد — فایل خروجی Export گوگل دستی آپلود می‌شود)
  const { report } = await getSeoReport();
  if (!report) return { opportunities: [], meta };
  if (report.topQueries.length === 0) return { opportunities: [], meta };

  // ─── v179: کل جدول (تا ۲۰۰۰ کوئری) — فال‌بک گزارش‌های قدیمی به ۵۰ کوئری ───
  const usingFullTable = !!(report.allQueries && report.allQueries.length > 0);
  const rawQueries = usingFullTable ? report.allQueries! : report.topQueries;
  const rawPages = report.allPages && report.allPages.length > 0 ? report.allPages : report.pages;
  meta.dataSource = usingFullTable ? "full-2000" : "legacy-top50";

  const queries: GscRow[] = rawQueries.map((q) => ({
    keys: [q.query], clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position,
  }));
  meta.queriesScanned = queries.length;

  const pages: GscRow[] = rawPages.map((p) => ({
    keys: [p.page], clicks: p.clicks, impressions: p.impressions, ctr: 0, position: 0,
  }));

  const articles = await db.article.findMany({
    where: { status: "published" },
    select: { id: true, slug: true, title: true, metaKeywords: true, excerpt: true, content: true, seoTitle: true, seoDescription: true },
  });
  if (articles.length === 0) return { opportunities: [], meta };

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pageToArticle = new Map<string, typeof articles[number]>();
  for (const a of articles) {
    // URL صفحه‌ی مقاله در این اپ: /article/<slug> (v106) — /?article= فقط برای
    // تطبیق داده‌های قدیمی گزارش GSC نگه داشته شده (خواندنی — تولید URL نیست)
    pageToArticle.set(`/?article=${a.slug}`, a);
    pageToArticle.set(`/article/${a.slug}`, a);
    // v179 — URL بدون اسلش ابتدایی هم دیده شود (بعضی خروجی‌های GSC دامنه را کامل می‌دهند)
    pageToArticle.set(`article/${a.slug}`, a);
  }

  // لنگر صفحه: مقاله‌هایی که URLشان در شیت صفحه‌های گزارش هست
  const anchoredIds = new Set<string>();
  for (const p of pages) {
    const url = p.keys[0] || "";
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] === ""
      ? url.replace(/^https?:\/\/[^/]+/, "") || "/"
      : url.replace(/^https?:\/\/[^/]+/, "");
    const normalized = url.includes(siteBase) ? url.split(siteBase)[1] || "/" : path;
    const article = pageToArticle.get(normalized);
    if (article) anchoredIds.add(article.id);
  }

  // نمایهٔ مقاله‌ها — توکن‌های عنوان/هسته یک‌بار ساخته می‌شوند؛ متن فقط در صورت نیاز
  const index: ArticleIndexEntry[] = articles.map((a) => {
    const titleNorm = normalizeFa(`${a.title} ${a.seoTitle || ""}`);
    const coreNorm = normalizeFa(
      `${a.title} ${a.seoTitle || ""} ${a.metaKeywords || ""} ${a.slug.replace(/-/g, " ")} ${a.excerpt || ""}`
    );
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      titleTokens: new Set(titleNorm.split(" ").filter((w) => w.length >= 2).map(lightStem)),
      coreTokens: new Set(coreNorm.split(" ").filter((w) => w.length >= 2).map(lightStem)),
      contentTokens: null,
      pageAnchored: anchoredIds.has(a.id),
    };
  });
  const indexById = new Map(index.map((e) => [e.id, e]));

  // توکن‌های معنادار هر کوئری یک‌بار محاسبه می‌شود
  interface QueryMatch { query: GscRow; articleId: string; tier: number }
  const matched: QueryMatch[] = [];

  for (const q of queries) {
    const query = q.keys[0];
    if (!query || query.length < 3) continue;
    const qTokens = meaningfulTokens(query);
    if (qTokens.length === 0) continue;
    const qTokenSet = new Set(qTokens);

    // بهترین مقاله برای این کوئری = کم‌ترین لایهٔ تطبیق (۱ بهترین)؛
    // تساوی لایه → مقالهٔ لنگردار (URLش در گزارش هست) اولویت دارد
    let best: { id: string; tier: number; anchored: boolean } | null = null;

    for (const entry of index) {
      const candidate = (tier: number) => {
        if (
          !best ||
          tier < best.tier ||
          (tier === best.tier && entry.pageAnchored && !best.anchored)
        ) {
          best = { id: entry.id, tier, anchored: entry.pageAnchored };
        }
      };

      // لایهٔ ۱: همهٔ توکن‌ها در عنوان
      let all = true;
      for (const t of qTokenSet) { if (!entry.titleTokens.has(t)) { all = false; break; } }
      if (all) {
        candidate(1);
        continue;
      }
      // لایهٔ ۲: همهٔ توکن‌ها در هستهٔ مقاله (عنوان+کلیدواژه+slug+خلاصه)
      all = true;
      for (const t of qTokenSet) { if (!entry.coreTokens.has(t)) { all = false; break; } }
      if (all) {
        candidate(2);
        continue;
      }
      // لایهٔ ۳: همهٔ توکن‌ها در متن کامل + حداقل یک توکن لنگر در هسته
      // (بازترین لایه — فقط برای مقاله‌های لنگردار یا کوئری‌های چندتوکنی)
      if (qTokenSet.size >= 2 || entry.pageAnchored) {
        if (!entry.contentTokens) {
          const raw = articles.find((a) => a.id === entry.id)!.content || "";
          entry.contentTokens = tokenSet(raw.slice(0, 20000));
        }
        let inContent = true;
        for (const t of qTokenSet) { if (!entry.contentTokens.has(t)) { inContent = false; break; } }
        if (inContent) {
          let anchor = false;
          for (const t of qTokenSet) { if (entry.coreTokens.has(t)) { anchor = true; break; } }
          if (anchor) candidate(3);
        }
      }
    }

    // TS در داخل حلقه، تغییر متغیر از طریق closure را دنبال نمی‌کند — با
    // alias صریح، نarrowing نادرست «never» دور زده می‌شود
    const chosen = best as { id: string; tier: number; anchored: boolean } | null;
    if (chosen) {
      matched.push({ query: q, articleId: chosen.id, tier: chosen.tier });
    }
  }
  meta.matchedQueries = matched.length;
  meta.articlesMatched = new Set(matched.map((m) => m.articleId)).size;

  if (matched.length === 0) return { opportunities: [], meta };

  // گروه‌بندی کوئری‌ها به‌ازای هر مقاله (بدون فیلتر جایگاه/نمایش — فیلتر در گذرها)
  const byArticle = new Map<string, Opportunity>();
  for (const m of matched) {
    let opp = byArticle.get(m.articleId);
    if (!opp) {
      const entry = indexById.get(m.articleId)!;
      opp = { articleId: m.articleId, slug: entry.slug, title: entry.title, matchedQueries: [] };
      byArticle.set(m.articleId, opp);
    }
    opp.matchedQueries.push({
      query: m.query.keys[0],
      clicks: m.query.clicks,
      impressions: m.query.impressions,
      position: m.query.position,
    });
  }

  // ─── آبشار پنجرهٔ فرصت: اولین گذری که فرصت بدهد برنده است ───
  for (let i = 0; i < OPPORTUNITY_PASSES.length; i++) {
    const pass = OPPORTUNITY_PASSES[i];
    const result = Array.from(byArticle.values())
      .map((opp) => ({
        ...opp,
        matchedQueries: opp.matchedQueries.filter(
          (q) =>
            q.position >= MIN_POSITION &&
            q.position <= pass.maxPosition &&
            q.impressions >= pass.minImpressions
        ),
      }))
      .filter((opp) => opp.matchedQueries.length > 0);

    // اولویت: جمع نمایش کوئری‌ها (نزولی)
    result.sort(
      (a, b) =>
        b.matchedQueries.reduce((s, q) => s + q.impressions, 0) -
        a.matchedQueries.reduce((s, q) => s + q.impressions, 0)
    );

    if (result.length > 0) {
      meta.passIndex = i + 1;
      meta.passLabel = pass.label;
      meta.opportunities = result.length;
      return { opportunities: result, meta };
    }
  }

  // هیچ گذری فرصت نداشت — یعنی همهٔ کوئری‌های منطبق در جایگاه ۱–۳ بودند (یا بی‌نمایش)
  meta.passIndex = OPPORTUNITY_PASSES.length;
  meta.passLabel = OPPORTUNITY_PASSES[OPPORTUNITY_PASSES.length - 1].label;
  meta.opportunities = 0;
  return { opportunities: [], meta };
}

/* ─────────────── بازنویسی مقاله با AI ─────────────── */

interface RefreshedArticle {
  title: string;
  excerpt: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  metaKeywords: string;
}

/* ──────── v182 — پارس مقاوم خروجی AI (ریشه‌درمانی خطاهای «JSON یافت نشد / JSON نامعتبر / پاسخ خالی») ────────
 *
 * ریشهٔ خطاهای میدانی (لاگ ۱۹:۰۰ مالک): قرارداد قدیمی «کل مقاله داخل یک رشتهٔ JSON»
 * فوق‌شکننده است — یک کوتیشن/بک‌اسلش/خط جدید escape‌نشده در متن فارسی+مارک‌داون،
 * کل JSON را نامعتبر می‌کند؛ و retry با درخواست عیناً یکسان هم همان خروجی بد را
 * تکرار می‌کرد. راه‌حل دولایه:
 *   ۱) پروتکل جداکنندهٔ متنی (FITUP_*): متن خام مارک‌داون بدون هیچ escape — پارس تریویال
 *   ۲) فال‌بک JSON مقاوم: استخراج متعادل‌بریس (string-aware) + ترمیم کامای انتهایی
 * علامت‌ها با regex پذیرا هستند تا مدل با «= =» یا فاصله هم بشکندشان؛ نشانهٔ END
 * الزامی است تا خروجی بریده (finish=length) هرگز نصفه‌کاره ذخیره نشود.
 */

const FITUP_MARK_RE = /={2,}\s*FITUP_([A-Z_]+)\s*={2,}/g;

function parseMarkedArticle(text: string): RefreshedArticle | null {
  FITUP_MARK_RE.lastIndex = 0;
  const marks: { kind: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = FITUP_MARK_RE.exec(text)) !== null) {
    marks.push({ kind: m[1], start: m.index, end: m.index + m[0].length });
  }
  if (!marks.some((x) => x.kind === "CONTENT")) return null;
  if (!marks.some((x) => x.kind === "END")) return null; // خروجی بریده — رد
  const fieldOf = (kind: string): string => {
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].kind !== kind) continue;
      const valueEnd = i + 1 < marks.length ? marks[i + 1].start : text.length;
      return text.slice(marks[i].end, valueEnd).trim();
    }
    return "";
  };
  const content = fieldOf("CONTENT");
  if (!content) return null;
  return {
    title: fieldOf("TITLE"),
    excerpt: fieldOf("EXCERPT"),
    content,
    seoTitle: fieldOf("SEO_TITLE"),
    seoDescription: fieldOf("SEO_DESCRIPTION"),
    metaKeywords: fieldOf("KEYWORDS"),
  };
}

/** استخراج اولین آبجکت JSON متعادل (string-aware — برخلاف regex حریص {.*}) */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // نامتعادل = بریده
}

function parseJsonArticle(text: string): RefreshedArticle | null {
  const raw = extractBalancedJsonObject(text);
  if (!raw) return null;
  // ترمیم‌های رایج: کامای انتهایی + فنس مارک‌داون دور JSON
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/,\s*([}\]])/g, "$1");
  try {
    const p = JSON.parse(cleaned) as Partial<RefreshedArticle>;
    if (typeof p?.content === "string" && p.content.length >= 400) {
      return {
        title: typeof p.title === "string" ? p.title : "",
        excerpt: typeof p.excerpt === "string" ? p.excerpt : "",
        content: p.content,
        seoTitle: typeof p.seoTitle === "string" ? p.seoTitle : "",
        seoDescription: typeof p.seoDescription === "string" ? p.seoDescription : "",
        metaKeywords: typeof p.metaKeywords === "string" ? p.metaKeywords : "",
      };
    }
  } catch {}
  return null;
}

/** پارس یکپارچه: اول قالب جداکننده، بعد JSON — با علت دقیق برای لاگ */
function parseRefreshedArticle(text: string): { article: RefreshedArticle | null; reason: string } {
  const marked = parseMarkedArticle(text);
  if (marked) return { article: marked, reason: "" };
  const asJson = parseJsonArticle(text);
  if (asJson) return { article: asJson, reason: "" };
  if (/FITUP_CONTENT/i.test(text) && !/FITUP_END/i.test(text))
    return { article: null, reason: "خروجی بریده شده — نشانهٔ پایانی FITUP_END غایب است (خروجی مدل کامل نشد)" };
  if (!/FITUP_|\{/.test(text))
    return { article: null, reason: "هیچ نشانه‌ای از قالب خواسته‌شده (جداکننده یا JSON) در پاسخ نیست" };
  return { article: null, reason: "قالب جداکنندهٔ کامل یا JSON معتبر شناسایی نشد" };
}

async function refreshArticle(
  article: { title: string; excerpt: string; content: string; seoTitle: string; seoDescription: string; metaKeywords: string; slug: string },
  queries: Opportunity["matchedQueries"]
): Promise<RefreshedArticle> {
  // کوئری‌ها به ترتیب نمایش نزولی — پرتکرارترین‌ها اول پرامپت را رهبری می‌کنند
  const sorted = [...queries].sort((a, b) => b.impressions - a.impressions);
  const primary = sorted[0];
  const queriesText = sorted
    .slice(0, 40)
    .map((q) => `- «${q.query}» — ${q.impressions} نمایش/ماه، جایگاه فعلی ${q.position.toFixed(1)}، ${q.clicks} کلیک`)
    .join("\n");

  const systemPrompt = withSystemDirectives(
    `تو هیئت ۵۰ نفرهٔ فوق تخصص سئو و دیجیتال مارکتینگ فیتاپ هستی (استراتژیست کلمات کلیدی، متخصص E-E-A-T، ویراستار ارشد فارسی، متخصص Featured Snippet، متخصص Search Intent و متخصص نرخ تبدیل) — در قالب یک نویسندهٔ واحد.
مقاله‌ی موجود را برای رسیدن به رتبه ۱ گوگل بازنویسی/غنی‌سازی می‌کنی — نه از صفر. این یک «آپدیت محتوایی سطح بالا» است: می‌توانی مقاله را بازنویسی کنی، پاراگراف/بخش جدید اضافه کنی، بخش‌های ضعیف را عمیق کنی — فقط موضوع اصلی نباید عوض شود.

داده‌های واقعی گوگل در اختیارت است: کوئری‌هایی که کاربران واقعی با آن‌ها این مقاله را دیده‌اند. کوئری اصلی (بیشترین نمایش) ${primary ? `«${primary.query}»` : ""} است — این کلمه کلیدی هدف اصلی است و بقیه کوئری‌ها کلیدواژه‌های ثانویه/سؤالات واقعی کاربران‌اند.

قواعد الزامی:
۱. موضوع و پیام اصلی مقاله را حفظ کن — این «آپدیت» است نه مقاله‌ی جدید.
۲. ساختار Markdown را حفظ کن (## ،### ، جدول‌ها، لیست‌ها) و سلسله‌مراتب سرتیترها را تمیز نگه دار (فقط یک H1 در ابتدا).
۳. کلمه‌ی کلیدی هدف (و مترادف‌های طبیعی فارسی) را در: عنوان، H1، پاراگراف اول، حداقل دو H2 و چند جای طبیعی متن بگنجان — بدون keyword stuffing (تراکم زیر ۲٪). کلیدواژه‌های ثانویه از کوئری‌های واقعی را در زیربخش‌های مرتبط به‌کار ببر.
۴. «پاسخ مستقیم Featured Snippet»: بلافاصله بعد از اولین H2، یک پاراگراف ۴۰ تا ۶۰ کلمه‌ای بنویس که مستقیم و بدون مقدمه به پرسش اصلی کوئری اول جواب می‌دهد (گوگل همین را اسنیپت می‌کند).
۵. عمق محتوا را بالا ببر: بخش‌های ناقص را کامل کن، آمار/اعداد واقعی و نکات عملی مربی‌گونه اضافه کن؛ اگر کوئری‌هایی در لیست هستند که مقاله هیچ بخشی برایشان ندارد، یک بخش ## جدید با همان موضوع اضافه کن (هر کوئری = نیت واقعی کاربر).
۶. بخش «## پرسش‌های متداول» با حداقل ۴ سؤال و پاسخ — سؤال‌ها را ترجیحاً از خود کوئری‌های واقعی لیست بردار (کوئری‌های پرسشی عالی‌اند) و هر پاسخ ۲-۴ جملهٔ کامل و مستقل باشد.
۷. یک پاراگراف خبرگان (E-E-A-T): تجربه‌ی عملی مربی/ورزشکار فیتاپ — چرا فیتاپ این توصیه را می‌دهد.
۸. لینک داخلی طبیعی: ۲-۳ ارجاع به صفحات فیتاپ با فرمت Markdown: [متن](/article/slug) — فقط از slugهای واقعی فهرست زیر. (v106: مسیر واقعی — هرگز /?article= ننویس)
۹. یک جدول یا چک‌لیست عملی به مقاله اضافه کن اگر به موضوع می‌خورد (مقایسه/برنامه/چک‌لیست) — گوگل جدول‌ها را برای اسنیپت دوست دارد.
۱۰. طول: مقاله را به حداقل ۸۰۰ کلمه برسان (اگر کمتر است)؛ اگر بلند است کیفیت را بهبود بده نه حجیم‌سازی.
۱۱. فارسی روان و حرفه‌ای؛ ارقام را با اعداد فارسی طبیعی بنویس.
۱۲. عنوان جدید باید جذاب + حاوی کلمه کلیدی اصلی + زیر ۶۰ کاراکتر باشد؛ seoDescription حدود ۱۵۰ کاراکتر با کلمهٔ کلیدی + دعوت به اقدام.
۱۳. خروجی فقط و فقط با «قالب جداکنندهٔ» زیر باشد — هیچ متن اضافه‌ای نه قبل و نه بعد؛ هرگز JSON ننویس و متن مقاله را خام (Markdown عادی، بدون escape و بدون محصورکردن در کدبلاک/fence) بین نشانه‌ها بنویس.

قالب دقیق خروجی:
===FITUP_TITLE===
(عنوان جدید — زیر ۶۰ کاراکتر، حاوی کلمه کلیدی اصلی)
===FITUP_EXCERPT===
(خلاصهٔ جدید — ۲ تا ۳ جمله)
===FITUP_SEO_TITLE===
(عنوان سئو)
===FITUP_SEO_DESCRIPTION===
(حدود ۱۵۰ کاراکتر با کلمه کلیدی + دعوت به اقدام)
===FITUP_KEYWORDS===
کلمه۱, کلمه۲, کلمه۳
===FITUP_CONTENT===
(کل مقالهٔ بازنویسی‌شده با Markdown کامل — H1 در ابتدا، H2/H3، جدول‌ها، لیست‌ها، FAQ)
===FITUP_END===

کوئری‌های واقعی گوگل برای این مقاله (فرصت‌های رتبه ۱ — به ترتیب اهمیت):
${queriesText}

مقاله‌ی فعلی:
عنوان: ${article.title}
slug: ${article.slug}
خلاصه: ${article.excerpt}
کلمات کلیدی فعلی: ${article.metaKeywords || "(خالی)"}

محتوای کامل فعلی:
${article.content}`
  );

  // v41: سپر سراسری — بودجهٔ صریح خروجی + retry خطای گذرا + retry پاسخ خالی +
  // اعتبارسنجی داخل خود سپر.
  // v73 — قاعدهٔ مالک: بازنویسی مقاله (متن خالص) → deepseek-v4.1-flash؛
  // v182 — فیکس فال‌بک: قبلاً fallback_model = TEXT_MODEL بود که همان مدل اصلی است
  // (deepseek-v4.1-flash) و fallbackModelFor آن را null می‌کرد → فال‌بک هرگز اجرا
  // نمی‌شد (تایم‌اوت‌های ۱۲ دقیقه‌ای بدون gemini). حالا gemini-3.8-flash واقعی.
  // v182 — پارس: قرارداد قدیمی «مقاله داخل JSON» برداشته شد (escape خراب فارسی/
  // مارک‌داون = JSON نامعتبر) → پروتکل جداکنندهٔ FITUP_* + فال‌بک JSON مقاوم.
  const raw = await createResilientCompletion(
    {
      model: TEXT_TASK_MODEL,
      fallback_model: FALLBACK_TEXT_MODEL,
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.4,
    },
    {
      logTag: "content-refresh",
      maxTokens: 65536, // مقالهٔ کامل + FAQ → تا ~۲۰هزار توکن متن
      timeoutMs: 240_000,
      maxAttempts: 3,
      validateContent: (text) => {
        const { article, reason } = parseRefreshedArticle(text);
        if (article) {
          if (article.content.length < 400)
            return "محتوای بازنویسی‌شده بسیار کوتاه/ناقص است";
          return null;
        }
        return `پاسخ AI قابل پارس نبود — ${reason}`;
      },
    }
  );
  const { article: parsed, reason } = parseRefreshedArticle(raw);
  if (!parsed) throw new Error(`پاسخ AI قابل پارس نبود — ${reason}`);
  if (!parsed.content || parsed.content.length < 400) throw new Error("محتوای بازنویسی‌شده بسیار کوتاه/ناقص است");
  if (!parsed.title) parsed.title = article.title;
  if (!parsed.excerpt) parsed.excerpt = article.excerpt;
  return parsed;
}

/* ─────────────── اجرای عمومی ─────────────── */

export async function runContentRefresh(
  ctx: RunContext,
  maxArticles: number
): Promise<RunContext> {
  log(ctx, "info", "🔄 شروع آپدیت محتواها بر اساس گزارش Google Search Console");

  // دادهٔ سرچ‌کنسول از گزارش آپلودشده (درخواست مالک — GSC API حذف شد)
  const reportBlock = await getSeoReportPromptBlock();
  if (!reportBlock.trim()) {
    log(ctx, "warn", "⚠️ هنوز گزارشی آپلود نشده — آپدیت محتوا انجام نمی‌شود (فایل اکسل/CSV سرچ کنسول را در کارت «گزارش سرچ کنسول» آپلود کنید)");
    ctx.errors.push("search-console-report-missing");
    return ctx;
  }
  log(ctx, "info", "📊 گزارش آپلودشدهٔ سرچ کنسول به‌عنوان منبع داده استفاده می‌شود — استخراج فرصت‌ها از کل جدول (تا ۲٬۰۰۰ کوئری)…");

  const { opportunities, meta } = await findOpportunities();

  // شفافیت کامل برای پنل — مالک باید بتواند حساب‌وکتاب بکند
  log(
    ctx,
    "info",
    `📈 تطبیق: ${toFa(meta.queriesScanned)} کوئری اسکن شد (${meta.dataSource === "full-2000" ? "کل جدول" : "گزارش قدیمی — فقط ۵۰ کوئری؛ فایل را دوباره آپلود کنید"})، ${toFa(meta.matchedQueries)} کوئری به ${toFa(meta.articlesMatched)} مقاله منطبق شد`
  );
  if (meta.dataSource === "legacy-top50") {
    log(ctx, "warn", "⚠️ گزارش ذخیره‌شده قدیمی است (فقط ۵۰ کوئری پرکلیک دارد) — برای پوشش کامل ۲٬۰۰۰ کوئری، فایل سرچ‌کنسول را یک‌بار دیگر آپلود کنید");
  }

  if (opportunities.length === 0) {
    if (meta.matchedQueries === 0) {
      log(ctx, "info", "هیچ کوئری‌ای از گزارش به مقاله‌ای از سایت منطبق نشد — یا فایل فقط کوئری‌های خارج از موضوع سایت دارد یا مقالات منتشرشده کم‌اند");
      ctx.errors.push(`no-opportunity:${JSON.stringify({ ...meta, reason: "no-match" })}`);
    } else {
      log(ctx, "info", `همهٔ ${toFa(meta.matchedQueries)} کوئریِ منطبق در جایگاه ۱ تا ۳ گوگل‌اند (${toFa(meta.articlesMatched)} مقاله) — بازنویسی مقالهٔ صدرنشین ریسک دارد و انجام نمی‌شود`);
      ctx.errors.push(`no-opportunity:${JSON.stringify({ ...meta, reason: "all-top3" })}`);
    }
    return ctx;
  }

  log(
    ctx,
    "info",
    `🎯 ${toFa(opportunities.length)} فرصت آپدیت با پنجرهٔ ${meta.passLabel} — بودجهٔ این اجرا: ${toFa(Math.min(Math.max(1, maxArticles), MAX_ARTICLES_PER_RUN))} مقاله`
  );

  const budget = Math.max(1, Math.min(maxArticles, MAX_ARTICLES_PER_RUN));
  const cooldownMs = REFRESH_COOLDOWN_HOURS * 3600_000;

  let updated = 0;
  let scanned = 0;
  for (const opp of opportunities) {
    if (updated >= budget) break;
    // سقف احتیاطی پیمایش — لیست فرصت‌های خیلی بلند اجرا را طولانی نمی‌کند
    // (بررسی کول‌داون یک کوئری DB ارزان است ولی بی‌نهایت نه)
    if (scanned >= MAX_OPPORTUNITY_SCAN) {
      log(ctx, "info", `⏳ سقف پیمایش (${toFa(MAX_OPPORTUNITY_SCAN)} فرصت) رسید — بقیه در اجرای بعدی`);
      break;
    }
    scanned++;

    try {
      const article = await db.article.findUnique({ where: { id: opp.articleId } });
      if (!article) continue;
      // v179 — کول‌داون: مقاله‌ای که همین ۲۴ ساعت گذشته بازنویسی شده رد می‌شود
      // تا اجراهای پشت‌سرهم از لیست فرصت‌ها پیشروی کنند نه اینکه همان اولی‌ها را
      // دوباره بازنویسی کنند.
      if (article.updatedAt && Date.now() - article.updatedAt.getTime() < cooldownMs) {
        meta.skippedCooldown++;
        log(ctx, "info", `⏭️ «${article.title}» ${toFa(REFRESH_COOLDOWN_HOURS)} ساعت گذشته آپدیت شده — رد شد (اجرای بعدی سراغ بقیه می‌رود)`);
        continue;
      }
      log(
        ctx,
        "info",
        `✍️ آپدیت «${article.title}» برای ${toFa(opp.matchedQueries.length)} کوئری (بهترین جایگاه ${toFa(Math.min(...opp.matchedQueries.map((q) => q.position)).toFixed(1))})…`
      );
      const refreshed = await refreshArticle(article, opp.matchedQueries);
      // نسخه پشتیبان محتوای فعلی قبل از بازنویسی (ممیزی 2-c P1) — اگر خروجی AI خراب
      // بود یا ادمین بخواهد، محتوای قبلی از ArticleRevision قابل بازیابی است.
      // اگر ذخیره پشتیبان شکست بخورد، بازنویسی هم انجام نمی‌شود (خطا در catch حلقه).
      await db.articleRevision.create({
        data: {
          articleId: article.id,
          title: article.title,
          excerpt: article.excerpt,
          content: article.content,
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          metaKeywords: article.metaKeywords,
        },
      });
      await db.article.update({
        where: { id: article.id },
        data: {
          title: refreshed.title,
          excerpt: refreshed.excerpt,
          content: refreshed.content,
          seoTitle: refreshed.seoTitle || article.seoTitle,
          seoDescription: refreshed.seoDescription || article.seoDescription,
          metaKeywords: refreshed.metaKeywords || article.metaKeywords,
          // status=published می‌ماند — مقاله زنده به‌روزرسانی می‌شود
        },
      });
      ctx.successCount++;
      updated++;
      ctx.articles.push({ slug: article.slug, title: refreshed.title, updated: true });
      log(ctx, "success", `✅ «${refreshed.title}» آپدیت و منتشر شد (${toFa(updated)}/${toFa(budget)})`);
    } catch (e) {
      ctx.failCount++;
      const msg = e instanceof Error ? e.message : String(e);
      ctx.errors.push(`refresh:${opp.slug}:${msg}`);
      log(ctx, "error", `❌ خطا در آپدیت «${opp.title}»: ${msg}`);
    }
  }

  log(ctx, "success", `🏁 آپدیت محتواها کامل شد — ${toFa(ctx.successCount)} مقاله بهبودیافت${opportunities.length > updated ? ` (از ${toFa(opportunities.length)} فرصت — بقیه در اجرای بعدی با کول‌داون ۲۴ ساعته)` : ""}`);
  return ctx;
}

function toFa(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
