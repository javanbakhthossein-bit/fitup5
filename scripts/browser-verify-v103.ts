/**
 * v103 browser verify — دیرکتیو مالک بخش رشته‌های ورزشی:
 *  ۱) سکشن رشته‌ها دو تب دارد: «آقایان» اول و پیش‌فرض، «بانوان» دوم
 *  ۲) تب آقایان ۱۳ کارت دارد (فیزیک آقایان، بادی‌بیلدینگ، پاورلیفتینگ و…) با لینک /sport/<slug>
 *  ۳) کلیک روی تب بانوان → ۱۳ کارت (ولنس، بیکینی، فیتنس بانوان و…)
 *  ۴) همهٔ لینک‌های هر دو تب به /sport/<slug> واقعی می‌روند (کرال‌پذیر)
 *  ۵) یک لندینگ جدید (/sport/wellness و /sport/mens_physique) محتوای کامل دارد (h1/h2/FAQ)
 *  ۶) صفر خطای کنسول صفحه
 * Run: bun scripts/browser-verify-v103.ts
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  OK ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  // صبر تا هیدریشن SPA و رندر سکشن رشته‌ها
  await page.waitForSelector("#disciplines", { timeout: 45000 });
  await page.waitForTimeout(1500);

  console.log("\n-- سکشن رشته‌ها: تب‌ها --");
  const tabs = page.locator('#disciplines [role="tab"]');
  const tabCount = await tabs.count();
  check("دو تب وجود دارد", tabCount === 2, `count=${tabCount}`);

  const firstTab = await tabs.nth(0).textContent();
  const secondTab = await tabs.nth(1).textContent();
  check("تب اول «آقایان»", (firstTab || "").includes("آقایان"), `first=${firstTab}`);
  check("تب دوم «بانوان»", (secondTab || "").includes("بانوان"), `second=${secondTab}`);

  const selected0 = await tabs.nth(0).getAttribute("aria-selected");
  const selected1 = await tabs.nth(1).getAttribute("aria-selected");
  check("پیش‌فرض آقایان (aria-selected)", selected0 === "true" && selected1 === "false", `0=${selected0} 1=${selected1}`);

  console.log("\n-- تب آقایان: کارت‌ها --");
  const menLinks = await page.locator('#disciplines a[href^="/sport/"]').allTextContents();
  const menHrefs = await page.locator('#disciplines a[href^="/sport/"]').evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute("href"))
  );
  check("تب آقایان ۱۳ کارت", menHrefs.length === 13, `count=${menHrefs.length}`);
  const mustMen = ["mens_physique", "bodybuilding", "powerlifting", "classic_physique", "crossfit", "calisthenics", "trx", "hiit", "functional", "balance", "pilates", "general", "fitness"];
  const missingMen = mustMen.filter((s) => !menHrefs.includes(`/sport/${s}`));
  check("همهٔ ۱۳ رشتهٔ آقایان لینک واقعی دارند", missingMen.length === 0, `missing=${missingMen.join(",")}`);
  check("اولین کارت آقایان فیتنس (ترتیب آنبوردینگ)", menHrefs[0] === "/sport/fitness", `first=${menHrefs[0]}`);
  const menCardText = menLinks.join(" ");
  check("کارت فیزیک آقایان با برچسب فارسی", menCardText.includes("فیزیک آقایان"));
  check("کارت بادی‌بیلدینگ با برچسب فارسی", menCardText.includes("بادی‌بیلدینگ"));
  check("کارت پاورلیفتینگ", menCardText.includes("پاورلیفتینگ"));

  console.log("\n-- تب بانوان: کارت‌ها --");
  await tabs.nth(1).click();
  await page.waitForTimeout(800);
  const womenHrefs = await page.locator('#disciplines a[href^="/sport/"]').evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute("href"))
  );
  check("تب بانوان ۱۳ کارت", womenHrefs.length === 13, `count=${womenHrefs.length}`);
  const mustWomen = ["womens_fitness", "wellness", "bikini_fitness", "womens_physique", "pilates", "trx", "hiit", "functional", "balance", "fitness", "crossfit", "calisthenics", "general"];
  const missingWomen = mustWomen.filter((s) => !womenHrefs.includes(`/sport/${s}`));
  check("همهٔ ۱۳ رشتهٔ بانوان لینک واقعی دارند", missingWomen.length === 0, `missing=${missingWomen.join(",")}`);
  const womenText = (await page.locator('#disciplines a[href^="/sport/"]').allTextContents()).join(" ");
  check("کارت ولنس", womenText.includes("ولنس"));
  check("کارت بیکینی فیتنس", womenText.includes("بیکینی فیتنس"));
  check("کارت فیزیک بانوان", womenText.includes("فیزیک بانوان"));

  console.log("\n-- لندینگ جدید /sport/wellness --");
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/sport/wellness`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const h1 = await p2.locator("h1").first().textContent();
  check("h1 شامل «ولنس»", (h1 || "").includes("ولنس"), `h1=${h1}`);
  const h2s = await p2.locator("h2").allTextContents();
  check("حداقل ۸ h2 (سکشن‌های سئو + فواید + FAQ)", h2s.length >= 8, `count=${h2s.length}`);
  const faqCount = await p2.locator("details").count();
  check("FAQ (details) = ۳", faqCount === 3, `count=${faqCount}`);
  const ldJson = await p2.locator('script[type="application/ld+json"]').allTextContents();
  const hasSportsActivity = ldJson.some((t) => t.includes('"SportsActivity"'));
  const hasFaqSchema = ldJson.some((t) => t.includes('"FAQPage"'));
  check("JSON-LD SportsActivity", hasSportsActivity);
  check("JSON-LD FAQPage", hasFaqSchema);
  const cta = await p2.locator('a[href="/?screen=onboarding"]').last().textContent();
  check("CTA «ساخت برنامهٔ تخصصی ولنس»", (cta || "").includes("ساخت برنامهٔ تخصصی ولنس"), `cta=${cta}`);

  console.log("\n-- لندینگ جدید /sport/mens_physique --");
  await p2.goto(`${BASE}/sport/mens_physique`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const title = await p2.title();
  check("title سئوشده شامل فیزیک آقایان", title.includes("فیزیک آقایان"), `title=${title}`);
  const canonical = await p2.locator('link[rel="canonical"]').getAttribute("href");
  check("canonical درست", canonical === "https://fittup.ir/sport/mens_physique", `canonical=${canonical}`);

  console.log("\n-- خطاهای کنسول --");
  const realErrors = consoleErrors.filter(
    (e) => !e.includes("favicon") && !e.includes("net::") && !e.includes("the server responded with a status")
  );
  check("صفر خطای کنسول/صفحه", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(`\n═══ نتیجه: ${pass} OK / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
