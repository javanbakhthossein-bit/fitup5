/* ═══════════════════════════════════════════════════════════════════════════
 * v230 — ترمیم قطعی سوپرست/تری‌ست/جاینت‌ست ادغام‌شده
 *
 * باگ گزارش‌شدهٔ مالک (برنامهٔ حسین جوان): «حرکت اول روز اول سوپرست است ولی
 * در قالب مناسب سوپرست‌ها نیومده و هر دو در یک حرکت نوشته شده» — مدلِ مجری
 * دو حرکت سوپرست را در «یک» آبجکت با نام «سوپرست A — پرس سینه + بارفیکس» و
 * یک آرایهٔ sets برگردانده بود. UI فیتاپ از قبل قالب درست را پشتیبانی می‌کند
 * (supersetGroup + supersetType روی آبجکت‌های مجزا — workout-groups.ts)؛ این
 * ماژول خروجیِ ادغام‌شده را قطعی به همان قالب استاندارد تبدیل می‌کند:
 *   • هر عضو = آبجکت مستقل با name/muscle/sets خودش
 *   • supersetGroup یکسان روی اعضا (حرف آزادِ بعدی روز)
 *   • supersetType بر اساس تعداد اعضا (۲=superset، ۳=triset، ۴+=giant)
 *   • restSec اعضا ۰ (به‌جز عضو آخر که استراحت گروه را حمل می‌کند —
 *     قرارداد groupRoundRestSec در workout-groups.ts)
 *   • circuitRounds/restBetweenRounds حفظ می‌شود
 * هرگز throw نمی‌کند؛ ورودی نامعتبر دست‌نخورده برمی‌گردد.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** پیشوند گروهی که مدل گاهی اول نام می‌گذارد: «سوپرست A — …» / «ترای‌ست: …» */
const GROUP_PREFIX_RE =
  /^(سوپرست|سوپر ست|تری\s*ست|تری‌ست|ترای‌?ست|جاینت\s*ست|جاینت‌ست|جاینت‌ست)\s*([A-Za-zآ-ی]?[۰-۹0-9]?)\s*[—–:\-]\s*/;

export interface MergedSupersetReport {
  splitCount: number;
  details: Array<{ day: string; from: string; to: string[]; group: string; type: string }>;
}

/** نام‌های عضو را از نام ادغام‌شده بیرون می‌کشد — جداکنندهٔ مطمئن فقط «+» است */
function splitMemberNames(mergedName: string, hadPrefix: boolean): string[] {
  let body = mergedName;
  if (hadPrefix) body = body.replace(GROUP_PREFIX_RE, "");
  // فقط «+» جداکنندهٔ معتبر نام دو حرکت است (جداسازی با «و» ریسکِ خراب‌کردن
  // نام‌های طبیعی مثل «سینه و مرکز» را دارد — محافظه‌کار می‌مانیم)
  const parts = body
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

/**
 * v230.1 — نرمال‌سازی قرارداد استراحت گروه‌های سوپرست (درجا، mutating).
 * قرارداد workout-groups.ts (groupRoundRestSec): استراحتِ پس از هر دورِ گروه =
 * restSecِ «ستِ همان شماره» روی «عضو آخر» خوانده می‌شود (یا restBetweenRounds).
 * پس عضو آخر باید استراحت گروه را روی «همهٔ» ست‌هایش حمل کند (استراحت بعد از هر
 * دور — الگوی غالب ۱۱۴ گروه فعال برنامه‌های واقعی) و بقیهٔ اعضا صفر. اگر کل گروه استراحت ۰ دارد، دست نمی‌زنیم
 * (هرگز استراحت از خودِ مدل اختراع نمی‌کنیم). تعداد سلول‌های اصلاح‌شده برمی‌گردد.
 */
export function normalizeSupersetRestContract(parsed: {
  days?: Array<Record<string, any>>;
}): number {
  let fixed = 0;
  if (!parsed || !Array.isArray(parsed.days)) return fixed;
  for (const day of parsed.days) {
    if (!day || !Array.isArray(day.exercises)) continue;
    const groups = new Map<string, any[]>();
    for (const ex of day.exercises) {
      const g = String(ex?.supersetGroup ?? "").trim();
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      (groups.get(g) as any[]).push(ex);
    }
    for (const members of groups.values()) {
      if (!members || members.length < 2) continue;
      // استراحت واقعی گروه: restBetweenRounds (قرارداد جاینت‌ست) یا بیشینهٔ
      // restSec ست‌های اعضا — هرگز مقدار جدید اختراع نمی‌شود
      let groupRest = 0;
      for (const m of members) {
        if (typeof m?.restBetweenRounds === "number" && m.restBetweenRounds > 0) {
          groupRest = Math.max(groupRest, m.restBetweenRounds);
          continue;
        }
        const sets = Array.isArray(m?.sets) ? m.sets : [];
        for (const s of sets) {
          const r = Number(s?.restSec ?? 0);
          if (Number.isFinite(r) && r > groupRest) groupRest = r;
        }
      }
      if (groupRest <= 0) continue;
      const last = members[members.length - 1];
      for (const m of members) {
        const sets = Array.isArray(m?.sets) ? m.sets : [];
        for (const s of sets) {
          if (!s || typeof s !== "object") continue;
          const want = m === last ? groupRest : 0;
          const cur = Number(s?.restSec ?? 0);
          if (cur !== want) {
            s.restSec = want;
            fixed += 1;
          }
        }
      }
    }
  }
  return fixed;
}

function nextFreeGroupLetter(existing: Set<string>): string {
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (!existing.has(ch)) return ch;
  }
  return `G${existing.size + 1}`;
}

