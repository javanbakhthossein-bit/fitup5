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
      // v154 — تشخیص با کلیدهای اسکیمای JSON (مقاوم): پرامپت تمرینی «"days"» دارد
      // و پرامپت غذایی «"meals"» — واژگان عمومی مثل «وعده» (قانون تمرین صبح v151)
      // دیگر باعث تشخیص غلط نمی‌شود.
      const wantsMeal = userMsg.includes('"meals"');
      const wantsWorkout = userMsg.includes('"days"');
      if (wantsWorkout && !wantsMeal) {
        content = workoutPlanJson();
      } else if (wantsMeal) {
        content = mealPlanJson();
      } else if (userMsg.includes("برنامه غذایی") || userMsg.includes("وعده")) {
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

/* ─── v139 — بوت‌استرپ سرور توسعهٔ Next.js (فقط سندباکس) ───
 * سندباکس فرایندهای پس‌زمینهٔ هر دستور را در پایان همان دستور جمع می‌کند؛
 * تنها فرایندهای داخل درختِ سرویس‌های مینی (که start.sh سندباکس اجرا می‌کند)
 * زنده می‌مانند. این بوت‌استرپ سرور Next را «فقط اگر پورت ۳۰۰۰ خالی باشد»
 * داخل همین درخت زنده بالا می‌آورد تا پیش‌نمایش/تست مرورگری همیشه بالاست.
 * در دیپلوی واقعی نقشی ندارد (فقط mock لوکال). */
async function bootstrapNextDev() {
  try {
    const res = await fetch("http://localhost:3000/", {
      method: "HEAD",
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    if (res && res.status > 0) {
      console.log("[bootstrap] next dev already running on :3000 — skip");
      return;
    }
    // 🩹 v139.4 — ضدتکرار: هر ریلودِ --hot یک اسپاون می‌ساخت و چند next-dev
    // همزمان (هرکدام تا ۲.۸GB) باعث OOM کل سندباکس می‌شد. قبل از اسپاون،
    // نمونه‌های نیمه‌مردده پاک می‌شوند (الگوی همان واچر bash).
    Bun.spawnSync(["bash", "-c", "pkill -9 -f 'next-server' 2>/dev/null; pkill -9 -f 'next dev -p 3000' 2>/dev/null; sleep 1; true"]);
    // v140.2 — setsid: نشست مستقل → مقاوم به جمع‌کنندهٔ فرایند و OOM همسایه‌ها
    const proc = Bun.spawn(["setsid", "bun", "run", "dev"], {
      cwd: "/home/z/my-project",
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
    console.log("[bootstrap] spawned next dev pid=" + proc.pid);
  } catch (e) {
    console.log("[bootstrap] failed: " + (e as Error).message);
  }
}
// v139.1 — اجرای همزمان در eval ماژول (bun --hot تایمرهای نسخهٔ قبل را می‌کشد)
bootstrapNextDev();

/* v139.3 — نگهبان دوره‌ای سرور (فیکس ریشه‌ای «connection refused» سندباکس)
 * فرایند next-dev توسط جمع‌کنندهٔ فرایندهای سندباکس هر چند دقیقه کشته می‌شود
 * و بوت‌استرپ تک‌اجرایی بالا فقط در لحظهٔ بوت کار می‌کرد — نتیجه: کاربر وسط
 * کار با «localhost refused to connect» روبه‌رو می‌شد. حالا هر ۳۰ ثانیه یک
 * HEAD سبک به :3000 می‌زنیم؛ اگر جواب نداد سرور را دوباره بالا می‌آوریم
 * (چایلدِ همین پروسهٔ زندهٔ mock-avalai → در برابر جمع‌کننده مقاوم است).
 * یک‌نمونه‌بودن: retryInFlight + زمان‌بند ثابت. */
let guardBusy = false;
// v139.4 — نگهبان به‌صورت «پروسهٔ bash» (نه تایمر JS): bun --hot بعد از هر
// ریلود همهٔ تایمرهای JS را می‌کشد (اثبات: interval register می‌شد ولی tick
// نمی‌خورد). حلقهٔ bash فرزندِ همین پروسهٔ زنده است و مستقل از reloadها
 // هر ۲۰ ثانیه چک می‌کند؛ سرور مرده را با bun run dev بالا می‌آورد.
function spawnDevGuard() {
  if (typeof Bun === "undefined") return;
  try {
    // ضدتکرار: با هر ریلودِ --hot، واچر قبلی کشته می‌شود (مارکر FITUP_DEV_GUARD)
    Bun.spawnSync(["bash", "-c", "pkill -f FITUP_DEV_GUARD || true"]);
    // v140.2 — خودِ واچر هم setsid: نشست مستقل = زنده‌ماندن در برابر OOM کسکید
    const proc = Bun.spawn(
      [
        "setsid", "bash", "-c",
        [
          '# FITUP_DEV_GUARD',
          // v143.1 — نگهبان هوشمند: «ناپاسخ» ≠ «مرده». وسط کامپایل سنگین Next
          // (بعد از تغییرات بزرگ، تا چند دقیقه) پورت جواب نمی‌دهد ولی پروسه
          // زنده است — نسخهٔ قبلی در همان لحظه pkill می‌کرد و خودش قاتل سرور
          // بود (اثبات: [guard] respawn حین «Compiling / ...» در dev.log).
          // حالا: پروسه نیست → فوری respawn؛ پروسه هست ولی ۸ چک پشت‌سرهم
          // (~۳ دقیقه) بی‌پاسخ بود → thrashing واقعی → kill + respawn.
          'fails=0;',
          'while true; do',
          '  sleep 20;',
          '  if curl -sf -o /dev/null -m 8 http://localhost:3000/; then fails=0; continue; fi',
          '  fails=$((fails+1))',
          '  if ! pgrep -f "next-server" >/dev/null 2>&1; then',
          '    echo "[guard] next-server missing -> respawn $(date +%T)" >> /tmp/next-dev-guard.log;',
          '    pkill -9 -f "next-server" 2>/dev/null; sleep 1;',
          '    cd /home/z/my-project && NODE_OPTIONS=--max-old-space-size=2048 setsid nohup bun run dev >> /home/z/my-project/dev.log 2>&1 &',
          '    for i in $(seq 1 60); do sleep 5; curl -sf -o /dev/null -m 8 http://localhost:3000/ && break; done',
          '    fails=0;',
          '  elif [ $fails -ge 8 ]; then',
          '    echo "[guard] next-server stuck (~3min unresponsive) -> kill+respawn $(date +%T)" >> /tmp/next-dev-guard.log;',
          '    pkill -9 -f "next-server" 2>/dev/null; sleep 1;',
          '    cd /home/z/my-project && NODE_OPTIONS=--max-old-space-size=2048 setsid nohup bun run dev >> /home/z/my-project/dev.log 2>&1 &',
          '    for i in $(seq 1 60); do sleep 5; curl -sf -o /dev/null -m 8 http://localhost:3000/ && break; done',
          '    fails=0;',
          '  fi',
          'done',
        ].join("\n"),
      ],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );
    proc.unref();
    console.log("[guard] bash watcher spawned pid=" + proc.pid);
  } catch (e) {
    console.log("[guard] spawn failed: " + (e as Error).message);
  }
}
spawnDevGuard();

/* v140.2 — پشتیبان JS: interval سبک هر ۴۵ ثانیه (بعد از هر ریلودِ --hot تایمر
 * قبلی کشته می‌شود و این دوباره ثبت می‌شود — همان منطق بوت‌استرپ بالا). اگر
 * واچر bash هم مرده باشد و سرور هم، این از داخل درخت زندهٔ بوت اسپاون می‌کند. */
function jsFallbackGuard() {
  if (typeof Bun === "undefined") return;
  setInterval(() => {
    fetch("http://localhost:3000/", { method: "HEAD", signal: AbortSignal.timeout(4000) })
      .then((r) => {
        if (!r || r.status <= 0) throw new Error("dead");
      })
      .catch(async () => {
        // فقط اگر واچر bash زنده نیست اسپاون کن (جلدِ دوبله‌اسپاون)
        const chk = Bun.spawnSync(["bash", "-c", "pgrep -f FITUP_DEV_GUARD >/dev/null && echo alive || echo dead"]);
        if (chk.stdout.toString().includes("alive")) return;
        console.log("[guard-js] bash watcher missing + server dead -> respawn");
        spawnDevGuard();
        bootstrapNextDev();
      });
  }, 45_000);
}
jsFallbackGuard();

/* v142 — نگهبان ضد-revert (همگام‌سازی دوره‌ای وضعیت پروژه)
 * ریشهٔ حادثه‌های «برگشت به نسخهٔ قدیم»: prestop پلتفرم قبل از جمع‌شدن سندباکس
 * نتوانسته repo.tar تازه بنویسد → بوت بعدی از اسنپ‌شات قدیمی برمی‌گردد.
 * راه‌حل: حلقهٔ scripts/state-sync.sh (فرزندِ همین درخت زندهٔ بوت، setsid) هر
 * ۱۵ دقیقه /tmp/my-project را به‌روز نگه می‌دارد (لایهٔ دفاع دوم) و هر ۶۰ دقیقه
 * repo.tar را به‌صورت اتمی بازسازی می‌کند. انتهای هر نشست کاری هم ایجنت
 * «state-sync.sh --once» را اجرا می‌کند (قانون worklog). */
function spawnStateSync() {
  if (typeof Bun === "undefined") return;
  try {
    // ضدتکرار: اگر واچر زنده است دوباره اسپاون نکن (به‌جای pkill — وسط tar نکُش)
    const chk = Bun.spawnSync([
      "bash", "-c",
      "pgrep -f 'state-sync[.]sh' >/dev/null && echo alive || echo dead",
    ]);
    if (chk.stdout.toString().includes("alive")) {
      console.log("[state-sync] watcher already alive — skip");
      return;
    }
    // مارکر FITUP_STATE_SYNC داخل cmdline برای pgrep + script برای اجرا
    const proc = Bun.spawn(
      ["setsid", "bash", "/home/z/my-project/scripts/state-sync.sh", "FITUP_STATE_SYNC"],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );
    proc.unref();
    console.log("[state-sync] watcher spawned pid=" + proc.pid);
  } catch (e) {
    console.log("[state-sync] spawn failed: " + (e as Error).message);
  }
}
spawnStateSync();
// پشتیبان: هر ۱۰ دقیقه چک کن واچر زنده است؛ نبود → دوباره اسپاون
// (تایمر بعد از هر ریلودِ --hot دوباره ثبت می‌شود — همان الگوی نگهبان سرور)
setInterval(() => {
  try {
    const chk = Bun.spawnSync([
      "bash", "-c",
      "pgrep -f 'state-sync[.]sh' >/dev/null && echo alive || echo dead",
    ]);
    if (!chk.stdout.toString().includes("alive")) {
      console.log("[state-sync] watcher missing -> respawn");
      spawnStateSync();
    }
  } catch {}
}, 600_000);

// v147 keepalive re-arm 1790499111
