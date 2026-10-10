/**
 * تست واقعی deepseek-v4-flash — چت نیکا + تحلیل آنبوردینگ (آیتم ۲۵ درخواست مالک)
 *
 * با env واقعی (کلید AvalAI) دو مسیر را end-to-end می‌سنجد:
 *   ۱) چت نیکا مهمان (api/nika/guest-chat) — بدون نوشتن در DB
 *   ۲) چت نیکا احراز شده (api/nika/chat) — با سشن تست (پاک‌سازی می‌شود)
 *   ۳) تحلیل آنبوردینگ (api/onboarding/analysis?force=1) — AI واقعی + چک قیف پلن
 *
 * ورود تستی: بدون OTP واقعی — کاربر تست مستقیم در DB ساخته می‌شود و سشن با همان
 * الگوریتم createSessionToken (scrypt + SESSION_SECRET) امضا می‌شود. هیچ پیامکی
 * ارسال نمی‌شود و حساب واقعی هیچ کاربر (از جمله ادمین) لمس نمی‌شود.
 *
 * اجرا: bun scripts/test-real-ai-v59.ts
 * نکته: کاربر تست در پایان حذف می‌شود ( onDelete: Cascade ) — دیتابیس واقعی دست نمی‌خورد.
 */

import { createHash, scryptSync } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

export {};

// ─── env ───
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const p of ["/home/z/my-project/.env"]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();

const BASE = "http://localhost:3000";
// موبایل تستی که قطعاً در DB وجود ندارد (پیش‌شماره 0999 رزرو سندباکس)
const MOBILE = "0999" + String(Math.floor(Math.random() * 90000000) + 10000000);

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

/** چک تایپوگرافی فارسی: فقط فرم‌های واقعاً غلط (می/نمی + stem شناخته‌شده چسبیده) */
function typographyIssues(text: string): string[] {
  const issues: string[] = [];
  // همان لیست stemهای فیکسر — «میلیون/میزان» کلمهٔ واقعی‌اند و فلگ نمی‌شوند
  const STEMS = "خواه|خو|خور|توان|تون|شو|شه|شن|شود|رود|ره|بایست|دون|گو|گه|بین|بینی|ساز|رس|گیر|پوش|ده|دی|بر|دار|دید|کن|کنی|کنه|شم|شینی|زن|ریز|سوز|چرب|سنج|پاش|کاه|انگیز";
  const glued = text.match(new RegExp(`(^|[\\s.,!؟،()«»:؛\\-])(نمی|می)(?:${STEMS})[\\u0600-\\u06FF]+`, "g"));
  if (glued) issues.push(`چسبیده: ${[...new Set(glued.map((g) => g.trim()))].slice(0, 5).join("، ")}`);
  const commonGlued = ["بهطور", "بهعنوان", "بصورت", "برنامهات", "ورزشیتو"];
  for (const w of commonGlued) {
    if (text.includes(w)) issues.push(`کلمهٔ چسبیده: ${w}`);
  }
  return issues;
}

