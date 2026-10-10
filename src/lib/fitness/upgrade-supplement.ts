/**
 * v216-A — مولد «برنامه مکمل» برای ارتقای پلن (دیرکتیو مالک)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک (عیناً): «کاربری که داره پلن رو ارتقا میده به هیچ وجه نباید
 * برنامه‌اش باز تولید بشه. فقط باید قابلیت‌هایی که در پلنش نیست و در پلنی که
 * ارتقا میده بهش هست آزاد بشه ... و همچنین برای پلن اقتصادی به پیشرفته یا
 * پلن‌های بالاتر باید برنامه مکمل هم ساخته بشه و اضافه بشه به پنل.»
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * جای این ماژول در معماری:
 *  • deliverPlanPayment (payment-delivery.ts) روی «ارتقا» دیگر ProgramRequest
 *    نمی‌سازد (برنامه هرگز بازتولید نمی‌شود) و اگر کاربر از پلن بدون مکمل
 *    (اقتصادی) به پلن مکمل‌دار (استاندارد به بالا) ارتقا داده باشد، این تابع
 *    را fire-and-forget صدا می‌زند.
 *  • GET /api/coach/plan یک تور ایمن (safety net) با cooldown ۱۰ دقیقه‌ای است —
 *    ارتقاهای تاریخی/از‌دست‌رفته را هم backfill می‌کند.
 *
 * قواعد سخت این ماژول:
 *  ۱) هرگز throw نمی‌کند — هر خطا {ok:false, reason} برمی‌گرداند و فقط log
 *     می‌شود؛ تحویل پلن/پاسخ API هرگز منتظر یا خرابِ این تابع نیست.
 *  ۲) idempotent — اگر برنامهٔ غذایی فعال همین حالا مکمل دارد، کاری نمی‌کند.
 *  ۳) به برنامهٔ غذایی فعال «اضافه» می‌کند، نه جایگزین: فقط سه فیلد
 *     supplements / supplementTimingNotes (داخل content JSON) و changeSummary
 *     (ستون ردیف) نوشته می‌شوند؛ version عوض نمی‌شود، نسخهٔ جدید/supersede
 *     ساخته نمی‌شود، WorkoutPlan دست نمی‌خورد.
 *  ۴) پرامپت پزشکی محافظه‌کارانه: فقط مکمل‌های رایج/ایمن/مبتنی بر شواهد، دوز
 *     در محدودهٔ برچسب استاندارد، بدون ادعای درمانی، احترام به حساسیت/بیماری/
 *     داروی کاربر، و جملهٔ «قبل از مصرف با پزشک مشورت کن» داخل
 *     supplementTimingNotes.
 *  ۵) فراخوانی AvalAI مستقل (کپی الگوی env/مدل‌های ai.ts بدون import از آن):
 *     AVALAI_TEXT_MODEL (deepseek-v4.1-flash) → فال‌بک gemini-3.8-flash،
 *     حداکثر ۲ دور، تایم‌اوت ~۴۵ ثانیه برای هر تلاش (AbortController).
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/fitness/notifications";
import { planHasSupplements } from "@/lib/fitness/supplement-gate";
import { toPersianDigits } from "@/lib/fitness/types";

/** تایم‌اوت هر تلاش فراخوانی مدل (~۴۵ ثانیه — پرامپت/خروجی کوچک است) */
const REQUEST_TIMEOUT_MS = 45_000;

/** سقف طول ایمن فیلدهای متنی خروجی مدل */
const LIMITS = {
  name: 80,
  dose: 60,
  timing: 60,
  note: 200,
  timingNotes: 300,
  changeSummary: 120,
  minSupplements: 3,
  maxSupplements: 8,
};

/** یک قلم مکمل — هم‌شکل supplements در MealPlanContent (types.ts) */
interface UpgradeSupplementItem {
  name: string;
  dose: string;
  timing: string;
  note?: string;
}

