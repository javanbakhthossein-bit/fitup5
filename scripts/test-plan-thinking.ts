/**
 * تست رفتاری v40 — دیریکتیو مالک: «برنامه با gemini-3.8-flash ساخته بشه؛ در
 * بدترین حالت با میزان تفکر high؛ اگر یک درصد نشد از DeepSeek 4 Flash استفاده کن»
 *
 * یک سرور capture محلی روی پورت 3990 بالا می‌آید (شبیه‌ساز AvalAI) و بدنهٔ
 * واقعی درخواست‌های خروجی generatePlanContent را ثبت می‌کند:
 *
 *   سناریو ۱: پاسخ سالم → فقط یک درخواست: model=gemini-3.8-flash + تفکر high
 *             (thinkingLevel=high برای gemini؛ reasoning_effort=high) — بدون فال‌بک
 *   سناریو ۲: gemini با 400 (خطای دائمی) رد می‌شود → تلاش بعدی باید مدل
 *             فال‌بک deepseek-v4-flash با reasoning_effort=high باشد (بدون extra_bodyِ gemini)
 *   سناریو ۳: gemini دو بار 504 گذرا → هر ۲ تلاش هم‌سطح مصرف می‌شود → بعدش deepseek
 *   سناریو ۴: gemini با 200 و content:null جواب می‌دهد (دقیقاً باگ پروداکشن
 *             «برنامه خالی») → نباید موفق حساب شود → فال‌بک deepseek برمی‌گرداند
 *
 * اجرا: bun run scripts/test-plan-thinking.ts
 */
import http from "http";

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";
process.env.AVALAI_TEXT_MODEL = "gemini-3.8-flash";
process.env.AVALAI_FALLBACK_TEXT_MODEL = "deepseek-v4-flash";

interface CapturedRequest {
  model?: string;
  reasoning_effort?: string;
  max_tokens?: number;
  extra_body?: {
    generationConfig?: {
      thinkingConfig?: { thinkingLevel?: string };
      maxOutputTokens?: number;
    };
  };
}

const captured: CapturedRequest[] = [];
let fail400NextN = 0;
let fail504NextN = 0;
let emptyNextN = 0;

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
    if (fail400NextN > 0) {
      fail400NextN--;
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: "Invalid thinking level" } }));
      return;
    }
    if (fail504NextN > 0) {
      fail504NextN--;
      res.statusCode = 504;
      res.end("<html>gateway timeout</html>");
      return;
    }
    if (emptyNextN > 0) {
      emptyNextN--;
      // دقیقاً رفتار معیوب پروداکشن: 200 ولی بدون متن (reasoning بودجه را خورده)
      res.end(
        JSON.stringify({
          id: "chatcmpl-empty",
          object: "chat.completion",
          created: Date.now(),
          model: "gemini-3.8-flash",
          choices: [
            {
              index: 0,
              finish_reason: "length",
              message: { role: "assistant", content: null },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 65536,
            total_tokens: 65546,
            completion_tokens_details: { reasoning_tokens: 65536, text_tokens: 0 },
          },
        })
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Date.now(),
        model: "gemini-3.8-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"ok":true}' },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })
    );
  });
});

