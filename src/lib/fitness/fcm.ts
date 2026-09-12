// ═══════════════════════════════════════════════════════════════════════════
// fcm.ts (Task 2-d) — Firebase Cloud Messaging برای اپ اندروید فیتاپ
//
// هدف مالک: «وقتی اپ موبایل کلاً از گوشی بسته است نوتیف‌ها ارسال نمی‌شود» —
// اپ اندروید (ir.fittup.panel) توکن FCM خودش را با کوکی سشن روی
// /api/app/device-token ثبت می‌کند (FcmService.onNewToken / پل syncDeviceToken)
// و این ماژول همان لحظهٔ ساخت نوتیف (createNotification) پیام را به توکن‌ها
// می‌فرستد تا حتی با اپِ کاملاً بسته (force-stop نه — از	recents بسته)،
// نوتیف سیستم‌عامل از مسیر گوگل تحویل داده شود.
//
// دو حالت احراز هویت (هر کدام تنظیم شود):
//  ۱) FCM_SERVICE_ACCOUNT_JSON (ترجیحی — OAuth v1):
//     محتوای فایل JSON سرویس‌اکانت Firebase (خام یا base64) → JWT با RS256
//     (crypto.sign با private_key) → access_token از oauth2.googleapis.com
//     → POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
//  ۲) FCM_LEGACY_SERVER_KEY (legacy):
//     کلید سرور legacy پنل Firebase → POST https://fcm.googleapis.com/fcm/send
//     با هدر Authorization: key=...
//
// قراردادهای امنیتی این ماژول:
//  - هیچ‌وقت throw نمی‌کند — فقط log (push هرگز نباید جریان اصلی نوتیف را بشکند)
//  - هر درخواست timeout ۳۰ ثانیه‌ای دارد
//  - توکن‌های نامعتبر (Unregistered/InvalidRegistration/NOT_FOUND/…) به‌صورت
//    dead برگردانده می‌شوند تا کالر (sendFcmToUser) آن‌ها را از DB پاک کند
// ═══════════════════════════════════════════════════════════════════════════
import { createSign } from "crypto";
import { db } from "@/lib/db";

/** کانال نوتیف اندروید — باید با MainActivity.CHANNEL_ID یکی باشد */
const ANDROID_CHANNEL_ID = "fitup_general";

const FCM_LEGACY_ENDPOINT = "https://fcm.googleapis.com/fcm/send";

export interface FcmPayload {
  title: string;
  body: string;
  /** مسیر داخلی اپ (مثل "?tab=progress") — برای مسیریابی تپ روی نوتیف */
  link?: string | null;
  /** id رکورد Notification — برای dedupe/مسیریابی در اپ */
  notificationId?: string;
  type?: string;
  /** دادهٔ آزاد اضافه — همهٔ مقادیر به رشته تبدیل می‌شوند (FCM فقط string می‌پذیرد) */
  data?: Record<string, unknown> | null;
}

export interface FcmSendResult {
  attempted: number;
  /** توکن‌هایی که با موفقیت تحویل FCM شدند */
  delivered: string[];
  /** توکن‌های قطعاً نامعتبر — باید از DB حذف شوند */
  dead: string[];
  /** توکن‌هایی که موقتاً ناموفق بودند (network/سرور) — نگه داشته می‌شوند */
  failed: string[];
}

/**
 * آیا FCM روی سرور تنظیم شده؟ (برای GET /api/app/notifications/sync →
 * اپ می‌تواند لاگ بگذارد/رفتارش را تنظیم کند؛ بدون تنظیم هم همه‌چیز graceful است)
 */
export function isFcmConfigured(): boolean {
  const legacy = process.env.FCM_LEGACY_SERVER_KEY?.trim();
  const sa = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  return Boolean(legacy || sa);
}

// ─────────────────────────── سرویس‌اکانت (OAuth v1) ───────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** کش توکن OAuth — تا نزدیک انقضا استفاده می‌شود (هر پیام توکن جدید نمی‌گیرد) */
let _cachedOAuth: { token: string; expiresAt: number } | null = null;

/**
 * پارس FCM_SERVICE_ACCOUNT_JSON — خام (JSON) یا base64.
 * خطا → null (و فقط log) — هرگز throw نمی‌کند.
 */
