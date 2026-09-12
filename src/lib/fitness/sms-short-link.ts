/**
 * لینک کوتاه پیامکی — فیکس ریشه‌ای خطای 114 سامانهٔ sms.ir (v48)
 *
 * خطای پنل مالک:
 *   «کد وضعیت 114 — طول رشته مقدار پارامتر، بیش از حد مجاز (۲۵ کاراکتر)»
 * ریشه: پارامتر LINK پیامک‌های تمدید (184777 / 322780 / 604678 / 883325)
 * مقدار «go/renew?t=<JWT>» می‌گرفت — صدها کاراکتر. نتیجه: ارسال اول با 400/114
 * رد و نردبان خودترمیم پیامک را «بدون لینک» می‌فرستاد (کاربر پیامک بی‌لینک می‌گرفت).
 *
 * راه‌حل: نگاشت کد کوتاه یکتا (۸ کاراکتر) به مقصد کامل در DB →
 *   LINK در پیامک = «r/XXXXXXXX» (۱۰ کاراکتر — خیلی زیر سقف ۲۵)
 *   و مسیر /r/[code] با 302 به مقصد واقعی (go/renew?t=… — لینک هوشمند اپ حفظ است).
 *
 * ایمنی: کد فقط [a-zA-Z0-9] — قابل تایپ؛ انقضا هم‌زمان با توکن تمدید (۱۸۰ روز).
 */

import { randomBytes } from "crypto";
import { db } from "@/lib/db";

/** حداکثر طول مجاز مقدار هر پارامتر قالب sms.ir (خطای 114) */
export const SMS_PARAM_MAX_LEN = 25;

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * ساخت لینک کوتاه برای پیامک — خروجی همیشه ≤ ۲۵ کاراکتر.
 * target = مسیر نسبی (مثل «go/renew?t=...») — دامنه در متن قالب است.
 * @returns مثل «r/Km7pQ2xN» — در بدترین حالت (شکست DB) همان target برمی‌گردد
 *          و گارد طول در sendTemplateSms پارامتر بلند را حذف می‌کند (پیامک بی‌لینک نمی‌ماند — بی‌لینک می‌رود ولی 114 نمی‌خورد)
 */
export async function createSmsShortLink(
  target: string,
  opts?: { userId?: string; expiresAt?: Date | null }
): Promise<string> {
  const safeTarget = String(target || "").trim();
  if (!safeTarget) return "";

  // اگر خود target قبلاً کوتاه است (≤۲۵) نیازی به نگاشت نیست
  if (safeTarget.length <= SMS_PARAM_MAX_LEN) return safeTarget;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(attempt === 0 ? 8 : 8 + attempt);
    try {
      await db.smsShortLink.create({
        data: {
          code,
          target: safeTarget,
          userId: opts?.userId ?? null,
          expiresAt: opts?.expiresAt ?? null,
        },
      });
      return `r/${code}`; // ۱۰ کاراکتر
    } catch (err: unknown) {
      // P2002 = برخورد کد یکتا → کد جدید
      const isP2002 =
        typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
      if (!isP2002) {
        console.error("[sms-short-link] create failed:", err);
        return ""; // شکست → گارد طول پارامتر را مدیریت می‌کند
      }
    }
  }
  return "";
}

/** لینک کوتاه تمدید — پرکاربردترین سناریو (تولید توکن + نگاشت کوتاه یک‌جا) */
export async function createSmsRenewLink(
  userId: string,
  subscriptionId: string
): Promise<string> {
  const { createRenewToken } = await import("@/lib/fitness/renew-token");
  const target = `go/renew?t=${createRenewToken(userId, subscriptionId)}`;
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // هم‌زمان با TTL توکن
  return createSmsShortLink(target, { userId, expiresAt });
}