/**
 * v230.3 — ترمیم استراحتِ قربانیانِ حذف/برش (بعد از پاکسازی یتیم‌های L3).
 *
 * حذفِ بی‌جایگزینِ عضوِ ناقلِ استراحت گروه (v149 وقتی بانک جایگزین ندارد) یا
 * برشِ انتهاییِ سقف تعداد حرکت (v183 — slice انتها) پس از normalizeSupersetRestContract
 * می‌تواند گروه یا تک‌حرکتی با «صفرِ کاملِ» استراحت باقی بگذارد (تایمر استراحت UI
 * صفر می‌شود — تجربهٔ خراب). جایگزینی (با spread ست‌ها) قرارداد را حفظ می‌کند و
 * قربانی نیست؛ فقط قربانیِ واقعی ترمیم می‌شود:
 *  • گروهِ ≥۲ عضوی که «همهٔ» اعضایش صفر است و restBetweenRounds/circuitRounds ندارد
 *    → استراحت ۹۰ ثانیه روی «همهٔ» ست‌های عضو آخر (قرارداد groupRoundRestSec —
 *    الگوی غالب ۱۱۴ گروه فعالِ برنامه‌های واقعی).
 *  • تک‌حرکتِ عادیِ خارج از گروه با صفرِ کامل → ۷۵ ثانیه (همان قراردادِ پیش‌فرضِ
 *    padWorkoutDayToMinExercises) — مدارِ واقعی (circuitRounds) هرگز لمس نمی‌شود.
 *  • عضوِ گروهی که supersetType ندارد → از شمار اعضای گروه همان روز پیش‌فرض می‌گیرد
 *    (وگرنه UI آن را تک‌حرکت رندر می‌کند در حالی که نرمال‌ساز استراحتش را صفر کرده).
 * هرگز throw نمی‌کند؛ شمار ترمیم‌ها برمی‌گردد.
 */