function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    let text = raw.trim();
    // اگر با { شروع نمی‌شود احتمالاً base64 است
    if (!text.startsWith("{")) {
      text = Buffer.from(text, "base64").toString("utf8");
    }
    const obj = JSON.parse(text);
    if (obj && obj.project_id && obj.client_email && obj.private_key) {
      return {
        project_id: String(obj.project_id),
        client_email: String(obj.client_email),
        // کلید خصوصی داخل JSON با «\n» ذخیره شده — اگر escape مانده باشد normalize می‌شود
        private_key: String(obj.private_key).replace(/\\n/g, "\n"),
      };
    }
    console.warn("[fcm] service account JSON missing project_id/client_email/private_key");
  } catch (err) {
    console.warn("[fcm] FCM_SERVICE_ACCOUNT_JSON parse failed:", (err as Error)?.message);
  }
  return null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/** fetch با timeout — هیچ درخواستی بیش از ۳۰ ثانیه معلق نمی‌ماند */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * گرفتن access_token OAuth با JWT امضاشده RS256 (بدون هیچ کتابخانهٔ خارجی —
 * فقط crypto خود Node). خطا → null.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  try {
    if (_cachedOAuth && Date.now() < _cachedOAuth.expiresAt - 60_000) {
      return _cachedOAuth.token;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = b64url(signer.sign(sa.private_key));
    const jwt = `${header}.${claims}.${signature}`;

    const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    });
    if (!res.ok) {
      console.warn("[fcm] OAuth token request failed:", res.status, await safeText(res));
      return null;
    }
    const json: any = await res.json();
    const token = json?.access_token ? String(json.access_token) : null;
    if (!token) {
      console.warn("[fcm] OAuth token response missing access_token");
      return null;
    }
    _cachedOAuth = {
      token,
      expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000,
    };
    return token;
  } catch (err) {
    console.warn("[fcm] OAuth token error:", (err as Error)?.message);
    return null;
  }
}

// ─────────────────────────── ساخت payload ───────────────────────────

/**
 * data payload — FCM فقط مقادیر string می‌پذیرد.
 * «fitup_link» کلید اپ اندروید است: وقتی اپ بسته است و FCM خودش نوتیف سیستمی
 * را می‌سازد، data به‌صورت extras روی launch intent می‌آید و MainActivity
 * با کلید fitup_link آن را به WebView می‌فرستد (v1.2.5 pattern).
 */
function buildDataPayload(payload: FcmPayload): Record<string, string> {
  const data: Record<string, string> = {};
  if (payload.notificationId) data.id = String(payload.notificationId);
  if (payload.type) data.type = String(payload.type);
  const link = payload.link ?? "";
  data.link = String(link);
  data.fitup_link = String(link);
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      if (v == null) continue;
      try {
        data[k] = typeof v === "string" ? v : JSON.stringify(v);
      } catch {
        // مقدار غیرقابل‌سریالایز — رد شو (هرگز نباید کل ارسال را ببندد)
      }
    }
  }
  return data;
}

// ─────────────────────────── ارسال — Legacy ───────────────────────────

/** خطاهای legacy که یعنی توکن مرده است (هرگز دوباره کار نمی‌کند) */
const DEAD_LEGACY_ERRORS = new Set([
  "Unregistered",
  "InvalidRegistration",
  "NotRegistered",
  "MismatchSenderId",
  "UNREGISTERED",
  "NOT_FOUND",
  "INVALID_ARGUMENT",
]);

