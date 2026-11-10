/**
 * ابزار تست سندباکس v265 — ساخت کاربر سینتتیک + توکن سشن معتبر + توکن تخفیف پیامکی
 * اجرا: bun --preload ./scripts/stub-next-headers.ts ./scripts/v265-test-session.ts <mode>
 * mode=setup | cleanup
 */
import { scryptSync, randomBytes } from "crypto";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { db } from "../src/lib/db";

function resolveSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const candidates = [
    path.join(process.cwd(), "db", ".session-secret"),
    path.join(process.cwd(), ".session-secret"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8").trim();
  }
  throw new Error("session secret not found");
}

function makeToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, resolveSecret(), 32).toString("hex");
  return `${payload}.${sig}`;
}

const MOBILE = "09990000001";

async function setup() {
  let user = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (!user) {
    user = await db.user.create({
      data: { name: "تست-قیف-v265", mobile: MOBILE, role: "USER" },
    });
    console.log("کاربر تستی ساخته شد:", user.id);
  } else {
    console.log("کاربر تستی موجود بود:", user.id);
  }
  const token = makeToken(user.id);
  console.log("SESSION_TOKEN=" + token);

  // توکن تخفیف تحلیل «پنجرهٔ پیامک» — ۲ ساعت
  await db.paymentToken.deleteMany({ where: { userId: user.id, kind: "analysis_discount" } });
  const pt = await db.paymentToken.create({
    data: {
      token: `v265test-${randomBytes(6).toString("hex")}`,
      kind: "analysis_discount",
      userId: user.id,
      amount: 10,
      source: "abandoned_cart_sms",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  console.log("ANALYSIS_TOKEN=" + pt.token, "(source=abandoned_cart_sms, 2h)");
  process.exit(0);
}

async function cleanup() {
  const user = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (!user) { console.log("کاربر تستی نبود"); process.exit(0); }
  await db.paymentToken.deleteMany({ where: { userId: user.id } });
  await db.userDiscountCode.deleteMany({ where: { userId: user.id } });
  await db.otpCode.deleteMany({ where: { mobile: MOBILE } });
  await db.onboardingProfile.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log("کاربر تستی + ردیف‌های وابسته پاک شد");
  process.exit(0);
}

const mode = process.argv[2] || "setup";
if (mode === "cleanup") await cleanup(); else await setup();
