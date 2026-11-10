/**
 * E2E تست رفع باگ «پرداخت ناموفق برای کاربر پول‌داده‌شده» — سندباکس
 *
 * شبیه‌سازی دقیق سناریوی مالک:
 *  ۱. شارژ کیف پول (wallet topup) از طریق درگاه
 *  ۲. **مسابقه**: همزمانی recover پس‌زمینه با lookup صفحه رسید (باگ اصلی)
 *  ۳. بازگشت مجدد از درگاه (idempotency) → رسید موفق نه خطا
 *  ۴. claim گیرکرده (verifying > 15 دقیقه) → دیگر failed نمی‌شود، ریست و تحویل
 *
 * اجرا: bun scripts/e2e-wallet-race-fix.ts
 */

export {}; // ماژول — برای جلوگیری از تداخل global با اسکریپت‌های دیگر
const BASE = "http://localhost:3000";
const MOBILE = "0915" + String(Math.floor(Math.random() * 9000000) + 1000000);
let cookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const sc of setCookies) {
    const m = sc.match(/^(sc_session=[^;]+)/);
    if (m) cookie = m[1];
  }
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

function log(step: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✅" : "❌"} [${step}] ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("════════ E2E: باگ مسابقه پرداخت — کیف پول ════════");
  console.log(`موبایل تست: ${MOBILE}\n`);

  // ─── ۱) ورود ───
  let r = await api("/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ mobile: MOBILE }),
  });
  // devCode فقط وقتی پیامک شکست بخورد برمی‌گردد؛ کد را مستقیم از DB می‌خوانیم
  const { execSync } = await import("child_process");
  const readOtp = () => {
    try {
      const out = execSync(
        `bun -e 'import {db} from "./src/lib/db"; const c = await db.otpCode.findFirst({where:{mobile:"${MOBILE}",used:false},orderBy:{createdAt:"desc"}}); console.log(c?c.code:"")'`,
        { cwd: process.cwd() }
      ).toString();
      // فقط خط ۴-رقمی را استخراج کن (خروجی ممکن است با لاگ Prisma قاطی شود)
      const m = out.match(/^\s*(\d{4})\s*$/m);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  };
  const devCode = r.body?.devCode || readOtp();
  if (!devCode) { log("send-otp", false, `کد OTP در دسترس نیست: ${JSON.stringify(r.body).slice(0, 120)}`); return; }
  r = await api("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ mobile: MOBILE, code: devCode, name: "تست مسابقه" }),
  });
  log("login", r.status === 200 && !!r.body?.id, `status=${r.status}`);

  // ─── ۲) شارژ کیف پول از درگاه ───
  const AMOUNT = 200000;
  r = await api("/api/wallet", {
    method: "POST",
    body: JSON.stringify({ amount: AMOUNT }),
  });
  const authority = r.body?.authority as string | undefined;
  const paymentId = r.body?.paymentId as string | undefined;
  log("wallet-topup-request", r.status === 200 && !!authority && !!paymentId,
    `status=${r.status} authority=${authority?.slice(0, 18)}… paymentId=${paymentId?.slice(0, 10)}…`);
  if (!authority || !paymentId) return;

  // ─── ۳) مسابقه‌ی مرگبار (بازسازی باگ مالک) ───
  // کاربر از درگاه برگشته؛ همزمان recover پس‌زمینه و lookup صفحه رسید اجرا می‌شوند.
  // قبلاً: recover اول می‌رسد → claim (pending→verifying) → lookup فقط pending می‌گیرد → 404
  // → «پرداخت ناموفق / پرداخت معلق یافت نشد» 😱
  console.log("\n── مسابقه recover × lookup (بازسازی باگ) ──");
  const [recoverRes, lookupRes] = await Promise.all([
    api("/api/payment/recover", { method: "POST", body: JSON.stringify({}) }),
    api("/api/payment/lookup-pending", { method: "POST", body: JSON.stringify({ authority }) }),
  ]);
  log("race: recover", recoverRes.status === 200, `status=${recoverRes.status}`);
  log("race: lookup بعد/همزمان با claim", !!lookupRes.body?.paymentId,
    `paymentId=${lookupRes.body?.paymentId ? "پیدا شد ✓" : "null"} paymentStatus=${lookupRes.body?.paymentStatus ?? "-"} resolved=${lookupRes.body?.resolved ?? false}`);
  // ← قبلاً اینجا null بود (404) → باگ. حالا باید پیدا شود (pending یا verifying)

  // ─── ۴) verify صفحه رسید (با تلاش مجدد اگر busy بود) ───
  let vData: any = null;
  for (let i = 1; i <= 5; i++) {
    r = await api("/api/payment/verify", {
      method: "POST",
      body: JSON.stringify({ paymentId, status: "OK", authority }),
    });
    vData = r.body;
    const nonFinal = vData?.status === "verifying" || vData?.status === "pending";
    if (vData?.success || !nonFinal) break;
    await new Promise((res2) => setTimeout(res2, 1500));
  }
  log("verify-after-race", vData?.success === true,
    `success=${vData?.success} type=${vData?.type} walletBalance=${vData?.walletBalance ?? "-"} refId=${vData?.refId ?? "-"}`);

  // ─── ۵) تأیید تحویل در DB ───
  const runDb = (js: string) => {
    try {
      const out = execSync(`bun -e '${js.replace(/'/g, "'\\''")}'`, { cwd: process.cwd() }).toString();
      const m = out.match(/\{[^]*\}/);
      return m ? m[0] : "null";
    } catch (e: any) {
      return JSON.stringify({ error: String(e.message).slice(0, 80) });
    }
  };
  const pay = JSON.parse(runDb(
    `import {db} from "./src/lib/db"; const p = await db.payment.findUnique({where:{id:"${paymentId}"},select:{status:true,amount:true,plan:true}}); console.log(JSON.stringify(p))`
  ));
  log("db-payment-status", pay?.status === "success", `status=${pay?.status} plan=${pay?.plan} amount=${pay?.amount}`);
  const wtx = JSON.parse(runDb(
    `import {db} from "./src/lib/db"; const n = await db.walletTransaction.count({where:{refId:"${paymentId}"}}); const s = await db.walletTransaction.aggregate({_sum:{amount:true},where:{refId:"${paymentId}"}}); console.log(JSON.stringify({n,s:s._sum.amount}))`
  ));
  log("db-wallet-tx", Number(wtx?.n) >= 1, `transactions=${wtx?.n} sum=${wtx?.s} (انتظار: ${AMOUNT})`);

  // ─── ۶) بازگشت مجدد از درگاه (idempotency — رفرش صفحه رسید) ───
  console.log("\n── بازگشت مجدد (idempotency) ──");
  r = await api("/api/payment/lookup-pending", {
    method: "POST",
    body: JSON.stringify({ authority }),
  });
  log("lookup-after-success", r.body?.paymentId === paymentId && r.body?.paymentStatus === "success",
    `paymentStatus=${r.body?.paymentStatus} resolved=${r.body?.resolved}`);
  r = await api("/api/payment/verify", {
    method: "POST",
    body: JSON.stringify({ paymentId, status: "OK", authority }),
  });
  log("verify-idempotent", r.body?.success === true && r.body?.type === "wallet_topup" && typeof r.body?.walletBalance === "number",
    `success=${r.body?.success} type=${r.body?.type} walletBalance=${r.body?.walletBalance}`);
  // دوبل‌شارژ نباید رخ دهد:
  const wtx2 = JSON.parse(runDb(
    `import {db} from "./src/lib/db"; const n = await db.walletTransaction.count({where:{refId:"${paymentId}"}}); console.log(JSON.stringify({n}))`
  ));
  log("no-double-charge", Number(wtx2?.n) === 1, `transactions=${wtx2?.n} (انتظار: دقیقاً ۱)`);

  // ─── ۷) باگ stuck-claim: verifying > ۱۵ دقیقه نباید failed شود ───
  console.log("\n── باگ stuck claim (verifying گیرکرده) ──");
  // یک پرداخت شارژ جدید بساز و دستی در وضعیت verifying گیرکرده بگذار
  r = await api("/api/wallet", { method: "POST", body: JSON.stringify({ amount: 50000 }) });
  const stuckPaymentId = r.body?.paymentId;
  const stuckAuthority = r.body?.authority;
  if (stuckPaymentId) {
    // وضعیت را verifying با verifiedAt قدیمی (۲۰ دقیقه قبل) شبیه‌سازی کن
    execSync(
      `bun -e 'import {db} from "./src/lib/db"; await db.payment.update({where:{id:"${stuckPaymentId}"}, data:{status:"verifying", verifiedAt: new Date(Date.now()-20*60*1000)}}); console.log("stuck")'`,
      { cwd: process.cwd() }
    );
    // حالا lookup باید پرداخت را پیدا کند (باگ قدیمی: 404!)
    r = await api("/api/payment/lookup-pending", {
      method: "POST",
      body: JSON.stringify({ authority: stuckAuthority }),
    });
    log("lookup-stuck-verifying", !!r.body?.paymentId, `paymentId=${r.body?.paymentId ? "پیدا شد ✓" : "null"} status=${r.body?.paymentStatus}`);
    // verify → claimPayment باید ریست+claim کند (نه failed)
    r = await api("/api/payment/verify", {
      method: "POST",
      body: JSON.stringify({ paymentId: stuckPaymentId, status: "OK", authority: stuckAuthority }),
    });
    log("verify-stuck-recovered", r.body?.success === true, `success=${r.body?.success} ${r.body?.message ?? ""}`);
    const stuckPay = JSON.parse(runDb(
      `import {db} from "./src/lib/db"; const p = await db.payment.findUnique({where:{id:"${stuckPaymentId}"},select:{status:true}}); console.log(JSON.stringify(p))`
    ));
    log("db-stuck-final-status", stuckPay?.status === "success", `status=${stuckPay?.status} (قبلاً: failed 😱)`);
  }

  // ─── ۸) باگ شاخه‌های recover: wallet_topup باید از شاخهٔ مخصوص خودش تحویل شود ───
  console.log("\n── recover اول می‌رسد (بازسازی دقیق ماجرا) ──");
  r = await api("/api/wallet", { method: "POST", body: JSON.stringify({ amount: 150000 }) });
  const rAuth = r.body?.authority;
  const rPid = r.body?.paymentId;
  if (rPid && rAuth) {
    // recover قبل از بازگشت کاربر اجرا می‌شود (مثل fetchAuthInBackground) —
    // قبلاً: شاخهٔ عمومی gateway می‌گرفتش → «پلن نامعتبر است» → تحویل هرگز!
    const rec = await api("/api/payment/recover", { method: "POST", body: JSON.stringify({}) });
    const recResult = (rec.body?.results || []).find((x: any) => x.paymentId === rPid);
    log("recover-first-claimed", !!recResult, `result=${recResult?.status ?? "not-touched"} recovered=${recResult?.recovered ?? "-"}`);
    const rPay = JSON.parse(runDb(
      `import {db} from "./src/lib/db"; const p = await db.payment.findUnique({where:{id:"${rPid}"},select:{status:true}}); console.log(JSON.stringify(p))`
    ));
    log("recover-first-delivered", rPay?.status === "success",
      `status=${rPay?.status} — قبلاً: pending می‌ماند + «پلن نامعتبر است» در لاگ 😱`);
    const rWtx = JSON.parse(runDb(
      `import {db} from "./src/lib/db"; const n = await db.walletTransaction.count({where:{refId:"${rPid}"}}); console.log(JSON.stringify({n}))`
    ));
    log("recover-first-wallet-tx", Number(rWtx?.n) === 1, `transactions=${rWtx?.n} sum-انتظار: 150000`);
    // حالا کاربر برمی‌گردد → رسید موفق idempotent
    r = await api("/api/payment/lookup-pending", { method: "POST", body: JSON.stringify({ authority: rAuth }) });
    log("return-after-recover", r.body?.paymentId === rPid && r.body?.paymentStatus === "success",
      `paymentStatus=${r.body?.paymentStatus}`);
    r = await api("/api/payment/verify", {
      method: "POST",
      body: JSON.stringify({ paymentId: rPid, status: "OK", authority: rAuth }),
    });
    log("receipt-after-recover", r.body?.success === true && r.body?.type === "wallet_topup",
      `success=${r.body?.success} type=${r.body?.type} walletBalance=${r.body?.walletBalance ?? "-"}`);
  }

  console.log("\n════════ پایان ════════");
  if (process.exitCode) {
    console.log("❌ بعضی تست‌ها شکست خوردند!");
  } else {
    console.log("✅ همهٔ تست‌ها موفق — باگ مسابقه و stuck رفع شده است.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
