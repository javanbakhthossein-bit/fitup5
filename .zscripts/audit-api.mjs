#!/usr/bin/env node
/**
 * ممیزی سیستماتیک همه API routes فیتاپ
 * چک: هر route باید JSON برگرداند (نه HTML) — ریشه خطای "Unexpected token '<'"
 */
const BASE = "http://localhost:3000";

// همه ۱۲۲ route با متد درست (فقط routeهای امن — بدون عوارض جانبی مخرب)
const routes = [
  // public GET
  ["GET", "/api"], ["GET", "/api/settings"], ["GET", "/api/head-codes"],
  ["GET", "/api/articles"], ["GET", "/api/articles/health"],
  ["GET", "/api/exercises"], ["GET", "/api/foods"], ["GET", "/api/terms"],
  ["GET", "/api/nutrition/log"], ["GET", "/api/coach/plan"],
  ["GET", "/api/coach/program-history"], ["GET", "/api/push/vapid-key"],
  ["GET", "/api/notifications"], ["GET", "/api/referral/info"],
  ["GET", "/api/payment/lookup-pending"], ["GET", "/api/payment/inquiry"],
  ["GET", "/api/auth/me"], ["GET", "/api/wallet"], ["GET", "/api/progress"],
  ["GET", "/api/checkup"], ["GET", "/api/checkup/baseline-measurements"],
  ["GET", "/api/blood-test/form"], ["GET", "/api/blood-test-status"],
  ["GET", "/api/video-status"], ["GET", "/api/user-media"],
  ["GET", "/api/feedback/status"], ["GET", "/api/survey"],
  ["GET", "/api/user-discount-code"], ["GET", "/api/support/tickets"],
  ["GET", "/api/workout-day-status"], ["GET", "/api/agents"],
  ["GET", "/api/payment/checkout"], ["GET", "/api/payment/upgrade-estimate"],
  ["GET", "/api/referral/code"], ["GET", "/api/articles/export"],
  ["GET", "/api/foods/search?q=برنج"], ["GET", "/api/exercises/1"],
  ["GET", "/api/foods/1"], ["GET", "/api/nika/chat"],
  ["GET", "/api/nika/guest-chat"], ["GET", "/api/coach/chat"],
  ["GET", "/api/coach/tts"], ["GET", "/api/coach/voice"],
  ["GET", "/api/onboarding"], ["GET", "/api/onboarding/profile"],
  ["GET", "/api/onboarding/analysis"],
  ["GET", "/api/admin/stats"], ["GET", "/api/admin/users"],
  ["GET", "/api/admin/pricing"], ["GET", "/api/admin/settings"],
  ["GET", "/api/admin/exercises"], ["GET", "/api/admin/foods"],
  ["GET", "/api/admin/surveys"], ["GET", "/api/admin/terms"],
  ["GET", "/api/admin/checkup"], ["GET", "/api/admin/transactions"],
  ["GET", "/api/admin/discount-codes"], ["GET", "/api/admin/admins"],
  ["GET", "/api/admin/head-codes"], ["GET", "/api/admin/watermark-all"],
  ["GET", "/api/admin/accounting/overview"], ["GET", "/api/admin/programs"],
  ["GET", "/api/admin/domain"], ["GET", "/api/admin/permissions"],
  ["GET", "/api/admin/ai-config"], ["GET", "/api/admin/seo-agent"],
  // POST safe (بدون عارضه واقعی — یا خطای اعتبارسنجی می‌دهند یا کار بی‌خطر)
  ["POST", "/api/nika/guest-chat", { message: "تست ممیزی" }],
  ["POST", "/api/error-log", { message: "audit-test" }],
  ["POST", "/api/pwa/installed", {}],
];

async function testRoute(method, path, body) {
  const start = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    const ms = Date.now() - start;
    const ct = res.headers.get("content-type") || "";
    let isJson = ct.includes("application/json");
    let bodyPreview = "";
    if (isJson) {
      try { bodyPreview = JSON.stringify(await res.json()).slice(0, 100); }
      catch { isJson = false; bodyPreview = "JSON-PARSE-FAILED"; }
    } else {
      bodyPreview = (await res.text()).slice(0, 80).replace(/\n/g, " ");
    }
    const status = "✅";
    // خطاهای قابل قبول: 401/403/400/404/405 (validation) — HTML هرگز قابل قبول نیست
    const ok = isJson && res.status < 500;
    return { ok, method, path, code: res.status, ms, ct: ct.split(";")[0], body: bodyPreview, status };
  } catch (e) {
    return { ok: false, method, path, code: "ERR", ms: Date.now() - start, ct: "-", body: String(e.message).slice(0, 80), status: "❌" };
  }
}

(async () => {
  console.log(`🔍 Auditing ${routes.length} routes against ${BASE}\n`);
  const results = [];
  for (const r of routes) {
    let res = await testRoute(r[0], r[1], r[2]);
    // retry اگر سرور وسط ری‌استارت بود (dev-mode memory restart)
    if (res.code === "ERR") {
      await new Promise((x) => setTimeout(x, 4000));
      res = await testRoute(r[0], r[1], r[2]);
    }
    results.push(res);
  }
  // خلاصه
  const bad = results.filter(r => !r.ok);
  const html = results.filter(r => r.ct.includes("text/html"));
  const server5xx = results.filter(r => typeof r.code === "number" && r.code >= 500);
  console.log("─".repeat(90));
  results.forEach(r => {
    const icon = r.ok ? "✅" : (r.ct.includes("text/html") ? "🚨HTML" : "⚠️");
    console.log(`${icon} ${r.code} ${String(r.ms).padStart(6)}ms ${r.method.padEnd(4)} ${r.path.padEnd(42)} ${r.ct.split(";")[0].padEnd(26)} ${r.ok ? "" : r.body.slice(0, 60)}`);
  });
  console.log("─".repeat(90));
  console.log(`TOTAL: ${results.length} | ✅ OK: ${results.length - bad.length} | ⚠️ ISSUE: ${bad.length}`);
  console.log(`🚨 HTML responses (root of "Unexpected token '<'"): ${html.length}`);
  html.forEach(r => console.log(`   - ${r.method} ${r.path} → ${r.code}`));
  console.log(`⚠️ 5xx errors: ${server5xx.length}`);
  server5xx.forEach(r => console.log(`   - ${r.method} ${r.path} → ${r.code} ${r.body.slice(0, 60)}`));
})();
