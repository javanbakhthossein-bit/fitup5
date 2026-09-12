Task ID: 3-a
Agent: full-stack-developer (accounting costs)
Date: 2026-09-08

# خلاصهٔ کار — حسابداری هزینه‌ها (پیامک + هوش مصنوعی) و درآمد خالص

## فایل‌های ساخته‌شده
1. **src/lib/fitness/costs.ts** (server-only، ~۴۶۰ خط) — منبع واحد هزینه‌ها:
   - `getUsdRateToman()` / `setUsdRateToman(v)` — SiteSetting کلید `usd_rate_toman`، پیش‌فرض ۱۱۰٬۰۰۰، کش ۶۰s.
   - `fetchUsdRateFromWeb()` — واکشی TGJU (`https://call5.tgju.org/ajax.json`) با timeout 6s؛ ⚠️ ساختار واقعی پاسخ `data.current.price_dollar_rl.p` است (نه ریشه) — «۲٬۲۶۷٬۰۰۰» ریال با ارقام فارسی/کاما → تومان = ریال÷۱۰ (تست واقعی: rate=226700 ✓). موفق → persist خودکار. هرگز throw نمی‌کند.
   - `getSmsCostPerMessageToman()` / `setSmsCostPerMessageToman(v)` — کلید `sms_cost_per_message_toman`، پیش‌فرض ۲۵۰.
   - `DEFAULT_MODEL_COSTS` — دلار به‌ازای ۱M توکن: gemini-3.8-flash {0.30,1.20}, gemini-3.5-flash {0.15,0.60}, deepseek-v4-flash {0.14,0.28} + مدل‌های **flat** (هزینهٔ ثابت هر فراخوانی): gemini-2.5-flash-tts 0.004$ , tts-1 0.006$ , gemini-3.1-flash-lite-image 0.012$. پیش‌فرض مدل ناشناخته: input 0.30 / output 1.20.
   - `getModelCosts()` / `setModelCosts()` — کلید `ai_model_costs` (JSON) merge روی پیش‌فرض‌ها + کش ۶۰s.
   - `computeModelCostUsd(model, prompt, completion)` — flat یا token-based.
   - `logAiUsage(...)` / `logSmsCost(...)` — insert best-effort (try/catch silent، console.error) — هرگز جریان اصلی را نمی‌شکنند.
   - `computeCostsForRange(from, to, netRevenue, gatewayFee)` — تجمیع SmsMessageLog (status=sent) + AiUsageLog + برآورد legacy + دو groupBy (orderBy: {_sum:{...}:desc}، take:10 — syntax با Prisma/SQLite راستی‌آزمایی شد) + سود = netRevenue − (پیامک+AI+کارمزد). legacySmsEstimate عمداً از سود کسر نمی‌شود (فقط اطلاعات).
   - `invalidateCostsCache()` — ابطال کش‌ها.

2. **src/app/api/admin/accounting/costs/route.ts** (جدید):
   - GET `?from&to` (پیش‌فرض: ابتدای ماه جاری) → `{ range, costs, breakdowns, settings: { usdRateToman, smsCostPerMessageToman, modelCosts } }` — netRevenue/fee خودش از Payment موفق/مسترد محاسبه می‌کند.
   - POST با requireAdmin: `{action:"refreshUsdRate"}` → `{ok,rate,source:"tgju"}` یا `{ok:false,error}` (502) | `{action:"saveSettings", usdRateToman?, smsCostPerMessageToman?}` (validate صحیح مثبت) | `{action:"saveModelCosts", modelCosts}` (validate record of {input,output} یا {flat}، سقف ۱۰۰۰$، flat با input/output قابل ترکیب نیست).