async function sendLegacy(tokens: string[], payload: FcmPayload): Promise<FcmSendResult> {
  const key = (process.env.FCM_LEGACY_SERVER_KEY || "").trim();
  const result: FcmSendResult = { attempted: tokens.length, delivered: [], dead: [], failed: [] };
  try {
    const res = await fetchWithTimeout(FCM_LEGACY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `key=${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        registration_ids: tokens,
        priority: "high",
        notification: {
          title: payload.title,
          body: payload.body,
          sound: "default",
          // اگر کانال ساخته شده باشد (اپ حداقل یک‌بار باز شده) نوتیف پس‌زمینه
          // مستقیم روی کانال فیتاپ می‌نشیند؛ وگرنه FCM به کانال پیش‌فرض می‌رود
          android_channel_id: ANDROID_CHANNEL_ID,
        },
        data: buildDataPayload(payload),
      }),
    });
    if (!res.ok) {
      console.warn("[fcm] legacy send failed:", res.status, await safeText(res));
      result.failed = [...tokens];
      return result;
    }
    const json: any = await res.json();
    const results: any[] = Array.isArray(json?.results) ? json.results : [];
    results.forEach((r, i) => {
      const token = tokens[i];
      if (!token) return;
      const err = typeof r?.error === "string" ? r.error : "";
      if (r?.message_id) {
        result.delivered.push(token);
      } else if (err && DEAD_LEGACY_ERRORS.has(err)) {
        result.dead.push(token);
      } else {
        if (err) console.warn(`[fcm] legacy token error (${err.slice(0, 80)})`);
        result.failed.push(token);
      }
    });
  } catch (err) {
    console.warn("[fcm] legacy send error:", (err as Error)?.message);
    result.failed = [...tokens];
  }
  return result;
}

// ─────────────────────────── ارسال — HTTP v1 ───────────────────────────

async function sendV1(sa: ServiceAccount, tokens: string[], payload: FcmPayload): Promise<FcmSendResult> {
  const result: FcmSendResult = { attempted: tokens.length, delivered: [], dead: [], failed: [] };
  const accessToken = await getAccessToken(sa);
  if (!accessToken) {
    result.failed = [...tokens];
    return result;
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  const data = buildDataPayload(payload);

  for (const token of tokens) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data,
            android: {
              priority: "HIGH",
              notification: { channel_id: ANDROID_CHANNEL_ID, sound: "default" },
            },
          },
        }),
      });
      if (res.ok) {
        result.delivered.push(token);
        continue;
      }
      const text = await safeText(res);
      const upper = text.toUpperCase();
      // 404/410 = توکن منقضی/حذف‌شده؛ 400 با INVALID_ARGUMENT/UNREGISTERED هم مرده است
      if (
        res.status === 404 ||
        res.status === 410 ||
        upper.includes("UNREGISTERED") ||
        upper.includes("NOT_FOUND") ||
        upper.includes("INVALID_ARGUMENT") ||
        upper.includes("INVALID_REGISTRATION")
      ) {
        result.dead.push(token);
      } else {
        console.warn(`[fcm] v1 send failed (${res.status}): ${text.slice(0, 200)}`);
        result.failed.push(token);
      }
    } catch (err) {
      console.warn("[fcm] v1 send error:", (err as Error)?.message);
      result.failed.push(token);
    }
  }
  return result;
}

// ─────────────────────────── API عمومی ───────────────────────────

/**
 * ارسال پیام به لیست توکن‌ها — هر دو حالت احراز (v1 ترجیحی، legacy fallback).
 * هیچ‌وقت throw نمی‌کند؛ نتیجه شامل توکن‌های dead است تا کالر پاک‌سازی کند.
 */
export async function sendFcmToTokens(tokens: string[], payload: FcmPayload): Promise<FcmSendResult> {
  const clean = Array.from(
    new Set(tokens.filter((t) => typeof t === "string" && t.trim().length >= 10))
  );
  if (clean.length === 0) {
    return { attempted: 0, delivered: [], dead: [], failed: [] };
  }

  // حالت ۱ — OAuth v1 (ترجیحی)
  const saRaw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (saRaw) {
    const sa = parseServiceAccount(saRaw);
    if (sa) return sendV1(sa, clean, payload);
    console.warn("[fcm] v1 skipped (service account parse failed) — trying legacy");
  }

  // حالت ۲ — Legacy server key
  if (process.env.FCM_LEGACY_SERVER_KEY?.trim()) {
    return sendLegacy(clean, payload);
  }

  return { attempted: clean.length, delivered: [], dead: [], failed: [...clean] };
}

/**
 * ارسال FCM به همهٔ دستگاه‌های فعال یک کاربر + نگهداری DB:
 *  - توکن‌های dead (Unregistered/…) از DeviceToken پاک می‌شوند
 *  - توکن‌های سالم lastSeenAt=now می‌گیرند
 *  - بدون FCM تنظیم‌نشده/بدون توکن/با هر خطا → silent return (graceful)
 */
export async function sendFcmToUser(userId: string, payload: FcmPayload): Promise<void> {
  try {
    if (!isFcmConfigured()) return; // FCM تنظیم نشده — اپ مسیر WorkManager را دارد
    const rows = await db.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (rows.length === 0) return; // اپ اندروید این کاربر توکنی ثبت نکرده

    const result = await sendFcmToTokens(
      rows.map((r) => r.token),
      payload
    );

    if (result.dead.length > 0) {
      try {
        await db.deviceToken.deleteMany({ where: { token: { in: result.dead } } });
      } catch {
        // پاک‌سازی غیربحرانی است
      }
    }
    if (result.delivered.length > 0) {
      try {
        await db.deviceToken.updateMany({
          where: { token: { in: result.delivered } },
          data: { lastSeenAt: new Date() },
        });
      } catch {
        // غیربحرانی
      }
    }
    if (result.failed.length > 0) {
      console.warn(
        `[fcm] user=${userId} delivered=${result.delivered.length} dead=${result.dead.length} failed=${result.failed.length}`
      );
    }
  } catch (err) {
    console.warn("[fcm] sendFcmToUser failed:", (err as Error)?.message);
  }
}
