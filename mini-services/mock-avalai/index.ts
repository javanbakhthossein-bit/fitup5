/**
 * Mock AvalAI — سرویس محلی سازگار با OpenAI /v1/chat/completions
 *
 * فقط برای تست E2E در سندباکس (بدون کلید واقعی AvalAI):
 *  - تشخیص «برنامه تمرینی» / «برنامه غذایی» از متن پرامپت
 *  - پاسخ JSON معتبر طبق اسکیمای WorkoutPlanContent / MealPlanContent
 *
 * پورت: 3040 (ثابت)
 * اجرا: bun run dev (hot-reload)
 */
const PORT = 3040;

function ex(id: string, name: string, muscle: string, category: string, sets: number) {
  return {
    id,
    name,
    muscle,
    category,
    description: `اجرای صحیح ${name} با کنترل کامل حرکت و دامنهٔ کامل.`,
    tips: "دم در فاز کاذب، بازدم در فاز فشرده. فرم صحیح اولویت اول است.",
    mediaUrl: "",
    difficulty: "متوسط",
    sets: Array.from({ length: sets }, (_, i) => ({
      setNumber: i + 1,
      reps: "10-12",
      restSec: 90,
      rpe: 8,
    })),
    rpe: 8,
  };
}

function workoutPlanJson(): string {
  return JSON.stringify({
    days: [
      {
        day: "شنبه",
        title: "روز سینه و پشت بازو",
        focus: "سینه",
        estimatedMinutes: 70,
        exercises: [
          ex("w1", "پرس سینه هالتر", "سینه", "پرس", 4),
          ex("w2", "پرس بالاسینه دمبل", "سینه", "پرس", 3),
          ex("w3", "قفسه سینه دمبل", "سینه", "جداکننده", 3),
          ex("w4", "ساب پرس", "پشت بازو", "پرس", 3),
          ex("w5", "دیپ پارالل", "پشت بازو", "پرس", 3),
          ex("w6", "پرس سینه دمبل", "سینه", "پرس", 3),
        ],
        warmup: [{ name: "گرم کردن عمومی", description: "۵ دقیقه تردمیل + چرخش شانه", durationMin: 5 }],
        cooldown: [{ name: "سرد کردن", description: "کشش سینه و شانه ۵ دقیقه", durationMin: 5 }],
      },
      {
        day: "یکشنبه",
        title: "روز پشت و جلو بازو",
        focus: "پشت",
        estimatedMinutes: 75,
        exercises: [
          ex("w7", "بارفیکس", "پشت", "کشش", 4),
          ex("w8", "زیربغل سیم‌کش از جلو", "پشت", "کشش", 4),
          ex("w9", "قایقی هالتر", "پشت", "کشش", 3),
          ex("w10", "لای پول", "پشت", "کشش", 3),
          ex("w11", "جلو بازو هالتر", "جلو بازو", "جمع‌کننده", 3),
          ex("w12", "چکشی دمبل", "جلو بازو", "جمع‌کننده", 3),
        ],
      },
      {
        day: "دوشنبه",
        title: "روز پا و شکم",
        focus: "پا",
        estimatedMinutes: 80,
        exercises: [
          ex("w13", "اسکوات هالتر", "چهارسر", "پرس پا", 4),
          ex("w14", "پرس پا دستگاه", "چهارسر", "پرس پا", 4),
          ex("w15", "ددلیفت رومانیایی", "همسترینگ", "کشش پا", 3),
          ex("w16", "جلو پا دستگاه", "چهارسر", "جداکننده", 3),
          ex("w17", "ساق ایستاده", "ساق", "پرس پا", 4),
          ex("w18", "کرانچ شکم", "شکم", "هسته", 3),
        ],
      },
    ],
    weeklyGoal: "افزایش قدرت و حجم عضلانی با پیشرفت تدریجی وزنه‌ها",
    goal: "عضله‌سازی",
    notes: "بین ست‌ها ۹۰ ثانیه استراحت. وزنه‌ها را هفته‌ای ۲.۵٪ افزایش دهید.",
    safetyNotes: ["در صورت درد مفصلی، حرکت را متوقف کنید."],
    recoveryNotes: ["۷-۸ ساعت خواب شبانه توصیه می‌شود."],
    weeklyProgression: {
      strategy: "افزایش تدریجی بار",
      weeks: [
        { week: 1, weightChangeKg: 0, note: "آشنایی با حرکات" },
        { week: 2, weightChangeKg: 2.5, note: "افزایش بار" },
      ],
    },
  });
}

