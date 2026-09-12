// E2E موقت — تست /api/daily-status با کاربر تستی (بعد از تست پاک می‌شود)
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const MOBILE = "09120000931";

async function main() {
  // ۱) کاربر تستی را پیدا/بساز
  let user = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (!user) {
    user = await db.user.create({ data: { mobile: MOBILE, name: "تست مدال", role: "USER", onboardingDone: true } });
    console.log("created test user", user.id);
  } else {
    console.log("existing test user", user.id);
  }

  // ۲) OTP تازه unused بساز
  const code = String(1000 + Math.floor(Math.random() * 8999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.otpCode.create({ data: { mobile: MOBILE, code, expiresAt } });
  console.log("OTP_CODE=" + code);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