server.listen(3990, async () => {
  process.env.AVALAI_BASE_URL = "http://127.0.0.1:3990/v1";
  const { generatePlanContent } = await import("../src/lib/fitness/ai");

  let ok = true;
  const fail = (scenario: string, why: string) => {
    console.error(`❌ سناریو ${scenario} شکست خورد: ${why}`);
    ok = false;
  };

  // ─── سناریو ۱: مسیر سالم — یک درخواست، تفکر high، بدون فال‌بک ───
  captured.length = 0;
  fail400NextN = fail504NextN = emptyNextN = 0;
  const out1 = await generatePlanContent("sys", "usr", "test-happy");
  const r1 = captured[0] ?? {};
  const lvl1 = r1.extra_body?.generationConfig?.thinkingConfig?.thinkingLevel;
  console.log(
    `[1] content=${out1} | model=${r1.model} | reasoning_effort=${r1.reasoning_effort} | thinkingLevel=${lvl1} | max_tokens=${r1.max_tokens} | calls=${captured.length}`
  );
  if (out1 !== '{"ok":true}') fail("۱", "محتوا اشتباه");
  if (r1.model !== "gemini-3.8-flash") fail("۱", `مدل=${r1.model}`);
  if (lvl1 !== "high") fail("۱", `thinkingLevel=${lvl1} (باید high باشد — دیگر max نیست)`);
  if (r1.reasoning_effort !== "high") fail("۱", `reasoning_effort=${r1.reasoning_effort}`);
  // نکته: پروکسی gemini-3 مقدار max_tokens را به extra_body.generationConfig.maxOutputTokens منتقل می‌کند
  const outTok = r1.extra_body?.generationConfig?.maxOutputTokens;
  if (outTok !== 65536) fail("۱", `maxOutputTokens=${outTok}`);
  if (captured.length !== 1) fail("۱", `تعداد کال=${captured.length} (باید ۱ باشد)`);

  // ─── سناریو ۲: gemini با 400 دائمی → فال‌بک deepseek-v4-flash با تفکر high ───
  captured.length = 0;
  fail400NextN = 1;
  fail504NextN = emptyNextN = 0;
  const out2 = await generatePlanContent("sys", "usr", "test-fallback-400");
  const r2 = captured[captured.length - 1] ?? {};
  const models2 = captured.map((c) => c.model);
  console.log(
    `[2] content=${out2} | models=${models2.join(" → ")} | fallback reasoning_effort=${r2.reasoning_effort} | fallback extra_body=${JSON.stringify(r2.extra_body ?? null)} | calls=${captured.length}`
  );
  if (out2 !== '{"ok":true}') fail("۲", "محتوا اشتباه");
  if (models2.join(",") !== "gemini-3.8-flash,deepseek-v4-flash")
    fail("۲", `زنجیره=${models2.join(",")} (باید gemini→deepseek می‌بود)`);
  if (r2.reasoning_effort !== "high") fail("۲", `فال‌بک reasoning_effort=${r2.reasoning_effort} (باید high باشد)`);
  if (r2.extra_body != null) fail("۲", "فال‌بک deepseek نباید extra_bodyِ gemini داشته باشد");
  if (r2.max_tokens !== 65536) fail("۲", `فال‌بک max_tokens=${r2.max_tokens} (بودجهٔ صریح خروجی)`);

  // ─── سناریو ۳: gemini دو بار 504 گذرا (هر ۲ تلاش هم‌سطح) → فال‌بک deepseek ───
  captured.length = 0;
  fail400NextN = emptyNextN = 0;
  fail504NextN = 2;
  const out3 = await generatePlanContent("sys", "usr", "test-fallback-504");
  const models3 = captured.map((c) => c.model);
  console.log(`[3] content=${out3} | models=${models3.join(" → ")} | calls=${captured.length}`);
  if (out3 !== '{"ok":true}') fail("۳", "محتوا اشتباه");
  if (models3.join(",") !== "gemini-3.8-flash,gemini-3.8-flash,deepseek-v4-flash")
    fail("۳", `زنجیره=${models3.join(",")} (باید ۲×gemini سپس deepseek می‌بود)`);

  // ─── سناریو ۴: باگ پروداکشن — 200 با content خالی → فال‌بک deepseek ───
  captured.length = 0;
  fail400NextN = fail504NextN = 0;
  emptyNextN = 1;
  const out4 = await generatePlanContent("sys", "usr", "test-empty-content");
  const models4 = captured.map((c) => c.model);
  console.log(`[4] content=${out4} | models=${models4.join(" → ")} | calls=${captured.length}`);
  if (out4 !== '{"ok":true}') fail("۴", "پاسخ خالی نباید موفق حساب شود — فال‌بک رخ نداد");
  if (models4.join(",") !== "gemini-3.8-flash,deepseek-v4-flash")
    fail("۴", `زنجیره=${models4.join(",")}`);

  server.close();
  console.log(ok ? "\n✅ همهٔ سناریوهای زنجیرهٔ v40 PASS شدند" : "\n❌ FAIL");
  process.exit(ok ? 0 : 1);
});