function mealItem(id: string, name: string, cal: number, p: number, c: number, f: number) {
  return {
    id,
    name,
    category: "اصلی",
    calories: cal,
    protein: p,
    carbs: c,
    fat: f,
    servingSize: "۱ وعده",
    imageUrl: "",
  };
}

function mealPlanJson(): string {
  return JSON.stringify({
    meals: [
      {
        type: "صبحانه",
        label: "صبحانه پروتئینی",
        items: [
          mealItem("m1", "تخم‌مرغ آب‌پز", 155, 13, 1, 11),
          mealItem("m2", "نان سنگک", 180, 6, 35, 1),
          mealItem("m3", "پنیر کم‌چرب", 100, 12, 2, 6),
        ],
        totalCalories: 435,
        totalProtein: 31,
        totalCarbs: 38,
        totalFat: 18,
        combination: "تخم‌مرغ + نان سنگک + پنیر",
      },
      {
        type: "ناهار",
        label: "ناهار اصلی",
        items: [
          mealItem("m4", "سینه مرغ گریل", 250, 47, 0, 5),
          mealItem("m5", "برنج قهوه‌ای", 215, 5, 45, 2),
          mealItem("m6", "سالاد سبزیجات", 80, 3, 12, 1),
        ],
        totalCalories: 545,
        totalProtein: 55,
        totalCarbs: 57,
        totalFat: 8,
        combination: "مرغ گریل + برنج + سالاد",
      },
      {
        type: "شام",
        label: "شام سبک",
        items: [
          mealItem("m7", "ماهی سالمون", 210, 34, 0, 11),
          mealItem("m8", "سیب‌زمینی آب‌پز", 130, 3, 30, 0),
        ],
        totalCalories: 340,
        totalProtein: 37,
        totalCarbs: 30,
        totalFat: 11,
        combination: "سالمون + سیب‌زمینی",
      },
      {
        type: "میان‌وعده",
        label: "میان‌وعده بعد از تمرین",
        items: [
          mealItem("m9", "پروتئین وی", 120, 24, 3, 1),
          mealItem("m10", "موز", 105, 1, 27, 0),
        ],
        totalCalories: 225,
        totalProtein: 25,
        totalCarbs: 30,
        totalFat: 1,
        combination: "وی + موز",
      },
    ],
    totalCalories: 1545,
    totalProtein: 148,
    totalCarbs: 155,
    totalFat: 38,
    waterLiters: 3,
    notes: "روزهای تمرین ۳۰۰ کالری اضافه مصرف کنید. آب را به‌صورت dividé در طول روز بنوشید.",
    foodPrepTips: ["مرغ را یک‌بار برای ۳ روز بپزید."],
    hydrationSchedule: [
      { time: "بیدار شد", amountMl: 400 },
      { time: "قبل از تمرین", amountMl: 300 },
    ],
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = (await req.json().catch(() => ({}))) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const userMsg =
        body.messages?.map((m) => m.content || "").join("\n") || "";

      let content: string;
      if (userMsg.includes("برنامه غذایی") || userMsg.includes("وعده")) {
        content = mealPlanJson();
      } else if (userMsg.includes("تمرینی") || userMsg.includes("حرکات")) {
        content = workoutPlanJson();
      } else {
        content = JSON.stringify({ note: "ok" });
      }

      return Response.json({
        id: `mock-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-avalai",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
      });
    }

    // health check
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, service: "mock-avalai", port: PORT });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[mock-avalai] listening on http://localhost:${PORT}/v1`);