export function healPostTrimGroupContracts(parsed: {
  days?: Array<Record<string, any>>;
}): { groupsHealed: number; singlesHealed: number; typesDefaulted: number } {
  const result = { groupsHealed: 0, singlesHealed: 0, typesDefaulted: 0 };
  if (!parsed || !Array.isArray(parsed.days)) return result;
  const maxRestOf = (ex: any): number => {
    const sets = Array.isArray(ex?.sets) ? ex.sets : [];
    let mx = 0;
    for (const s of sets) {
      const r = Number(s?.restSec ?? 0);
      if (Number.isFinite(r) && r > mx) mx = r;
    }
    return mx;
  };
  for (const day of parsed.days) {
    if (!day || !Array.isArray(day.exercises)) continue;
    const groups = new Map<string, any[]>();
    for (const ex of day.exercises) {
      const g = String(ex?.supersetGroup ?? "").trim();
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      (groups.get(g) as any[]).push(ex);
    }
    for (const members of groups.values()) {
      if (!members || members.length < 2) continue;
      // پیش‌فرض نوع برای اعضای بدون نوع (رندر تک‌حرکتی + استراحت صفر را می‌کشد)
      const type = groupTypeFor(members.length);
      for (const m of members) {
        if (m && typeof m === "object" && !m.supersetType) {
          m.supersetType = type;
          result.typesDefaulted += 1;
        }
      }
      // گروهِ سالمِ با استراحت دور (restBetweenRounds) دست‌نخورده می‌ماند
      const hasRoundRest = members.some(
        (m) => typeof m?.restBetweenRounds === "number" && m.restBetweenRounds > 0
      );
      if (hasRoundRest) continue;
      if (members.some((m) => maxRestOf(m) > 0)) continue; // قرارداد سالم است
      const last = members[members.length - 1];
      const sets = Array.isArray(last?.sets) ? last.sets : [];
      if (sets.length === 0) continue;
      for (const s of sets) {
        if (s && typeof s === "object") s.restSec = 90;
      }
      result.groupsHealed += 1;
    }
    for (const ex of day.exercises) {
      if (!ex || typeof ex !== "object") continue;
      if (ex.supersetGroup) continue; // عضو گروه — در حلقهٔ بالا رسیدگی شد
      if (typeof ex.circuitRounds === "number" && ex.circuitRounds > 0) continue;
      if (maxRestOf(ex) > 0) continue; // استراحت دارد — سالم
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      if (sets.length === 0) continue;
      for (const s of sets) {
        if (s && typeof s === "object") s.restSec = 75;
      }
      result.singlesHealed += 1;
    }
  }
  return result;
}

function groupTypeFor(count: number): "superset" | "triset" | "giant" {
  if (count >= 4) return "giant";
  if (count === 3) return "triset";
  return "superset";
}

/**
 * تشخیص و جداسازی سوپرست‌های ادغام‌شده در کل برنامه — درجا (mutating).
 * شرط تشخیص محافظه‌کارانه است تا هرگز حرکت سالمِ عجیب‌نام را خراب نکند:
 *   ۱) نام با پیشوند گروهی شروع شود («سوپرست A — X + Y») و جداکنندهٔ «+» داشته باشد، یا
 *   ۲) نام جداکنندهٔ «+» داشته باشد و عضله جداکنندهٔ «/» (دو عضلهٔ متفاوت) —
 *      الگوی مشترک خروجی ادغام‌شدهٔ مدل.
 */
