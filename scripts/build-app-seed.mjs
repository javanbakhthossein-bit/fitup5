/**
 * build-app-seed.mjs — برداشت دارایی‌های استاتیک سایت تولید برای «بذر» داخل APK (v1.17.0)
 *
 * هدف مالک: جابجایی نرم و روان بین بخش‌های اپ موبایل — چانک‌های JS/CSS و فونت‌ها و
 * تصاویر استاتیک از داخل APK سرو شوند (بی‌شبکه)، ولی ویدیوها هیچ‌وقت داخل اپ
 * نیایند (استریم و زنده‌بودن محتوا حفظ شود).
 *
 * چه چیزی برداشت می‌شود:
 *   ۱) /_next/static/** از سایت تولید (fittup.ir) — HTML مسیرهای اصلی + اسکن
 *      بازگشتی داخل JS/CSS ها — دقیقاً همان چانک‌هایی که سرورِ زنده سرو می‌کند
 *   ۲) public/{animations,images,fonts,splash} از سورس محلی + فایل‌های ریشهٔ برند
 *      (favicon/لوگو/hero/مانیفست — هر بار شروع سرد درخواست می‌شوند؛ داخل APK = صفر رفت‌وبرگشت شبکه)
 *
 * چه چیزی هرگز برداشت نمی‌شود: ویدیوها (mp4/webm)، public/videos، public/uploads،
 * sw.js (سرویس‌ورکر باید همیشه از سرور بیاید)، فایل‌های بالای ۲٫۵MB.
 *
 * مصرف:  node scripts/build-app-seed.mjs
 * خروجی: fitup-app + fitup-bazaar → app/src/main/assets/seed/...
 */

import fs from "node:fs";
import path from "node:path";

const BASE = "https://fittup.ir";
const ROUTES = [
  "/", "/exercises", "/exercise/cmu8vvp7q00002bc4c9bh0nmp", "/articles", "/article/fat-loss-tips",
  "/foods", "/food/fitup_v137_food_1", "/tdee", "/about", "/contact", "/terms",
  "/activity", "/download", "/wallet", "/pay",
];
const APPS = ["fitup-app", "fitup-bazaar"];
const PUB_DIRS = ["animations", "images", "fonts", "splash"];
// v1.17.1 — فایل‌های ریشهٔ public که در هر شروع سرد (favicon/مانیفست/آیکون‌ها) و
// لندینگ/اسپلش درخواست می‌شوند — داخل APK یعنی شروع بدون انتظارِ شبکه
const ROOT_PUBLIC_FILES = [
  "manifest.json",
  "favicon.png", "favicon-16.png", "favicon-32.png",
  "apple-touch-icon.png",
  "fitup-logo.png", "fitup-logo-64.png",
  "icon-512.png", "icon-512-maskable.png",
  "hero-fitup.png", "hero-fitup.webp",
  "hero-fitup-mobile.webp", "hero-fitup-desktop.webp",
  "hero-fitup-680.webp", "hero-fitup-splash.png",
];
const MAX_FILE = 2.5 * 1024 * 1024; // ۲٫۵MB
const SKIP_EXT = /\.(mp4|webm|m3u8|ts)$/i;
const RE = /\/_next\/static\/[A-Za-z0-9/._%-]+\.(?:js|css|woff2?|ttf|otf|png|webp|jpe?g|svg|gif|mp3|json)/gi;
const UA = { "User-Agent": "Mozilla/5.0 (fitup-seed-harvest)" };

const found = new Set();
const seen = new Set();

async function getText(u) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(u, { headers: UA });
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function getBuf(u) {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(String(r.status));
  return Buffer.from(await r.arrayBuffer());
}

/* ── ۱) HTML مسیرهای اصلی ── */
for (const route of ROUTES) {
  try {
    const html = await getText(BASE + route);
    for (const m of html.matchAll(RE)) found.add(m[0]);
    console.log(`route ${route}: ok — total refs ${found.size}`);
  } catch {
    console.log(`route ${route}: skip (خطا/۴۰۴)`);
  }
}

