/**
 * ai-e2e-v256.ts — تست E2E تولید برنامه با هوش مصنوعی واقعی (AvalAI)
 * ─────────────────────────────────────────────────────────────────────
 * دیرکتیو مالک: «میخوام با هوش مصنوعی خودم بصورت دقیق تست کنی که برنامه‌ای
 * دیگه بدون باگ ساخته نمیشه» + «نمیخوام برنامهٔ کاربران برای خودشون بازطراحی
 * بشه» → فقط کاربرانِ سنتزیِ «آینده» (پیش‌شمارهٔ 099991000xx).
 *
 * معماری (مقاوم به Reaper سندباکس): تولید داخل next-server نظارت‌شده اجرا می‌شود
 * و این اسکریپت فقط «کلاینتِ واقعی» است — مثل یک کاربر آیندهٔ واقعی:
 *   --setup          ساخت ۱۰ کاربر سنتزی + پروفایل + اشتراک (+عکس/وضعیت‌ها)
 *   --drive i,i      ورود واقعی (dev OTP) + PUT /api/coach/plan → تولید در سرور
 *   --renew i,i      تمدید واقعی: اشتراک نو + POST /api/renew/update-metrics
 *   --audit A|D      ممیزی ریزبه‌ریز برنامه‌های تولیدشده
 *   --report         ساخت گزارش نهایی JSON
 *   --status         وضعیت لحظه‌ای درخواست‌ها
 *
 * اجرا: DATABASE_URL=file:/home/z/my-project/db/custom.db bun ai-e2e-v256.ts --setup
 */
import { db } from "@/lib/db";
import { coveredMajorGroupsDetailed, MAJOR_GROUP_KEYS } from "@/lib/fitness/exercise-bank-lock";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const MOBILE_PREFIX = "099991000";
const mobileOf = (idx: number) => `${MOBILE_PREFIX}${String(idx).padStart(2, "0")}`;
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ProfileSpec {
  idx: number; name: string; gender: "male" | "female"; age: number;
  height: number; weight: number; targetWeight: number;
  goal: string; activityLevel: string; days: number;
  daysList: string[]; place: "gym" | "home" | "both";
  equipment: string[]; experience: string; plan: "basic" | "standard" | "advanced" | "ultimate";
  injuryAreas: string[]; injuriesText: string; mealCount: number;
  sleepHours: number; stressLevel: number; discipline: string; special?: string;
}

