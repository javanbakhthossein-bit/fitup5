/**
 * تست رفتاری v73 — دیریکتیو مالک: «تولید برنامه باید با میزان تفکر مکس و
 * بقیه موارد همگی با low باشه. کل سیستم با deepseek-v4.1-flash بره جلو.»
 *
 * یک سرور capture محلی بالا می‌آید (شبیه‌ساز AvalAI) و بدنهٔ واقعی درخواست‌های
 * خروجی generatePlanContent را ثبت می‌کند:
 *
 *   سناریو ۱ (سلامت): فقط یک درخواست — model=deepseek-v4.1-flash +
 *           reasoning_effort=max + max_tokens=65536 — بدون فال‌بک
 *   سناریو ۲ (خطای دائمی 400): تور نجات low باید فعال شود — همان مدل با
 *           reasoning_effort=low
 *   سناریو ۳ (شکست کامل گام ۱): فال‌بک مدل gemini-3.8-flash با
 *           thinkingLevel=high (extra_body.generationConfig) و reasoning_effort=high
 *   سناریو ۴ (200 ولی content:null — باگ «برنامه خالی»): نباید موفق حساب شود →
 *           تور low باید برمی‌گرداند
 *
 * اجرا: bun run scripts/test-plan-thinking-v73.ts
 */
import http from "http";

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";
process.env.AVALAI_BASE_URL = "http://127.0.0.1:3993/v1";

interface CapturedRequest {
  model?: string;
  reasoning_effort?: string;
  max_tokens?: number;
  fallback_model?: string;
  extra_body?: {
    generationConfig?: {
      thinkingConfig?: { thinkingLevel?: string };
    };
  };
}

const captured: CapturedRequest[] = [];
let mode: "ok" | "fail400x2" | "fail400x3" | "empty" = "ok";

const PLAN_JSON = JSON.stringify({ days: [{ title: "روز ۱ — پا", exercises: [{ name: "اسکوات", sets: 3 }] }] });

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      captured.push(JSON.parse(body || "{}"));
    } catch {
      captured.push({});
    }
    res.setHeader("Content-Type", "application/json");
    const n400 = mode === "fail400x2" ? 2 : mode === "fail400x3" ? 3 : 0;
    if (captured.length <= n400) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: "Invalid thinking level" } }));
      return;
    }
    if (mode === "empty" && captured.length === 1) {
      res.statusCode = 200;
      res.end(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "length" }], usage: {} }));
      return;
    }
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        choices: [{ message: { content: PLAN_JSON }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      })
    );
  });
});

function expect(cond: boolean, label: string): boolean {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  return cond;
}

async function runScenario(name: string, m: typeof mode, fn: () => Promise<string>): Promise<boolean> {
  captured.length = 0;
  mode = m;
  let ok = true;
  const t0 = Date.now();
  try {
    const out = await fn();
    ok = expect(out.includes('"plan"') || out.includes("days"), `${name}: خروجی برگشت (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e: any) {
    console.log(`❌ ${name}: استثنا — ${String(e?.message || e).slice(0, 140)}`);
    return false;
  }
  return ok;
}

async function main() {
  await new Promise<void>((r) => server.listen(3993, "127.0.0.1", r));
  const { generatePlanContent } = await import("@/lib/fitness/ai");
  let allOk = true;

  // ─── سناریو ۱: سلامت — فقط deepseek@max ───
  allOk = (await runScenario("۱ سلامت", "ok", () => generatePlanContent("سیستم", "برنامه بساز", "test-73-ok"))) && allOk;
  {
    const c = captured[0] || {};
    allOk = expect(c.model === "deepseek-v4.1-flash", "۱: مدل deepseek-v4.1-flash") && allOk;
    allOk = expect(c.reasoning_effort === "max", "۱: تفکر مکس (reasoning_effort=max)") && allOk;
    allOk = expect(c.max_tokens === 65536, "۱: بودجهٔ خروجی 65536") && allOk;
    allOk = expect(!c.extra_body?.generationConfig?.thinkingConfig, "۱: بدون extra_bodyِ gemini") && allOk;
    allOk = expect(captured.length === 1, `۱: فقط یک درخواست (شد ${captured.length})`) && allOk;
  }

  // ─── سناریو ۲: 400 دائمی روی max (#1) → تور نجات low (#2) → موفق ───
  allOk = (await runScenario("۲ 400→low", "fail400x2", () => generatePlanContent("سیستم", "برنامه بساز", "test-73-400"))) && allOk;
  {
    const c2 = captured[1] || {};
    allOk = expect(captured.length === 3, `۲: سه درخواست (شد ${captured.length})`) && allOk;
    allOk = expect(c2.model === "deepseek-v4.1-flash", "۲: تور نجات همان مدل") && allOk;
    allOk = expect(c2.reasoning_effort === "low", "۲: تور نجات با تفکر low") && allOk;
  }

  // ─── سناریو ۳: شکست کامل (400 دائمی روی max/low/gemini) → fail-fast با پرتاب خطا ───
  // (400 گذرا نیست — هر مدل فقط یک درخواست می‌زند؛ رفتار صحیح = شکست صریح، نه معلق‌ماندن)
  {
    captured.length = 0;
    mode = "fail400x3";
    let threw = false;
    try {
      await generatePlanContent("سیستم", "برنامه بساز", "test-73-gem");
    } catch {
      threw = true;
    }
    const last = captured[captured.length - 1] || {};
    allOk = expect(threw, "۳: شکست کامل با خطای صریح (fail-fast)") && allOk;
    allOk = expect(captured.length === 3, `۳: سه درخواست (شد ${captured.length})`) && allOk;
    allOk = expect(last.model === "gemini-3.8-flash", "۳: آخرین تلاش = فال‌بک gemini-3.8-flash") && allOk;
    allOk = expect(last.reasoning_effort === "high", "۳: تفکر high در فال‌بک") && allOk;
    allOk = expect(last.extra_body?.generationConfig?.thinkingConfig?.thinkingLevel === "high", "۳: thinkingLevel=high برای gemini") && allOk;
    allOk = expect(captured[0]?.reasoning_effort === "max", "۳: تلاش اول با مکس بوده") && allOk;
  }

  // ─── سناریو ۴: content:null → تور نجات low ───
  allOk = (await runScenario("۴ خالی→low", "empty", () => generatePlanContent("سیستم", "برنامه بساز", "test-73-empty"))) && allOk;
  {
    allOk = expect(captured.length === 2, `۴: پاسخ خالی موفق نشمرد — تور low (شد ${captured.length})`) && allOk;
    allOk = expect((captured[1] || {}).reasoning_effort === "low", "۴: تلاش دوم با low") && allOk;
  }

  server.close();
  console.log(allOk ? "\n🎉 زنجیرهٔ v73 کاملاً رفتاری سبز" : "\n⚠️ زنجیرهٔ v73 قرمز — اصلاح لازم");
  process.exit(allOk ? 0 : 2);
}

main();
