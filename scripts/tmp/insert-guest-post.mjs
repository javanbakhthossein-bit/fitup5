/**
 * v242 — درج پست مهمان در مجلهٔ فیتاپ (Article published)
 * اجرا: node scripts/tmp/insert-guest-post.mjs (node:sqlite — بدون bun -e)
 * Idempotent: اگر slug موجود باشد، UPDATE می‌کند (برای ویرایش محتوا).
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB = "db/custom.db";
const SLUG = "why-generic-workout-plans-fail";

// ── محتوا ──
let content = readFileSync("scripts/tmp/guest-post/content.md", "utf8");
const assets = JSON.parse(readFileSync("scripts/tmp/guest-post/assets.json", "utf8"));
content = content.replace("{{IMG1}}", assets.inline1).replace("{{IMG2}}", assets.inline2);

const TITLE = "چرا برنامه تمرینی آماده جواب نمی‌دهد؟ راهنمای علمی شخصی‌سازی تمرین";
const EXCERPT =
  "برنامه‌های تمرینی آماده برای اکثر افراد نتیجه پایدار نمی‌دهند. در این پست مهمان، سه دلیل علمی شکست برنامه‌های آماده + فرمول ۵ مرحله‌ای ساخت برنامه تمرینی شخصی را ببینید.";
const SEO_TITLE = "چرا برنامه تمرینی آماده جواب نمی‌دهد؟ راهنمای شخصی‌سازی";
const SEO_DESC =
  "برنامه‌های آماده بدنسازی چرا نتیجه نمی‌دهند؟ سه دلیل علمی + فرمول ۵ مرحله‌ای ساخت برنامه تمرینی شخصی‌سازی‌شده برای عضله‌سازی و چربی‌سوزی.";
const KEYWORDS =
  "برنامه تمرینی,برنامه تمرینی شخصی,برنامه بدنسازی,شخصی‌سازی تمرین,چربی سوزی,عضله سازی,تناسب اندام";
const TAGS = "برنامه تمرینی,شخصی‌سازی تمرین,عضله سازی,چربی سوزی,تناسب اندام";
const CATEGORY = "تمرین";
const COVER = assets.cover;

// تعداد کلمات → دقیقه مطالعه (حدود ۱۸۰ کلمه در دقیقه فارسی)
const wordCount = content.split(/\s+/).filter(Boolean).length;
const readingMinutes = Math.max(6, Math.round(wordCount / 180));

// id مشابه الگوی cuid
function makeId() {
  let s = "c";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const db = new DatabaseSync(DB);
const now = Date.now();
const existing = db.prepare("SELECT id FROM Article WHERE slug = ?").get(SLUG);

const fields = {
  title: TITLE,
  excerpt: EXCERPT,
  content,
  category: CATEGORY,
  tags: TAGS,
  status: "published",
  coverImage: COVER,
  seoTitle: SEO_TITLE,
  seoDescription: SEO_DESC,
  metaKeywords: KEYWORDS,
  canonicalUrl: "",
  ogImage: COVER,
  robots: "index,follow",
  readingMinutes,
  updatedAt: now,
};

if (existing) {
  const set = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE Article SET ${set} WHERE slug = ?`).run(...Object.values(fields), SLUG);
  console.log("UPDATED existing article:", existing.id, "| words:", wordCount, "| read:", readingMinutes);
} else {
  const id = makeId();
  db.prepare(
    `INSERT INTO Article (id, title, slug, excerpt, content, category, tags, status, coverImage,
      seoTitle, seoDescription, metaKeywords, canonicalUrl, ogImage, robots, readingMinutes,
      publishedAt, views, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id, fields.title, SLUG, fields.excerpt, fields.content, fields.category, fields.tags,
    fields.status, fields.coverImage, fields.seoTitle, fields.seoDescription, fields.metaKeywords,
    fields.canonicalUrl, fields.ogImage, fields.robots, fields.readingMinutes, now, now, fields.updatedAt
  );
  console.log("INSERTED article:", id, "| words:", wordCount, "| read:", readingMinutes);
}

// راستی‌آزمایی
const row = db.prepare(
  "SELECT id, slug, status, category, readingMinutes, coverImage, length(content) AS len, publishedAt FROM Article WHERE slug = ?"
).get(SLUG);
console.log("VERIFY:", JSON.stringify(row, null, 2));
// FAQ extraction check (همان منطق extractFaqFromMarkdown)
const faqHeader = /^(#{1,6})\s+(سوالات\s+متداول|پرسش(?:‌|\s)?های?\s+متداول|FAQ|سؤالات\s+متداول)\s*$/im;
console.log("FAQ_HEADER_PRESENT:", faqHeader.test(content));
const h3Count = (content.match(/^###\s+(.+?)\s*$/gm) || []).length;
console.log("H3_COUNT:", h3Count);
const imgCount = (content.match(/!\[[^\]]*\]\(([^\)]+)\)/g) || []).length;
console.log("IMG_MARKDOWN_COUNT:", imgCount);
db.close();