// ═══════════ ۱۰ پروفایل سنتزی «کاربر آینده» ═══════════
const SPECS: ProfileSpec[] = [
  { idx: 1, name: "تست-آینده امیرحسین", gender: "male", age: 28, height: 180, weight: 74, targetWeight: 82, goal: "muscle_gain", activityLevel: "moderate", days: 5, daysList: ["شنبه", "یکشنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"], place: "gym", equipment: ["barbell", "dumbbell", "machine", "cable", "bench", "pullup_bar"], experience: "advanced", plan: "ultimate", injuryAreas: [], injuriesText: "", mealCount: 5, sleepHours: 8, stressLevel: 2, discipline: "bodybuilding", special: "پلن حرفه‌ای کامل — عکس بدن آپلودشده، ویدیو ردشده، آزمایش ردشده" },
  { idx: 2, name: "تست-آینده مریم", gender: "female", age: 31, height: 165, weight: 78, targetWeight: 64, goal: "fat_loss", activityLevel: "light", days: 3, daysList: ["شنبه", "دوشنبه", "چهارشنبه"], place: "home", equipment: ["bodyweight"], experience: "beginner", plan: "basic", injuryAreas: [], injuriesText: "", mealCount: 3, sleepHours: 7, stressLevel: 3, discipline: "general", special: "خانگی فقط وزن بدن — چربی‌سوزی" },
  { idx: 3, name: "تست-آینده رضا", gender: "male", age: 42, height: 176, weight: 96, targetWeight: 84, goal: "fat_loss", activityLevel: "light", days: 4, daysList: ["شنبه", "یکشنبه", "سه‌شنبه", "پنجشنبه"], place: "gym", equipment: ["barbell", "dumbbell", "machine", "bench"], experience: "beginner", plan: "standard", injuryAreas: ["knee"], injuriesText: "درد زانو هنگام دویدن", mealCount: 4, sleepHours: 6, stressLevel: 4, discipline: "general", special: "آسیب زانو — ممنوعیت پرش/اسکوات عمیق + کاردیوی ایمن" },
  { idx: 4, name: "تست-آینده سارا", gender: "female", age: 24, height: 170, weight: 58, targetWeight: 60, goal: "muscle_gain", activityLevel: "moderate", days: 4, daysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"], place: "gym", equipment: ["barbell", "dumbbell", "machine", "cable", "bench"], experience: "intermediate", plan: "standard", injuryAreas: [], injuriesText: "", mealCount: 4, sleepHours: 8, stressLevel: 2, discipline: "fitness", special: "پوشش ۶ گروه + استک مکمل (استاندارد)" },
  { idx: 5, name: "تست-آینده علی", gender: "male", age: 35, height: 172, weight: 70, targetWeight: 72, goal: "fitness", activityLevel: "moderate", days: 3, daysList: ["یکشنبه", "سه‌شنبه", "پنجشنبه"], place: "both", equipment: ["dumbbell", "bands"], experience: "beginner", plan: "basic", injuryAreas: [], injuriesText: "", mealCount: 3, sleepHours: 7, stressLevel: 3, discipline: "general", special: "محیط ترکیبی با تجهیزات محدود" },
  { idx: 6, name: "تست-آینده حسین", gender: "male", age: 45, height: 178, weight: 88, targetWeight: 80, goal: "strength", activityLevel: "light", days: 4, daysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"], place: "gym", equipment: ["barbell", "dumbbell", "bench", "machine"], experience: "intermediate", plan: "standard", injuryAreas: ["lower_back"], injuriesText: "دیسک کمر خفیف — پزشک تمرین قدرتی مجاز دانسته", mealCount: 4, sleepHours: 6, stressLevel: 4, discipline: "powerlifting", special: "آسیب کمر — ممنوعیت ددلیفت/گودمورنینگ/پرش" },
  { idx: 7, name: "تست-آینده زهرا", gender: "female", age: 38, height: 160, weight: 92, targetWeight: 75, goal: "endurance", activityLevel: "sedentary", days: 4, daysList: ["شنبه", "یکشنبه", "سه‌شنبه", "چهارشنبه"], place: "home", equipment: ["bodyweight"], experience: "beginner", plan: "standard", injuryAreas: [], injuriesText: "", mealCount: 4, sleepHours: 6, stressLevel: 5, discipline: "general", special: "BMI≈۳۶ — ممنوعیت پرش/پلایومتریک + هوازی سازگار" },
  { idx: 8, name: "تست-آینده محمد", gender: "male", age: 26, height: 174, weight: 62, targetWeight: 70, goal: "muscle_gain", activityLevel: "active", days: 4, daysList: ["شنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"], place: "home", equipment: ["dumbbell", "pullup_bar", "bands", "bench"], experience: "intermediate", plan: "standard", injuryAreas: [], injuriesText: "", mealCount: 5, sleepHours: 8, stressLevel: 2, discipline: "calisthenics", special: "خانگی تجهیزات‌دار — خلوص تجهیزات" },
  { idx: 9, name: "تست-آینده نگار", gender: "female", age: 29, height: 168, weight: 61, targetWeight: 58, goal: "fitness", activityLevel: "active", days: 5, daysList: ["شنبه", "یکشنبه", "دوشنبه", "چهارشنبه", "پنجشنبه"], place: "gym", equipment: ["barbell", "dumbbell", "machine", "cable", "bench"], experience: "advanced", plan: "advanced", injuryAreas: ["shoulder"], injuriesText: "impingement شانه — پرس بالاسینه درد می‌دهد", mealCount: 4, sleepHours: 7, stressLevel: 2, discipline: "womens_fitness", special: "آسیب شانه — ممنوعیت پشت‌گردن" },
  { idx: 10, name: "تست-آینده کیوان", gender: "male", age: 33, height: 181, weight: 103, targetWeight: 88, goal: "fat_loss", activityLevel: "moderate", days: 5, daysList: ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "پنجشنبه"], place: "both", equipment: ["dumbbell", "bands", "machine"], experience: "intermediate", plan: "standard", injuryAreas: ["wrist"], injuriesText: "مچ دست راست در تمرین پرس اذیت می‌کند", mealCount: 5, sleepHours: 6, stressLevel: 4, discipline: "general", special: "BMI≈۳۱ — ممنوعیت پرش + ممنوعیت فشار مچ" },
];

// ═══════════ --setup ═══════════
async function setup(onlyIdxs?: number[]) {
  const specs = onlyIdxs?.length ? SPECS.filter((s) => onlyIdxs.includes(s.idx)) : SPECS;
  console.log(`── ساخت ${fa(specs.length)} کاربر سنتزی ──`);
  for (const spec of specs) {
    const mobile = mobileOf(spec.idx);
    const old = await db.user.findUnique({ where: { mobile } });
    if (old) {
      await db.workoutPlan.deleteMany({ where: { userId: old.id } });
      await db.mealPlan.deleteMany({ where: { userId: old.id } });
      await db.programRequest.deleteMany({ where: { userId: old.id } });
      await db.subscription.deleteMany({ where: { userId: old.id } });
      await db.progressPhoto.deleteMany({ where: { userId: old.id } });
      await db.weightLog.deleteMany({ where: { userId: old.id } });
      await db.onboardingProfile.deleteMany({ where: { userId: old.id } });
      await db.notification.deleteMany({ where: { userId: old.id } });
      await db.user.delete({ where: { id: old.id } });
    }
    const now = new Date();
    const user = await db.user.create({
      data: {
        mobile, name: spec.name, role: "USER",
        ...(spec.plan === "ultimate" ? { videoStatus: "skipped", bloodTestStatus: "declined" } : {}),
      },
    });
    await db.subscription.create({
      data: { userId: user.id, plan: spec.plan, status: "active", startDate: now, endDate: new Date(now.getTime() + 45 * 86400000), durationDays: 45, pricePaid: 0 },
    });
    await db.onboardingProfile.create({
      data: {
        userId: user.id, gender: spec.gender, age: spec.age, height: spec.height,
        weight: spec.weight, targetWeight: spec.targetWeight, goal: spec.goal,
        activityLevel: spec.activityLevel, workoutDays: spec.days,
        workoutDaysList: JSON.stringify(spec.daysList), workoutPlace: spec.place,
        equipment: JSON.stringify(spec.equipment), diseases: "", injuries: spec.injuriesText,
        injuryAreas: JSON.stringify(spec.injuryAreas), allergies: "", dietType: "standard",
        mealCount: spec.mealCount, trainingExperience: spec.experience,
        sleepHours: spec.sleepHours, stressLevel: spec.stressLevel, discipline: spec.discipline,
        specialConditions: spec.special ?? null, weightUpdatedAt: now,
      },
    });
    if (spec.plan === "advanced" || spec.plan === "ultimate") {
      const takenAt = new Date(now.getTime() + 2000);
      await db.progressPhoto.create({ data: { userId: user.id, imageUrl: `/uploads/test/ai-e2e-${spec.idx}-front.jpg`, type: "front", takenAt, note: "عکس تست سندباکس — AI E2E v256" } });
      await db.progressPhoto.create({ data: { userId: user.id, imageUrl: `/uploads/test/ai-e2e-${spec.idx}-side.jpg`, type: "side", takenAt, note: "عکس تست سندباکس — AI E2E v256" } });
    }
    console.log(`✅ ${spec.name} (${mobile}) — ${spec.plan}/${spec.goal}/${spec.place}/${fa(spec.days)}روز`);
  }
}

// ═══════════ ورود (سشن مستقیم با ماشین خود اپ — بدون مصرف پیامک) ═══════════
// createSessionToken همان تابع production است (payload+scrypt با SESSION_SECRET .env)
// — معادل کامل ورود OTP ولی بدون هیچ تماس SMS.ir.
import { createSessionToken } from "@/lib/fitness/auth";

async function login(mobile: string): Promise<string> {
  const user = await db.user.findUnique({ where: { mobile } });
  if (!user) throw new Error(`کاربر ${mobile} یافت نشد`);
  const token = await createSessionToken(user.id);
  return token;
}

async function drive(onlyIdxs?: number[]) {
  const specs = onlyIdxs?.length ? SPECS.filter((s) => onlyIdxs.includes(s.idx)) : SPECS;
  for (const spec of specs) {
    const mobile = mobileOf(spec.idx);
    try {
      const cookie = await login(mobile);
      const genRes = await fetch(`${BASE}/api/coach/plan`, {
        method: "PUT", headers: { "Content-Type": "application/json", Cookie: `sc_session=${cookie}` },
        body: JSON.stringify({}), signal: AbortSignal.timeout(60000),
      });
      const genJson = await genRes.json() as Record<string, unknown>;
      console.log(`[${spec.name}] PUT /api/coach/plan → HTTP ${genRes.status} ${JSON.stringify(genJson).slice(0, 220)}`);
    } catch (e) {
      console.log(`[${spec.name}] خطا: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
    await sleep(2500);
  }
}

// ═══════════ --renew (تمدید واقعی) ═══════════
async function renew(onlyIdxs?: number[], newGoal?: Record<number, string>) {
  const specs = onlyIdxs?.length ? SPECS.filter((s) => onlyIdxs.includes(s.idx)) : SPECS;
  for (const spec of specs) {
    const mobile = mobileOf(spec.idx);
    const user = await db.user.findUnique({ where: { mobile } });
    if (!user) { console.log(`[${spec.name}] کاربر یافت نشد`); continue; }
    const now = new Date();
    // چرخهٔ فعلی تمام شده → تمدید خریداری شده (اشتراک جدید — عین جریان production)
    await db.subscription.updateMany({ where: { userId: user.id, status: "active" }, data: { status: "expired", endDate: new Date(now.getTime() - 86400000) } });
    await db.subscription.create({ data: { userId: user.id, plan: spec.plan, status: "active", startDate: now, endDate: new Date(now.getTime() + 45 * 86400000), durationDays: 45, pricePaid: 0 } });
    try {
      const cookie = await login(mobile);
      // متریک‌های تازه + هدف (ممکن است عوض شده باشد — عین مدال به‌روزرسانی تمدید)
      const payload: Record<string, string | number> = {
        weight: spec.idx === 3 ? 91 : 89,
        goal: newGoal?.[spec.idx] ?? spec.goal,
      };
      const res = await fetch(`${BASE}/api/renew/update-metrics`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: `sc_session=${cookie}` },
        body: JSON.stringify({ fields: payload }), signal: AbortSignal.timeout(60000),
      });
      const json = await res.json() as Record<string, unknown>;
      console.log(`[${spec.name}] POST /api/renew/update-metrics → HTTP ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
    } catch (e) {
      console.log(`[${spec.name}] خطا: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
    await sleep(2500);
  }
}

// ═══════════ --status ═══════════
async function status() {
  for (const spec of SPECS) {
    const user = await db.user.findUnique({ where: { mobile: mobileOf(spec.idx) } });
    if (!user) { console.log(`[${spec.name}] —`); continue; }
    const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    const plan = await db.workoutPlan.findFirst({ where: { userId: user.id, active: true }, select: { version: true, generatedSource: true, createdAt: true } });
    console.log(`[${spec.name}] req=${req?.status ?? "-"} attempts=${fa(req?.attempts ?? 0)} plan=${plan ? `v${fa(plan.version)}/${plan.generatedSource ?? "AI"}` : "-"}`);
  }
}

// ═══════════ ممیزی کامل (همان باتری B) ═══════════
interface Issue { code: string; severity: "critical" | "warn" | "info"; detail: string }
const INJURY_BANS: { key: string; label: string; patterns: RegExp[]; allow?: RegExp }[] = [
  { key: "knee", label: "زانو", patterns: [/پرش|جامپ|jump/i, /اسکوات\s*عمیق|دیپ\s*اسکوات|deep\s*squat|پیستول|پستول|pistol/i] },
  { key: "lower_back", label: "کمر / دیسک", patterns: [/گود\s*مورنینگ|good\s*morning/i, /اسنچ|کلین|snatch|clean\s*&?\s*(jerk|press)|های\s*پول|high\s*pull/i, /پرش|جامپ|jump|پلایومتریک|plyo|برپی|burpee/i], allow: /رومانی|ترپ|تراپ|trap|ددلیفت\s*ترپ|تراپ\s*بار/i },
  { key: "shoulder", label: "شانه / روتاتور کاف", patterns: [/پشت\s*گردن|behind[.\s-]?neck/i] },
  { key: "wrist", label: "مچ دست", patterns: [/هندستند|handstand|کرل\s*مچ|wrist\s*(curl|ext)/i] },
  { key: "high_impact_risk", label: "وزن بالا (BMI≥۳۰)", patterns: [/پرش|جامپ|jump|پلایومتریک|plyo|برپی|burpee/i] },
];
const HOME_MACHINE_RE = /ماشین|دستگاه\s*بدنسازی|جلو\s*پا|پشت\s*پا\s*خوابیده|لگ\s*پرس|هاک|پک\s*دک|لت\s*کش|قفسه\s*سینه|شراک|سمیت|پول\s*اُور|پول‌اور/i;
const HOME_CABLE_RE = /سیم\s*کش|سیم‌کش|کراس\s*اُور|کراس‌اور/i;
function exerciseEqNeed(name: string): string[] {
  const need: string[] = [];
  if (/هالتر/.test(name) && !/بارفیکس/.test(name)) need.push("barbell");
  if (/دمبل/.test(name)) need.push("dumbbell");
  if (/کتل.?بل/.test(name)) need.push("kettlebell");
  if (/کش\s*مقاومتی|کش\s*تمرینی/.test(name)) need.push("bands");
  if (/بارفیکس|میوزآپ|muscle.?up|chin.?up|pull.?up/i.test(name)) need.push("pullup_bar");
  if (/پارالل|دیپس(?!.*نیمکت)|دیپ(?!.*(نیمکت|روی))/i.test(name)) need.push("pullup_bar");
  if (/حلقه|\bring/i.test(name)) need.push("rings");
  if (/نیمکت/.test(name)) need.push("bench");
  if (/TRX|ناپایدار|بی\s*ثبات/.test(name)) need.push("trx");
  if (HOME_MACHINE_RE.test(name)) need.push("machine");
  if (HOME_CABLE_RE.test(name)) need.push("cable");
  if (/اسمیت/.test(name)) need.push("machine");
  return need;
}
function restCheck(name: string, muscle: string | null, category: string | null, sets: unknown): string | null {
  // restSec داخل هر ست است: sets[{setNumber, reps, restSec, rpe, done}]
  const arr = Array.isArray(sets) ? sets : [];
  const rests = arr.map((s: any) => (typeof s?.restSec === "number" ? s.restSec : typeof s?.restSec === "string" ? parseInt(s.restSec) || 0 : 0));
  if (arr.length === 0) return "بدون ست/ساختار ست نامعتبر";
  const zeroRest = rests.filter((r) => !(r > 0)).length;
  const r = rests.length ? Math.max(...rests) : 0; // سخت‌گیرانه: بیشترین استراحت ست‌ها مبنای چک نوع حرکت
  // کاردیو: فقط بر اساس category رسمی (نه نام — «کرانچ دوچرخه» کاردیو نیست!)
  if (String(category ?? "") === "cardio") {
    return r >= 0 && r <= 120 ? null : `کاردیو با استراحت نامعتبر (${r})`; // صفر = پیوسته — مجاز
  }
  const t = `${name} ${muscle ?? ""}`;
  const isCore = /شکم|کرانچ|پلانک|زیرشکم|ابدومینال|core/i.test(t);
  // ساق/کلف تک‌مفصلی است — «ساق پرس پا» (کلف روی لگ‌پرس) مرکب حساب نمی‌شود
  const isCalf = /ساق|کلف|calf/i.test(t);
  const isCompound = !isCalf && /اسکوات|ددلیفت|پرس\s*(سینه|پا|سرشانه|بالاسینه)|بارفیکس|هاک|لگ\s*پرس|پرس\s*شانه|رومانی|لانژ|هیپ\s*ثرست|hip\s*thrust|زیربغل\s*(هالتر|دمبل)/i.test(t);
  if (zeroRest === arr.length) return `استراحت صفر/نامشخص در همهٔ ${fa(arr.length)} ست`;
  if (isCompound && r < 75) return `حرکت مرکب با استراحت ناکافی (${r}s < 75s)`;
  if (!isCore && !isCompound && r < 30) return `حرکت تک‌مفصلی با استراحت ناکافی (${r}s < 30s)`;
  if (r > 300) return `استراحت غیرمعمول طولانی (${r}s)`;
  return null;
}

interface AuditResult { name: string; idx: number; plan: string; goal: string; place: string; days: number; injuries: string[]; bmi: number; status: string; version: number; source: string | null; genSec: number; issues: Issue[] }

async function auditOne(spec: ProfileSpec, phase: "A" | "D"): Promise<{ u: AuditResult; activePlanContent: string | null; prevContent: string | null }> {
  const issues: Issue[] = [];
  const user = await db.user.findUnique({ where: { mobile: mobileOf(spec.idx) } });
  const u: AuditResult = {
    name: spec.name, idx: spec.idx, plan: spec.plan, goal: spec.goal, place: spec.place,
    days: spec.days, injuries: spec.injuryAreas, bmi: +(spec.weight / Math.pow(spec.height / 100, 2)).toFixed(1),
    status: "no_user", version: 0, source: null, genSec: 0, issues,
  };
  if (!user) return { u, activePlanContent: null, prevContent: null };
  // v256 — وزن/قد از پروفایل «فعلی» خوانده می‌شود (تمدید وزن نو دارد — BMI واقعیِ مبنای تولید)
  const prof = await db.onboardingProfile.findUnique({ where: { userId: user.id }, select: { weight: true, height: true } });
  const curWeight = prof?.weight ?? spec.weight;
  const curHeight = prof?.height ?? spec.height;
  u.bmi = +(curWeight / Math.pow(curHeight / 100, 2)).toFixed(1);
  const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  u.status = req?.status ?? "-";
  const plan = await db.workoutPlan.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "desc" } });
  const meal = await db.mealPlan.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "desc" } });
  const prevPlan = await db.workoutPlan.findFirst({ where: { userId: user.id, active: false }, orderBy: { createdAt: "desc" } });
  if (!plan) { issues.push({ code: "no_plan", severity: "critical", detail: "هیچ برنامهٔ فعالی ذخیره نشد" }); return { u, activePlanContent: null, prevContent: prevPlan?.content ?? null }; }
  if (!meal) issues.push({ code: "no_meal", severity: "critical", detail: "هیچ برنامهٔ غذایی فعالی ذخیره نشد" });
  u.version = plan.version; u.source = plan.generatedSource;
  if (prevPlan) u.genSec = Math.round((plan.createdAt.getTime() - prevPlan.updatedAt.getTime()) / 1000);

  if (plan.generatedSource === "local_fallback") issues.push({ code: "local_fallback", severity: "critical", detail: "برنامه با موتور محلی ساخته شد (AI شکست خورد)" });
  if ((plan.changeSummary ?? "").includes("موتور محلی")) issues.push({ code: "local_fallback_summary", severity: "critical", detail: "خلاصهٔ تغییرات موتور محلی را اعلام می‌کند" });

  let content: any = null;
  try { content = JSON.parse(plan.content); } catch { issues.push({ code: "unparsable", severity: "critical", detail: "content JSON پارس نشد" }); return { u, activePlanContent: null, prevContent: prevPlan?.content ?? null }; }
  const days: any[] = Array.isArray(content?.days) ? content.days : [];

  if (days.length !== spec.days) issues.push({ code: "days_mismatch", severity: "critical", detail: `پروفایل ${fa(spec.days)} روز خواست، برنامه ${fa(days.length)} روز دارد` });

  // پوشش ۶ گروه با کلاسیفایر رسمی خود اپ (فیکس B1)
  const cov = coveredMajorGroupsDetailed(days);
  const missing = MAJOR_GROUP_KEYS.filter((g) => !cov.covered.has(g));
  if (missing.length > 0 && !cov.isGenuineFullbodySplit) {
    issues.push({ code: "coverage_missing", severity: "critical", detail: `گروه‌های پوشش‌نایافته: ${missing.join(", ")}` });
  }

  // تجهیزات (فیکس B2) — فقط برای place=home سخت‌گیرانه؛ place=both آزاد
  if (spec.place === "home") {
    for (const d of days) {
      for (const ex of d.exercises ?? []) {
        const need = exerciseEqNeed(String(ex.name ?? ""));
        const bad = need.filter((eq) => !spec.equipment.includes(eq) && !(eq === "bench" && spec.equipment.includes("bench")));
        if (bad.length > 0) issues.push({ code: "equipment_mismatch", severity: "critical", detail: `«${ex.name}» (${d.day}) نیازمند ${bad.join("+")} — کاربر خانگی ندارد` });
      }
    }
  }

  // کاردیو (فیکس B3/B11) — count با اولویت category رسمی، فال‌بک نام قوی
  if (spec.goal === "fat_loss" || spec.goal === "endurance") {
    const strongCardioName = /کاردیو|هوازی|تردمیل|دوچرخه\s*ثابت|الپتیکال|رووینگ|رویینگ|پرش\s*با\s*طناب|طناب\s*زدن|جامپینگ\s*طناب|jump\s*rope|برپی|جامپینگ\s*جک|جامپ\s*جک|دوی|پیاده\s*روی|اسکی\s*سطح|پارویی|کوهنوردی\s*درجا|mountain\s*climb/i;
    let cardioCount = 0;
    for (const d of days) {
      cardioCount += Array.isArray(d.cardio) ? d.cardio.length : 0;
      for (const ex of d.exercises ?? []) {
        if (String(ex.category ?? "") === "cardio" || strongCardioName.test(String(ex.name ?? ""))) cardioCount++;
      }
    }
    if (cardioCount < 2) issues.push({ code: "goal_no_cardio", severity: "critical", detail: `هدف ${spec.goal} ولی فقط ${fa(cardioCount)} کاردیو در کل هفته` });
  }

  // استراحت علمی (فیکس B6) — restSec داخل sets هر ست؛ عضو غیرآخری سوپرست = صفر علمی
  for (const d of days) {
    const exs: any[] = d.exercises ?? [];
    // آخرین ایندکس هر supersetGroup در روز — عضو آخر زنجیره استراحت واقعی دارد
    const lastOfGroup = new Map<string, number>();
    exs.forEach((ex, i) => { if (ex?.supersetGroup) lastOfGroup.set(String(ex.supersetGroup), i); });
    exs.forEach((ex, i) => {
      const isChained = !!ex?.supersetGroup && lastOfGroup.get(String(ex.supersetGroup)) !== i;
      if (isChained) return; // استراحت صفر عضو زنجیرهٔ سوپرست = استاندارد صحیح
      const restFail = restCheck(String(ex.name ?? ""), ex.muscle ?? null, ex.category ?? null, ex.sets);
      if (restFail) issues.push({ code: "rest_bad", severity: "warn", detail: `«${ex.name}» (${d.day}): ${restFail}` });
    });
  }

  // ممنوعیت آسیب
  const injKeys = new Set<string>(spec.injuryAreas);
  if (u.bmi >= 30) injKeys.add("high_impact_risk");
  for (const d of days) {
    for (const ex of d.exercises ?? []) {
      const name = String(ex.name ?? "");
      for (const rule of INJURY_BANS) {
        if (!injKeys.has(rule.key)) continue;
        if (rule.allow && rule.allow.test(name)) continue;
        if (rule.patterns.some((p) => p.test(name))) issues.push({ code: "injury_violation", severity: "critical", detail: `«${name}» (${d.day}) با آسیب ${rule.label} سازگار نیست` });
      }
    }
  }

  // مکمل (فیکس B4)
  const planAllowsSupp = spec.plan !== "basic";
  const supps = Array.isArray(content?.supplements) ? content.supplements : [];
  if (planAllowsSupp && supps.length === 0) issues.push({ code: "no_supplements", severity: "warn", detail: `پلن ${spec.plan} بدون پشتهٔ مکمل` });
  if (!planAllowsSupp && supps.length > 0) issues.push({ code: "supplement_for_basic", severity: "critical", detail: `پلن اقتصادی مکمل دریافت کرده (${fa(supps.length)} مورد)` });

  // ساختار و پارسی
  let totalEx = 0, emptyNames = 0;
  for (const d of days) {
    if (!d.day || !d.title) issues.push({ code: "day_struct", severity: "warn", detail: `روز بدون عنوان: ${JSON.stringify(d).slice(0, 60)}` });
    for (const ex of d.exercises ?? []) {
      totalEx++;
      if (!ex.name || String(ex.name).trim().length < 2) emptyNames++;
    }
  }
  if (emptyNames > 0) issues.push({ code: "empty_names", severity: "critical", detail: `${fa(emptyNames)} حرکت بدون نام` });
  if (totalEx === 0) issues.push({ code: "no_exercises", severity: "critical", detail: "هیچ حرکتی در برنامه نیست" });

  // غذا
  if (meal) {
    let mc: any = null;
    try { mc = JSON.parse(meal.content); } catch { issues.push({ code: "meal_unparsable", severity: "critical", detail: "محتوای غذایی پارس نشد" }); }
    if (mc) {
      const meals = Array.isArray(mc?.meals) ? mc.meals : Array.isArray(mc) ? mc : [];
      if (meals.length < 3) issues.push({ code: "meal_few", severity: "warn", detail: `فقط ${fa(meals.length)} وعده (پروفایل ${fa(spec.mealCount)} وعده خواست)` });
      if (!(meal.totalCal > 800)) issues.push({ code: "meal_cal", severity: "warn", detail: `کالری کل نامعتبر: ${fa(meal.totalCal)}` });
    }
  }
  return { u, activePlanContent: plan.content, prevContent: prevPlan?.content ?? null };
}

async function audit(phase: "A" | "D", onlyIdxs?: number[]) {
  const specs = onlyIdxs?.length ? SPECS.filter((s) => onlyIdxs.includes(s.idx)) : SPECS;
  const results: AuditResult[] = [];
  for (const spec of specs) {
    const { u, activePlanContent, prevContent } = await auditOne(spec, phase);
    // چک‌های ویژهٔ تمدید
    if (phase === "D" && u.status === "ready") {
      const user = await db.user.findUnique({ where: { mobile: mobileOf(spec.idx) } });
      if (user) {
        const activePlan = await db.workoutPlan.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "desc" } });
        if (activePlan && activePlan.version <= 1) u.issues.push({ code: "renewal_no_version_bump", severity: "critical", detail: `تمدید نسخه را جلو نبرد (نسخهٔ ${fa(activePlan.version)})` });
        if (activePlan?.baseWeight != null) {
          const expected = spec.idx === 3 ? 91 : 89;
          if (Math.abs(activePlan.baseWeight - expected) > 0.01) u.issues.push({ code: "renewal_weight_stale", severity: "critical", detail: `وزن مبنای برنامهٔ جدید (${fa(activePlan.baseWeight)}) ≠ وزن جدید (${fa(expected)})` });
        }
        if (activePlan && prevContent && activePlan.content === prevContent) u.issues.push({ code: "renewal_identical", severity: "critical", detail: "برنامهٔ تمدید عیناً کپی قبلی است" });
        // هدف در برنامهٔ جدید (اگر در تمدید عوض شده باشد باید در content دیده شود)
        if (activePlan) {
          let c: any = null; try { c = JSON.parse(activePlan.content); } catch {}
          if (c?.goal && c.goal !== spec.goal && !["cut", "bulk"].includes(c.goal)) {
            u.issues.push({ code: "renewal_goal_stale", severity: "warn", detail: `هدف برنامه (${c.goal}) با هدف موردانتظار (${spec.goal}) متفاوت است` });
          }
        }
      }
    }
    results.push(u);
  }
  console.log(`\n══════ ممیزی فاز ${phase === "A" ? "A — کاربران جدید" : "D — تمدید"} ══════`);
  let critical = 0, warn = 0;
  for (const u of results) {
    const crit = u.issues.filter((i) => i.severity === "critical");
    const wn = u.issues.filter((i) => i.severity === "warn");
    critical += crit.length; warn += wn.length;
    const icon = crit.length === 0 ? (wn.length === 0 ? "✅" : "🟡") : "❌";
    console.log(`${icon} ${u.name} (${u.plan}/${u.goal}/${u.place}/${fa(u.days)}روز BMI=${fa(u.bmi)}) — وضعیت: ${u.status} — نسخهٔ ${fa(u.version)} — موتور: ${u.source ?? "AI"}`);
    for (const i of crit) console.log(`   🔴 [${i.code}] ${i.detail}`);
    for (const i of wn) console.log(`   🟡 [${i.code}] ${i.detail}`);
  }
  console.log(`— جمع: ${fa(results.length)} کاربر · ${fa(critical)} بحرانی · ${fa(warn)} هشدار`);
  return { results, critical, warn };
}

// ═══════════ --report ═══════════
async function report() {
  const a = await audit("A");
  // چک‌های تمدید فقط برای «کوهورت تمدید» (کاربران ۳ و ۷) — بقیه تمدید نشده‌اند
  const d = await audit("D", [3, 7]);
  const result = {
    generatedAt: new Date().toISOString(),
    phaseA: { users: a.results.length, critical: a.critical, warn: a.warn, users_detail: a.results },
    phaseD: { users: d.results.length, critical: d.critical, warn: d.warn, users_detail: d.results },
    totalCritical: a.critical + d.critical,
    verdict: a.critical + d.critical === 0 ? "PASS — صفر باگ بحرانی" : "FAIL",
  };
  fs.writeFileSync("ai-e2e-v256-result.json", JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n══════ جمع‌بندی ══════`);
  console.log(`نتیجه: ${result.verdict} — گزارش: ai-e2e-v256-result.json`);
}

// ═══════════ CLI ═══════════
const cmd = process.argv[2];
const idxArg = process.argv[3] && /^\d/.test(process.argv[3]) ? process.argv[3].split(",").map(Number).filter(Boolean) : process.argv[4] && /^\d/.test(process.argv[4]) ? process.argv[4].split(",").map(Number).filter(Boolean) : undefined;
let goalArg: Record<number, string> | undefined;
if (process.argv[4] && process.argv[4].startsWith("{")) { try { goalArg = JSON.parse(process.argv[4]); } catch { goalArg = undefined; } }

const cmds: Record<string, () => Promise<void>> = {
  "--setup": () => setup(idxArg),
  "--drive": () => drive(idxArg),
  "--renew": () => renew(idxArg, goalArg),
  "--audit": async () => { await audit((process.argv[3] as "A" | "D") ?? "A", idxArg); },
  "--status": () => status(),
  "--report": () => report(),
};

if (cmd && cmds[cmd]) {
  cmds[cmd]().catch((e) => { console.error("FATAL:", e); process.exitCode = 1; }).finally(() => db.$disconnect());
} else {
  console.log("استفاده: bun ai-e2e-v256.ts --setup|--drive|--renew|--audit A|--status|--report [idx,idx]");
}