## فایل‌های ویرایش‌شده
3. **src/lib/fitness/smsir.ts** — `SmsIrResult.cost?: number` + `extractSmsCost(data)` (data.data.cost، برای bulk آبجکت/آرایه هر دو) که در postVerify و sendBulkSms روی موفقیت برمی‌گردد. `logSmsResultCost()` helper: موفق → cost گزارش‌شده ?? نرخ پیش‌فرض؛ شکستِ «بعد از تلاش واقعی ارسال» → failed با cost 0 (پیش‌فرض‌های pre-flight مثل نبودِ API key لاگ نمی‌شوند). لاگ در: sendOtpSms (scenario="otp" — یک لاگ برای هر درخواست OTP حتی در مسیر bulk→fallback)، sendTicketSms (scenario="ticket")، sendTemplateSms (scenario=opts.key). امضاهای قدیمی backward-compatible (پارامتر opts اختیاری). SmsLog (داپ ابدی) ۱۰۰٪ دست‌نخورده.
4. **src/lib/fitness/ai.ts** — فقط در `resilientCompletionAttempt` (قلب createResilientCompletion): بعد از validateContent موفق و قبل از return، اگر `completion.usage` بود → `logAiUsage({route: opts.routeTag ?? opts.logTag ?? "unknown", model: body.model, promptTokens, completionTokens, totalTokens, latencyMs, userId})`. `ResilientCompletionOptions` دو فیلد اختیاری گرفت: `routeTag?`, `userId?`. هیچ منطق retry/فال‌بک/اعتبارسنجی تغییر نکرد. (توجه: fallback فال‌بک مدل با withFallbackModel هم body.model را درست ثبت می‌کند.)
5. **src/lib/fitness/avalai-image.ts** — در generateImage بعد از تولید موفق تصویر → logAiUsage({route:"image:generate", model, tokens 0}) — flat.
6. **src/lib/fitness/tts.ts** — در generateTTS بعد از پاسخ صوتی موفق → logAiUsage({route:"tts:speech", model, tokens 0}) — flat.
7. **src/app/api/admin/accounting/overview/route.ts** — پاسخ GET حالا `costs` + `breakdowns` دارد (از computeCostsForRange با kpis.netRevenue و kpis.feeTotal موجود — fee دوباره محاسبه نمی‌شود). شکست costs کل پاسخ را نمی‌شکند (try/catch + console.error). شکل: costs = {smsCostToman, smsSentCount, smsFailedCount, aiCostToman, aiCostUsd(2 اعشار), aiCallCount, aiTotalTokens, gatewayFeeToman, totalCostsToman, profitToman, legacySmsEstimate{count,costToman}}.
8. **src/app/api/admin/stats/route.ts** — ۶ aggregate جدید در Promise.all (پیامک/AI/کارمزد — all-time و 30d؛ دو تای جدول‌های جدید با .catch برای db قدیمی) → `stats.netIncome = {totalRevenue, totalCosts, netProfit, smsCost, aiCost, gatewayFee, costs30d, netProfit30d}`. فیکس تیکت‌های task-owner (openTickets `not:"closed"` + pendingReplyTickets) حفظ شد.
9. **src/components/fitness/views/admin-overlay.tsx**:
   - OverviewContent: ۳ کارت KPI جدید بعد از «درآمد خالص»: «هزینهٔ پیامک» (sky)، «هزینهٔ هوش مصنوعی» (violet)، «سود خالص نهایی» (emerald/.red بر اساس علامت) + خط muted «برآورد پیامک‌های قدیمی‌تر» بعد از ردیف KPI + strip ریز هزینه‌ها (۲ کارت با max-h-64 scroll: پیامک per-scenario با برچسب فارسی SMS_SCENARIO_LABELS، AI per-model) بعد از نمودارها — مخفی وقتی داده صفر است.
   - سابتَب پنجم «هزینه‌ها و سود» (CostsSubtab): کارت تنظیمات (نرخ دلار + دکمهٔ «به‌روزرسانی از وب» با توست، هزینهٔ هر پیامک، ذخیره)، کارت قیمت مدل‌ها (جدول قابل ویرایش: مدل / ورودی $/1M / خروجی $/1M / ثابت $/کال + ذخیره)، ۴ کارت KPI ماه جاری، دو جدول ریز شکست max-h-80 overflow-y-auto. همه فارسی/RTL با الگوی glass/AccountingKpiCard.
   - DashboardTab: کارت برجستهٔ «درآمد خالص (پس از هزینه‌ها)» بعد از ردیف اول KPI (سود کل + هزینه‌ها با تفکیک + واریانت ۳۰ روزه در همان کارت).
   - تایپ `AccountingSubtab` + SUBTABS + رندر به‌روزرسانی شد؛ توضیح هدر تب حسابداری تکمیل شد.

## کلیدهای SiteSetting جدید
- `usd_rate_toman` (تومان/دلار) — در سندباکس با نرخ زندهٔ TGJU پر شد (۲۲۶٬۷۰۰)
- `sms_cost_per_message_toman` (پیش‌فرض ۲۵۰ — هنوز در DB نوشته نشده، lazy)
- `ai_model_costs` (JSON override قیمت مدل‌ها — هنوز نوشته نشده، lazy)

## تست‌ها
- `bunx tsc --noEmit` = exit 0 (چند بار در طول کار)
- `bun run lint` = 0 error / 73 warning (پایه، بدون افزایش)
- smoke: GET/POST `/api/admin/accounting/costs` و overview و stats → 401 تمیز (کامپایل+گارد)؛ `/` 200؛ dev.log بدون خطای کامپایل
- تست عملکردی مستقیم با bun (اسکریپت موقت — حذف شد): computeModelCostUsd (token/flat/unknown) ✓، computeCostsForRange روی DB واقعی (legacySmsEstimate: ۷ پیامک × ۲۵۰ = ۱۷۵۰ تومان) ✓، groupBy orderBy _sum/take ✓، create+delete هر دو جدول لاگ ✓، setUsdRateToman roundtrip + cleanup ✓، fetchUsdRateFromWeb واقعی → rate 226700 persisted ✓ (باقی ماند — نرخ واقعی بازار است)

## نکته‌ها برای ایجنت‌های بعدی
- وابستگی‌ها یک‌طرفه‌اند: costs.ts ← {ai, smsir, tts, avalai-image} — cycle وجود ندارد؛ costs.ts را دستکاری نکنید مگر برای همین مأموریت.
- واحد cost پیامک «تومان» فرض شده (کامنت در smsir.ts) — اگر مالک گفت sms.ir ریال می‌دهد، فقط در logSmsResultCost تقسیم بر ۱۰ اضافه شود.
- در ai.ts فقط مسیر createResilientCompletion لاگ می‌شود؛ createPlanCompletionWithRetry و createChatCompletionWithRetry عمداً لاگ نمی‌کنند (تسک فقط createResilientCompletion را مجاز دانست).
