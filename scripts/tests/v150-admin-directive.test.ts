/**
 * v150 — تست یونیت دیرکتیوهای این نسخه
 *  ① دستور اصولی مدیر: buildAdminDirective وابسته به متن — خالی = بدون دیرکتیو
 *  ② فیلد planRegenExtra در DDL selfheal حاضر است (جدول تازه + ستون)
 *  ③ فیلتر نویز: امضای case-insensitive window.webkit.messagehandlers
 *  ④ به‌روزرسانی برنامه باکس: منطق sanitize instructions (خالی → رفتار قبلی)
 * خالص و بدون DB/AI — قابل اجرا در CI.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNoiseError } from "../../src/lib/fitness/error-noise";
import { SCHEMA_DDL_STATEMENTS } from "../../src/lib/fitness/db-schema-ddl";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("v150 — دستور اصولی مدیر (باکس به‌روزرسانی برنامه)", () => {
  it("API ادمین instructions خالی/غایب را می‌پذیرد و null پاس می‌دهد (رفتار قبلی)", () => {
    const src = read("src/app/api/admin/programs/route.ts");
    expect(src.includes("instructions?: string")).toBe(true);
    // منطق: فقط اگر trim().length > 0 → پاس به تولید
    expect(src.includes('body.instructions.trim().length > 0')).toBe(true);
    // پاس فقط شرطی
    expect(src.includes("...(adminInstructions ? { adminInstructions } : {})")).toBe(true);
  });

  it("startProgramGenerationInBackground adminInstructions را به دیرکتیو الزامی تبدیل می‌کند", () => {
    const src = read("src/lib/fitness/program-generation.ts");
    expect(src.includes("adminInstructions?: string | null;")).toBe(true);
    expect(src.includes("دستور صریح و الزامی مدیر فیتاپ")).toBe(true);
    // سقف ۴۰۰۰ نویسه با capPromptText (۷۰/۳۰)
    expect(src.includes("capPromptText(adminInstructionsRaw, 4000)")).toBe(true);
  });

  it("دیرکتیو مدیر در پرامپت تمرین بالاتر از دیرکتیو بازطراحی چت تزریق می‌شود", () => {
    const src = read("src/lib/fitness/ai.ts");
    const workoutPromptIdx = src.indexOf("یک برنامه تمرینی هفتگی کامل");
    const adminIdx = src.indexOf("extras?.adminDirective", workoutPromptIdx);
    const redesignIdx = src.indexOf("extras?.redesignDirective", workoutPromptIdx);
    expect(workoutPromptIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(-1);
    expect(redesignIdx).toBeGreaterThan(adminIdx); // admin اول (بالاترین اولویت)
    // تغذیه هم دیرکتیو مدیر را می‌گیرد
    const mealPromptIdx = src.indexOf("یک برنامه غذایی یک روزه کامل");
    expect(mealPromptIdx).toBeGreaterThan(-1);
    const mealAdminIdx = src.indexOf("extras?.adminDirective", mealPromptIdx);
    expect(mealAdminIdx).toBeGreaterThan(-1);
  });
});

describe("v150 — سهمیهٔ اضافهٔ اهدایی درخواست تغییر برنامه از چت", () => {
  it("DDL selfheal ستون planRegenExtra را دارد (فیکس بازگردانی بکاپ قدیمی)", () => {
    const subDdl = SCHEMA_DDL_STATEMENTS.find((s) => s.includes('CREATE TABLE IF NOT EXISTS "Subscription"'));
    expect(subDdl).toBeDefined();
    expect(subDdl!).toContain('"planRegenExtra"');
  });

  it("منطق مصرف: used=false تا وقتی extra>0 — مصرف بونوس از extra کم می‌کند", () => {
    const src = read("src/lib/fitness/plan-change-intent.ts");
    // getPlanRegenState — used با احتساب extra
    expect(src.includes('(holder?.planRegenUsed ?? false) && (holder?.planRegenExtra ?? 0) <= 0')).toBe(true);
    // مصرف از بونوس — decrement فقط وقتی پایه قبلاً used بوده
    expect(src.includes("consumeFromExtra")).toBe(true);
    expect(src.includes("planRegenExtra: { decrement: 1 }")).toBe(true);
  });

  it("state چت و auth هم extra را منعکس می‌کنند", () => {
    const intent = read("src/lib/fitness/plan-change-intent.ts");
    expect(intent.includes("extra: holder?.planRegenExtra ?? 0")).toBe(true);
    const auth = read("src/lib/fitness/auth.ts");
    expect(auth.includes("planRegenExtra ?? 0")).toBe(true);
  });

  it("API grant ادمین: clamp ۱ تا ۵۰ + نوتیف کاربر + اشتراک ح-holder", () => {
    const grant = read("src/app/api/admin/users/[id]/plan-regen-grant/route.ts");
    expect(grant.includes("amount < 1 || amount > 50")).toBe(true);
    expect(grant.includes("planRegenExtra: { increment: amount }")).toBe(true);
    expect(grant.includes("createNotification")).toBe(true);
  });
});

describe("v150 — فیلتر نویز خطاهای مرورگر (Clarity)", () => {
  it("امضای lowercase window.webkit.messagehandlers فیلتر می‌شود", () => {
    expect(
      isNoiseError({
        message: "undefined is not an object (evaluating 'window.webkit.messagehandlers')",
        hasErrorObject: true,
      })
    ).toBe(true);
    // حالت استاندارد (v37) هم سر جایش است
    expect(
      isNoiseError({ message: "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers.sendDataToNative')", hasErrorObject: true })
    ).toBe(true);
    // خطای واقعی اپ هرگز فیلتر نمی‌شود
    expect(isNoiseError({ message: "Cannot read properties of undefined (reading 'map')", hasErrorObject: true })).toBe(false);
  });
});

describe("v150 — ابزارها و ثبات‌ها", () => {
  it("تیتر /tdee هم‌تراز بقیهٔ صفحات ابزار است", () => {
    const tdee = read("src/app/tdee/page.tsx");
    expect(tdee.includes("pt-[7.5rem] sm:pt-24")).toBe(true);
    const ex = read("src/app/exercises/page.tsx");
    expect(ex.includes("pt-[7.5rem] sm:pt-24")).toBe(true);
  });

  it("ارقام بانک غذاها قطعی‌اند (بدون toLocaleString fa-IR در SSR کلاینت)", () => {
    const foods = read("src/app/foods/foods-hub-list.tsx");
    // تبدیل قطعی pure-JS — به‌جای ICU locale که بین Node/مرورگر تفاوت دارد
    expect(foods.includes("FA_DIGITS")).toBe(true);
    expect(/const toFa[\s\S]*?toLocaleString\("en-US"\)/.test(foods)).toBe(true);
    // هیچ فراخوانی واقعی fa-IR در کد باقی نمانده (کامنت اشکال ندارد)
    expect(/(?<![/\s"])(?:toLocaleString|toLocaleDateString|toLocaleTimeString)\("fa-IR"\)/.test(foods.replace(/\/\/.*/g, ""))).toBe(false);
  });

  it("همهٔ مسیرهای حساس پرداخت fetch تاب‌آور دارند", () => {
    const purchaseModal = read("src/components/fitness/landing/sections/purchase-modal.tsx");
    for (const path of ["/api/payment/discount", "/api/payment/verify", "/api/payment/bazaar/dynamic-price", "/api/payment/bazaar/purchase"]) {
      const idx = purchaseModal.indexOf(`"${path}"`);
      expect(idx).toBeGreaterThan(-1);
      const before = purchaseModal.slice(Math.max(0, idx - 220), idx);
      expect(before.includes("fetchWithResilience")).toBe(true);
    }
    const verifyHandler = read("src/components/fitness/payment-verify-handler.tsx");
    expect(verifyHandler.includes('fetchWithResilience("/api/payment/verify"')).toBe(true);
    expect(verifyHandler.includes('fetchWithResilience("/api/payment/lookup-pending"')).toBe(true);
    const renew = read("src/app/renew/renew-client.tsx");
    expect(renew.includes('fetchWithResilience("/api/renew/verify"')).toBe(true);
    const profile = read("src/components/fitness/views/profile-overlay.tsx");
    expect(profile.includes('fetchWithResilience("/api/payment/bazaar/wallet"')).toBe(true);
  });
});
