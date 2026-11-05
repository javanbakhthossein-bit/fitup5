/**
 * ─────────────────────────────────────────────────────────────────────────
 * v238 — بلوپرینت تجویزی مدیر (Admin-Prescribed Blueprint)
 * ─────────────────────────────────────────────────────────────────────────
 * تیکت/شکایت مصطفی خوشبخت (2026-10-13): مدیر عین درخواست کاربر (چیدمان
 * روزبه‌روز «شنبه: سینه+زیربغل / دوشنبه: پا / سه‌شنبه: سرشانه+بازو /
 * چهارشنبه: پشت+پشت‌بازو») را در باکس بازنویسی کپی کرد ولی برنامهٔ نهایی
 * دوباره ۲ روز پا داد. ریشه: دستور مدیر (v150) فقط «متن پرامپت + استخراج
 * ممنوعیت‌ها» بود و هرگز به اسپک ساختاری تبدیل نمی‌شد → بلوپرینت خودکار
 * (Upper/Lower ۲روز پا) مسلح می‌ماند و پلیس معماری (v213) روزِ چهارم را
 * حتی وقتی مدل درست ساخته بود به‌زور پایین‌تنه می‌کرد.
 *
 * راه‌حل v238 (این ماژول):
 *   اگر متن دستور مدیر «چیدمان روزبه‌روز» صریح داشته باشد (خط‌های کلید‌شده
 *   با نام روز هفته)، همان متن به یک CoachBlueprint واقعی تبدیل می‌شود و
 *   جای بلوپرینت خودکار می‌نشیند — در نتیجه:
 *     • دیرکتیو پرامپت (buildBlueprintDirectiveFa) عین تجویز مدیر را می‌گوید
 *     • پلیس هویت روز (v213) حرکت خارج از تجویز را تعویض/حذف می‌کند
 *     • پلیس عنوان روز (v230) عنوان‌ها را با تجویز هم‌راستا می‌کند
 *     • گیت‌های L4 (انطباق معماری + سقف فرکانس v237) با تجویز ممیزی می‌کنند
 *     • snapshot برنامه (coachBlueprint) = تجویز مدیر → شفاف برای ادمین
 *
 * ⚠️ ضد-دام (بسیار مهم): متن مدیر درخواست‌های شماره‌دار هم دارد مثل
 *   «۱) برنامهٔ فعلی ۳ روز پا داره (دوشنبه، سه‌شنبه، چهارشنبه)...» — این
 *   «شرح وضعیت فعلی» است نه درخواست! قواعد پارسر:
 *   ① فقط خط‌هایی که با «نام روز هفته» شروع می‌شوند (بعد از بولت اختیاری)
 *      چیدمان حساب می‌شوند؛ خط شروع‌شده با شماره/enumerator هرگز.
 *   ② از هر خط فقط تکهٔ «بعد از روز و قبل از روز بعدی» پارس می‌شود.
 *   ③ حداقل ۳ روزِ معتبر (روز + حداقل یک عضلهٔ شناخته‌شده) — وگرنه null
 *      (رفتار قبلی: فقط پرامپت).
 * خالص و بدون I/O — قابل تست واحد. هرگز throw نمی‌کند.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  type BlueprintDay,
  type BpMuscle,
  type CoachBlueprint,
} from "./coach-blueprint";

/* ───────────────────────── روزهای هفته ───────────────────────── */

/** واریانت‌های نگارشی روزها — طولانی‌تر اول (پنجشنبه قبل از شنبه!) */
const WEEKDAY_VARIANTS: Array<{ canonical: string; re: RegExp }> = [
  { canonical: "پنجشنبه", re: /پنج\s*[‌\s]?شنبه/ },
  { canonical: "چهارشنبه", re: /چهار\s*[‌\s]?شنبه/ },
  { canonical: "سه‌شنبه", re: /سه\s*[‌\s]?شنبه/ },
  { canonical: "دوشنبه", re: /دو\s*[‌\s]?شنبه/ },
  { canonical: "یکشنبه", re: /یک\s*[‌\s]?شنبه/ },
  { canonical: "جمعه", re: /جمعه/ },
  { canonical: "شنبه", re: /شنبه/ },
];

