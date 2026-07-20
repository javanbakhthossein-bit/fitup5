---
Task ID: ZARINPAL-REWRITE-OFFICIAL
Agent: full-stack-developer
Task: بازنویسی کامل درگاه زرین‌پال + مدیریت تراکنش‌ها
Date: 2025-01-XX
---

# Work Record

## خلاصه
بازنویسی کامل پروایدر زرین‌پال بر اساس داکیومنت رسمی API v4 (با هاست payment.zarinpal.com به جای api.zarinpal.com) + افزودن مدیریت تراکنش‌ها برای ادمین.

## تغییرات فایل‌ها

### 1. `.env`
- افزودن `ZARINPAL_MERCHANT_ID=7028596b-4032-4fc0-a262-2486f6b95a63`
- افزودن `NEXT_PUBLIC_SITE_URL=https://fittup.ir`

### 2. `prisma/schema.prisma` — مدل Payment
- افزودن فیلدهای جدید (طبق داکیومنت رسمی verify):
  - `cardPan String?` — شماره کارت ماسک‌شده (مثلاً 502229******5995)
  - `cardHash String?` — هش کارت کاربر
  - `fee Int?` — کارمزد درگاه
- افزودن مقدار `refunded` به وضعیت‌های مجاز payment
- اجرای `bun run db:push` برای اعمال تغییرات

### 3. `src/lib/payment/providers/zarinpal.ts` — بازنویسی کامل
**هاست‌ها (طبق داکیومنت رسمی):**
- Request URL: `https://payment.zarinpal.com/pg/v4/payment/request.json`
- Verify URL: `https://payment.zarinpal.com/pg/v4/payment/verify.json`
- StartPay URL: `https://payment.zarinpal.com/pg/StartPay/{authority}`
  (همگی از payment.zarinpal.com استفاده می‌کنند، نه api.zarinpal.com یا www.zarinpal.com)

**هدرها:**
- `Content-Type: application/json`
- `Accept: application/json` (جدید — طبق داکیومنت رسمی الزامی است)

**بدنه درخواست (request):**
```json
{
  "merchant_id": "...",
  "amount": 350000,
  "currency": "IRT",           // ← جدید (تومان)
  "description": "خرید پلن فیتاپ",
  "callback_url": "https://fittup.ir/?payment_verify=1",
  "metadata": { "mobile": "...", "auto_verify": true }   // ← auto_verify جدید
}
```

**بدنه تایید (verify):**
```json
{ "merchant_id": "...", "amount": 350000, "authority": "A000..." }
```

**کدهای موفق verify:**
- `code === 100` → موفق
- `code === 101` → قبلاً تایید شده (also success)

**فیلدهای بازگشتی از verify:**
- `ref_id`, `card_pan`, `card_hash`, `fee` — در PaymentVerifyResult اضافه شدند

**تابع `resolveCallbackUrl`:**
- اولویت با `NEXT_PUBLIC_SITE_URL`، fallback به `origin`

### 4. `src/lib/payment/types.ts`
- افزودن `cardPan`, `cardHash`, `fee` به `PaymentVerifyResult`

### 5. `src/app/api/payment/checkout/route.ts`
- استفاده از `process.env.NEXT_PUBLIC_SITE_URL` برای callback URL
- callbackUrl در پاسخ API با origin واقعی ساخته می‌شود
- fallback URL از `https://payment.zarinpal.com/pg/StartPay/...` استفاده می‌کند

### 6. `src/app/api/payment/verify/route.ts`
- ذخیره `cardPan`, `cardHash`, `fee` در Payment record پس از verify موفق
- پاسخ idempotent برای payment.status === "success" (برای جلوگیری از double-verify)
- بازگرداندن `cardPan`, `cardHash`, `fee` در پاسخ موفقیت
- هندل صحیح Status=OK از callback زرین‌پال

