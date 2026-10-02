/**
 * تست زندهٔ API توسعه‌دهندگان کافه‌بازار (v48)
 *  ۱) OAuth client_credentials → access token
 *  ۲) endpoint راستی‌آزمایی با توکن معتبر (انتظار: not_found برای توکن قلابی = احراز OK)
 *  ۳) مسیر legacy (هدر پیشخان) برای مقایسه
 * اجرا: bun scripts/test-bazaar-dev-api.ts
 */
import { config } from "dotenv";
config({ path: "/home/z/my-project/.env" });

const CLIENT_ID = process.env.BAZAAR_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BAZAAR_CLIENT_SECRET || "";
const LEGACY = process.env.BAZAAR_API_SECRET || "";
const PKG = process.env.BAZAAR_PACKAGE_NAME || "ir.fittup.app";
const TOKEN_URL = "https://accounts.pardakht-bazaar.ir/api/oauth/token";
const V2 = "https://api.pardakht-bazaar.ir/devapi/v2/api";
const LEGACY_V2 = "https://pardakht.cafebazaar.ir/devapi/v2/api";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✅ ${name} — ${detail}`); }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`); }
}

async function main() {
  console.log("═══ تست API توسعه‌دهندگان بازار ═══");
  check("env BAZAAR_CLIENT_ID", !!CLIENT_ID, CLIENT_ID ? `${CLIENT_ID.slice(0, 8)}…` : "تنظیم نیست");
  check("env BAZAAR_CLIENT_SECRET", !!CLIENT_SECRET, CLIENT_SECRET ? `${CLIENT_SECRET.slice(0, 6)}…` : "تنظیم نیست");
  check("env BAZAAR_API_SECRET (پیشخان)", LEGACY.split(".").length === 3, `طول=${LEGACY.length}، قطعات JWT=${LEGACY.split(".").length}`);

  // ۱) OAuth token
  let token: string | null = null;
  try {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null) as any;
    token = data?.access_token ?? null;
    check("OAuth token", res.ok && !!token, res.ok ? `HTTP ${res.status} — expires_in=${data?.expires_in}s، token=${String(token).slice(0, 18)}…` : `HTTP ${res.status} — ${JSON.stringify(data)?.slice(0, 200)}`);
  } catch (e) {
    check("OAuth token", false, e instanceof Error ? e.message : String(e));
  }

  // ۲) verify endpoint با توکن واقعی + توکن خرید قلابی → انتظار not_found/404 (نه 401)
  if (token) {
    try {
      const url = `${V2}/applications/${encodeURIComponent(PKG)}/purchases/test_product/tokens/FAKE_TOKEN_123`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      const data = await res.json().catch(() => ({})) as any;
      const authedOk = res.status !== 401 && res.status !== 403;
      check("endpoint خرید (توکن قلابی)", authedOk, `HTTP ${res.status} — ${JSON.stringify(data).slice(0, 160)}`);
    } catch (e) {
      check("endpoint خرید (توکن قلابی)", false, e instanceof Error ? e.message : String(e));
    }
    try {
      const url = `${V2}/applications/${encodeURIComponent(PKG)}/subscriptions/test_sku/purchases/FAKE_TOKEN_123`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      const data = await res.json().catch(() => ({})) as any;
      const authedOk = res.status !== 401 && res.status !== 403;
      check("endpoint اشتراک (توکن قلابی)", authedOk, `HTTP ${res.status} — ${JSON.stringify(data).slice(0, 160)}`);
    } catch (e) {
      check("endpoint اشتراک (توکن قلابی)", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ۳) مسیر legacy — هدر پیشخان
  try {
    const url = `${LEGACY_V2}/applications/${encodeURIComponent(PKG)}/purchases/test_product/tokens/FAKE_TOKEN_123`;
    const res = await fetch(url, { headers: { "CAFEBAZAAR-PISHKHAN-API-SECRET": LEGACY, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const data = await res.json().catch(() => ({})) as any;
    const authedOk = res.status !== 401 && res.status !== 403;
    check("مسیر legacy پیشخان", authedOk, `HTTP ${res.status} — ${JSON.stringify(data).slice(0, 160)}`);
  } catch (e) {
    check("مسیر legacy پیشخان", false, e instanceof Error ? e.message : String(e));
  }

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