export function splitMergedSupersetEntries(parsed: {
  days?: Array<Record<string, any>>;
}): MergedSupersetReport {
  const report: MergedSupersetReport = { splitCount: 0, details: [] };
  if (!parsed || !Array.isArray(parsed.days)) return report;

  for (const day of parsed.days) {
    if (!day || !Array.isArray(day.exercises)) continue;
    const dayLabel = String(day.day ?? "?");
    const usedLetters = new Set<string>(
      day.exercises
        .map((e: any) => String(e?.supersetGroup ?? "").trim())
        .filter(Boolean)
    );

    const rebuilt: any[] = [];
    for (const ex of day.exercises) {
      if (!ex || typeof ex.name !== "string") {
        rebuilt.push(ex);
        continue;
      }
      const name = ex.name;
      const prefixMatch = name.match(GROUP_PREFIX_RE);
      const hadPrefix = !!prefixMatch;
      const muscleText = String(ex.muscle ?? "");
      const hasPlusInName = /\s\+\s|\+/.test(name.replace(GROUP_PREFIX_RE, ""));
      const hasSlashInMuscle = /\s*\/\s*/.test(muscleText) && muscleText.includes("/") && muscleText.split("/").length >= 2;

      const looksMerged =
        (hadPrefix && hasPlusInName) || (!hadPrefix && hasPlusInName && hasSlashInMuscle);
      if (!looksMerged) {
        rebuilt.push(ex);
        continue;
      }

      const memberNames = splitMemberNames(name, hadPrefix);
      // جداسازی فقط وقتی معنا دارد که حداقل دو نام بادوام بیرون بیاید
      if (memberNames.length < 2 || memberNames.some((n) => n.length < 3)) {
        rebuilt.push(ex);
        continue;
      }

      // عضلات: اگر شمار عضله‌ها با اعضا یکی است یکی می‌دهیم؛ وگرنه کل متن برای همه
      const muscleParts = hasSlashInMuscle
        ? muscleText.split("/").map((s) => s.trim()).filter(Boolean)
        : [];
      const type = groupTypeFor(memberNames.length);
      // v230.2 — برخورد حرف: اگر مدل با پیشوند «A» صادر کرده ولی «A» در همین
      // روز به گروه مستقل دیگری تعلق دارد، اعتماد کورکورانه به حرف پیشوندی دو
      // گروهِ متمایز را در groupExercises ادغام می‌کند (و نرمال‌ساز استراحتِ
      // گروه قبلی را صفر می‌کند) → در برخورد، نخستین حرفِ آزاد روز تخصیص می‌یابد.
      const prefixLetter =
        hadPrefix && prefixMatch?.[2] && /^[A-Za-z]$/.test(prefixMatch[2])
          ? prefixMatch[2].toUpperCase()
          : null;
      const letter =
        prefixLetter && !usedLetters.has(prefixLetter)
          ? prefixLetter
          : nextFreeGroupLetter(usedLetters);
      usedLetters.add(letter);

      const n = memberNames.length;
      const baseSets = Array.isArray(ex.sets) ? ex.sets : [];
      // استراحت گروه برای مسیر split: بیشینهٔ restSec ست‌های ورودی (هرگز اختراع نمی‌شود)
      const splitGroupRest = baseSets.reduce(
        (mx: number, s: any) => Math.max(mx, Number(s?.restSec ?? 0) || 0),
        0
      );
      const circuitRounds = typeof ex.circuitRounds === "number" ? ex.circuitRounds : undefined;
      const restBetweenRounds = typeof ex.restBetweenRounds === "number" ? ex.restBetweenRounds : undefined;

      const members = memberNames.map((memberName, mi) => {
        const isLast = mi === n - 1;
        // عضو آخر استراحت گروه را روی «همهٔ» ست‌هایش حمل می‌کند (قرارداد
        // groupRoundRestSec — استراحت پس از هر دور)؛ بقیهٔ اعضا صفر
        return {
          ...ex,
          name: memberName,
          muscle: muscleParts.length === n ? muscleParts[mi] : muscleText || undefined,
          sets: baseSets.map((s: any) => ({
            ...s,
            restSec: isLast ? splitGroupRest : 0,
          })),
          supersetGroup: letter,
          supersetType: type,
          ...(circuitRounds != null ? { circuitRounds } : {}),
          ...(restBetweenRounds != null ? { restBetweenRounds } : {}),
          // توضیحاتِ اصلیِ ورودیِ ادغام‌شده مالِ عضو اول است (مثلاً پرس سینه)؛
          // عضوهای بعدی توضیح سبک می‌گیرند — قفل بانک بعداً توضیح/ویدیوی واقعی
          // همان حرکت را الصاق می‌کند.
          ...(mi === 0
            ? {}
            : {
                description:
                  "بدون استراحت بعد از حرکت قبلی گروه اجرا شود — کنترل کامل و دامنهٔ حرکتی کامل.",
                coachTip:
                  "عضو گروه سوپرست — بلافاصله بعد از حرکت قبلی، بدون استراحت.",
              }),
        };
      });

      rebuilt.push(...members);
      report.splitCount += 1;
      report.details.push({
        day: dayLabel,
        from: name,
        to: memberNames,
        group: letter,
        type,
      });
    }
    day.exercises = rebuilt;
  }
  return report;
}
