/**
 * تست رفتاری «تحلیل هوشمند یک‌بار در هر پلن» (v48 — دیریکتیو مالک)
 *
 *  ۱) GET عادی → aiAnalysis=null (دکمهٔ تحلیل)
 *  ۲) بعد از اولین تولید (شبیه‌سازی با درج رکورد) → GET عادی تحلیل ذخیره‌شده را
 *     برمی‌گرداند (آکاردئون به‌جای دکمه — بدون درخواست AI)
 *  ۳) GET با analyze=1 وقتی تحلیل ذخیره دارد → همان متن بدون هیچ فراخوانی LLM
 *     (شمارش رکوردها ثابت می‌ماند = ضد سوختن توکن)
 *  ۴) پلن/بازسازی جدید → planKey جدید → دکمه دوباره ظاهر می‌شود (تحلیل قبلی به
 *     پلن قبلی چسبیده است)
 * اجرا: bun scripts/test-plan-analysis-once.ts
 */
import { config } from "dotenv";
config({ path: "/home/z/my-project/.env" });

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";

const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { createSessionToken } = await import("../src/lib/fitness/auth");

  console.log("═══ تست تحلیل هوشمند یک‌بار در هر پلن ═══");

  // ─── کاربر تست ایزوله ───
  const mobile = "09900000048";
  await db.user.deleteMany({ where: { mobile } });
  const user = await db.user.create({
    data: {
      mobile,
      name: "تست تحلیل v48",
      planName: "ultimate",
      planStartedAt: new Date(),
      planExpiresAt: new Date(Date.now() + 40 * 24 * 3600 * 1000),
      onboardingDone: true,
    },
  });

  const planContent = JSON.stringify({
    weeklyGoal: "تست",
    notes: "",
    days: [{ day: "شنبه", title: "سینه", exercises: [{ id: "e1", name: "پرس سینه", sets: [{ setNumber: 1, reps: 10, weight: 40 }] }] }],
  });
  const plan1 = await db.workoutPlan.create({
    data: { userId: user.id, weekIndex: 0, active: true, content: planContent },
  });

  const cookie = `sc_session=${createSessionToken(user.id)}`;
  const get = async (qs = "") => {
    const res = await fetch(`${BASE}/api/coach/program-history${qs}`, {
      headers: { cookie },
      cache: "no-store",
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  // ۱) حالت اول — بدون تحلیل ذخیره‌شده
  const r1 = await get();
  check("GET عادی: برنامه‌ها برگشت", r1.status === 200 && (r1.data?.programs?.length ?? 0) === 1, `programs=${r1.data?.programs?.length}`);
  check("GET عادی: بدون تحلیل → aiAnalysis=null", r1.data?.aiAnalysis === null && r1.data?.aiAnalysisStored === false);

  // ۲) شبیه‌سازی اولین تولید (درج رکورد — همان کاری که analyze=1 می‌کند)
  await db.planAiAnalysis.create({
    data: { userId: user.id, planKey: plan1.id, content: "تحلیل تست v48 — مخصوص همین برنامه.", model: "test" },
  });
  const r2 = await get();
  check("GET عادی بعد از تولید: آکاردئون (تحلیل ذخیره‌شده)", r2.data?.aiAnalysis === "تحلیل تست v48 — مخصوص همین برنامه." && r2.data?.aiAnalysisStored === true);

  // ۳) analyze=1 با تحلیل موجود → بدون فراخوانی LLM (فوری + رکورد جدید نمی‌سازد)
  const t0 = Date.now();
  const r3 = await get("?analyze=1");
  const elapsed = Date.now() - t0;
  const countAfter = await db.planAiAnalysis.count({ where: { userId: user.id } });
  check("analyze=1 با تحلیل موجود: همان متن (بدون AI)", r3.data?.aiAnalysis === "تحلیل تست v48 — مخصوص همین برنامه.", `${elapsed}ms`);
  check("analyze=1: رکورد جدید نساخت (ضد سوختن توکن)", countAfter === 1 && elapsed < 5000, `count=${countAfter}, ${elapsed}ms`);

  // ۴) پلن جدید → planKey جدید → دکمه برمی‌گردد
  const plan2 = await db.workoutPlan.create({
    data: { userId: user.id, weekIndex: 1, active: true, content: planContent },
  });
  const r4 = await get();
  check("پلن جدید: تحلیل قبلی به پلن قبلی چسبیده (دکمهٔ تحلیل برمی‌گردد)", r4.data?.aiAnalysis === null && r4.data?.aiAnalysisStored === false);
  check("planKey = آخرین چرخهٔ برنامه", r4.data?.programs?.length === 2);

  // ─── پاک‌سازی کامل ───
  await db.planAiAnalysis.deleteMany({ where: { userId: user.id } });
  await db.workoutPlan.deleteMany({ where: { userId: user.id } });
  await db.smsLog.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log("  🧹 پاک‌سازی انجام شد");

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
