/**
 * build-video-mapping.mjs — سندباکس-اونلی (جزو بسته دیپلوی نیست)
 *
 * برای هر حرکتی که ویدیوی خراب (404/400) یا نامرتبط دارد، یوتیوب را جستجو
 * می‌کند، بهترین نتیجه را با oEmbed صحت‌سنجی و در scripts/exercise-video-fixes.json
 * ذخیره می‌کند. کش <cache> باعث ادامه از محل قطع شدن می‌شود.
 *
 * استفاده: bun scripts/build-video-mapping.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "fs";

const DB_URL = process.env.MAP_DB_URL || "file:/home/z/my-project/db/custom.db";
const CACHE = "/tmp/yt-map-cache.json";
const OUT = "/home/z/my-project/scripts/exercise-video-fixes.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const p = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ── حرکاتی که ویدیوی سالم ولی «حرکتِ متفاوت» دارند (بازبینی دستی من) ──
const MISMATCH = new Set([
  "هک اسکوات", "اسکوات سومو", "سیسی اسکوات", "استپ‌آپ", "زیرآرنج‌گیر",
  "جلو بازو دمبل", "جلو بازو اسکات", "پشت پا دستگاه", "گود مورنینگ", "پشت پا خوابیده",
  "زیربغل تی‌بار", "زیربغل تی‌بار صفحاتی", "فلای خماری", "شنا پایک", "شنا پایک دست",
  "پرس سینه با دمبل", "کرانچ سیم‌کش", "پلانک جانبی", "پرس سینه هالتر دست‌بسته",
  "ددلیفت رومانیایی تک‌پا", "فیس پول سرشانه", "شنا با پای بالا",
]);

// پسوند‌های تمپو/تنوع که در جستجو حذف می‌شوند (پلن B)
const STRIP = ["ایزومتریک", "پلایومتریک", "با مکث", "تک‌پا", "چرخشی", "ترکیبی", "با توقف"];

const KNOWN = ["scotthermanfitness", "crossfit", "bowflex", "howcast", "calisthenicmovement", "livestrong", "buff dudes", "jeff nippard", "athlean", "muscleandstrength", "alan thrall", "bodybuilding.com"];

function vidOf(url) { const m = /embed\/([\w-]+)/.exec(url || ""); return m ? m[1] : null; }

function norm(s) {
  return (s || "")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[يى]/g, "ی").replace(/[ك]/g, "ک").replace(/[ۀة]/g, "ه").replace(/[أإ]/g, "ا")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
const STOP = new Set(["آموزش", "اموزش", "حرکت", "تمرین", "بهترین", "صحیح", "اصول", "درست", "به", "با", "های", "شده", "کردن", "نحوه", "اجرای", "how", "to", "the", "a", "an", "exercise", "workout", "proper", "form", "technique"]);
function toks(s) { return norm(s).split(" ").filter(t => t && !STOP.has(t)); }
function score(name, title) {
  const nt = toks(name), tt = toks(title);
  if (!nt.length) return 0;
  const inter = nt.filter(t => tt.some(x => x.includes(t) || t.includes(x))).length;
  let s = inter / nt.length;
  const n = norm(name);
  if (norm(title).includes(n)) s = Math.min(1, s + 0.35);
  return s;
}
function baseName(name) { let b = name; for (const s of STRIP) b = b.replace(s, ""); return b.replace(/\s+/g, " ").trim(); }

async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}&format=json`, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": UA } });
    if (r.ok) { const j = await r.json(); return { ok: true, title: j.title, author: j.author_name }; }
    return { ok: false, status: r.status };
  } catch (e) { return { ok: false, err: String(e).slice(0, 50) }; }
}

async function ytSearch(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=fa&gl=IR`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fa,en;q=0.8" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("search " + r.status);
  const html = await r.text();
  const out = [];
  const chunks = html.split('"videoRenderer"');
  for (let i = 1; i < chunks.length && out.length < 10; i++) {
    const c = chunks[i].slice(0, 3000);
    const id = /"videoId":"([\w-]{11})"/.exec(c);
    const t = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(c);
    if (id && t) {
      let title = t[1];
      try { title = JSON.parse('"' + t[1] + '"'); } catch {}
      out.push({ id: id[1], title });
    }
  }
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pickFor(name) {
  const queries = [`آموزش ${name}`, `آموزش حرکت ${name}`, `آموزش ${baseName(name)}`];
  let best = null;
  for (const q of queries) {
    let results = [];
    try { results = await ytSearch(q); } catch (e) { await sleep(2500); continue; }
    for (const cand of results.slice(0, 8)) {
      const s0 = score(name, cand.title);
      const known = KNOWN.some(k => cand.title.toLowerCase().includes(k));
      const howto = /آموزش|فرم صحیح|اشتباه|how to/i.test(cand.title) ? 0.08 : 0;
      const s = s0 + (known ? 0.12 : 0) + howto;
      if (!best || s > best.s) best = { ...cand, s, s0, q };
    }
    if (best && best.s0 >= 0.6) break; // تطابق خوب — لازم نیست پلن بعدی
    await sleep(900);
  }
  if (!best) return null;
  const o = await oembed(best.id);
  if (!o.ok) return null;
  return { videoId: best.id, title: o.title, channel: o.author, s: best.s, s0: best.s0, q: best.q };
}

const rows = await p.$queryRaw`SELECT name, category, muscle, equipment, youtubeUrl FROM ExerciseLibrary ORDER BY name`;
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

// کدام حرکات نیاز دارند؟
const BROKEN = new Set(JSON.parse(readFileSync("/tmp/broken-ids.json", "utf8")));
const needs = rows.filter(r => BROKEN.has(vidOf(r.youtubeUrl)) || MISMATCH.has(r.name));
console.log("NEED:", needs.length, "| cached:", Object.keys(cache).length);

let done = 0, idx = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (idx < needs.length) {
    const r = needs[idx++];
    if (cache[r.name]) { done++; continue; }
    const pick = await pickFor(r.name);
    if (pick) cache[r.name] = pick; else cache[r.name] = { failed: true };
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    done++;
    if (done % 15 === 0) console.log(`... ${done}/${needs.length}`);
    await sleep(600);
  }
});
await Promise.all(workers);

const ok = Object.entries(cache).filter(([, v]) => !v.failed);
const failed = Object.entries(cache).filter(([, v]) => v.failed);
console.log(`DONE ok=${ok.length} failed=${failed.length}`);
for (const [n] of failed) console.log("FAILED:", n);
const low = ok.filter(([, v]) => v.s0 < 0.45);
console.log("LOW-CONFIDENCE (بازبینی دستی):", low.length);
for (const [n, v] of low) console.log(`LOW ${n} => ${v.videoId} [${v.s0.toFixed(2)}] ${v.title}`);
writeFileSync(OUT, JSON.stringify(Object.fromEntries(ok.map(([n, v]) => [n, { videoId: v.videoId, title: v.title, channel: v.channel }])), null, 1));
console.log("WROTE", OUT);
await p.$disconnect();
