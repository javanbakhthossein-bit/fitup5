/**
 * تست واقعی v60 — اهداف جدید (cut/bulk) + شرایط خاص کاربر + چت نیکا
 * با env واقعی (کلید AvalAI — deepseek-v4-flash برای تحلیل آنبوردینگ):
 *   ۱) POST /api/onboarding با goal="cut" + specialConditions → ذخیره
 *   ۲) GET /api/onboarding/analysis?force=1 → تحلیل واقعی AI + چک ماکروی کات
 *      (نقصان ۲۰٪ + پروتئین ۲.۴g/kg) + چک بازتاب شرایط خاص در تحلیل + قیف basic
 *   ۳) POST /api/onboarding با goal="bulk" → چک ماکروی حجم (مازاد ۱۵٪) بدون AI (سریع)
 *   ۴) چت نیکا مهمان (واقعی)
 * کاربر تست در پایان حذف می‌شود؛ هیچ پیامکی ارسال نمی‌شود.
 */
import { createHash, scryptSync } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

export {};

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

function makeSessionToken(userId: string): string {
  const secret = ENV.SESSION_SECRET || "";
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

function runDbScript(code: string): any | null {
  const file = "/tmp/v60-db-script.ts";
  const wrapped = `import { db } from "/home/z/my-project/src/lib/db";
async function _main() {
${code}
}
_main().then(() => process.exit(0)).catch((e) => { console.error("DBERR", e.message); process.exit(1); });
`;
  execSync(`cat > ${file} << 'DBEOF'\n${wrapped}\nDBEOF`, { encoding: "utf8" });
  try {
    const out = execSync(`cd /home/z/my-project && bun ${file} 2>/dev/null | tail -1`, { encoding: "utf8" }).trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

async function cleanup() {
  const del = runDbScript(`
    const u = await db.user.findUnique({ where: { mobile: "${MOBILE}" } });
    if (u) { await db.user.delete({ where: { id: u.id } }); console.log(JSON.stringify({ deleted: true })); }
    else { console.log(JSON.stringify({ deleted: false })); }
  `);
  console.log(`🧹 پاک‌سازی: ${del?.deleted ? "کاربر تست حذف شد" : "یافت نشد"}`);
}

async function main() {
  console.log("════════ تست واقعی AI v60 — اهداف cut/bulk + شرایط خاص + نیکا ════════");
  console.log(`موبایل تست: ${MOBILE}\n`);

  const created = runDbScript(`
    const u = await db.user.create({ data: { mobile: "${MOBILE}", name: "تست AI v60" } });
    console.log(JSON.stringify({ userId: u.id }));
  `);
  const userId = created?.userId ?? null;
  log("test-user-created", !!userId, `userId=${userId ?? "-"}`);
  if (!userId) return;
  cookie = `sc_session=${makeSessionToken(userId)}`;

  // ─── ۱) آنبوردینگ با هدف cut + شرایط خاص ───
  const SPECIAL = "کمرم حساسیت داره و از اسکوات سنگین باید پرهیز کنم؛ شیفتم دوشنبه‌هاست؛ مسابقه ۱۰ کیلومتری تیرماه دارم";
  let r = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      firstName: "تست", lastName: "AI", gender: "male", age: 27, height: 180,
      weight: 84, targetWeight: 78, goal: "cut", activityLevel: "moderate",
      workoutDays: 4, workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"],
      workoutPlace: "gym", dietType: "balanced", trainingExperience: "beginner",
      specialConditions: SPECIAL,
    }),
  });
  log("onboarding-cut+special", r.status === 200, `status=${r.status} ${r.body?.error ?? ""}`);
  if (r.status !== 200) { console.log("   خطا:", JSON.stringify(r.body).slice(0, 300)); await cleanup(); return; }

  const saved = runDbScript(`
    const p = await db.onboardingProfile.findUnique({ where: { userId: "${userId}" }, select: { specialConditions: true, goal: true } });
    console.log(JSON.stringify({ specialConditions: p?.specialConditions ?? null, goal: p?.goal ?? null }));
  `);
  log("special-conditions-saved", saved?.specialConditions === SPECIAL, `goal=${saved?.goal} ذخیره=${saved?.specialConditions ? "✓" : "✗"}`);

  // ─── ۲) تحلیل واقعی AI + چک ماکروی کات ───
  const t1 = Date.now();
  r = await api("/api/onboarding/analysis?force=1");
  const analysis: string = r.body?.analysis ?? "";
  const macros = r.body?.macros;
  const rec = r.body?.planRecommendation;
  log("analysis-ai", r.status === 200 && analysis.length > 100, `طول=${analysis.length} زمان=${((Date.now() - t1) / 1000).toFixed(1)}s`);
  log(
    "cut-macros",
    macros && Math.abs(macros.deficitPercent - 20) < 0.1 && Math.abs(macros.proteinPerKg - 2.4) < 0.01,
    `نقصان=${macros?.deficitPercent}٪ (انتظار ۲۰) | پروتئین=${macros?.proteinPerKg}g/kg (انتظار ۲.۴)`
  );
  log("plan-funnel", rec?.recommendedPlan === "basic", `پلن پیشنهادی=${rec?.recommendedPlan} (باید basic باشد)`);
  const reflectsSpecial =
    analysis.includes("کمر") || analysis.includes("شیف") || analysis.includes("۱۰ کیلومتر") || analysis.includes("دوشنبه") || analysis.includes("مسابقه");
  log("special-conditions-reflected", reflectsSpecial, `تحلیل به شرایط خاص اشاره ${reflectsSpecial ? "کرد ✓" : "نکرد ✗"}`);
  console.log("   نمونه تحلیل:", analysis.slice(0, 260).replace(/\n/g, " "), "…\n");

  // ─── ۳) هدف bulk — چک ماکرو بدون AI (آنبوردینگ دوباره ذخیره می‌شود) ───
  r = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      firstName: "تست", lastName: "AI", gender: "male", age: 27, height: 180,
      weight: 84, targetWeight: 88, goal: "bulk", activityLevel: "moderate",
      workoutDays: 4, workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"],
      workoutPlace: "gym", dietType: "balanced", trainingExperience: "beginner",
    }),
  });
  r = await api("/api/onboarding/analysis");
  const bulkMacros = r.body?.macros;
  log(
    "bulk-macros",
    bulkMacros && Math.abs(bulkMacros.deficitPercent - (-15)) < 0.1 && Math.abs(bulkMacros.proteinPerKg - 2.0) < 0.01,
    `مازاد=${bulkMacros?.deficitPercent}٪ (انتظار -۱۵) | پروتئین=${bulkMacros?.proteinPerKg}g/kg (انتظار ۲.۰)`
  );

  // ─── ۴) چت نیکا مهمان (واقعی) ───
  const t0 = Date.now();
  cookie = "";
  r = await api("/api/nika/guest-chat", {
    method: "POST",
    body: JSON.stringify({ message: "تفاوت کات و کاهش وزن چیه؟", history: [] }),
  });
  const guestReply: string = r.body?.nikaMessage?.content ?? "";
  log("nika-guest", r.status === 200 && guestReply.length > 30, `طول=${guestReply.length} زمان=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("   نمونه:", guestReply.slice(0, 150).replace(/\n/g, " "), "…");

  await cleanup();
  console.log(process.exitCode === 1 ? "\n⚠️ تست با خطا" : "\n🎉 همهٔ تست‌های v60 پاس شدند");
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
