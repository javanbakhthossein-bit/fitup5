/**
 * v242 — صادرکردن پست مهمان به پچ SQL مخصوص سرور تولیدی (idempotent)
 * اجرا: node scripts/tmp/export-guest-post-sql.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const SLUG = "why-generic-workout-plans-fail";
const db = new DatabaseSync("db/custom.db", { readOnly: true });
const row = db.prepare("SELECT * FROM Article WHERE slug = ?").get(SLUG);
if (!row) { console.error("NOT_FOUND"); process.exit(1); }
db.close();

const esc = (s) => (s == null ? "" : String(s)).replace(/'/g, "''");
const num = (v) => (v == null ? "NULL" : String(v));

const cols = ["id","title","slug","excerpt","content","category","tags","status","coverImage",
  "seoTitle","seoDescription","metaKeywords","canonicalUrl","ogImage","robots","readingMinutes",
  "publishedAt","views","createdAt","updatedAt"];
const vals = cols.map((c) => {
  const v = row[c];
  if (v == null) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${esc(v)}'`;
});

const sql = `-- ═══════════════════════════════════════════════════════════════
-- v242 — پست مهمان مجلهٔ فیتاپ: «چرا برنامه تمرینی آماده جواب نمی‌دهد؟»
-- نصب روی سرور:  sqlite3 /var/www/fitup/db/custom.db < guest-post-insert-v242.sql
-- Idempotent: اجرای چندباره امن است (upsert بر اساس slug).
-- تصاویر: پوشهٔ uploads/ این بسته را کنار uploads/ سرور کپی کنید.
-- بعد از نصب (اختیاری، برای ایندکس فوری):
--   curl -s -X POST "https://fittup.ir/api/indexnow?secret=$CRON_SECRET" \\
--     -H "Content-Type: application/json" \\
--     -d '{"urls":["https://fittup.ir/article/${SLUG}"]}'
-- ═══════════════════════════════════════════════════════════════

INSERT INTO Article (${cols.join(", ")})
VALUES (${vals.join(", ")})
ON CONFLICT(slug) DO UPDATE SET
  title=excluded.title, excerpt=excluded.excerpt, content=excluded.content,
  category=excluded.category, tags=excluded.tags, status=excluded.status,
  coverImage=excluded.coverImage, seoTitle=excluded.seoTitle,
  seoDescription=excluded.seoDescription, metaKeywords=excluded.metaKeywords,
  ogImage=excluded.ogImage, robots=excluded.robots,
  readingMinutes=excluded.readingMinutes, updatedAt=excluded.updatedAt;

SELECT 'OK: ' || slug || ' / status=' || status FROM Article WHERE slug='${SLUG}';
`;

writeFileSync("scripts/guest-post-insert-v242.sql", sql, "utf8");
console.log("SQL_WRITTEN: scripts/guest-post-insert-v242.sql |", sql.length, "chars | content:", row.content.length, "chars");
