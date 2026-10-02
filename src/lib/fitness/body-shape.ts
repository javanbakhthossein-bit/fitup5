/**
 * v170 — فرم بدن (Body Shape) — کانفیگ مشترک + موتور سیلیوئت «چارت کلاسیک»
 *
 * دیرکتیو مالک: «سیلوئت‌های قبلی عجیب‌غریب بودند؛ یک فرم بدن خوشگل و یکدست لازم است.»
 *
 * راه‌حل نهایی: به‌جای هندسهٔ دست‌ساز، از چارت کلاسیک و شناخته‌شدهٔ فرم بدن
 * (Bodyshapes.svg — ویکی‌مدیا کامانز، Public Domain) به‌عنوان مبنای بصری استفاده شد.
 * ۴ فیگور پایه (مستطیل/بیضی/پیر/ساعت‌شنی) استخراج و نرمال شدند (body-shape-base.ts)
 * و ۱۲ ترکیب نهایی (۶ فرم × ۲ جنسیت) با «مورف ناحیه‌ای» ساخته می‌شوند:
 *
 *  - هر نقطهٔ مسیر بر حسب ارتفاعش (y) با ضریب k(y) افقی جابه‌جا می‌شود
 *  - نواحی: شانه (62) → سینه (92) → کمر (140) → باسن (172) → ران (232) → کف پا (300)
 *  - سر و صورت (y<46) هرگز تغییر نمی‌کند — فقط تنه پارامتریک است
 *  - نسخهٔ مردانه = مورف قوی‌تر (شانه‌پهن/لگن‌باریک) + موی کوتاه هم‌سبک
 *
 * نتیجه: یک خانوادهٔ بصری کاملاً یکدست با آناتومی چارت کلاسیک (دست‌ها روی کمر،
 * ایستادهٔ روبه‌رو) که کاربر بلافاصله آن را «چارت فرم بدن» تشخیص می‌دهد.
 */
import type { BodyShapeKey, Gender } from "./types";
import { FEMALE_BASE, MALE_HAIR_PATH, type BodyShapeBaseKey } from "./body-shape-base";

export interface BodyShapeInfo {
  id: BodyShapeKey;
  label: string;
  /** توضیح کوتاه زیر کارت */
  desc: string;
  /** ویژگی تمرینی — به هوش مصنوعی تزریق می‌شود (اولویت توازن نسبت‌های بدنی) */
  focus: string;
}

export const BODY_SHAPES: BodyShapeInfo[] = [
  {
    id: "pear",
    label: "مثلث (پیر)",
    desc: "پایین‌تنه پهن‌تر، بالاتنه کوچک‌تر",
    focus:
      "پایین‌تنه پهن و بالاتنه کوچک — برای توازن نسبت‌ها، حجم و تأکید تمرینی بالاتنه (سرشانه، سینه، زیربغل و بازو) بالاتر می‌رود و پایین‌تنه با تمرین قدرتی و کالری‌سوز متعادل می‌شود.",
  },
  {
    id: "inverted_triangle",
    label: "مثلث معکوس",
    desc: "بالاتنه پهن‌تر، پایین‌تنه باریک‌تر",
    focus:
      "بالاتنه پهن و پایین‌تنه باریک — برای توازن نسبت‌ها، تأکید اصلی روی ران/باسن و پا (اسکوات، لانژ، hip hinge) و خنثی‌کردن اضافه‌حجم بالاتنه است.",
  },
  {
    id: "rectangle",
    label: "مستطیل",
    desc: "شانه و لگن هم‌عرض، کمر کم‌قوس",
    focus:
      "فرم مستقیم با اختلاف کم شانه/کمر/لگن — هدف اصلی ساخت حجم کلی و شکل‌دهی (شانه‌سازی، زیربغل پهن، باسن و سرشانه) تا دایره‌های بدن ایجاد شود.",
  },
  {
    id: "hourglass",
    label: "ساعت شنی",
    desc: "بالا و پایین هماهنگ، کمر باریک",
    focus:
      "شانه و لگن هماهنگ با کمر باریک — تمرین متوازن کل بدن با تقویت متعادل؛ تمرکز روی حفظ نسبت طلایی و قدرت پایه است.",
  },
  {
    id: "oval",
    label: "بیضی (سیب)",
    desc: "حجم بیشتر در میانهٔ بدن",
    focus:
      "تجمع چربی بیشتر در میانه (شکم/پهلو) — اولویت با کالری‌سوز، هوازی و مرکز بدن (core) به‌همراه تمرین قدرتی تمام‌بدن برای بهبود نسبت کمر به قد است.",
  },
  {
    id: "athletic",
    label: "ورزشی",
    desc: "شانه‌های نسبتاً پهن، فرم متوازن",
    focus:
      "فرم ورزشی با V-taper ملایم — تمرین پیشرفته‌تر با تأکید نقاط ضعف جزئی و حفظ تقارن؛ حجم‌دهی هدفمند به‌جای تغییر کلی فرم.",
  },
];

export const BODY_SHAPE_INFO: Record<BodyShapeKey, BodyShapeInfo> = Object.fromEntries(
  BODY_SHAPES.map((s) => [s.id, s])
) as Record<BodyShapeKey, BodyShapeInfo>;

/* ─────────────────────────  موتور مورف ناحیه‌ای  ───────────────────────── */

interface BodyMorph {
  base: BodyShapeBaseKey;
  /** ضریب عرض شانه (deltoid) */
  ks: number;
  /** ضریب عرض کمر */
  kw: number;
  /** ضریب عرض باسن */
  kh: number;
  /** ضریب عرض ران */
  kt: number;
  /** موی کوتاه مردانه (جایگزین موی بلند چارت) */
  maleHair?: boolean;
}

