import { db } from "@/lib/db";
import { apiError, requireAdmin } from "@/lib/fitness/auth";
import { sendTemplateSms, SMS_TEMPLATE_ENV_KEYS } from "@/lib/fitness/smsir";
import {
  ensureRenewalDiscountCode,
  ensureOnboardingWinbackCode,
  ensureWelcomeOfferCode,
} from "@/lib/fitness/notifications";
import { createSmsRenewLink } from "@/lib/fitness/sms-short-link";

/**
 * POST /api/admin/sms-test — تست ارسال واقعی هر ۱۵ قالب پیامکی (فقط ادمین)
 * body: { mobile: string }
 *
 * هر قالب با پارامترهای واقعی (نام ادمین + کد تخفیف واقعی + لینک واقعی)
 * به شمارهٔ داده‌شده ارسال می‌شود؛ با force=true دداپ SmsLog دور زده می‌شود
 * تا بتوان چند بار تست کرد. نتیجهٔ هر ۱۵ قالب به‌صورت آیتمی برمی‌گردد.
 * قالب‌های خرید (8-10) مثل جریان واقعی «خودترمیم» هستند: اول با NAME، اگر
 * خطا خورد بدون پارامتر — تا مشخص شود قالب متغیر دارد یا نه.
 * قالب‌های جدید v36 (11-13): ارتقای پلن 275042/324322 با NAME+PLANBASE+PLANUPDATE
 * و شارژ کیف پول 556023 با نردبان [NAME+AMOUNT]→[NAME]→[].
 *
 * v66 — حالت «تکی»: body { mobile, key } → فقط همان سناریو تست می‌شود
 * (از کارت ممیزی پیامک‌ها). کلیدها همان کلیدهای /api/admin/sms-audit هستند.
 */

