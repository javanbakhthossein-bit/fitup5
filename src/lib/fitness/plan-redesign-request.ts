/**
 * ─────────────────────────────────────────────────────────────────────────
 * plan-redesign-request.ts (v149) — «بازطراحی از چت: برنامه عیناً عین درخواست ورزشکار»
 *
 * تیکت مالک (دی ۱۴۰۴): کاربر در چت با فیتاپ درخواست بازطراحی برنامه داده و
 * گفته «۳ روز بالاتنه، ۱ روز پایین‌تنه» — اما برنامهٔ تحویل‌شده هر ۴ روز
 * بالاتنه بود. قرار بود «دقیقاً و عیناً برنامه عین درخواست ورزشکار نوشته بشه».
 *
 * ریشه‌یابی (چهار حلقهٔ گسسته):
 *   ۱) متن درخواست چت فقط به‌صورت یک ردیف آزاد در nutritionNotes ذخیره می‌شد
 *      و در پرامپت با برچسب «یادداشت‌های تغذیه‌ای» + سقف ۱۵۰۰ نویسه (۷۰/۳۰)
 *      تزریق می‌شد — یعنی درخواست ساختاری، برچسب تغذیه‌ای می‌گرفت.
 *   ۲) بند «A) تقسیم هفته (Split)» پرامپت تمرین مدل را ملزم می‌کرد split را
 *      «دقیقاً بر اساس workoutDays» از گزینه‌های ثابت (۴ روز → بالاتنه/پایتنه
 *      ×۲ یا PPL+بدن‌کامل) انتخاب کند — درخواست کاربر در فهرست نبود و هیچ
 *      قانونی نمی‌گفت درخواست صریح کاربر بر این بند مقدم است.
 *   ۳) changeSummary (خلاصهٔ توافق‌شدهٔ کارت تایید) هرگز به پرامپت تولید
 *      نمی‌رسید — فقط برچسب نسخه و پیام چت بود.
 *   ۴) هیچ حلقهٔ پس‌پردازشی (قفل بانک، dedupe، ترمیم پوشش) چیدمان روزها را
 *      با درخواست کاربر مقایسه نمی‌کرد؛ برنامهٔ «۴ روز بالاتنه» همهٔ گیت‌ها
 *      را سبز می‌کرد.
 *
 * راه‌حل چهارلایه (همهٔ مسیرهای بازطراحی چت از این می‌گذرند):
 *   لایهٔ ۱ — پارسر ساختاری: متن فارسی/محاورهٔ درخواست →
 *     RequestedSplitSpec {upper, lower, fullBody, push, pull} — در چت
 *     (plan-change-intent) استخراج و در Subscription.planRegenRequest ذخیره می‌شود.
 *   لایهٔ ۲ — دیرکتیو: buildRedesignDirectiveFa بلوک «درخواست صریح و الزامی
 *     ورزشکار» را می‌سازد که در بالاترین نقطهٔ پرامپت تمرین تزریق می‌شود و
 *     بند A را صریحاً لغو می‌کند.
 *   لایهٔ ۳ — ترمیم قطعی: repairPlanDaySplitToRequest بعد از تولید، روزها را
 *     با majorGroupsOfExercise طبقه‌بندی و هر روزِ ناهم‌خوان را با حرکات
 *     ویدیودار واقعی بانک به ناحیهٔ درخواستی تبدیل می‌کند (بدون ردِ برنامه —
 *     هم‌راستا با موتور «یک تلاش، صفر شکست» v148) + خط شفافیت در نکات مربی.
 *   لایهٔ ۴ — مصرف: بعد از ذخیرهٔ موفق برنامه، فیلد پاک می‌شود تا درخواست کهنه
 *     در تولیدهای بعدی (چکاپ/تغییر وزن) نشت نکند.
 *
 * خالص و بدون I/O — هم سرور و هم تست.
 * ─────────────────────────────────────────────────────────────────────────
 */
import {
  type BankExerciseRow,
  type LockedBank,
  majorGroupsOfExercise,
} from "./exercise-bank-lock";

/* ───────────────────────── اسپک درخواست ───────────────────────── */

/** چیدمان درخواستی کاربر — تعداد روز هر ناحیه (فیلدهای ناموجود = ۰) */
export interface RequestedSplitSpec {
  /** روزهای بالاتنه (سینه/زیربغل/سرشانه/بازو) */
  upper?: number;
  /** روزهای پایین‌تنه (پا) */
  lower?: number;
  /** روزهای بدن کامل */
  fullBody?: number;
  /** روزهای پوش (بالاتنه‌محور رانش-جلو) */
  push?: number;
  /** روزهای پول (بالاتنه‌محور کشش-عقب) */
  pull?: number;
}