/** خط‌های شمارهدار (۱) / 1) / ۱. / 1. / ۱-) — هرگز چیدمان نیستند (ضد-دام) */
const ENUMERATOR_PREFIX = /^\s*(?:[-•*▪◦–—]\s*)?(?:[۰-۹0-9]+|[۱-۹]+)\s*[-)）.،:؛]/;

/** بولت ساده که روز می‌تواند بعدش بیاید */
const BULLET_PREFIX = /^\s*[-•*▪◦–—]\s*/;

/* ───────────────────────── واژگان عضلانی ───────────────────────── */

/**
 * الگوهای عضله — ترتیب مهم است: «پشت بازو» قبل از «پشت»، «پایین‌تنه» قبل از «پا».
 * هر الگو از متن حذف می‌شود تا دوباره مچ نشود.
 */
const MUSCLE_PATTERNS: Array<{ muscle: BpMuscle; re: RegExp }> = [
  { muscle: "پشت بازو", re: /پشت\s*[‌\s]?بازو|پشت‌بازو|ترای\b|تریسپس?/i },
  { muscle: "جلو بازو", re: /جلو\s*[‌\s]?بازو|جلوبازو|بایسپس?/i },
  { muscle: "سرشانه", re: /سر\s*[‌\s]?شانه|شانه(?!‌?[سه])/i },
  { muscle: "سینه", re: /سینه|چست\b|پک\b/i },
  { muscle: "زیربغل/پشت", re: /زیربغل|کول|لت\b|پشت(?!‌?\s?(?:پا|ران))/i },
  { muscle: "پشت پا", re: /پشت\s*[‌\s]?پا|همسترینگ|پشت\s*[‌\s]?ران|هامسترینگ/i },
  { muscle: "چهارسر", re: /چهار\s*[‌\s]?سر|کوادرِ?س|کواد\b|جلو\s*[‌\s]?ران/i },
  { muscle: "باسن", re: /باسن|سرینی|گلوت|گیلوت/i },
  { muscle: "ساق", re: /ساق/i },
  { muscle: "پشت پا", re: /پا\b|پاها|پایین\s*[‌\s]?تنه|پایتنه|اندام\s*تحت|لگن/i },
  { muscle: "شکم و مرکز", re: /شکم|مرکز\s*(?:بدن)?|کور\b|اب\s*دامن|اب‌دامن|کاردیو\s*شکم/i },
  { muscle: "هوازی", re: /کاردیو|هوازی|تردمیل|دوی|دویدن|الپتیکال/i },
];

/** «بازو» تنها = هر دو سر بازو (جلو+پشت) */
const BARE_ARM_RE = /(?:^|[^\u0600-\u06FF])بازو(?:s)?(?=$|[^\u0600-\u06FF])/;

/* ───────────────────────── پارس خط ───────────────────────── */

interface ParsedLayoutDay {
  day: string;
  groups: BpMuscle[];
}

/** یافتن اولین روز هفته در متن؛ خروجی = ایندکس شروع/پایان مچ + نام کانونیک */
function findWeekday(text: string): { canonical: string; start: number; end: number } | null {
  let best: { canonical: string; start: number; end: number } | null = null;
  for (const v of WEEKDAY_VARIANTS) {
    const m = v.re.exec(text);
    if (!m) continue;
    const hit = { canonical: v.canonical, start: m.index, end: m.index + m[0].length };
    // اولین (چپ‌ترین) روز؛ تساوی مکان = واریانت طولانی‌تر (الگوها به ترتیب طول‌اند)
    if (!best || hit.start < best.start) best = hit;
  }
  return best;
}

/** استخراج عضلات از تکهٔ متن — هر الگو فقط اولین مچ */
function extractGroups(segment: string): BpMuscle[] {
  const groups: BpMuscle[] = [];
  let rest = segment;
  let bareArm = false;
  for (const p of MUSCLE_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    const m = re.exec(rest);
    if (m) {
      if (!groups.includes(p.muscle)) groups.push(p.muscle);
      // حذف مچ تا «پشت بازو» دوباره «پشت» را مچ نکند
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    }
  }
  if (BARE_ARM_RE.test(rest)) bareArm = true;
  if (bareArm) {
    for (const m of ["جلو بازو", "پشت بازو"] as BpMuscle[]) {
      if (!groups.includes(m)) groups.push(m);
    }
  }
  return groups;
}