/* ── ۲) اسکن بازگشتی داخل JS/CSS (چانک‌های lazy) ── */
let frontier = [...found].filter((u) => /\.(js|css)$/i.test(u));
for (const u of frontier) seen.add(u);
let pass = 0;
while (frontier.length && pass < 3) {
  pass++;
  const next = [];
  const CHUNK = 10;
  for (let i = 0; i < frontier.length; i += CHUNK) {
    await Promise.all(
      frontier.slice(i, i + CHUNK).map(async (u) => {
        try {
          const txt = await getText(u);
          for (const m of txt.matchAll(RE)) {
            if (!seen.has(m[0])) {
              seen.add(m[0]);
              found.add(m[0]);
              next.push(m[0]);
            }
          }
        } catch {}
      })
    );
  }
  frontier = next;
  console.log(`pass ${pass}: +${next.length} — total refs ${found.size}`);
}

/* ── ۳) دانلود همهٔ فایل‌ها ── */
const list = [...found].filter((u) => !SKIP_EXT.test(u)).map((u) => (u.startsWith("http") ? u : BASE + u));
console.log(`\n⬇️  دانلود ${list.length} فایل _next/static ...`);
const files = []; // { rel, buf }
let bytes = 0, ok = 0, fail = 0;
const CONC = 12;
for (let i = 0; i < list.length; i += CONC) {
  await Promise.all(
    list.slice(i, i + CONC).map(async (u) => {
      try {
        const buf = await getBuf(u);
        if (buf.length > MAX_FILE) return;
        const rel = decodeURIComponent(u.replace(/^https?:\/\/[^/]+\//, ""));
        if (rel.includes("..")) return;
        files.push({ rel, buf });
        ok++;
        bytes += buf.length;
      } catch {
        fail++;
      }
    })
  );
}
console.log(`   ok=${ok} fail=${fail} — ${(bytes / 1048576).toFixed(1)} MB`);

/* ── ۴) فایل‌های عمومی public (بدون ویدیو) ── */
function walk(dir, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cb);
    else cb(p);
  }
}
const pubFiles = [];
for (const d of PUB_DIRS) {
  const abs = path.resolve("public", d);
  if (fs.existsSync(abs)) walk(abs, (p) => {
    const rel = path.relative("public", p).split(path.sep).join("/");
    if (SKIP_EXT.test(rel)) return;
    if (fs.statSync(p).size > MAX_FILE) return;
    pubFiles.push({ abs: p, rel });
  });
}
for (const name of ROOT_PUBLIC_FILES) {
  const abs = path.resolve("public", name);
  if (fs.existsSync(abs) && fs.statSync(abs).size <= MAX_FILE) {
    pubFiles.push({ abs, rel: name });
  }
}
console.log(`public dirs: ${pubFiles.length} فایل`);

/* ── ۵) نوشتن در seed هر دو اپ ── */
let totalApp = 0;
for (const app of APPS) {
  const seed = path.resolve(app, "app/src/main/assets/seed");
  fs.mkdirSync(seed, { recursive: true });
  let n = 0;
  for (const f of files) {
    // ⚠️ aapt مسیرهای زیرخط‌دار را از snapshot حذف می‌کند → روی دیسک زیر nx/ ذخیره می‌شود
    const dest = path.join(seed, "nx", f.rel.replace(/^_next\//, ""));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.buf);
    n++;
  }
  for (const f of pubFiles) {
    const dest = path.join(seed, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
    n++;
  }
  const size = execDu(seed);
  totalApp = size;
  console.log(`✅ ${app}/app/src/main/assets/seed → ${n} فایل — ${size.toFixed(1)} MB`);
}

function execDu(dir) {
  let s = 0;
  walk(dir, (p) => { s += fs.statSync(p).size; });
  return s / 1048576;
}
console.log(`\nتمام — حجم seed نهایی هر اپ: ~${totalApp.toFixed(1)} MB`);
