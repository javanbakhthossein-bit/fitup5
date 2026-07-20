/**
 * SMS.ir OTP Gateway helper
 * Docs: https://api.sms.ir/v1/send/verify
 *
 * Authentication: HTTP header `x-api-key: <API_KEY>` (NOT Bearer).
 * Mobile format: `9XXXXXXXXX` (without leading 0 or 98).
 * Body: { mobile, templateId, parameters: [{ name, value }] }
 * Response: { status: 1, message: "موفق", data: { messageId, cost } }
 */

const SMSIR_API_URL = "https://api.sms.ir/v1/send/verify";

export interface SmsIrResult {
  success: boolean;
  status?: number;
  raw?: unknown;
  error?: string;
}

/**
 * Normalize an Iranian mobile number to the format SMS.ir expects:
 *   "09123456789"  → "9123456789"
 *   "989123456789" → "9123456789"
 *   "+989123456789"→ "9123456789"
 *   "00989123456789"→ "9123456789"
 */
export function normalizeMobileForSmsIr(mobile: string): string {
  let m = mobile.replace(/\s/g, "").replace(/[+\-()]/g, "");
  // Strip country code variants
  if (m.startsWith("0098")) m = m.slice(4);
  else if (m.startsWith("98")) m = m.slice(2);
  // Strip leading 0
  if (m.startsWith("0")) m = m.slice(1);
  return m;
}

/**
 * Send a verification OTP via sms.ir using the configured template.
 *
 * @param mobile Iranian mobile number (any common format — will be normalized)
 * @param code   4-digit code as a string (e.g. "1234")
 */
export async function sendOtpSms(mobile: string, code: string): Promise<SmsIrResult> {
  const apiKey = process.env.SMSIR_API_KEY;
  const templateIdRaw = process.env.SMSIR_TEMPLATE_ID;

  if (!apiKey || !templateIdRaw) {
    return {
      success: false,
      error: "SMSIR_API_KEY یا SMSIR_TEMPLATE_ID تنظیم نشده است.",
    };
  }

  const templateId = Number(templateIdRaw);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return {
      success: false,
      error: "SMSIR_TEMPLATE_ID نامعتبر است.",
    };
  }

  const normalized = normalizeMobileForSmsIr(mobile);

  if (!/^9\d{9}$/.test(normalized)) {
    return {
      success: false,
      error: `شماره موبایل نرمال‌شده نامعتبر است: ${normalized}`,
    };
  }

  try {
    const res = await fetch(SMSIR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // CRITICAL: sms.ir uses `x-api-key`, NOT `Authorization: Bearer`.
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        mobile: normalized,
        templateId,
        // Parameter name must match the placeholder key defined in the
        // sms.ir panel template. Common conventions: "CODE" or "Code".
        // We use "CODE" (most common default). If the template uses a
        // different key, update SMSIR_PARAM_NAME below.
        parameters: [{ name: "CODE", value: code }],
      }),
      cache: "no-store",
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response — keep data null.
    }

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        raw: data,
        error: `sms.ir خطای HTTP ${res.status}`,
      };
    }

    // sms.ir returns { status: <code>, message: "...", data: {...} }
    // status === 1 → success.
    const statusField =
      data && typeof data === "object" && "status" in data
        ? (data as { status: unknown }).status
        : undefined;

    if (statusField !== undefined && statusField !== 1) {
      const messageField =
        data && typeof data === "object" && "message" in data
          ? (data as { message: unknown }).message
          : undefined;
      return {
        success: false,
        status: typeof statusField === "number" ? statusField : res.status,
        raw: data,
        error: `sms.ir خطای وضعیت ${String(statusField)}${
          messageField ? ` — ${String(messageField)}` : ""
        }`,
      };
    }

    return { success: true, status: res.status, raw: data };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "خطای ناشناخته در اتصال به sms.ir",
    };
  }
}