/** پارس چیدمان روزبه‌روز از متن مدیر — null = چیدمان صریح در متن نیست */
export function parseAdminPrescribedDayLayout(raw: string): ParsedLayoutDay[] | null {
  try {
    if (!raw || raw.length < 8) return null;
    const lines = String(raw)
      .split(/[\n\r]+|(?:؛)/)
      .map((l) => String(l ?? "").trim())
      .filter((l) => l.length >= 3);

    const days: ParsedLayoutDay[] = [];
    for (const line of lines) {
      // ① ضدام: خط شمارهدار هرگز چیدمان نیست («۱) برنامهٔ فعلی ۳ روز پا داره…»)
      if (ENUMERATOR_PREFIX.test(line)) continue;
      const body = line.replace(BULLET_PREFIX, "").trim();
      // ② روز باید «دقیقاً ابتدای خط» باشد (بعد از بولت) — خط‌های پروس‌وار مثل
      //    «۲) روز سه‌شنبه از پا به سرشانه تغییر کنه» یا «شنبه‌ها…» هرگز چیدمان
      //    نیستند (ضد-دام دوم — آلودگی عضلانی خط‌های توضیحی)
      const head = body.slice(0, 14);
      const wd = findWeekday(head);
      if (!wd || wd.start !== 0) continue;
      const afterHead = body.slice(wd.end);
      // ③ از هر خط فقط تا «روز بعدی» پارس می‌شود (خط‌های چندروزی نادر — محافظه‌کار)
      const nextWd = findWeekday(afterHead);
      const segment = nextWd && nextWd.start >= 0 ? afterHead.slice(0, nextWd.start) : afterHead;
      // ④ جداکنندهٔ روز: اگر بلافاصله بعد از روز «:» یا «-»/«→»/«=» نیامد و
      //    بقیهٔ خط بلافاصله عضله هم ندارد، شاید روز فقط در جملهٔ عادی آمده —
      //    محافظه‌کار: جداکننده یا شروع متن عضله لازم است.
      const sep = /^\s*[:：\-–—=→»)]?\s*/.exec(segment);
      const segmentBody = segment.slice(sep ? sep[0].length : 0);
      const groups = extractGroups(segmentBody);
      if (groups.length === 0) continue;
      const existing = days.find((d) => d.day === wd.canonical);
      if (existing) {
        for (const g of groups) if (!existing.groups.includes(g)) existing.groups.push(g);
      } else {
        days.push({ day: wd.canonical, groups });
      }
    }

    // ⑤ حداقل ۳ روز معتبر — «شنبه پا هم بود» تنها = چیدمان نیست
    if (days.length < 3) return null;
    return days;
  } catch {
    return null; // قرارداد: هرگز نمی‌شکند
  }
}

/* ───────────────────────── ساخت بلوپرینت تجویزی ───────────────────────── */

/** عضلات «کمکی» که به‌جای primary در secondary می‌نشینند */
const ACCESSORY_MUSCLES = new Set<BpMuscle>(["شکم و مرکز", "هوازی"]);

/** روزِ پا = کامل (چهارسر/پشت‌پا/باسن اصلی + ساق/مرکز مکمل) مگر عضلهٔ صریح دیگر */
function buildLegDayGroups(explicit: BpMuscle[]): { primary: BpMuscle[]; secondary: BpMuscle[] } {
  const legSpecific = explicit.filter((m) =>
    m === "چهارسر" || m === "پشت پا" || m === "باسن" || m === "ساق"
  );
  const primary: BpMuscle[] = legSpecific.length > 0
    ? legSpecific.filter((m) => m !== "ساق")
    : ["چهارسر", "پشت پا", "باسن"];
  if (legSpecific.includes("ساق")) primary.push("ساق");
  const secondary: BpMuscle[] = explicit.filter((m) => ACCESSORY_MUSCLES.has(m));
  if (!secondary.includes("شکم و مرکز")) secondary.push("شکم و مرکز");
  if (!primary.includes("پشت پا") && !primary.includes("چهارسر")) {
    primary.unshift("چهارسر"); // حفاظت: روز پا بدون هیچ عضلهٔ بزرگ ممنوع
  }
  return { primary, secondary };
}

