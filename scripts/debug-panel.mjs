import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const user = await db.user.create({ data: { mobile: "0916" + String(Math.floor(1_000_000 + Math.random() * 8_999_999)), name: "dbg", role: "USER", onboardingDone: true }, select: { id: true } });
const secret = readFileSync("db/.session-secret", "utf8").trim();
const payload = Buffer.from(JSON.stringify({ uid: user.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile", viewport: { width: 412, height: 915 } });
await ctx.addCookies([{ name: "sc_session", value: token, url: "http://localhost:3000" }]);
const page = await ctx.newPage();
await page.goto("http://localhost:3000/?screen=panel", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log("URL:", page.url());
console.log("title:", await page.title());
const info = await page.evaluate(() => ({
  burger: !!document.querySelector('button[aria-label="باز کردن منو"]'),
  labels: [...document.querySelectorAll("button[aria-label]")].slice(0, 8).map((b) => b.getAttribute("aria-label")),
  bodyStart: document.body.innerText.slice(0, 180).replace(/\n/g, " | "),
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: "/tmp/v215-debug.png" });
await db.user.deleteMany({ where: { id: user.id } });
await browser.close();
process.exit(0);
