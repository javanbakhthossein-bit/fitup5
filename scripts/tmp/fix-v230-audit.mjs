// v230.4 — رفع یافته‌های ممیزی کامل (تسک 23) — هر فیکس با انکر دقیق + راستی‌آزمایی داخلی
import { readFileSync, writeFileSync } from "fs";

const results = [];
function applyFix(file, name, anchor, replacement, expectedCount = 1) {
  let src = readFileSync(file, "utf8");
  const count = src.split(anchor).length - 1;
  if (count !== expectedCount) {
    results.push(`FAIL ${name} — anchor count ${count} (expected ${expectedCount})`);
    return false;
  }
  src = src.split(anchor).join(replacement);
  writeFileSync(file, src);
  results.push(`OK   ${name}`);
  return true;
}

// ─── 1) گارد پاداش معرفی بازار — هم‌تراز با گارد v202-M6 زرین‌پال ───
applyFix(
  "src/app/api/payment/bazaar/purchase/route.ts",
  "bazaar-referral-guard",
  `    // ─── پاداش معرفی (ممیزی 2-a باگ #4 — قبلاً در مسیر بازار جا افتاده بود) ───
    // v216-A — در ارتقا اشتراک فوری فعال است → مثل شاخهٔ فعال پاداش پرداخت می‌شود
    if (!deliveryPending) {`,
  `    // ─── پاداش معرفی (ممیزی 2-a باگ #4 — قبلاً در مسیر بازار جا افتاده بود) ───
    // v216-A — در ارتقا اشتراک فوری فعال است → مثل شاخهٔ فعال پاداش پرداخت می‌شود
    // v230.4 — هم‌ترازی با گارد v202-M6 زرین‌پال: خریدِ مبلغ صفر (اعتبار کامل کسر شده)
    // پاداش معرفی تولید نمی‌کند — ضد «چاپ پول کیف‌پولی» بدون درآمد واقعی.
    if (!deliveryPending && paidAmount > 0) {`
);

// ─── 2) RangeControls ادمین: پاک‌کردن تاریخ → خالی (نه «امروز») ───
applyFix(
  "src/components/fitness/views/admin-overlay.tsx",
  "range-from-clear",
  `onChange={(v) => { setFromVal(v || new Date().toISOString()); setActivePreset(null); }}`,
  `onChange={(v) => { setFromVal(v || ""); setActivePreset(null); }}`
);
applyFix(
  "src/components/fitness/views/admin-overlay.tsx",
  "range-to-clear",
  `onChange={(v) => { setToVal(v || new Date().toISOString()); setActivePreset(null); }}`,
  `onChange={(v) => { setToVal(v || ""); setActivePreset(null); }}`
);

// ─── 3) اسکرول‌بار سفارشی برای کانتینرهای فاقد آن ───
applyFix(
  "src/components/fitness/views/admin-overlay.tsx",
  "scrollbar-maxh64",
  `<div className="max-h-64 overflow-y-auto">`,
  `<div className="max-h-64 overflow-y-auto custom-scrollbar">`,
  2
);
applyFix(
  "src/components/fitness/views/admin-overlay.tsx",
  "scrollbar-maxh80",
  `<div className="max-h-80 overflow-y-auto">`,
  `<div className="max-h-80 overflow-y-auto custom-scrollbar">`,
  3
);

// ─── 4) برچسب ماه/سال شمسی — ثابت تهران (مستقل از TZ دستگاه) ───
applyFix(
  "src/lib/fitness/plan-media-groups.ts",
  "faMonthYear-tz",
  `    return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(d);`,
  `    return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric", timeZone: "Asia/Tehran" }).format(d);`
);

// ─── 5) details/route.ts — ایمپورت PERSIAN_WEEKDAYS ───
applyFix(
  "src/app/api/admin/users/[id]/details/route.ts",
  "details-weekdays-import",
  `import { BODY_SHAPE_LABELS_FA, SMOKING_HABIT_LABELS_FA, INJURY_AREA_LABELS_FA } from "@/lib/fitness/types";`,
  `import { BODY_SHAPE_LABELS_FA, SMOKING_HABIT_LABELS_FA, INJURY_AREA_LABELS_FA, PERSIAN_WEEKDAYS } from "@/lib/fitness/types";`
);