/** بودجهٔ ست هفتهٔ هر عضله بر اساس تعداد روزهای ظهورش در تجویز */
function buildWeeklySets(days: ParsedLayoutDay[]): CoachBlueprint["weeklySets"] {
  const seen = new Map<BpMuscle, number>();
  for (const d of days) {
    for (const g of d.groups) seen.set(g, (seen.get(g) ?? 0) + 1);
  }
  const out: CoachBlueprint["weeklySets"] = [];
  for (const [muscle, freq] of seen) {
    const big = muscle === "سینه" || muscle === "زیربغل/پشت" || muscle === "چهارسر" || muscle === "پشت پا";
    out.push({
      muscle,
      min: big ? 6 : 3,
      max: big ? 14 : 9,
      frequency: freq,
      priority: false,
    });
  }
  return out;
}

export interface PrescribedBlueprintResult {
  blueprint: CoachBlueprint;
  /** پارس خام برای لاگ/تست — «شنبه=[سینه، زیربغل/پشت]…» */
  daysParsed: Array<{ day: string; groups: BpMuscle[] }>;
}

/**
 * متن دستور مدیر → بلوپرینت تجویزی (یا null اگر چیدمان صریح روزبه‌روز در متن نباشد).
 * بلوپرینت خروجی دقیقاً همان قراردادی است که همهٔ پلیس‌ها/گیت‌های v213/v230/v237 می‌خوانند.
 */
export function buildAdminPrescribedBlueprintFromText(raw: string): PrescribedBlueprintResult | null {
  const days = parseAdminPrescribedDayLayout(raw);
  if (!days || days.length < 3) return null;

  const bpDays: BlueprintDay[] = days.map((d) => {
    const main = d.groups.filter((g) => !ACCESSORY_MUSCLES.has(g));
    const isLegDay = d.groups.includes("پشت پا") || d.groups.includes("چهارسر") || d.groups.includes("باسن") || d.groups.includes("ساق");
    let primary: BpMuscle[];
    let secondary: BpMuscle[];
    if (isLegDay && main.length <= 1) {
      // «پا» تنها → روز پا کامل استاندارد (عین درخواست «پا کامل» کاربر)
      const built = buildLegDayGroups(d.groups);
      primary = built.primary;
      secondary = built.secondary;
    } else {
      primary = main.length > 0 ? main : d.groups;
      secondary = d.groups.filter((g) => ACCESSORY_MUSCLES.has(g) && !primary.includes(g));
    }
    const titleFa = primary.join(" + ");
    return {
      day: d.day,
      title: titleFa,
      primary,
      secondary,
      rationale: `چیدمان تجویزی مدیر فیتاپ (v238) — عین دستور صریح: روز ${d.day} = ${d.groups.join(" + ")}`,
    };
  });

  const label = bpDays.map((d) => `${d.day}: ${d.title}`).join(" / ");
  const blueprint: CoachBlueprint = {
    splitId: "admin_prescribed",
    splitLabelFa: `تجویز صریح مدیر فیتاپ — ${label}`,
    coachModelFa: "دستور صریح مدیر فیتاپ (v238) — معماری عیناً طبق تجویز روزبه‌روز؛ هیچ بلوپرینت خودکاری جای آن را نمی‌گیرد",
    coachKey: "mixed",
    days: bpDays,
    weeklySets: buildWeeklySets(days),
    periodizationHint: "linear",
    executionNotes: [
      "چیدمان روزها و عضلاتِ هر روز عیناً طبق تجویز مدیر است؛ ترتیب حرکات داخل روز: عضلهٔ اصلی اول، مکمل آخر.",
      "ایمنی مطلق (ممنوعیت‌های پزشکی/آسیب/BMI) بر تجویز مقدم است؛ جایگزین امن از همان عضلهٔ تجویزشده انتخاب می‌شود.",
    ],
    rationaleLines: [
      "v238 — بلوپرینت از «چیدمان روزبه‌روزِ صریح» در دستور مدیر ساخته شد (تیکت مصطفی خوشبخت: بازنویسی دوباره ۲ روز پا داده بود).",
      "پلیس هویت روز/عنوان و گیت سقف فرکانس اکنون همین تجویز را اجرا و ممیزی می‌کنند.",
    ],
  };
  return { blueprint, daysParsed: days };
}