### 7. `src/app/api/admin/transactions/route.ts` — بازنویگی کامل
**GET endpoint:**
- فیلتر بر اساس status (pending|success|failed|cancelled|refunded|all)
- جستجوی کاربر (نام/موبایل)
- بازگرداندن فیلدهای جدید: cardPan, cardHash, fee, authority
- افزودن stats کلی:
  - total, success, failed, pending, cancelled, refunded (تعداد)
  - totalRevenue, totalFees (مجموع مبلغ و کارمزد)
  - successRate (نرخ موفقیت درصدی)
  - netRevenue (درآمد خالص = totalRevenue - totalFees)
- پشتیبانی از `?stats=1` برای دریافت فقط آمار

**PATCH endpoint (جدید):**
- تغییر وضعیت پرداخت بین success ↔ refunded
- فقط پرداخت‌های success قابل تبدیل به refunded هستند
- فقط پرداخت‌های refunded قابل بازگردانی به success هستند
- هشدار: فقط تغییر وضعیت DB، بازگشت وجه واقعی در درگاه انجام نمی‌شود

### 8. `src/components/fitness/views/admin-overlay.tsx` — بازنویسی FinanceTab
- کارت‌های آماری (۶ کارت): درآمد کل، نرخ موفقیت، موفق، در انتظار، ناموفق/لغو، کارمزد درگاه
- فیلتر وضعیت با ۵ گزینه (شامل refunded)
- جدول تراکنش‌ها با ستون‌ها:
  - کاربر (نام + موبایل)
  - مبلغ (با خط‌خوردگی مبلغ اصلی اگر تخفیف خورده)
  - پلن/روش (با کد تخفیف اگر وجود دارد)
  - وضعیت (با badge رنگی)
  - کارت / کد پیگیری (cardPan + refId + fee)
  - تاریخ (ایجاد + تأیید)
  - عملیات (دکمه "علامت مسترد" یا "بازگردانی")
- اسکرول عمودی با max-h-[60vh] و sticky header
- تأیید قبل از عملیات با confirm()
- toast notification برای موفقیت/خطا

### 9. `src/components/fitness/payment-verify-handler.tsx` — بهبود
- نمایش cardPan در رسید موفقیت
- نمایش originalAmount (با خط‌خوردگی اگر تخفیف خورده)
- نمایش alreadyVerified (پیام متفاوت برای تایید مجدد)
- باکس هشدار ۷۲ ساعته برای بازگشت وجه در حالت ناموفق
- آیکن CreditCard و AlertTriangle اضافه شد
- نشانگر "اتصال امن به درگاه + تأیید رسمی API v4" در حالت loading

## تست API رسمی زرین‌پال
```bash
curl -s -X POST https://payment.zarinpal.com/pg/v4/payment/request.json \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "merchant_id":"7028596b-4032-4fc0-a262-2486f6b95a63",
    "amount":350000,
    "currency":"IRT",
    "description":"خرید پلن فیتاپ",
    "callback_url":"https://fittup.ir/?payment_verify=1",
    "metadata":{"mobile":"09123456789","auto_verify":true}
  }'
```

**پاسخ موفق:**
```json
{
  "data": {
    "authority": "A000000000000000000000000000qjg8m32e",
    "fee": 22500,
    "fee_type": "Merchant",
    "code": 100,
    "message": "Success"
  },
  "errors": []
}
```
✅ API رسمی کار می‌کند.

## Lint
- `bun run lint`: **0 errors**، ۶۲ warning (همه "Unused eslint-disable directive" که از قبل وجود داشته‌اند)

## نکات مهم
1. مبلغ‌ها به تومان (IRT) هستند — همان واحدی که کد قبلاً استفاده می‌کرده. هیچ تبدیلی لازم نیست.
2. sandbox logic حفظ شده — در صورت PAYMENT_SANDBOX=true با merchant=TEST/unset، شبیه‌سازی می‌شود.
3. URL کال‌بک از NEXT_PUBLIC_SITE_URL ساخته می‌شود تا در production مطمئن باشیم URL صحیح است.
4. عملیات mark-as-refunded فقط وضعیت DB را تغییر می‌دهد — بازگشت وجه واقعی باید در پنل زرین‌پال به‌صورت دستی انجام شود.
5. فیلد alreadyVerified در پاسخ verify برای جلوگیری از نمایش خطا هنگام refresh صفحه استفاده می‌شود.