/** نتیجهٔ تست یک سناریو */
async function runScenarioTest(
  key: string,
  target: string,
  admin: { id: string; name: string | null; mobile: string; referralCode: string | null }
): Promise<{ key: string; sent: boolean; skipped?: string; error?: string }> {
  const name = (admin.name || "ورزشکار").split(" ")[0];
  const resultKey = `${key}_663678test`;

  switch (key) {
    case "onboarding_nudge": {
      const r = await sendTemplateSms({
        key: "onboarding_nudge",
        templateEnvKey: "onboarding_nudge",
        mobile: target,
        params: [{ name: "NAME", value: name }],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "onboarding_winback": {
      const discount = await ensureOnboardingWinbackCode(admin.id, 15, 2);
      const r = await sendTemplateSms({
        key: "onboarding_winback",
        templateEnvKey: "onboarding_winback",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "CODE", value: discount?.code ?? "NEW15-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "program_ready": {
      const r = await sendTemplateSms({
        key: "program_ready",
        templateEnvKey: "program_ready",
        mobile: target,
        params: [{ name: "NAME", value: name }],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "checkup_reminder": {
      const r = await sendTemplateSms({
        key: "checkup_reminder",
        templateEnvKey: "checkup_reminder",
        mobile: target,
        params: [{ name: "NAME", value: name }],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "plan_expiring_soon": {
      const link = await createSmsRenewLink(admin.id, "test-expiring");
      const r = await sendTemplateSms({
        key: `plan_expiring_${resultKey}`,
        templateEnvKey: "plan_expiring_soon",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "LINK", value: link },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "plan_expired": {
      const link = await createSmsRenewLink(admin.id, "test-expired");
      const r = await sendTemplateSms({
        key: `plan_expired_${resultKey}`,
        templateEnvKey: "plan_expired",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "LINK", value: link },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "invite_friend": {
      const r = await sendTemplateSms({
        key: `invite_friend_test_${Date.now()}`,
        templateEnvKey: "invite_friend",
        mobile: target,
        params: [
          { name: "NAME", value: "دوست خوبم" },
          { name: "LINK", value: `go/plans?ref=${admin.referralCode ?? "FIT-TEST01"}` },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "expired_winback": {
      const discount = await ensureRenewalDiscountCode(admin.id, 15, 2);
      const r = await sendTemplateSms({
        key: "expired_winback",
        templateEnvKey: "expired_winback",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "CODE", value: discount?.code ?? "FITAP15-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "welcome_offer": {
      const discount = await ensureWelcomeOfferCode(admin.id, 30, 2);
      const r = await sendTemplateSms({
        key: "welcome_offer",
        templateEnvKey: "welcome_offer",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "CODE", value: discount?.code ?? "HI30-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "renewal_boost": {
      const discount = await ensureRenewalDiscountCode(admin.id, 30, 2);
      let r = await sendTemplateSms({
        key: `renewal_boost_test_${Date.now()}`,
        templateEnvKey: "renewal_boost",
        mobile: target,
        params: [
          { name: "NAME", value: name },
          { name: "CODE", value: discount?.code ?? "FITAP30-TEST01" },
          { name: "LINK", value: await createSmsRenewLink(admin.id, "test") },
        ],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `renewal_boost_test_${Date.now()}`,
          templateEnvKey: "renewal_boost",
          mobile: target,
          params: [
            { name: "NAME", value: name },
            { name: "CODE", value: discount?.code ?? "FITAP30-TEST01" },
          ],
          userId: admin.id,
          force: true,
        });
      }
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "purchase_advanced":
    case "purchase_ultimate":
    case "purchase_basic": {
      let r = await sendTemplateSms({
        key: `purchase_test_${Date.now()}`,
        templateEnvKey: key,
        mobile: target,
        params: [{ name: "NAME", value: name }],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `purchase_test_${Date.now()}`,
          templateEnvKey: key,
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "plan_upgrade_premium":
    case "plan_upgrade_standard": {
      const fullParams = [
        { name: "NAME", value: name },
        { name: "PLANBASE", value: "اقتصادی" },
        { name: "PLANUPDATE", value: key === "plan_upgrade_premium" ? "حرفه‌ای" : "استاندارد" },
      ];
      let r = await sendTemplateSms({
        key: `upgrade_test_${Date.now()}`,
        templateEnvKey: key,
        mobile: target,
        params: fullParams,
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `upgrade_test_${Date.now()}`,
          templateEnvKey: key,
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      return { key, sent: r.sent, skipped: r.skipped, error: r.error };
    }
    case "wallet_topup": {
      const attempts: Array<Array<{ name: string; value: string }>> = [
        [
          { name: "NAME", value: name },
          { name: "AMOUNT", value: "۵۰۰,۰۰۰" },
        ],
        [{ name: "NAME", value: name }],
        [],
      ];
      let r: Awaited<ReturnType<typeof sendTemplateSms>> | null = null;
      for (const params of attempts) {
        r = await sendTemplateSms({
          key: `wallet_test_${Date.now()}`,
          templateEnvKey: "wallet_topup",
          mobile: target,
          params,
          userId: admin.id,
          force: true,
        });
        if (r.sent) break;
      }
      return { key, sent: !!r?.sent, skipped: r?.skipped, error: r?.error };
    }
    default:
      return { key, sent: false, error: "سناریوی تست ناشناخته است." };
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    let mobile = "";
    let singleKey = "";
    try {
      const body = await req.json();
      mobile = String(body?.mobile ?? "");
      singleKey = String(body?.key ?? "");
    } catch {}
    // پیش‌فرض: شمارهٔ خود ادمین
    const target = mobile.trim() || admin.mobile;
    if (!/^09\d{9}$/.test(target.replace(/\s/g, ""))) {
      return Response.json({ error: "شماره موبایل معتبر نیست." }, { status: 400 });
    }

    const adminRef = {
      id: admin.id,
      name: admin.name,
      mobile: admin.mobile,
      referralCode: admin.referralCode,
    };

    // ─── v66 — حالت تکی (از کارت ممیزی) ───
    if (singleKey) {
      const result = await runScenarioTest(singleKey, target, adminRef);
      return Response.json({ ok: true, target, single: true, results: [result] });
    }

    const envStatus = Object.entries(SMS_TEMPLATE_ENV_KEYS).map(([key, envKey]) => ({
      key,
      envKey,
      templateId: process.env[envKey] ?? null,
    }));

    const results: Array<{ key: string; sent: boolean; skipped?: string; error?: string }> = [];

    // 1) 669068 — onboarding_nudge (NAME)
    {
      const r = await sendTemplateSms({
        key: "onboarding_nudge",
        templateEnvKey: "onboarding_nudge",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "onboarding_nudge_669068", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 2) 461291 — onboarding_winback (NAME + CODE)
    {
      const discount = await ensureOnboardingWinbackCode(admin.id, 15, 2); // v53 — اعتبار ۴۸ ساعته
      const r = await sendTemplateSms({
        key: "onboarding_winback",
        templateEnvKey: "onboarding_winback",
        mobile: target,
        params: [
          { name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] },
          { name: "CODE", value: discount?.code ?? "NEW15-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "onboarding_winback_461291", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 3) 663678 — program_ready (NAME)
    {
      const r = await sendTemplateSms({
        key: "program_ready",
        templateEnvKey: "program_ready",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "program_ready_663678", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 4) 761137 — checkup_reminder (NAME)
    {
      const r = await sendTemplateSms({
        key: "checkup_reminder",
        templateEnvKey: "checkup_reminder",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "checkup_reminder_761137", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 5) 322780 — plan_expired (NAME)
    {
      const r = await sendTemplateSms({
        key: "plan_expired",
        templateEnvKey: "plan_expired",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "plan_expired_322780", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 6) 852193 — invite_friend (NAME + LINK)
    {
      const r = await sendTemplateSms({
        key: `invite_friend_test_${Date.now()}`, // تست: هر بار ارسال می‌شود
        templateEnvKey: "invite_friend",
        mobile: target,
        params: [
          { name: "NAME", value: "دوست خوبم" },
          { name: "LINK", value: `?ref=${admin.referralCode ?? "FIT-TEST01"}` },
        ],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "invite_friend_852193", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 7) 604678 — expired_winback (NAME + CODE)
    {
      const discount = await ensureRenewalDiscountCode(admin.id, 15, 2); // v53 — اعتبار ۴۸ ساعته
      const r = await sendTemplateSms({
        key: "expired_winback",
        templateEnvKey: "expired_winback",
        mobile: target,
        params: [
          { name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] },
          { name: "CODE", value: discount?.code ?? "FITAP15-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "expired_winback_604678", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 7.5) 612964 — welcome_offer (NAME + CODE) — v47 خوش‌آمدگویی ۸ روزه
    {
      const discount = await ensureWelcomeOfferCode(admin.id, 30, 2); // v53 — اعتبار ۴۸ ساعته
      const r = await sendTemplateSms({
        key: "welcome_offer",
        templateEnvKey: "welcome_offer",
        mobile: target,
        params: [
          { name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] },
          { name: "CODE", value: discount?.code ?? "HI30-TEST01" },
        ],
        userId: admin.id,
        force: true,
      });
      results.push({ key: "welcome_offer_612964", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 7.6) 883325 — renewal_boost (NAME + CODE + LINK) — v47 تقویت تمدید ۸ روزه
    {
      const discount = await ensureRenewalDiscountCode(admin.id, 30, 2); // v53 — اعتبار ۴۸ ساعته
      let r = await sendTemplateSms({
        key: `renewal_boost_test_${Date.now()}`,
        templateEnvKey: "renewal_boost",
        mobile: target,
        params: [
          { name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] },
          { name: "CODE", value: discount?.code ?? "FITAP30-TEST01" },
          { name: "LINK", value: await createSmsRenewLink(admin.id, "test") },
        ],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        // خودترمیم: قالب شاید LINK نداشته باشد → بدون لینک
        r = await sendTemplateSms({
          key: `renewal_boost_test_${Date.now()}`,
          templateEnvKey: "renewal_boost",
          mobile: target,
          params: [
            { name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] },
            { name: "CODE", value: discount?.code ?? "FITAP30-TEST01" },
          ],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "renewal_boost_883325", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 8) 423726 — purchase_advanced (خرید پلن پیشرفته)
    {
      // تست هر دو حالت پارامتر: ابتدا با NAME — اگر قالب متغیر نداشته باشد و
      // خطا بخورد، بدون پارامتر تلاش می‌شود (همان خودترمیم جریان واقعی خرید)
      let r = await sendTemplateSms({
        key: `purchase_test_${Date.now()}`, // تست: هر بار ارسال می‌شود
        templateEnvKey: "purchase_advanced",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `purchase_test_${Date.now()}`,
          templateEnvKey: "purchase_advanced",
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "purchase_advanced_423726", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 9) 612405 — purchase_ultimate (خرید پلن حرفه‌ای)
    {
      let r = await sendTemplateSms({
        key: `purchase_test_${Date.now()}`,
        templateEnvKey: "purchase_ultimate",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `purchase_test_${Date.now()}`,
          templateEnvKey: "purchase_ultimate",
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "purchase_ultimate_612405", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 10) 565185 — purchase_basic (خرید پلن اقتصادی یا استاندارد — یک قالب مشترک)
    {
      let r = await sendTemplateSms({
        key: `purchase_test_${Date.now()}`,
        templateEnvKey: "purchase_basic",
        mobile: target,
        params: [{ name: "NAME", value: (admin.name || "ورزشکار").split(" ")[0] }],
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `purchase_test_${Date.now()}`,
          templateEnvKey: "purchase_basic",
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "purchase_basic_565185", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 11) 275042 — plan_upgrade_premium (ارتقا از اقتصادی/استاندارد به پیشرفته/حرفه‌ای)
    {
      const name = (admin.name || "ورزشکار").split(" ")[0];
      const fullParams = [
        { name: "NAME", value: name },
        { name: "PLANBASE", value: "اقتصادی" },
        { name: "PLANUPDATE", value: "حرفه‌ای" },
      ];
      let r = await sendTemplateSms({
        key: `upgrade_test_${Date.now()}`, // تست: هر بار ارسال می‌شود
        templateEnvKey: "plan_upgrade_premium",
        mobile: target,
        params: fullParams,
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `upgrade_test_${Date.now()}`,
          templateEnvKey: "plan_upgrade_premium",
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "plan_upgrade_premium_275042", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 12) 324322 — plan_upgrade_standard (فقط ارتقا از اقتصادی به استاندارد)
    {
      const name = (admin.name || "ورزشکار").split(" ")[0];
      const fullParams = [
        { name: "NAME", value: name },
        { name: "PLANBASE", value: "اقتصادی" },
        { name: "PLANUPDATE", value: "استاندارد" },
      ];
      let r = await sendTemplateSms({
        key: `upgrade_test_${Date.now()}`,
        templateEnvKey: "plan_upgrade_standard",
        mobile: target,
        params: fullParams,
        userId: admin.id,
        force: true,
      });
      if (!r.sent) {
        r = await sendTemplateSms({
          key: `upgrade_test_${Date.now()}`,
          templateEnvKey: "plan_upgrade_standard",
          mobile: target,
          params: [],
          userId: admin.id,
          force: true,
        });
      }
      results.push({ key: "plan_upgrade_standard_324322", sent: r.sent, skipped: r.skipped, error: r.error });
    }

    // 13) 556023 — wallet_topup (شارژ کیف پول بعد از تأیید پرداخت)
    {
      const name = (admin.name || "ورزشکار").split(" ")[0];
      const attempts: Array<Array<{ name: string; value: string }>> = [
        [
          { name: "NAME", value: name },
          { name: "AMOUNT", value: "۵۰۰,۰۰۰" },
        ],
        [{ name: "NAME", value: name }],
        [],
      ];
      let r: Awaited<ReturnType<typeof sendTemplateSms>> | null = null;
      for (const params of attempts) {
        r = await sendTemplateSms({
          key: `wallet_test_${Date.now()}`, // تست: هر بار ارسال می‌شود
          templateEnvKey: "wallet_topup",
          mobile: target,
          params,
          userId: admin.id,
          force: true,
        });
        if (r.sent) break;
      }
      results.push({ key: "wallet_topup_556023", sent: !!r?.sent, skipped: r?.skipped, error: r?.error });
    }

    return Response.json({ ok: true, target, envStatus, results });
  } catch (e) {
    return apiError(e);
  }
}
