/**
 * تست لینک کوتاه پیامکی (فیکس خطای 114) — v48
 *  ۱) createSmsRenewLink → ≤۲۵ کاراکتر + رکورد DB
 *  ۲) /r/[code] → 302 به go/renew (لینک هوشمند اپ حفظ)
 *  ۳) ارسال واقعی قالب 883325 با LINK کوتاه (قبلاً 114 می‌خورد)
 *  ۴) گارد طول: پارامتر >۲۵ (NAME کوتاه می‌شود / LINK حذف می‌شود — بدون 114)
 * اجرا: bun scripts/test-sms-short-link.ts
 */
import { config } from "dotenv";
config({ path: "/home/z/my-project/.env" });

const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

async function main() {
  console.log("═══ تست لینک کوتاه پیامک (خطای 114) ═══");

  // ۱) ساخت لینک کوتاه
  const { createSmsRenewLink } = await import("../src/lib/fitness/sms-short-link");
  const userId = "cmtestuser000000000000000";
  const subId = "cmtestsub0000000000000000";
  const short = await createSmsRenewLink(userId, subId);
  check("ساخت لینک کوتاه", short.startsWith("r/") && short.length <= 25, `"${short}" (طول=${short.length})`);

  // ۲) ریدایرکت /r/[code]
  if (short.startsWith("r/")) {
    const code = short.slice(2);
    const res = await fetch(`${BASE}/r/${code}`, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    check("ریدایرکت /r/[code]", res.status === 302 && loc.includes("/go/renew?t="), `HTTP ${res.status} → ${loc.slice(0, 60)}…`);
    // کد ناموجود → خانه
    const res404 = await fetch(`${BASE}/r/NoSuchCode99`, { redirect: "manual" });
    check("کد ناموجود → صفحهٔ اصلی", res404.status === 302 && (res404.headers.get("location") || "").endsWith("/"), `HTTP ${res404.status}`);
  }

  // ۳) ارسال واقعی 883325 (همان قالبی که 114 خورده بود) — به موبایل ادمین
  const { sendTemplateSms } = await import("../src/lib/fitness/smsir");
  const adminMobile = process.env.SMSIR_TICKET_ADMIN_MOBILE || "09300083803";
  const r = await sendTemplateSms({
    key: `renewal_boost_v48test_${Date.now()}`,
    templateEnvKey: "renewal_boost",
    mobile: adminMobile,
    params: [
      { name: "NAME", value: "سارا" },
      { name: "CODE", value: "FITAP30-TEST48" },
      { name: "LINK", value: short },
    ],
    force: true,
  });
  check("ارسال واقعی 883325 با لینک کوتاه", r.sent, r.sent ? `تحویل شد به ${adminMobile} — بدون خطای 114 ✓` : `error: ${r.error}`);

  // ۴) گارد طول — LINK بلند باید حذف شود و پیامک همچنان برود (بدون 114)
  const longLink = `go/renew?t=${"x".repeat(120)}`;
  const r2 = await sendTemplateSms({
    key: `renewal_boost_v48guard_${Date.now()}`,
    templateEnvKey: "renewal_boost",
    mobile: adminMobile,
    params: [
      { name: "NAME", value: "تست" },
      { name: "CODE", value: "FITAP30-TEST48" },
      { name: "LINK", value: longLink },
    ],
    force: true,
  });
  check("گارد طول: LINK بلند حذف و ارسال سالم", r2.sent, r2.sent ? "ارسال شد (بدون LINK — بدون 114) ✓" : `error: ${r2.error}`);

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