/* ──────────────────────────── استخراج JSON ──────────────────────────── */

/**
 * استخراج کمینه و مقاوم JSON از متن پاسخ مدل: اولین { تا آخرین }.
 * (پیاده‌سازی مستقل — بدون وابستگی به ترمیم‌گر ai.ts)
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* ─────────────────────── فراخوانی مستقیم AvalAI ─────────────────────── */

/**
 * کپی الگوی env/مدل ai.ts (بدون import از آن — برای استقلال و سبکی این ماژول):
 *   base url: AVALAI_BASE_URL || https://api.avalai.ir/v1
 *   دور ۱: AVALAI_TEXT_MODEL || deepseek-v4.1-flash (reasoning_effort=low + json_object — پرب v161)
 *   دور ۲: AVALAI_FALLBACK_TEXT_MODEL || gemini-3.8-flash
 *   حداکثر ۲ دور؛ هر تلاش با AbortController ~۴۵ ثانیه.
 * خطا را throw می‌کند (کالرِ این تابع never-fail است).
 */
async function callAvalaiJson(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.AVALAI_API_KEY || "";
  const baseUrl = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
  const models = [
    process.env.AVALAI_TEXT_MODEL || "deepseek-v4.1-flash",
    process.env.AVALAI_FALLBACK_TEXT_MODEL || "gemini-3.8-flash",
  ];

  let lastErr: Error | null = null;
  for (const model of models) {
    const isDeepseek = model.toLowerCase().includes("deepseek");
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      // بودجهٔ خروجی ≥۴۰۹۶ — درس ai.ts: مدل تفکری با بودجهٔ کوچک متن خالی می‌دهد
      max_tokens: 4096,
    };
    if (isDeepseek) {
      // پیش‌فرض ai.ts برای deepseek: تفکر low + خروجی JSON (پرب زندهٔ v161 تأیید شد)
      body.reasoning_effort = "low";
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = (await res.text().catch(() => "")).slice(0, 160);
        throw new Error(`AvalAI HTTP ${res.status}: ${errText}`);
      }
      const json: any = await res.json();
      const text = String(json?.choices?.[0]?.message?.content ?? "");
      if (!text.trim()) {
        throw new Error("پاسخ خالی از مدل (content خالی)");
      }
      return text;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.error(`[upgrade-supplement] AvalAI call failed (model=${model}):`, lastErr.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("AvalAI در دسترس نیست");
}

/* ─────────────────────── ساخت پرامپت فشرده (<4KB) ─────────────────────── */

const SYSTEM_PROMPT = `تو مشاور مکمل‌های ورزشی «فیتاپ» هستی. برای کاربری که پلنش را ارتقا داده و هم‌اکنون برنامهٔ تمرین و تغذیهٔ فعال دارد، «برنامهٔ مکمل» می‌نویسی.

قوانین سخت (غیرقابل‌مذاکره):
- فقط مکمل‌های رایج، ایمن و مبتنی بر شواهد: پروتئین وی، کازئین، کراتین مونوهیدرات، کافئین، امگا۳، ویتامین D، منیزیم، زینک، ویتامین B-complex و مشابه آن‌ها.
- دوز فقط در محدودهٔ برچسب استاندارد محصولات باشد؛ دوز بالای درمانی/تجویز پزشکی ممنوع.
- هیچ ادعای درمانی، تشخیصی یا وعدهٔ نتیجه (چربی‌سوزی تضمینی و…) ننویس.
- اگر در پروفایل حساسیت/بیماری/دارو آمده، از هر مکملی که تداخل احتمالی دارد پرهیز کن و در note دلیل احتیاط یا جایگزین غذایی را بنویس.
- به برنامهٔ غذایی فعلی کاری نداری — مکمل‌ها فقط «اضافه» می‌شوند و با وعده‌ها/تمرین هماهنگ باشند.
- خروجی فقط و فقط JSON باشد؛ هیچ متن اضافه، markdown یا توضیح بیرون JSON ننویس.`;

function buildProfileSummaryFa(profile: Record<string, unknown> | null): string {
  if (!profile) return "پروفایل آنبوردینگ در دسترس نیست — بر اساس اطلاعات عمومی و محافظه‌کارانه بده.";
  const s = (v: unknown, max = 100) => String(v ?? "").trim().slice(0, max);
  // اعداد از DB ممکن است number یا رشته باشند — همیشه عدد امن → ارقام فارسی
  const n = (v: unknown, fallback: string) => {
    const num = Number(v);
    return Number.isFinite(num) && num > 0 ? toPersianDigits(Math.round(num)) : fallback;
  };
  const goalFa: Record<string, string> = {
    fat_loss: "کاهش چربی",
    muscle_gain: "عضله‌سازی",
    endurance: "استقامت",
    fitness: "تناسب اندام عمومی",
    strength: "افزایش قدرت",
  };
  const lines: string[] = [
    `جنسیت: ${profile.gender === "female" ? "زن" : profile.gender === "male" ? "مرد" : s(profile.gender) || "نامشخص"}`,
    `سن: ${n(profile.age, "؟")} | قد: ${n(profile.height, "؟")} سانتی‌متر | وزن: ${n(profile.weight, "؟")} کیلوگرم`,
  ];
  if (profile.targetWeight != null) lines.push(`وزن هدف: ${n(profile.targetWeight, "؟")} کیلوگرم`);
  if (profile.goal) lines.push(`هدف: ${goalFa[s(profile.goal, 30)] ?? s(profile.goal, 30)}`);
  if (profile.activityLevel) lines.push(`سطح فعالیت: ${s(profile.activityLevel, 30)}`);
  if (profile.workoutDays != null) lines.push(`روزهای تمرین در هفته: ${n(profile.workoutDays, "؟")}`);
  if (profile.workoutPlace) lines.push(`محل تمرین: ${profile.workoutPlace === "gym" ? "باشگاه" : profile.workoutPlace === "home" ? "خانه" : s(profile.workoutPlace, 20)}`);
  if (profile.trainingExperience) lines.push(`سابقهٔ ورزشی: ${s(profile.trainingExperience, 30)}`);
  if (profile.dietType && profile.dietType !== "standard") lines.push(`نوع رژیم: ${s(profile.dietType, 30)}`);
  if (s(profile.allergies)) lines.push(`حساسیت‌های غذایی (حتماً رعایت شود): ${s(profile.allergies)}`);
  if (s(profile.diseases)) lines.push(`سوابق بیماری: ${s(profile.diseases)}`);
  if (s(profile.injuries)) lines.push(`آسیب‌دیدگی‌ها: ${s(profile.injuries)}`);
  if (s(profile.medicalConditions)) lines.push(`شرایط پزشکی: ${s(profile.medicalConditions)}`);
  if (s(profile.currentMedications)) lines.push(`داروهای مصرفی (تداخل را جدی بگیر): ${s(profile.currentMedications)}`);
  if (s(profile.drugAllergies)) lines.push(`آلرژی دارویی: ${s(profile.drugAllergies)}`);
  if (s(profile.currentSupplements)) lines.push(`مکمل‌های فعلی: ${s(profile.currentSupplements)}`);
  if (s(profile.specialConditions)) lines.push(`شرایط خاص کاربر: ${s(profile.specialConditions)}`);
  return lines.join("\n");
}

function buildMealSummaryFa(content: Record<string, unknown>): string {
  const meals = Array.isArray(content.meals) ? content.meals : [];
  const labels = meals
    .map((m: any) => String(m?.label ?? m?.type ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  const cal = Math.round(Number(content.totalCalories) || 0);
  const protein = Math.round(Number(content.totalProtein) || 0);
  return [
    `کالری روزانه: ${toPersianDigits(cal)} | پروتئین: ${toPersianDigits(protein)} گرم`,
    `وعده‌ها: ${labels.join("، ") || "نامشخص"}`,
  ].join("\n");
}

/* ───────────────────────── پاک‌سازی خروجی مدل ───────────────────────── */

function sanitizeSupplements(raw: unknown): UpgradeSupplementItem[] {
  if (!Array.isArray(raw)) return [];
  const out: UpgradeSupplementItem[] = [];
  for (const item of raw.slice(0, LIMITS.maxSupplements)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = String(rec.name ?? "").trim().slice(0, LIMITS.name);
    if (!name) continue;
    const note = String(rec.note ?? "").trim().slice(0, LIMITS.note);
    out.push({
      name,
      dose: String(rec.dose ?? "").trim().slice(0, LIMITS.dose),
      timing: String(rec.timing ?? "").trim().slice(0, LIMITS.timing),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/* ─────────────────────────── تابع اصلی (never-fail) ─────────────────────────── */

/**
 * تولید و ادغام «برنامه مکمل» در برنامهٔ غذایی فعال کاربر.
 *
 * هرگز throw نمی‌کند؛ هر خطا {ok:false, reason} است.
 * خروجی ok حتی وقتی «کار از قبل انجام شده» (idempotent) هم true است تا کالر
 * آن را موفقیت تلقی کند.
 */
export async function generateUpgradeSupplement(userId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    // ── گارد ۱: پلن کاربر باید مکمل‌دار باشد (استاندارد به بالا) ──
    const user = await db.user.findUnique({ where: { id: userId }, select: { planName: true } });
    if (!user) return { ok: false, reason: "user_not_found" };
    if (!planHasSupplements(user.planName)) {
      return { ok: false, reason: "plan_not_eligible" };
    }

    // ── گارد ۲: برنامهٔ غذایی فعال لازم است (ارتقا بدون برنامه = خرید تازه است، نه این مسیر) ──
    const meal = await db.mealPlan.findFirst({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!meal) return { ok: false, reason: "no_active_meal_plan" };

    let content: Record<string, unknown>;
    try {
      const parsed = JSON.parse(meal.content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, reason: "meal_content_invalid" };
      }
      content = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "meal_content_invalid" };
    }

    // ── گارد ۳: idempotent — اگر همین حالا مکمل دارد، کاری نکن ──
    const hasSupp = Array.isArray(content.supplements) && content.supplements.length > 0;
    const hasStack = Array.isArray(content.supplementStack) && content.supplementStack.length > 0;
    if (hasSupp || hasStack) {
      return { ok: true, reason: "already_present" };
    }

    // ── پرامپت فشرده: پروفایل + خلاصهٔ برنامهٔ غذایی (کل درخواست <4KB) ──
    const profile = await db.onboardingProfile.findUnique({
      where: { userId },
      select: {
        gender: true,
        age: true,
        height: true,
        weight: true,
        targetWeight: true,
        goal: true,
        activityLevel: true,
        workoutDays: true,
        workoutPlace: true,
        trainingExperience: true,
        dietType: true,
        allergies: true,
        diseases: true,
        injuries: true,
        medicalConditions: true,
        currentMedications: true,
        drugAllergies: true,
        currentSupplements: true,
        specialConditions: true,
      },
    });
    const userPrompt = [
      "پروفایل کاربر (خلاصه):",
      buildProfileSummaryFa(profile as unknown as Record<string, unknown> | null),
      "",
      "برنامهٔ غذایی فعال فعلی (تغییر نمی‌کند — فقط برای هماهنگی تایمینگ):",
      buildMealSummaryFa(content),
      "",
      "الان فقط «برنامهٔ مکمل» بساز و دقیقاً در این قالب JSON پاسخ بده:",
      '{"supplements": [{"name": "نام مکمل", "dose": "دوز به فارسی", "timing": "زمان مصرف به فارسی", "note": "نکتهٔ کوتاه اختصاصی همین کاربر"}], "supplementTimingNotes": "جمله‌بندی تایمینگ کلی حداکثر ۳۰۰ کاراکتر که حتماً جملهٔ «قبل از مصرف با پزشک مشورت کن» در آن باشد", "changeSummary": "یک جملهٔ کوتاه حداکثر ۱۲۰ کاراکتر دربارهٔ این اضافه‌شدن"}',
      "",
      "شرایط: بین ۴ تا ۸ قلم مکمل. دوزها به فارسی و در محدودهٔ برچسب استاندارد. با توجه به حساسیت/بیماری/داروی پروفایل محافظه‌کار باش. هیچ ادعای درمانی ننویس.",
    ].join("\n");

    const raw = await callAvalaiJson(SYSTEM_PROMPT, userPrompt);
    const parsedOut = extractJsonBlock(raw);
    if (!parsedOut) {
      return { ok: false, reason: "ai_bad_json" };
    }

    const supplements = sanitizeSupplements(parsedOut.supplements);
    if (supplements.length < LIMITS.minSupplements) {
      return { ok: false, reason: "ai_supplements_too_few" };
    }

    let timingNotes = String(parsedOut.supplementTimingNotes ?? "").trim();
    if (timingNotes && !timingNotes.includes("پزشک")) {
      // دفاع در عمق: جملهٔ سلب مسئولیت همیشه داخل تایمینگ‌نوت باشد
      timingNotes = `${timingNotes.replace(/[.\s]+$/, "")} — قبل از مصرف با پزشک مشورت کن.`;
    }
    timingNotes = timingNotes.slice(0, LIMITS.timingNotes);
    const changeSummary = String(parsedOut.changeSummary ?? "")
      .trim()
      .slice(0, LIMITS.changeSummary);

    // ── ادغام در همان ردیف برنامهٔ غذایی فعال (بدون نسخهٔ جدید / بدون supersede) ──
    content.supplements = supplements;
    if (timingNotes) {
      content.supplementTimingNotes = timingNotes;
    }
    const updateData: {
      content: string;
      changeSummary?: string;
      generatedSource?: string;
    } = { content: JSON.stringify(content) };
    if (!meal.changeSummary || !meal.changeSummary.trim()) {
      updateData.changeSummary = changeSummary || "افزودن برنامهٔ مکمل پس از ارتقای پلن";
    }
    if (!meal.generatedSource || !meal.generatedSource.trim()) {
      updateData.generatedSource = "upgrade_supplement";
    }
    await db.mealPlan.update({ where: { id: meal.id }, data: updateData });

    // ── نوتیف — همان الگوی «برنامه آماده شد» (program-generation.ts): type=achievement + link=?tab=programs ──
    // createNotification خودش SSE پنل + push هر دو کانال را مدیریت می‌کند (v172).
    await createNotification(
      userId,
      "achievement",
      "برنامهٔ مکمل اختصاصی‌ات آماده شد 💊",
      "با ارتقای پلن تو، برنامهٔ مکمل‌های ورزشی اختصاصی به برنامهٔ فعلی‌ات اضافه شد — برنامهٔ تمرین و تغذیهٔ قبلی دست نخورده باقی مانده است. از بخش «تغذیه» یا «برنامه‌ها» مشاهده کن.",
      "?tab=programs"
    );

    console.log(`[upgrade-supplement] supplements merged into active meal plan (user=${userId}, items=${supplements.length})`);
    return { ok: true, reason: "generated" };
  } catch (err) {
    // تور ایمن نهایی — این تابع هرگز به کالرِ غیرمنتظره‌ای exception نمی‌دهد
    console.error("[upgrade-supplement] generation failed (safety-net will retry later):", err);
    return { ok: false, reason: "unexpected_error" };
  }
}