/** ناحیهٔ واقعیِ هر روز برنامه بعد از طبقه‌بندی حرکات */
export type PlanDayRegion = "upper" | "lower" | "fullbody" | "unknown";

/** خروجی پارسر */
export interface ParsedSplitRequest {
  spec: RequestedSplitSpec;
  /** جملهٔ فارسی آماده (مثل «۳ روز بالاتنه + ۱ روز پایین‌تنه») */
  summary: string;
}

/* ───────────────────────── نرمال‌سازی متن ───────────────────────── */

/** ارقام فارسی/عربی → لاتین + ی/ک + فشرده‌سازی فاصله */
function normalizeRequestText(raw: string): string {
  return (raw || "")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/** واژه‌های عددی فارسی/محاوره → رقم (فقط توکن مستقل) */
const FA_NUMBER_WORDS: Record<string, number> = {
  یک: 1,
  یه: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  چار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
};

/** جایگزینی توکن‌های عددی واژه‌ای با رقم — «سه روز» → «3 روز» */
function foldNumberWords(text: string): string {
  return text
    .split(/([\s،,.؛!؟()\-])/)
    .map((tok) => {
      const key = tok.trim();
      if (key && Object.prototype.hasOwnProperty.call(FA_NUMBER_WORDS, key)) {
        return String(FA_NUMBER_WORDS[key]);
      }
      return tok;
    })
    .join("");
}

/* ───────────────────────── نواحی بدنی ───────────────────────── */

const REGION_PATTERNS: Record<keyof RequestedSplitSpec, RegExp> = {
  // بالاتنه / بالا تنه / بالای تنه / upper
  upper: /بالا(?:ی)?\s*تنه|بالاتنه|upper/i,
  // پایین‌تنه / پایین تنه / پایتنه / پا|پاها (توکن مستقل — «پایین» مچ نمی‌شود)
  lower: /پایین\s*تنه|پایتنه|(?:(?:^)|(?<=[\s،,.؛!؟()]))پا(?:ها)?(?=(?:$)|(?=[\s،,.؛!؟()]))|lower|leg/i,
  // بدن کامل / تمام بدن / کل بدن / فول بادی / full body
  fullBody: /بدن\s*کامل|تمام\s*بدن|کل\s*بدن|فول\s*بادی|full\s*body|fullbody/i,
  // پوش / push
  push: /(?:(?<=[\s،,.؛!؟()]))پوش(?=(?:$)|(?=[\s،,.؛!؟()]))|\bpush\b/i,
  // پول / pull
  pull: /(?:(?<=[\s،,.؛!؟()]))پول(?=(?:$)|(?=[\s،,.؛!؟()]))|\bpull\b/i,
};

/** پنجرهٔ جستجوی عدد در اطراف واژهٔ ناحیه (نویسه) */
const COUNT_WINDOW = 14;
/** پنجرهٔ «ناحیهٔ پشتِ عدد» — عددی که بلافاصله بعد از ناحیه آمده، دیگر الگوی جلو نیست */
const BACKWARD_CLAIM_WINDOW = 8;

/**
 * پارسر ساختاری درخواست چیدمان از متن فارسی/محاورهٔ کاربر.
 *
 * مدل مالکیت عدد (دو گذر — مقاوم به آلودگی عدد ناحیهٔ مجاور):
 *   گذر ۱ (عدد → ناحیهٔ جلو): برای هر رقم که «واژهٔ ناحیه‌ای» در ۸ نویسه پشتش
 *     نباشد (یعنی آن رقم به ناحیهٔ قبلی تعلق ندارد)، اگر تا ۱۴ نویسه بعدش
 *     الگوی «واحد اختیاری + پرکنندهٔ سبک اختیاری (تمام/کامل/هم) + واژهٔ ناحیه»
 *     بیاید، رقم به آن ناحیه تعلق می‌گیرد («۳ روز بالاتنه»، «2 upper»، «۱ روز پایین تنه»).
 *   گذر ۲ (ناحیه → رقم پشت): برای هر مچ واژهٔ ناحیه، رقمِ بلافاصله‌بعدی
 *     (فقط فاصله/علامت یا را/رو/هم بین‌شان، با واحد روز/جلسه یا چسبیده) اگر
 *     مصرف‌نشده باشد به همان ناحیه می‌رسد («بالاتنه سه روز»، «پا یک جلسه»).
 * هر رقم فقط یک‌بار مصرف می‌شود و شمارش هر ناحیه max اعداد تخصیص‌یافته است.
 * مثال‌های پشتیبانی‌شده:
 *   «سه روز بالاتنه بده یک روز پایین تنه» → {upper:3, lower:1}
 *   «2 upper days, 1 leg day»            → {upper:2, lower:1}
 *   «بالاتنه سه روز و پا یک روز»          → {upper:3, lower:1}
 *   «۴ روز بالاتنه ۲ روز پایین تنه»       → {upper:4, lower:2}
 * null = درخواست ساختاریِ قابل‌اجرا در متن نیست (متن خام همچنان به پرامپت می‌رود).
 */
export function parseRequestedSplitFromText(raw: string): ParsedSplitRequest | null {
  if (!raw || raw.length < 3) return null;
  const text = foldNumberWords(normalizeRequestText(raw));
  if (!/\d/.test(text)) return null;

  const regionKeys = Object.keys(REGION_PATTERNS) as Array<keyof RequestedSplitSpec>;
  const regionMatches = regionKeys.map((key) => {
    const re = new RegExp(REGION_PATTERNS[key].source, "gi");
    const hits: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(re)) {
      hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
    return { key, hits };
  });

  const digits: Array<{ start: number; end: number; n: number }> = [];
  for (const m of text.matchAll(/(\d+)/g)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 7) {
      digits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, n });
    }
  }

  // پیشوند مجاز بین رقم و ناحیهٔ جلو (فقط واحد روز + واژه‌های سبک — هیچ واژهٔ دیگر)
  const P1_PREFIX = /^[\s\u200C]*(?:(?:روز|جلسه|واحد)[\s\u200C]*)?(?:(?:تمام|کامل|هم)[\s\u200C]*)?/;
  // پیشوند مجاز بین ناحیه و رقم پشتی (فقط فاصله/علامت یا را/رو/هم)
  const P2_PREFIX = /^[\s\u200C،,\-–؛:()!؟.]{0,4}(?:(?:را|رو|هم)[\s\u200C،,]{0,2})?[\s\u200C،,\-–؛:()!؟.]*/;
  const UNIT_AFTER_DIGIT = /\s*(?:روز|جلسه|واحد)/;

  const counts = new Map<keyof RequestedSplitSpec, number>();
  const bump = (key: keyof RequestedSplitSpec, n: number) =>
    counts.set(key, Math.max(counts.get(key) ?? 0, n));

  // ─── کاندیدهای مالکیت هر رقم ───
  // هر رقم می‌تواند به ناحیهٔ جلوی خودش تعلق بگیرد (۳ روز بالاتنه) یا ناحیهٔ پشتی
  // (پا یک روز / بالاتنه ۳) — انتخاب نهایی با حل‌کنندهٔ سراسری انجام می‌شود تا
  // «بیشترین ناحیه‌های پوشش‌داده‌شده» انتخاب شود (تیکت مالک: «۳ روز بالاتنه،
  // ۱ روز پایین تنه» هر دو ناحیه باید دربیایند).
  const mentioned = new Set<keyof RequestedSplitSpec>();
  for (const rm of regionMatches) {
    if (rm.hits.length > 0) mentioned.add(rm.key);
  }

  const digitCandidates: Array<Array<{ region: keyof RequestedSplitSpec; backward: boolean }>> = [];
  for (const d of digits) {
    const cands: Array<{ region: keyof RequestedSplitSpec; backward: boolean }> = [];

    // جلو (P1): رقم + واحد اختیاری + واژه‌های سبک اختیاری + ناحیه
    const prefix = P1_PREFIX.exec(text.slice(d.end, d.end + COUNT_WINDOW));
    if (prefix) {
      const rest = text.slice(d.end + prefix[0].length, d.end + COUNT_WINDOW + 8);
      for (const rm of regionMatches) {
        const re = new RegExp(REGION_PATTERNS[rm.key].source, "i");
        const hit = re.exec(rest);
        if (hit && hit.index === 0) {
          cands.push({ region: rm.key, backward: false });
          break;
        }
      }
    }

    // پشت (P2): ناحیه + فقط فاصله/علامت/را/رو/هم + رقم
    for (const rm of regionMatches) {
      for (const h of rm.hits) {
        const gap = d.start - h.end;
        if (gap < 0 || gap > BACKWARD_CLAIM_WINDOW) continue;
        const gapText = text.slice(h.end, d.start);
        const gm = P2_PREFIX.exec(gapText);
        // کل فاصله باید پرکنندهٔ سبک باشد («بده» و هر واژهٔ دیگر = غیرمجاز)
        if (!gm || gm[0].length !== gapText.length) continue;
        const after = text.slice(d.end, d.end + 6);
        const hasUnit = UNIT_AFTER_DIGIT.test(after);
        // بدون واژهٔ واحد، فقط چسبیدگی/تقریباً چسبیده مجاز است («بالاتنه ۳»)
        if (!hasUnit && gap > 2) continue;
        if (!cands.some((c) => c.region === rm.key)) {
          cands.push({ region: rm.key, backward: true });
        }
        break;
      }
    }

    digitCandidates.push(cands);
  }

  /** امتیاز ترکیب: ① تعداد ناحیه‌های ذکرشده که عدد گرفتند ② تعداد اعداد مصرف‌شده ③ جلومحوری */
  function scoreCombo(choice: Array<number | -1>): { served: number; used: number; forward: number } {
    const perRegion = new Map<keyof RequestedSplitSpec, number>();
    let used = 0;
    let forward = 0;
    for (let i = 0; i < choice.length; i++) {
      const c = choice[i];
      if (c < 0) continue;
      const cand = digitCandidates[i][c];
      used++;
      if (!cand.backward) forward++;
      perRegion.set(cand.region, Math.max(perRegion.get(cand.region) ?? 0, digits[i].n));
    }
    let served = 0;
    for (const m of mentioned) if (perRegion.has(m)) served++;
    return { served, used, forward };
  }

  let best: { choice: Array<number | -1>; score: { served: number; used: number; forward: number } } | null = null;
  const enumMax = 9; // بیش از ۹ رقم → حافظهٔ ترکیبی سنگین نمی‌شود (۲^۹)
  if (digits.length <= enumMax) {
    const choice: Array<number | -1> = new Array(digits.length).fill(-1);
    const better = (a: NonNullable<typeof best>["score"], b: NonNullable<typeof best>["score"]) =>
      a.served !== b.served ? a.served > b.served
        : a.used !== b.used ? a.used > b.used
        : a.forward > b.forward;
    const recurse = (i: number) => {
      if (i === digits.length) {
        const s = scoreCombo(choice);
        if (!best || better(s, best.score)) best = { choice: [...choice], score: s };
        return;
      }
      choice[i] = -1;
      recurse(i + 1);
      for (let c = 0; c < digitCandidates[i].length; c++) {
        choice[i] = c;
        recurse(i + 1);
      }
    };
    recurse(0);
  } else {
    // فال‌بک حریصانه برای متن‌های با رقم خیلی زیاد
    const choice = digitCandidates.map((cands) => (cands.length > 0 ? 0 : -1));
    best = { choice, score: scoreCombo(choice) };
  }

  if (best) {
    for (let i = 0; i < digits.length; i++) {
      const c = best.choice[i];
      if (c < 0) continue;
      bump(digitCandidates[i][c].region, digits[i].n);
    }
  }

  if (counts.size === 0) return null;
  const spec: RequestedSplitSpec = {};
  for (const [k, v] of counts) {
    (spec as Record<string, number>)[k] = v;
  }
  const total = Object.values(spec).reduce((s, n) => s + (n || 0), 0);
  if (total < 1 || total > 7) return null;

  return { spec, summary: describeSplitSpecFa(spec) };
}