/** ساخت سشن معتبر — دقیقاً همان الگوریتم auth.ts */
function makeSessionToken(userId: string): string {
  const secret = ENV.SESSION_SECRET || "";
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

interface DbOut {
  userId: string | null;
  deleted: boolean;
}

/** اجرای کد DB در پروسهٔ جدا با پیکربندی درست (تریس مسیرهای @/) */
function runDbScript(code: string): DbOut | null {
  const file = "/tmp/v59-db-script.ts";
  const wrapped = `import { db } from "/home/z/my-project/src/lib/db";
async function _main() {
${code}
}
_main().then(() => process.exit(0)).catch((e) => { console.error("DBERR", e.message); process.exit(1); });
`;
  execSync(`cat > ${file} << 'DBEOF'\n${wrapped}\nDBEOF`, { encoding: "utf8" });
  try {
    const out = execSync(`cd /home/z/my-project && bun ${file} 2>/dev/null | tail -1`, {
      encoding: "utf8",
    }).trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("════════ تست واقعی AI v59 — نیکا + تحلیل آنبوردینگ (deepseek-v4-flash) ════════");
  console.log(`موبایل تست (ساخت مستقیم در DB — بدون SMS): ${MOBILE}\n`);

  // ─── ۱) چت نیکا مهمان (واقعی — deepseek-v4-flash) ───
  const t0 = Date.now();
  let r = await api("/api/nika/guest-chat", {
    method: "POST",
    body: JSON.stringify({
      message: "سلام! من ۲۵ سالمه، ۸۵ کیلومترم و می‌خوام ۱۰ کیلو چربی بسوزونم. از کجا شروع کنم؟",
      history: [],
    }),
  });
  const guestReply: string = r.body?.nikaMessage?.content ?? "";
  log(
    "nika-guest",
    r.status === 200 && guestReply.length > 30,
    `status=${r.status} طول پاسخ=${guestReply.length} کاراکتر، زمان=${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  if (r.status !== 200) console.log("   خطا:", JSON.stringify(r.body).slice(0, 300));
  const ty1 = typographyIssues(guestReply);
  log("nika-guest-typography", ty1.length === 0, ty1.length === 0 ? "بدون کلمهٔ چسبیده" : ty1.join(" | "));
  console.log("   نمونه پاسخ نیکا:", guestReply.slice(0, 160).replace(/\n/g, " "), "…\n");

  // ─── ۲) ساخت کاربر تست در DB + سشن معتبر ───
  const created = runDbScript(`
    const u = await db.user.create({ data: { mobile: "${MOBILE}", name: "تست AI v59" } });
    console.log(JSON.stringify({ userId: u.id, deleted: false }));
  `);
  const userId = created?.userId ?? null;
  log("test-user-created", !!userId, `userId=${userId ?? "-"}`);
  if (!userId) return;
  cookie = `sc_session=${makeSessionToken(userId)}`;

  // ─── ۳) آنبوردینگ ───
  r = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      firstName: "تست",
      lastName: "AI",
      gender: "male",
      age: 27,
      height: 180,
      weight: 84,
      targetWeight: 78,
      goal: "fat_loss",
      activityLevel: "moderate",
      workoutDays: 4,
      workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"],
      workoutPlace: "gym",
      dietType: "balanced",
      trainingExperience: "beginner",
    }),
  });
  log("onboarding", r.status === 200, `status=${r.status} ${r.body?.error ?? ""}`);
  if (r.status !== 200) { console.log("   خطا:", JSON.stringify(r.body).slice(0, 300)); await cleanup(); return; }

  // ─── ۴) تحلیل آنبوردینگ — AI واقعی (force=1 → بدون کش) ───
  const t1 = Date.now();
  r = await api("/api/onboarding/analysis?force=1");
  const analysis: string = r.body?.analysis ?? "";
  const rec = r.body?.planRecommendation;
  log(
    "onboarding-analysis",
    r.status === 200 && analysis.length > 100,
    `status=${r.status} طول تحلیل=${analysis.length} کاراکتر، زمان=${((Date.now() - t1) / 1000).toFixed(1)}s`
  );
  if (r.status !== 200) console.log("   خطا:", JSON.stringify(r.body).slice(0, 300));
  const ty2 = typographyIssues(analysis);
  log("analysis-typography", ty2.length === 0, ty2.length === 0 ? "بدون کلمهٔ چسبیده (فاصله/نیم‌فاصله درست)" : ty2.join(" | "));
  log(
    "plan-funnel-v59",
    rec?.recommendedPlan === "basic",
    `پلن پیشنهادی=${rec?.recommendedPlan} (باید basic ~۳۵۰K باشد — دیریکتیو مالک)`
  );
  console.log("   دلیل پیشنهاد:", (rec?.reason ?? "").slice(0, 160));
  console.log("   نمونه تحلیل:", analysis.slice(0, 220).replace(/\n/g, " "), "…\n");

  // ─── ۵) چت نیکا احراز شده (واقعی) ───
  const t2 = Date.now();
  r = await api("/api/nika/chat", {
    method: "POST",
    body: JSON.stringify({ message: "برای چربی‌سوزی بهتر کاردیو بهتره قبل تمرین یا بعدش؟" }),
  });
  const authReply: string = r.body?.nikaMessage?.content ?? "";
  log(
    "nika-auth",
    r.status === 200 && authReply.length > 30,
    `status=${r.status} طول پاسخ=${authReply.length} کاراکتر، زمان=${((Date.now() - t2) / 1000).toFixed(1)}s`
  );
  const ty3 = typographyIssues(authReply);
  log("nika-auth-typography", ty3.length === 0, ty3.length === 0 ? "بدون کلمهٔ چسبیده" : ty3.join(" | "));
  console.log("   نمونه پاسخ:", authReply.slice(0, 180).replace(/\n/g, " "), "…\n");

  await cleanup();

  console.log(process.exitCode === 1 ? "\n⚠️ تست با خطا" : "\n🎉 همهٔ تست‌های AI واقعی پاس شدند");
}

async function cleanup() {
  const del = runDbScript(`
    const u = await db.user.findUnique({ where: { mobile: "${MOBILE}" } });
    if (u) { await db.user.delete({ where: { id: u.id } }); console.log(JSON.stringify({ userId: null, deleted: true })); }
    else { console.log(JSON.stringify({ userId: null, deleted: false })); }
  `);
  console.log(`🧹 پاک‌سازی: ${del?.deleted ? "کاربر تست + همه رکوردهایش حذف شد" : "یافت نشد"}`);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