// ─── 6) details/route.ts — بازسازی/برش لیست روزها (یافتهٔ D ممیزی) ───
applyFix(
  "src/app/api/admin/users/[id]/details/route.ts",
  "details-workoutdays-rebuild",
  `      if (dayNames.length > 0) {
        // لیست حرف آخر را می‌زند — تعداد روز از لیست مشتق می‌شود (۱ تا ۷)
        updateData.workoutDays = Math.min(7, Math.max(1, dayNames.length));
      }
      // لیست خالی + تعداد معتبر → همان تعداد می‌ماند (لیست اختیاری است)
    }`,
  `      if (dayNames.length > 0) {
        // لیست حرف آخر را می‌زند — تعداد روز از لیست مشتق می‌شود (۱ تا ۷)
        // v230.4 — لیست بلندتر از هفته بی‌معناست: قبلاً تعداد ۷ می‌شد ولی لیست ۸تایی
        // سر جایش می‌ماند (همان ناهم‌خوانی) → برش + ذخیرهٔ لیستِ بریده
        if (dayNames.length > 7) dayNames = dayNames.slice(0, 7);
        updateData.workoutDays = Math.min(7, Math.max(1, dayNames.length));
        updateData.workoutDaysList = JSON.stringify(dayNames);
      } else if (!("workoutDaysList" in updateData)) {
        // v230.4 — فقط workoutDays آمده (PUT مستقیم API بدون UI): اگر لیست بازسازی
        // نشود، لیست کهنه می‌ماند و برچسب روزها می‌لغزد → بازسازی از ترتیب استاندارد
        const nDays = Number(updateData.workoutDays);
        if (Number.isFinite(nDays) && nDays >= 1 && nDays <= 7) {
          updateData.workoutDaysList = JSON.stringify(PERSIAN_WEEKDAYS.slice(0, nDays));
        }
      }
      // لیست خالی + تعداد معتبر → همان تعداد می‌ماند (لیست اختیاری است)
    }`
);

// ─── 7) details/route.ts — نوتیف فقط برای تغییر واقعی پروفایل (یافتهٔ E) ───
applyFix(
  "src/app/api/admin/users/[id]/details/route.ts",
  "details-notification-gate",
  `    // نوتیف به کاربر مبنی بر ویرایش پروفایل توسط ادمین
    await db.notification.create({
      data: {
        userId: id,
        type: "system",
        title: "پروفایل شما توسط ادمین به‌روزرسانی شد ✅",
        body: "اطلاعات پروفایل و پرونده پزشکی شما توسط ادمین ویرایش شد. در صورت سوال، با پشتیبانی در ارتباط باشید.",
        read: false,
      },
    }).catch(() => {});`,
  `    // نوتیف به کاربر مبنی بر ویرایش پروفایل توسط ادمین
    // v230.4 — فقط وقتی پروفایل واقعاً تغییر کرده باشد (ویرایشِ فقط-نام بی‌نوتیف)
    if (Object.keys(updateData).length > 0) {
      await db.notification.create({
        data: {
          userId: id,
          type: "system",
          title: "پروفایل شما توسط ادمین به‌روزرسانی شد ✅",
          body: "اطلاعات پروفایل و پرونده پزشکی شما توسط ادمین ویرایش شد. در صورت سوال، با پشتیبانی در ارتباط باشید.",
          read: false,
        },
      }).catch(() => {});
    }`
);

// ─── 8) ai.ts — کامنت کهنه (۱۱۰۰۰ → واقعی ۲۵۰۰۰) ───
applyFix(
  "src/lib/fitness/ai.ts",
  "ai-stale-comment",
  `لایهٔ ۲ — سقف renewalContext در buildPlanAwareInstructions: ۱۱۰۰۰ (v155).`,
  `لایهٔ ۲ — سقف renewalContext در buildPlanAwareInstructions: ۲۵۰۰۰ (v155، بازتر شده در v215).`
);

// ─── 9) DEPLOY.md — اسکراب ۳ راز زندهٔ بازار (داخل زیپ دیپلوی می‌رود) ───
applyFix(
  "download/DEPLOY.md",
  "deploy-scrub-client-id",
  `BAZAAR_CLIENT_ID=byvbZebXnM86x2gi4uELdt63gSJ2bXCNolhmQJNC`,
  `BAZAAR_CLIENT_ID=***در ‎.env سرور موجود است — از پیشخان بازار***`
);
applyFix(
  "download/DEPLOY.md",
  "deploy-scrub-client-secret",
  `BAZAAR_CLIENT_SECRET=IanPHTi8Tc4S8BIaeo0W7nHv2h7qbSbCC5AFf1g6oWlE9YucM9pCpZ4SWLRK`,
  `BAZAAR_CLIENT_SECRET=***در ‎.env سرور موجود است — از پیشخان بازار***`
);
applyFix(
  "download/DEPLOY.md",
  "deploy-scrub-api-secret",
  `BAZAAR_API_SECRET=eyJhbGciOiJIUzI1NiIsImtpZCI6ImFuY2llbnQiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJuYXNoZXItcGlzaGtoYW4tYXBpIiwiaWF0IjoxNzg4Mjg0NzQzLCJleHAiOjQ5NDE4ODQ3NDMsImFwaV9hZ2VudF9pZCI6OTE4Mn0.YC27kspD4k6OlMxDGkg7Jb8ldDVEG5YNU_7iILxh1ME`,
  `BAZAAR_API_SECRET=***در ‎.env سرور موجود است — توکن کامل پیشخان بازار***`
);

console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL")).length;
process.exit(fails > 0 ? 1 : 0);