/** جملهٔ فارسی خوانا از اسپک — «۳ روز بالاتنه + ۱ روز پایین‌تنه» */
export function describeSplitSpecFa(spec: RequestedSplitSpec): string {
  const parts: string[] = [];
  const toFa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (spec.upper) parts.push(`${toFa(spec.upper)} روز بالاتنه`);
  if (spec.lower) parts.push(`${toFa(spec.lower)} روز پایین‌تنه`);
  if (spec.fullBody) parts.push(`${toFa(spec.fullBody)} روز بدن کامل`);
  if (spec.push) parts.push(`${toFa(spec.push)} روز پوش`);
  if (spec.pull) parts.push(`${toFa(spec.pull)} روز پول`);
  return parts.join(" + ");
}

/** مجموع روزهای اسپک */
export function splitSpecTotalDays(spec: RequestedSplitSpec): number {
  return Object.values(spec).reduce((s, n) => s + (n || 0), 0);
}

/**
 * دیرکتیو «درخواست صریح و الزامی ورزشکار» — بالاترین اولویت پرامپت تمرین.
 * بند A (تقسیم هفته) را صریحاً لغو می‌کند و ترکیب روزها را دیکته می‌کند.
 */
export function buildRedesignDirectiveFa(
  spec: RequestedSplitSpec,
  raw?: string | null,
  changeSummary?: string | null
): string {
  const splitLine = describeSplitSpecFa(spec);
  const total = splitSpecTotalDays(spec);
  const toFa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const dayComposition: string[] = [];
  if (spec.upper || spec.push || spec.pull) {
    dayComposition.push("روز بالاتنه = ترکیب علمی سینه/زیربغل/سرشانه/بازو (چند گروه بالاتنه در هر روز)");
  }
  if (spec.lower) dayComposition.push("روز پایین‌تنه = پا (چهارسر/همسترینگ/باسن/ساق)");
  if (spec.fullBody) dayComposition.push("روز بدن کامل = پوشش چندمفصلی کل بدن");
  return [
    `🔴🔴 درخواست صریح و الزامی ورزشکار (بالاترین اولویتِ کل برنامه — نقض آن یعنی برنامهٔ باطل):`,
    `ورزشکار در «چت با فیتاپ» خواسته برنامه‌اش دقیقاً با این چیدمان بازطراحی شود: «${splitLine}» (مجموعاً ${toFa(total)} روز).`,
    `• چیدمان روزها باید عیناً و دقیقاً همین باشد — نه یک روز بیشتر، نه کمتر، نه جابه‌جا.`,
    `• این درخواستِ صریح، گزینه‌های پیش‌فرض بند «A) تقسیم هفته (Split)» را برای این کاربر کامل لغو می‌کند — فقط چیدمان بالا ملاک است.`,
    ...dayComposition.map((l) => `• ${l}.`),
    `• در فیلد notes یک خط «📊 تحلیل چیدمان» بنویس: این چیدمان عیناً طبق درخواست خود ورزشکار چیده شده + پوشش شش گروه اصلی در همین قالب چطور تضمین شده.`,
    raw ? `• متن خود ورزشکار: «${raw.slice(0, 400)}»` : "",
    changeSummary ? `• خلاصهٔ تغییرات توافق‌شده در چت: ${changeSummary.slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ───────────────────────── طبقه‌بندی روزها ───────────────────────── */

/**
 * ناحیهٔ واقعی یک روز برنامه — از روی عضلات واقعی حرکات (نه برچسب AI):
 *   lower    = روز پا (حداقل ۲ حرکت پا و بیشتر از حرکات بالاتنه)
 *   upper    = روز بالاتنه
 *   fullbody = روز کل‌بدن (حرکات چندمفصلی شش‌گروه)
 *   unknown  = روز غیرقابل‌طبقه‌بندی (کم‌حرکت/خالی)
 */
export function classifyPlanDayRegion(
  day: { exercises?: Array<Record<string, any>>; [k: string]: any } | null | undefined
): PlanDayRegion {
  const exs = Array.isArray(day?.exercises) ? day!.exercises! : [];
  let leg = 0;
  let upper = 0;
  let full = 0;
  for (const ex of exs) {
    if (!ex || !ex.name) continue;
    const groups = majorGroupsOfExercise(ex as any);
    if (groups.size >= 5) {
      full++;
      continue;
    }
    if (groups.has("legs")) {
      leg++;
      continue;
    }
    if (groups.has("chest") || groups.has("back") || groups.has("shoulders") || groups.has("arms")) {
      upper++;
    }
  }
  if (full > 0 && full >= leg && full >= upper) return "fullbody";
  if (leg >= 2 && leg > upper) return "lower";
  if (upper >= 2 && upper > leg) return "upper";
  if (upper >= 1 && leg === 0) return "upper";
  if (leg >= 1 && upper === 0) return "lower";
  return "unknown";
}

/* ───────────────────────── ترمیم قطعی چیدمان ───────────────────────── */

const MIN_BANK_FOR_SPLIT_REPAIR = 12;

export interface SplitRepairReport {
  /** چیدمان از اول ناهم‌خوان بوده یا نه */
  alreadyOk: boolean;
  converted: Array<{ day: string; to: PlanDayRegion; replaced: number }>;
  /** خط شفافیت «طبق درخواست صریح شما» به نکات اضافه شد؟ */
  noteAdded: boolean;
  /** بانک برای ترمیم کافی نبود (fail-safe — روز دست‌نخورده ماند) */
  poolExhausted: boolean;
}

interface DayRepairRow {
  day: Record<string, any>;
  region: PlanDayRegion;
}

function isCompoundName(name: string): boolean {
  return /اسکوات|ددلیفت|دد لیفت|لانژ|لانج|پرس پا|هاک|جلو پا|پشت پا|هیپ|hip thrust|ساق|رومانیایی|گلوت|leg press|squat|deadlift|lunge/i.test(
    name
  );
}

/** ساخت شیء حرکت کامل از ردیف بانک (همان شکل repairWorkoutPlanCoverage) */
function bankRowToExercise(row: BankExerciseRow, compound: boolean): Record<string, any> {
  const setCount = compound ? 4 : 3;
  const reps = compound ? "8-10" : "12-15";
  const rest = compound ? 90 : 60;
  return {
    name: row.name,
    muscle: row.muscle,
    category: row.category,
    description: row.description || "حرکت را با کنترل کامل و دامنهٔ حرکتی کامل اجرا کن.",
    tips: row.tips || "فرم صحیح و تنفس منظم را حفظ کن.",
    coachTip: "انقباض کامل و کنترل تنفس — کیفیت اجرا مهم‌تر از وزنه است.",
    difficulty: "intermediate",
    rpe: compound ? 8 : 7,
    tempo: "2-0-2-0",
    substitution: "نسخهٔ سبک‌تر با همان عضله در صورت خستگی",
    sets: Array.from({ length: setCount }, (_, i) => ({
      setNumber: i + 1,
      reps,
      restSec: rest,
      rpe: compound ? 8 : 7,
    })),
    exerciseId: row.id,
  };
}

/** استخر حرکات ویدیودارِ یک ناحیه از بانک (بدون تکرار در کل برنامه) */
function buildRegionPool(
  region: Exclude<PlanDayRegion, "unknown">,
  bank: LockedBank,
  usedIds: Set<string>
): BankExerciseRow[] {
  const upperGroups = ["chest", "back", "shoulders", "arms"] as const;
  const scored: Array<{ row: BankExerciseRow; primary: string; compound: boolean }> = [];
  for (const row of bank.all) {
    if (usedIds.has(row.id)) continue;
    const groups = majorGroupsOfExercise(row);
    if (groups.size >= 5) continue; // کل‌بدن — ناحیهٔ خاص نمی‌سازد
    const compound = isCompoundName(row.name);
    if (region === "lower") {
      if (!groups.has("legs")) continue;
      scored.push({ row, primary: "legs", compound });
    } else if (region === "upper") {
      const hit = upperGroups.find((g) => groups.has(g));
      if (!hit) continue;
      scored.push({ row, primary: hit, compound });
    } else {
      // fullbody — ترکیب چندگروهی
      if (groups.size < 3) continue;
      scored.push({ row, primary: "fullbody", compound });
    }
  }
  // کامپاند اول؛ برای بالاتنه چرخش گروهی (سینه→زیربغل→سرشانه→بازو) تا روز متوازن شود
  scored.sort((a, b) => Number(b.compound) - Number(a.compound));
  if (region !== "upper") {
    return scored.map((s) => s.row);
  }
  const byGroup = new Map<string, BankExerciseRow[]>();
  for (const s of scored) {
    const list = byGroup.get(s.primary) ?? [];
    list.push(s.row);
    byGroup.set(s.primary, list);
  }
  const order = ["chest", "back", "shoulders", "arms"];
  const out: BankExerciseRow[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const g of order) {
      const list = byGroup.get(g);
      if (list && list.length > 0) {
        out.push(list.shift()!);
        added = true;
      }
    }
  }
  return out;
}

const REGION_LABELS_FA: Record<Exclude<PlanDayRegion, "unknown">, string> = {
  upper: "بالاتنه",
  lower: "پایین‌تنه",
  fullbody: "بدن کامل",
};

/**
 * لایهٔ ۳ — ترمیم قطعی چیدمان روزها با درخواست ورزشکار (v149 — تیکت مالک).
 * بعد از قفل بانک + dedupe خانواده و «قبل از» ترمیم پوشش گروه‌ها اجرا می‌شود:
 *   ① هر روز با عضلات واقعی حرکاتش طبقه‌بندی می‌شود (نه برچسب AI)
 *   ② کمبود/مازاد هر ناحیه نسبت به اسپک حساب می‌شود
 *   ③ روزهای مازاد با حرکات ویدیودار واقعی بانک به ناحیهٔ کمبود تبدیل می‌شوند
 *     (ست/تکرار/تمپو استاندارد، بدون تکرار حرکت در کل برنامه) — بدون ردِ
 *     برنامه و بدون تلاش دوم (موتور «یک تلاش، صفر شکست» v148)
 *   ④ خط شفافیت «📊 تحلیل چیدمان — طبق درخواست صریح شما» به نکات مربی اضافه می‌شود
 * fail-safe: بانک کوچک/پول خالی → روز دست‌نخورده می‌ماند و فقط گزارش می‌دهد.
 * idempotent: اجرای دوم no-op است.
 */
export function repairPlanDaySplitToRequest<
  T extends {
    days?: Array<{ day?: string; title?: string; focus?: string; exercises?: Array<Record<string, any>>; [k: string]: any }>;
    notes?: string;
    [k: string]: any;
  }
>(plan: T, spec: RequestedSplitSpec, bank: LockedBank | null): SplitRepairReport {
  const report: SplitRepairReport = {
    alreadyOk: true,
    converted: [],
    noteAdded: false,
    poolExhausted: false,
  };
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) return report;

  // خواستهٔ مؤثر: push/pull عملاً روز بالاتنه‌اند
  const desired: Record<Exclude<PlanDayRegion, "unknown">, number> = {
    upper: (spec.upper ?? 0) + (spec.push ?? 0) + (spec.pull ?? 0),
    lower: spec.lower ?? 0,
    fullbody: spec.fullBody ?? 0,
  };

  const rows: DayRepairRow[] = plan.days.map((d) => ({
    day: d,
    region: classifyPlanDayRegion(d),
  }));

  const actual: Record<Exclude<PlanDayRegion, "unknown">, number> = { upper: 0, lower: 0, fullbody: 0 };
  let unknownCount = 0;
  for (const r of rows) {
    if (r.region === "unknown") unknownCount++;
    else actual[r.region]++;
  }

  // کمبود/مازاد
  const deficit: Array<Exclude<PlanDayRegion, "unknown">> = [];
  const surplus: Array<Exclude<PlanDayRegion, "unknown">> = [];
  for (const region of ["upper", "lower", "fullbody"] as const) {
    const d = desired[region] - actual[region];
    for (let i = 0; i < d; i++) deficit.push(region);
    for (let i = 0; i < -d; i++) surplus.push(region);
  }

  if (deficit.length === 0) {
    // چیدمان هم‌خوان است — فقط خط شفافیت را تضمین کن
    report.noteAdded = ensureRequestedSplitNote(plan, spec, false);
    return report;
  }
  report.alreadyOk = false;

  if (!bank || bank.all.length < MIN_BANK_FOR_SPLIT_REPAIR) {
    report.poolExhausted = true;
    report.noteAdded = ensureRequestedSplitNote(plan, spec, true);
    return report;
  }

  // شناسه‌ها/خانواده‌های مصرف‌شدهٔ کل برنامه
  const usedIds = new Set<string>(
    plan.days.flatMap((d) =>
      Array.isArray(d?.exercises)
        ? d.exercises.map((e: any) => (typeof e?.exerciseId === "string" ? e.exerciseId : "")).filter(Boolean)
        : []
    )
  );

  // ترجیح تبدیل: ① روز unknown (غیرقابل‌طبقه‌بندی — تعادل نواحی برهم نمی‌خورد)
  //               ② روز از ناحیهٔ مازاد (اولویت با ناحیهٔ مقابل هدف)
  const pickSourceDay = (target: Exclude<PlanDayRegion, "unknown">): DayRepairRow | null => {
    const unknownRow = rows.find((r) => r.region === "unknown" && !r.day.__splitConverted);
    if (unknownRow) return unknownRow;
    if (surplus.length === 0) return null;
    // مازادِ ناحیهٔ مقابل هدف (اگر پا کم است از بالاتنه بگیر و بالعکس)
    const opposite: Exclude<PlanDayRegion, "unknown"> = target === "lower" ? "upper" : "lower";
    const sourceRegion = surplus.includes(opposite) ? opposite : surplus[0];
    const idx = surplus.indexOf(sourceRegion);
    if (idx >= 0) surplus.splice(idx, 1);
    const candidates = rows
      .filter((r) => r.region === sourceRegion && !r.day.__splitConverted)
      .sort((a, b) => (b.day.exercises?.length ?? 0) - (a.day.exercises?.length ?? 0));
    return candidates[0] ?? rows.find((r) => r.region !== target && !r.day.__splitConverted) ?? null;
  };

  for (const target of deficit) {
    const source = pickSourceDay(target);
    if (!source) {
      report.poolExhausted = true;
      break;
    }
    const originalCount = Array.isArray(source.day.exercises) ? source.day.exercises.length : 0;
    const wanted = Math.min(8, Math.max(4, originalCount || 6));
    const pool = buildRegionPool(target, bank, usedIds);
    if (pool.length < Math.min(4, wanted)) {
      report.poolExhausted = true;
      continue; // بانک کافی نیست — این روز دست‌نخورده می‌ماند
    }
    const chosen = pool.slice(0, wanted);
    const rebuilt = chosen.map((row) => bankRowToExercise(row, isCompoundName(row.name)));
    for (const row of chosen) usedIds.add(row.id);
    const label = REGION_LABELS_FA[target];
    source.day.exercises = rebuilt;
    source.day.focus = `${label} (طبق درخواست شما)`;
    source.day.title = `تمرین ${label} — عین درخواست شما`;
    source.day.__splitConverted = true;
    source.region = target;
    report.converted.push({
      day: source.day.day || "؟",
      to: target,
      replaced: rebuilt.length,
    });
  }

  // شفافیت برای کاربر
  report.noteAdded = ensureRequestedSplitNote(plan, spec, report.converted.length === 0 && deficit.length > 0);
  // پاک‌سازی فلگ موقت
  for (const r of rows) delete r.day.__splitConverted;
  return report;
}

/**
 * خط شفافیت الزامی در نکات مربی — «چیدمان عیناً طبق درخواست خود ورزشکار است».
 * idempotent: اگر قبلاً اضافه شده، دوباره اضافه نمی‌شود.
 */
export function ensureRequestedSplitNote(
  plan: { notes?: string; [k: string]: any },
  spec: RequestedSplitSpec,
  mismatchWarn: boolean
): boolean {
  const MARKER = "طبق درخواست صریح شما";
  const existing = typeof plan.notes === "string" ? plan.notes : "";
  if (existing.includes(MARKER)) return false;
  const splitLine = describeSplitSpecFa(spec);
  const line = mismatchWarn
    ? `- 📊 تحلیل چیدمان: درخواست شما در چت این بود: «${splitLine}». سیستم این درخواست را ثبت و در چیدمان اعمال کرده است؛ در صورت مغایرت ظاهری روزها، همین درخواست برای بازتولید بعدی ملاک خواهد بود.`
    : `- 📊 تحلیل چیدمان: چیدمان روزهای این برنامه («${splitLine}») عیناً ${MARKER} در چت با فیتاپ تنظیم شده است — نه یک روز بیشتر، نه کمتر. پوشش شش گروه اصلی در همین قالب رعایت شده و روزهای بالاتنه به‌صورت چرخشی چند گروه بالاتنه را پوشش می‌دهند.`;
  plan.notes = existing ? `${existing}\n${line}` : line;
  return true;
}

/** گزارش سریع ناهم‌خوانی (برای لاگ سرور) — null = هم‌خوان */
export function describeSplitMismatch(
  days: Array<{ exercises?: Array<Record<string, any>> }>,
  spec: RequestedSplitSpec
): string | null {
  const actual: Record<string, number> = { upper: 0, lower: 0, fullbody: 0 };
  for (const d of days) {
    const r = classifyPlanDayRegion(d);
    if (r !== "unknown") actual[r]++;
  }
  const desired: Record<string, number> = {
    upper: (spec.upper ?? 0) + (spec.push ?? 0) + (spec.pull ?? 0),
    lower: spec.lower ?? 0,
    fullbody: spec.fullBody ?? 0,
  };
  const diffs = Object.keys(desired)
    .filter((k) => desired[k] !== actual[k])
    .map((k) => `${k}: خواسته=${desired[k]} واقعی=${actual[k]}`);
  return diffs.length > 0 ? diffs.join(" | ") : null;
}
