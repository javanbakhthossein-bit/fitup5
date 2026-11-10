/**
 * author-slug — v251-seo
 * منبع واحد اسلاگ نویسنده: هم /author/[slug] و هم باکس نویسندهٔ مقاله از
 * همین تابع استفاده می‌کنند تا لینک E-E-A-T همیشه سازگار باشد.
 * (کپی بی‌تغییر از منطق صفحهٔ نویسنده — تک‌منبع حقیقت شد.)
 */

/** نگاشت صریح نویسنده‌های واقعی دیتابیس به اسلاگ خوانا */
const AUTHOR_SLUG_OVERRIDES: Record<string, string> = {
  "حسین جوان": "hossein-javan",
  "مدیر سیستم": "modir-system",
};

/** آوانگاری قطعی حرف‌به‌حرف فارسی→لاتین (fallback برای نویسنده‌های آینده) */
const FA_CHAR_MAP: Record<string, string> = {
  آ: "a", ا: "a", ب: "b", پ: "p", ت: "t", ث: "s", ج: "j", چ: "ch", ح: "h", خ: "kh",
  د: "d", ذ: "z", ر: "r", ز: "z", ژ: "zh", س: "s", ش: "sh", ص: "s", ض: "z", ط: "t",
  ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "gh", ک: "k", گ: "g", ل: "l", م: "m", ن: "n",
  و: "v", ه: "h", ی: "y", ي: "y", ك: "k", ئ: "y", ء: "", أ: "a", إ: "e", ؤ: "o", ة: "h",
};

export function authorSlugFromName(name: string): string {
  const trimmed = name.trim();
  const override = AUTHOR_SLUG_OVERRIDES[trimmed];
  if (override) return override;

  let out = "";
  for (const ch of trimmed.replace(/\u200c/g, "-").toLowerCase()) {
    if (FA_CHAR_MAP[ch] !== undefined) out += FA_CHAR_MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if(/[\s_-]/.test(ch)) out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!out) {
    let h = 5381;
    for (let i = 0; i < trimmed.length; i++) h = (((h << 5) + h + trimmed.charCodeAt(i)) >>> 0);
    out = `author-${h.toString(36)}`;
  }
  return out;
}