/** y-های لنگر ناحیه‌ها در فضای نرمال (ارتفاع ۳۰۰) */
const Y_SHOULDER = 62;
const Y_CHEST = 92;
const Y_WAIST = 140;
const Y_HIP = 172;
const Y_THIGH = 232;
const Y_HEAD_END = 46; // تا اینجا (سر/صورت/نیم‌بالای گردن) هیچ تغییری نمی‌کند

/** درون‌یابی کسینوسی بین توقف‌های ناحیه‌ای */
function widthFactorAt(y: number, m: BodyMorph): number {
  const stops: Array<[number, number]> = [
    [0, 1],
    [Y_HEAD_END, 1],
    [Y_SHOULDER, m.ks],
    [Y_CHEST, (m.ks + m.kw) / 2],
    [Y_WAIST, m.kw],
    [Y_HIP, m.kh],
    [205, (m.kh + m.kt) / 2],
    [Y_THIGH, m.kt],
    [300, 0.985],
  ];
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [y1, k1] = stops[i];
    if (y <= y1) {
      const [y0, k0] = stops[i - 1];
      if (y1 === y0) return k1;
      const t = (y - y0) / (y1 - y0);
      const s = 0.5 - 0.5 * Math.cos(Math.PI * t); // smooth
      return k0 + (k1 - k0) * s;
    }
  }
  return stops[stops.length - 1][1];
}

/** تبدیل یک مسیر مطلق M/L/C/Z با ضرایب افقی وابسته به y */
function morphPath(d: string, k: (y: number) => number): string {
  // دادهٔ ما فقط شامل M/L/C/Z مطلق است (تولیدشده توسط اسکریپت استخراج)
  const out: string[] = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const args = m[2].trim();
    if (cmd === "Z" || args === "") {
      out.push(cmd);
      continue;
    }
    const nums = args.split(/\s+/).map(Number);
    const mapped: string[] = [];
    for (let j = 0; j < nums.length; j += 2) {
      const x = nums[j];
      const y = nums[j + 1];
      const f = k(y);
      mapped.push(`${(x * f).toFixed(2)} ${y.toFixed(2)}`);
    }
    out.push(cmd + mapped.join(" "));
  }
  return out.join(" ");
}

/* ─────────────────────────  جدول ترکیب‌های نهایی  ───────────────────────── */

const VARIANTS: Record<Gender, Record<BodyShapeKey, BodyMorph>> = {
  female: {
    // ۴ فرم اصلی مستقیماً از چارت کلاسیک
    rectangle: { base: "rectangle", ks: 1, kw: 1, kh: 1, kt: 1 },
    oval: { base: "oval", ks: 1, kw: 1, kh: 1, kt: 1 },
    pear: { base: "pear", ks: 1, kw: 1, kh: 1, kt: 1 },
    hourglass: { base: "hourglass", ks: 1, kw: 1, kh: 1, kt: 1 },
    // ۲ فرم تکمیلی با مورف همان زبان بصری
    inverted_triangle: { base: "hourglass", ks: 1.16, kw: 0.97, kh: 0.85, kt: 0.88 },
    athletic: { base: "rectangle", ks: 1.1, kw: 0.9, kh: 0.97, kt: 1.02 },
  },
  male: {
    rectangle: { base: "rectangle", ks: 1.2, kw: 1.03, kh: 0.93, kt: 0.97, maleHair: true },
    oval: { base: "oval", ks: 1.1, kw: 1.09, kh: 0.9, kt: 0.95, maleHair: true },
    pear: { base: "pear", ks: 1.05, kw: 0.98, kh: 0.95, kt: 0.95, maleHair: true },
    hourglass: { base: "hourglass", ks: 1.22, kw: 0.88, kh: 0.85, kt: 0.89, maleHair: true },
    inverted_triangle: { base: "rectangle", ks: 1.3, kw: 1, kh: 0.85, kt: 0.87, maleHair: true },
    athletic: { base: "hourglass", ks: 1.17, kw: 0.95, kh: 0.93, kt: 1.06, maleHair: true },
  },
};

const pathsCache = new Map<string, string[]>();

/**
 * مسیرهای سیلیوئت نهایی برای ترکیب جنسیت/فرم — در viewBox «BODY_SHAPE_VIEWBOX».
 * ترتیب: [خط موی پیشانی، خط صورت، مو، کانتور دست/شانهٔ چپ، خط بدن چپ، کانتور دست/شانهٔ راست، خط بدن راست، خط داخلی پا]
 */
export function bodyShapePaths(gender: Gender, shape: BodyShapeKey): string[] {
  const key = `${gender}:${shape}`;
  const hit = pathsCache.get(key);
  if (hit) return hit;

  const v = VARIANTS[gender][shape];
  const k = (y: number) => widthFactorAt(y, v);
  const base = FEMALE_BASE[v.base];

  const out = base.map((d, i) => {
    if (v.maleHair) {
      if (i === 2) return MALE_HAIR_PATH; // موی کوتاه مردانه به‌جای موی بلند چارت
      if (i === 0) return ""; // خط sweep پیشانی در نسخهٔ مردانه زیر کلاه پنهان است
    }
    return morphPath(d, k);
  }).filter(Boolean);

  pathsCache.set(key, out);
  return out;
}

/** سازگاری با نام قبلی — مسیر تنه به‌صورت پیوسته دیگر وجود ندارد؛ اولین کانتور بدن برمی‌گردد */
export function buildBodyShapeSilhouettePath(gender: Gender, shape: BodyShapeKey): string {
  return bodyShapePaths(gender, shape).join(" ");
}
