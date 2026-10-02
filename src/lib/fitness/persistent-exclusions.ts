/**
 * ─────────────────────────────────────────────────────────────────────────
 * persistent-exclusions.ts (v157) — «ممنوعیت‌های ماندگار کاربر/مدیر»
 *
 * ریشه‌یابی تیکت مالک (مصطفی خوشبخت — «چند بار روش کار کردی ولی هیچ وقت درست
 * نشده و کاربران من الان شاکی هستند»):
 *
 * سه حفرهٔ ریشه‌ای که در ۱۰+ تعمیر قبلی دیده نشده بود:
 *   حفرهٔ ۱ — مسیر تاییدِ «تایپ‌شده»: وقتی کاربر به‌جای دکمهٔ کارت، «تایید
 *     نهایی» را تایپ می‌کند، مسیر چت changeSummary را پاس نمی‌داد →
 *     ممنوعیت‌های توافق‌شده هیچ‌وقت ذخیره و هیچ‌وقت در تولید مسلح نمی‌شد.
 *   حفرهٔ ۲ — یک‌مصرفی بودن: planRegenRequest اشتراک بعد از اولین تولیدِ موفق
 *     «پاک» می‌شد → در هر بازتولید بعدی (به‌روزرسانی وزن، بازنویسی مدیر،
 *     چکاپ، تمدید) حافظهٔ ممنوعیت‌ها از بین می‌رفت و حرکات حذفی «برمی‌گشتند» —
 *     دقیقاً شکایت مالک: «در بازنویسی برنامه و به‌روزرسانی برنامه هم چنین
 *     مشکلی نباید وجود داشته باشد».
 *   حفرهٔ ۳ — پوشش ناقص: ممنوعیت‌ها فقط برای source=chat_request مسلح می‌شدند؛
 *     بقیهٔ منابع تولید هیچ ممیزی پس‌تولیدی نداشتند.
 *
 * راه‌حل این ماژول — مخزن ماندگار سمت پروفایل کاربر (OnboardingProfile.
 * persistentExclusions):
 *   • «جمع‌کردن» (merge) از همهٔ مسیرهای ثبت: چت (نیت بازطراحی/تایید تایپی/
 *     پیام عادی با درخواست حذف صریح) + اصول مدیر در باکس به‌روزرسانی.
 *   • «هرگز منقضی نمی‌شود» و «هرگز خودکار پاک نمی‌شود» — آسیب (کمر/مچ/زانو)
 *     منقضی شدن ندارد؛ فقط مدیر می‌تواند اصلاح/پاک کند.
 *   • «همهٔ» تولیدها آن را می‌خوانند (تزریق ⛔ به پرامپت + ممیزی قطعی
 *     پس‌تولیدی enforceWorkoutExclusions/enforceMealExclusions در ai.ts).
 *   • سقف ایمن: همان sanitizeConstraints (۲۴ قلم × ۶۰ نویسه در هر سبد).
 *   • سازگاری با عقب: فیلد nullable JSON؛ برنامه‌های قبلی و مسیرهای خواندن
 *     دست‌نخورده می‌مانند.
 *
 * همیشه best-effort — هیچ تابعی از این ماژول جریان چت/تولید را نمی‌شکند.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  sanitizeConstraints,
  mergeConstraints,
  type RedesignConstraints,
} from "./plan-redesign-constraints";

/** خواندن ممنوعیت‌های ماندگار کاربر (null = چیزی ثبت نشده) */
export async function readPersistentExclusions(
  userId: string
): Promise<RedesignConstraints | null> {
  try {
    const profile = await db.onboardingProfile.findUnique({
      where: { userId },
      select: { persistentExclusions: true },
    });
    return sanitizeConstraints(profile?.persistentExclusions);
  } catch (err) {
    console.warn("[persistent-exclusions] read failed (non-fatal):", err);
    return null;
  }
}

/**
 * ادغام ممنوعیت‌های تازه در مخزن ماندگار — جمع‌شونده و هرگز کاهنده نیست.
 * خروجی: مخزن پس از ادغام (null = ادغامی انجام نشد).
 */
export async function mergePersistentExclusions(
  userId: string,
  incoming: RedesignConstraints | null | undefined
): Promise<RedesignConstraints | null> {
  try {
    const sanitized = sanitizeConstraints(incoming);
    if (!sanitized) return null;
    const current = await readPersistentExclusions(userId);
    const merged = mergeConstraints(current, sanitized);
    if (!merged) return null;
    const payload = JSON.stringify({
      ...merged,
      updatedAt: new Date().toISOString(),
    });
    await db.onboardingProfile.update({
      where: { userId },
      data: { persistentExclusions: payload },
    });
    console.log(
      `[persistent-exclusions] merged for user=${userId}: ` +
        `movements=[${merged.forbiddenMovements.join("، ")}] ` +
        `foods=[${merged.forbiddenFoods.join("، ")}] ` +
        `supplements=[${merged.forbiddenSupplements.join("، ")}]`
    );
    return merged;
  } catch (err) {
    console.warn("[persistent-exclusions] merge failed (non-fatal):", err);
    return null;
  }
}

/**
 * جایگزینی کامل مخزن — فقط برای مدیر (پنل ادمین).
 * next=null یعنی پاک‌کردن کامل ممنوعیت‌های ماندگار کاربر.
 */
export async function replacePersistentExclusions(
  userId: string,
  next: RedesignConstraints | null
): Promise<boolean> {
  try {
    const sanitized = sanitizeConstraints(next);
    const payload = sanitized
      ? ({ ...sanitized, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    await db.onboardingProfile.update({
      where: { userId },
      data: { persistentExclusions: payload },
    });
    console.log(
      `[persistent-exclusions] admin replaced for user=${userId}: ` +
        (sanitized
          ? `movements=[${sanitized.forbiddenMovements.join("، ")}] foods=[${sanitized.forbiddenFoods.join("، ")}] supplements=[${sanitized.forbiddenSupplements.join("، ")}]`
          : "cleared")
    );
    return true;
  } catch (err) {
    console.warn("[persistent-exclusions] admin replace failed (non-fatal):", err);
    return false;
  }
}

/**
 * v157 — استخراج واژه‌نامه‌ای سریع (بدون LLM) + ادغام در مخزن ماندگار.
 * لایهٔ ضبط ارگانیک: از هر متنی که «نشانهٔ حذف» صریح دارد، ممنوعیت‌ها برای
 * همیشه ثبت می‌شوند. گارد نیت حذفِ پارسر (v157) جلوی ممنوع‌شدن اشتباه از
 * سؤال‌های معمولی («به جای بارفیکس چی برم؟») را می‌گیرد.
 */
export async function capturePersistentExclusionsFromText(
  userId: string,
  ...texts: Array<string | null | undefined>
): Promise<RedesignConstraints | null> {
  try {
    const { parseRedesignConstraintsFromText } = await import(
      "./plan-redesign-constraints"
    );
    const parsed = parseRedesignConstraintsFromText(...texts);
    if (!parsed) return null;
    return await mergePersistentExclusions(userId, parsed);
  } catch (err) {
    console.warn("[persistent-exclusions] capture failed (non-fatal):", err);
    return null;
  }
}
