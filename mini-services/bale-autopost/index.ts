// ═══════════════════════════════════════════════════════════════
// فیتاپ — سرویس اتوپست کانال بله (v244-0)
// هر روز ۴ پست: ۰۹:۰۰ راهنمای علمی سئوشده (تصویردار)
//              ۱۳:۰۰ کوئیز تعاملی / ۱۷:۰۰ مقالهٔ روز (کاور + تیزر + لینک)
//              ۲۱:۰۰ انگیزشی
// فیکس v243: بوت دیگر اسلاتِ ازدست‌رفتهٔ دیرهنگام را جبران نمی‌کند
// (ریشهٔ پست تکراری ۱۰:۱۵ — دو نمونهٔ موازی + catch-up بی‌مرز) — گرِیس ۱۰ دقیقه
// دیرکتیو مالک v244: چرخهٔ مقالهٔ روز «زنده» شد — لیست از
//   /api/bale/articles سایت خوانده می‌شود: فقط مقاله‌های منتشرشده
//   (صف انتشار/draft هرگز)، مرتب بر اساس جدیدترینِ منتشرشده → مقالهٔ
//   جدید در نخستین اسلات ۱۷:۰۰ وارد چرخه می‌شود. فایل ثابت
//   articles.json فقط فال‌بکِ قطعیِ شبکه است (و کش state/articles-cache.json).
// متن: AvalAI مالک (deepseek-v4.1-flash) — دیرکتیو صریح مالک
// تصویر: AvalAI مالک (gemini-3.1-flash-lite-image) + امضای FitUp بالا-چپ نارنجی
// لینک: به‌جای انکرتکست، لینک خامِ کوتاه (دیرکتیو مالک — انکر در بله کار نمی‌کند)
// آدم‌ها: خانم‌ها کاملاً معمولی (بدون حجاب/شال)؛ روی تیشرت همه FitUp نارنجی
// ═══════════════════════════════════════════════════════════════
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dir;
const CFG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const STATE_DIR = path.join(DIR, 'state');
const OUTBOX = path.join(DIR, 'outbox');
const LOG_DIR = path.join(DIR, 'logs');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const LOG_PATH = path.join(LOG_DIR, 'service.log');
const ARTICLES_CACHE_PATH = path.join(STATE_DIR, 'articles-cache.json');
for (const d of [STATE_DIR, OUTBOX, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

// ─── چرخهٔ مقاله‌ها (v244 — دیرکتیو مالک) ────────────────────────
// لیست زنده از سایت → فال‌بک کش دیروز → فال‌بک فایل ثابت articles.json.
// «فقط منتشرشده‌ها» را سایت تضمین می‌کند (endpoint فقط status=published
// برمی‌گرداند و جدیدترین‌ها اول‌اند)؛ اینجا فقط مصرف‌کننده‌ای مطیعیم.
const STATIC_ARTICLES_PATH = path.join(DIR, 'articles.json');
const STATIC_ARTICLES: any[] = (() => {
  try { return JSON.parse(fs.readFileSync(STATIC_ARTICLES_PATH, 'utf8')).articles || []; } catch { return []; }
})();
let ARTICLES: any[] = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(ARTICLES_CACHE_PATH, 'utf8'));
    if (Array.isArray(c.articles) && c.articles.length >= 1) return c.articles;
  } catch {}
  return STATIC_ARTICLES;
})();
let articlesSource: 'site' | 'cache' | 'static' = ARTICLES.length && fs.existsSync(ARTICLES_CACHE_PATH) ? 'cache' : 'static';
let articlesRefreshedAt: string | null = (() => {
  try { return JSON.parse(fs.readFileSync(ARTICLES_CACHE_PATH, 'utf8')).updatedAt || null; } catch { return null; }
})();
let articlesRefreshing = false;
async function refreshArticles(): Promise<void> {
  if (articlesRefreshing) return;
  articlesRefreshing = true;
  try {
    const res = await fetch(SITE + '/api/bale/articles', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j: any = await res.json();
    const list: any[] = Array.isArray(j.articles) ? j.articles.filter((a: any) => a && a.slug && a.anchor) : [];
    if (!list.length) throw new Error('empty list');
    ARTICLES = list;
    articlesSource = 'site';
    articlesRefreshedAt = new Date().toISOString();
    try { fs.writeFileSync(ARTICLES_CACHE_PATH, JSON.stringify({ updatedAt: articlesRefreshedAt, articles: list }, null, 1)); } catch {}
    log(`ARTICLES_REFRESH: ${list.length} مقالهٔ منتشرشده از سایت ( جدیدترین اول )`);
  } catch (e: any) {
    // فال‌بک مطمئن: لیست قبلی (کش دیروز یا فایل ثابت) دست‌نخورده می‌ماند
    log(`ARTICLES_REFRESH_FAIL: ${String(e.message).slice(0, 100)} — ادامه با لیست فعلی (${ARTICLES.length} از ${articlesSource})`);
  } finally { articlesRefreshing = false;
  }
}

const ADMIN_KEY = 'fitup-admin';
const SITE = CFG.siteUrl; // https://fittup.ir

type Cat = 'exercise' | 'nutrition' | 'fatloss' | 'muscle' | 'injury' | 'cardio' | 'habit' | 'brand' | 'any';
const CATEGORIES: { name: string; cat: Cat; tags: string[] }[] = [
  { name: 'آموزش حرکات و فرم صحیح تمرین', cat: 'exercise', tags: ['حرکات_اصولی', 'بدنسازی'] },
  { name: 'تغذیه علمی برای چربی‌سوزی و عضله‌سازی', cat: 'nutrition', tags: ['تغذیه_ورزشی', 'سلامت'] },
  { name: 'لاغری و کاهش وزن علمی و پایدار', cat: 'fatloss', tags: ['لاغری', 'چربی_سوزی'] },
  { name: 'تمرین در خانه بدون دستگاه', cat: 'exercise', tags: ['تمرین_در_خانه'] },
  { name: 'سلامت مفاصل، گرم کردن و پیشگیری از آسیب', cat: 'injury', tags: ['پیشگیری_از_آسیب'] },
  { name: 'عضله‌سازی و قدرت برای همه سنین', cat: 'muscle', tags: ['عضله_سازی'] },
  { name: 'پیاده‌روی و هوازی برای سلامت قلب', cat: 'cardio', tags: ['پیاده_روی', 'هوازی'] },
  { name: 'عادت‌سازی ورزشی و انگیزش پایدار', cat: 'habit', tags: ['عادت_ورزشی', 'انگیزشی'] },
  { name: 'تغذیه سالم برای زنان و مادران (با تأیید پزشک)', cat: 'nutrition', tags: ['تغذیه_زنان'] },
  { name: 'ورزش برای سالمندان و میانسال‌ها', cat: 'exercise', tags: ['ورزش_سالمندان'] },
];

// ─── صفحات ابزار سایت (label کوتاه + مسیر) ─────────────────────
const SITE_LINKS: { url: string; label: string; cat: Cat[] }[] = [
  { url: '/go', label: 'دانلود اپ فیتاپ (رایگان)', cat: ['any', 'muscle', 'fatloss', 'brand'] },
  { url: '/exercises', label: 'بانک ۱۰۰۰+ حرکت با ویدیو', cat: ['exercise', 'muscle', 'injury', 'any'] },
  { url: '/foods', label: 'کالری و ماکروی غذاهای ایرانی', cat: ['nutrition', 'fatloss'] },
  { url: '/tdee', label: 'محاسبهٔ کالری روزانه', cat: ['fatloss', 'nutrition', 'muscle', 'any'] },
  { url: '/articles', label: 'مقالات تخصصی فیتاپ', cat: ['habit', 'any', 'injury', 'nutrition'] },
  { url: '/', label: 'فیتاپ — برنامهٔ شخصی تو', cat: ['any', 'brand'] },
  { url: '/about', label: 'داستان فیتاپ', cat: ['habit', 'brand'] },
  { url: '/contact', label: 'سوال داری؟ به ما بگو', cat: ['any'] },
];

// ─── تصویر: سبک فیتاپ — خانم‌ها کاملاً معمولی (بدون حجاب/شال — دیرکتیو مالک)
// روی تیشرتِ همه (زن و مرد) لوگوی FitUp نارنجی ──────────────────
const TSHIRT = (shirt: string) => `wearing a ${shirt} t-shirt with orange FitUp logo print`;
const IMAGE_PROMPTS = [
  `Photorealistic photo of an Iranian woman with dark hair in a high ponytail ${TSHIRT('fitted black')} and gray leggings, doing perfect squats on a yoga mat in a bright modern Iranian home, warm morning light through window, energetic and inspiring mood, orange and amber warm tones, no other text, high quality, detailed`,
  `Photorealistic photo of an Iranian man with dark hair and beard ${TSHIRT('navy')} doing dumbbell curls in a modern Tehran gym, focused expression, dramatic warm lighting, orange accents, no other text, high quality`,
  'Photorealistic top-down photo of healthy Iranian-inspired meal prep on wooden table: grilled chicken, saffron rice in small bowl, fresh herbs, vegetables, eggs, walnuts and an orange sports bottle, natural light, appetizing vibrant colors, no text, high quality',
  `Photorealistic photo of an Iranian couple in their 30s ${TSHIRT('matching white')} , walking briskly together in a Tehran park during golden hour, joyful energy, autumn trees, no other text, high quality`,
  `Photorealistic photo of a young Iranian woman with shoulder-length dark hair ${TSHIRT('light gray')} stretching her shoulders beside a large window in a cozy home, calm wellness mood, soft warm light, no other text, high quality`,
  `Photorealistic photo of an Iranian senior man in his 60s ${TSHIRT('dark blue')} doing light dumbbell exercises on a balcony with potted plants, morning light, healthy active lifestyle, no other text, high quality`,
  `Photorealistic photo of an Iranian mother and daughter preparing a healthy breakfast bowl with yogurt, berries and nuts in a bright Iranian kitchen, mother ${TSHIRT('black')} , laughing together, warm tones, no other text, high quality`,
  `Photorealistic photo of Iranian men and women ${TSHIRT('matching athletic')} doing push-ups side by side in a park fitness area, women with hair in ponytails, teamwork energy, morning light, no other text, high quality`,
  `Photorealistic photo of an Iranian man ${TSHIRT('gray')} measuring his waist with a tape in front of a mirror, happy with progress, home bedroom, natural light, no other text, high quality`,
  `Photorealistic photo of an Iranian woman with dark hair in a bun ${TSHIRT('fitted white')} doing glute bridge with perfect form on a mat at home, bright modern living room, motivational mood, no other text, high quality`,
  'Photorealistic photo of dumbbells, water bottle, towel and a smartphone showing a fitness app on a wooden bench, next to a folded black t-shirt with orange FitUp logo print, warm minimal composition, orange accent light, no other text, high quality',
  `Photorealistic photo of an Iranian family with kids walking after dinner in a quiet Tehran neighborhood at sunset, parents ${TSHIRT('casual colorful')} , active lifestyle habit, warm golden light, no other text, high quality`,
];

type State = {
  lastFired: Record<string, string>;
  usedTitles: string[];
  catIndex: number;
  imgIndex: number;
  artIndex: number;
  toolIndex: number;
  articlePostIndex: number;
  postCount: number;
  textVia?: string;
  avalaiModel?: string;
  imageBlocked?: string | null;
  pendingQuiz: { q: string; answer: string; fact: string } | null;
  errors: { at: string; msg: string }[];
  sentLog: { at: string; slot: string; title: string; mode: string }[];
};
const defaultState: State = { lastFired: {}, usedTitles: [], catIndex: 0, imgIndex: 0, artIndex: 0, toolIndex: 0, articlePostIndex: 0, postCount: 0, imageBlocked: null, pendingQuiz: null, errors: [], sentLog: [] };
let state: State = defaultState;
try { state = { ...defaultState, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; } catch {}
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
const log = (m: string) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
};

const tehran = (fmt: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: CFG.timezone, ...fmt }).format(new Date());
const tehranHHMM = () => tehran({ hour: '2-digit', minute: '2-digit', hour12: false });
const tehranDate = () => tehran({ year: 'numeric', month: '2-digit', day: '2-digit' });

let zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
const getZai = async () => (zai ||= await ZAI.create());

// ─── متن: اول AvalAI مالک (دیرکتیو مالک)؛ z-ai فقط در خطای سرویس ──
// deepseek-v4.1-flash مدل reasoning دار است؛ تلاش ۱ بدون فکر (سریع)،
// تلاش ۲ با فکر کامل و بودنهٔ بالا؛ در نبود این‌ها content خالی برمی‌گشت
async function avalaiText(messages: any[]): Promise<string> {
  const call = (maxTokens: number, noThink: boolean): Promise<any> =>
    fetch('https://api.avalai.ir/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.avalai.apiKey}` },
      body: JSON.stringify({
        model: CFG.avalai.textModel || 'deepseek-v4.1-flash', messages, max_tokens: maxTokens,
        ...(noThink ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
      signal: AbortSignal.timeout(noThink ? 150_000 : 300_000),
    }).then(r => r.json());
  const tries: [number, boolean][] = [[4000, true], [12000, false]];
  for (const [maxTokens, noThink] of tries) {
    const tag = noThink ? 'fast' : 'think';
    try {
      const j: any = await call(maxTokens, noThink);
      if (j?.error) { log(`avalai-text[${tag}] err: ` + JSON.stringify(j.error).slice(0, 120)); continue; }
      const c = j?.choices?.[0]?.message?.content;
      if (c && String(c).trim()) return String(c).trim();
      log(`avalai-text[${tag}] empty content`);
    } catch (e: any) { log(`avalai-text[${tag}] fail: ` + e.message.slice(0, 100)); }
  }
  throw new Error('avalai-text: both attempts failed');
}
async function genText(messages: any[]) {
  try {
    const t = await avalaiText(messages);
    state.textVia = CFG.avalai.textModel || 'deepseek-v4.1-flash';
    saveState();
    return t;
  } catch (e: any) {
    log('TEXT_FALLBACK→zai: ' + e.message.slice(0, 120));
    state.textVia = 'zai-fallback';
    saveState();
    const z = await getZai();
    const r = await z.chat.completions.create({ messages, thinking: { type: 'disabled' } });
    return (r.choices[0]?.message?.content || '').trim();
  }
}

const esc = (t: string) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const recentBlock = () => state.usedTitles.slice(-12).map(t => '- ' + t).join('\n') || '(هیچ)';

// ─── پرامپت‌ها — علم روز، فراگیری، سئو، جذابیت ────────────────
const SCIENCE = `از جدیدترین یافته‌های علم ورزش و تغذیه استفاده کن (مکانیسم‌های ساده: متابولیسم، هورمون‌ها، عضله‌سازی، بازیابی) اما فقط ادعاهای علمی پذیرفته‌شده؛ هیچ نقل‌قول جعلی از پژوهش خاص، هیچ ادعای شبه‌علمی و هیچ وعدهٔ درمانی ننویس.`;
const INCLUSIVE = `مخاطب کانال همهٔ قشرهاست: زن و مرد، جوان و میانسال و سالمند، خانه‌دار و کارمند و دانشجو و مادر شاغل؛ مثال‌ها برای همه قابل استفاده باشد.`;
const SEO = `خط اول (TITLE) باید مثل عنوان سئوشده باشد: کلمهٔ کلیدی اصلی در ابتدای عنوان + قلاب جذاب (مثل تیتر مقاله‌های صفحهٔ اول گوگل). در متن، کلمهٔ کلیدی اصلی ۲-۳ بار به‌طور طبیعی تکرار شود و از مترادف‌هایش هم استفاده کن.`;

function guidePrompt(catName: string) {
  return `یک پست آموزشی فوق‌العاده جذاب برای کانال بله برند فیتاپ (اپ برنامه تمرینی، تغذیه و مربی هوشمند) به فارسی بنویس.
موضوع: راهنمای مینی عمیق و کاربردی در حوزه «${catName}» که تا حالا گفته نشده:
${recentBlock()}
${SCIENCE}
${INCLUSIVE}
${SEO}
خروجی را دقیقاً با این ساختار خطی بده (بدون هیچ علامت اضافه، بدون Markdown):
TITLE: عنوان سئوشده جذاب
HOOK: یک جمله قلاب کوبنده
BODY: پاراگراف اول علمی-ساده
BODY: پاراگراف دوم کاربردی
TIP: نکته عملی قابل اجرای امروز
TIP: نکته عملی
TIP: نکته عملی
GOLDEN: نکتهٔ طلایی که کمتر کسی می‌داند
QUESTION: یک سؤال کوتاه از مخاطب برای کامنت
قواعد: مجموعاً ۲۵۰ تا ۳۵۰ کلمه؛ لحن صمیمی-حرفه‌ای (خطاب به «تو») که خواندنش لذت‌بخش باشد؛ در لینک و CTA اشاره نکن (خودکار اضافه می‌شود)؛ فقط این ساختار را بده.`;
}
function motivatePrompt() {
  return `یک پست انگیزشی کوبنده برای کانال بله برند فیتاپ به فارسی بنویس.
${SCIENCE}
${INCLUSIVE}
ساختار: خط اول = جملهٔ کوبندهٔ فورواردپذیر؛ سپس micro-story واقع‌گرایانه ۲-۳ خطی از یک انسان عادی ایرانی (نه قهرمان) → درس کلیدی → یک عادت ریز قابل‌اجرای امروز.
قواعد: ۸۰ تا ۱۳۰ کلمه؛ بدون Markdown؛ بدون لینک؛ اسم فیتاپ حداکثر یک‌بار طبیعی؛ فقط متن پست را بده، عنوان با «TITLE: » در خط اول.`;
}
function articlePrompt(title: string, excerpt: string) {
  return `برای معرفی مقالهٔ زیر در کانال بلهٔ برند فیتاپ، یک تیزر خیلی خلاصه و کنجکاوکننده به فارسی بنویس.
عنوان مقاله: «${title}»
خلاصهٔ خود مقاله: «${(excerpt || '').slice(0, 400)}»
قواعد: ۳۵ تا ۶۰ کلمه؛ لحن صمیمی (خطاب به «تو»)؛ با یک سؤال یا وعدهٔ نتیجه شروع کن؛ لقمهٔ جذاب از محتوای مقاله بده اما همه‌چیز را لو نده؛ بدون Markdown، بدون لینک، بدون هشتگ، بدون عنوان؛ فقط خودِ متن تیزر را بده.`;
}
function quizPrompt() {
  return `یک سؤال تستی جذاب حوزه فیتنس/تغذیه/بدنسازی بر اساس علم روز برای کانال فیتاپ به فارسی بساز که تا حالا پرسیده نشده:
${recentBlock()}
${INCLUSIVE}
خروجی را دقیقاً در این قالب JSON بده و هیچ چیز دیگری ننویس:
{"question":"متن سؤال","options":["گزینه الف","گزینه ب","گزینه ج","گزینه د"],"answer":"متن دقیق گزینه صحیح","fact":"یک جمله توضیح شگفت‌انگیز و علمی درباره پاسخ"}
سؤال برای عموم مردم قابل پاسخ، یادگیرنده و غافلگیرکننده باشد؛ گزینه‌ها باهوش و نزدیک به هم.`;
}

// ─── تصویر: کلید تصویری مالک (gemini-3.1-flash-lite-image) — تست‌شده ✓
// fallback داخلی فقط وقتی API مالک پاسخ ندهد ────────────────────
async function avalaiImage(idx: number): Promise<Buffer | null> {
  const prompt = IMAGE_PROMPTS[idx % IMAGE_PROMPTS.length] + ', exclusive original FitUp brand photography style';
  const model = CFG.avalai.imageModel || 'gemini-3.1-flash-lite-image';
  try {
    const res = await fetch('https://api.avalai.ir/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.avalai.imageApiKey || CFG.avalai.apiKey}` },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
      signal: AbortSignal.timeout(240_000),
    });
    const j: any = await res.json();
    const d = j?.data?.[0];
    if (!d) throw new Error(JSON.stringify(j?.error || j).slice(0, 140));
    state.avalaiModel = model; state.imageBlocked = null; saveState();
    if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
    if (d.url) { const img = await fetch(d.url, { signal: AbortSignal.timeout(60_000) }); return Buffer.from(await img.arrayBuffer()); }
    throw new Error('no image payload in response');
  } catch (e: any) {
    state.imageBlocked = 'AvalAI-image: ' + e.message.slice(0, 120);
    saveState();
    log('IMAGE_FALLBACK→zai: ' + e.message.slice(0, 120));
    try {
      const z = await getZai();
      const r = await z.images.generations.create({ prompt, size: '1024x1024' });
      if (r.data[0]?.base64) return Buffer.from(r.data[0].base64, 'base64');
      if (r.data[0]?.url) { const img = await fetch(r.data[0].url, { signal: AbortSignal.timeout(60_000) }); return Buffer.from(await img.arrayBuffer()); }
    } catch (e2: any) { log('ZAI_IMG_FAIL: ' + e2.message.slice(0, 80)); }
    return null;
  }
}

/** امضای FitUp — واترمارک بالا-چپ، نوشتهٔ FitUp نارنجی (دیرکتیو مالک) */
async function signImage(buf: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    const W = meta.width || 1024, H = meta.height || 1024;
    const m = Math.round(W * 0.035);
    const bw = Math.round(W * 0.36), bh = Math.round(H * 0.075);
    const bx = m, by = m; // بالا-چپ
    const fs1 = Math.round(bh * 0.42), fs2 = Math.round(bh * 0.26);
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.round(bh / 2)}" fill="rgba(20,16,10,0.55)"/>
  <text x="${bx + bw * 0.09}" y="${by + bh * 0.60}" font-family="DejaVu Sans, Arial" font-weight="bold" font-size="${fs1}" fill="#FF8A1E">FitUp</text>
  <text x="${bx + bw * 0.47}" y="${by + bh * 0.58}" font-family="DejaVu Sans, Arial" font-size="${fs2}" fill="#FFFFFF">fittup.ir</text>
</svg>`;
    return await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  } catch (e: any) { log('SIGN_FAIL: ' + e.message.slice(0, 100)); return buf; }
}

// ─── لینک خامِ کوتاه (v242-5 — دیرکتیو مالک: انکرتکست در بله کار نمی‌کند)
// فرمت: برچسب کوتاه + خودِ URL با فقط utm_source=bale (برای تگ «بله» در ادمین)
const rawLink = (p: string) => `${SITE}${p === '/' ? '/' : p}?utm_source=bale`;
function pickLinks(cat: Cat, isSales: boolean): string {
  const tools = SITE_LINKS.filter(l => l.cat.includes(cat) || l.cat.includes('any'));
  let arts = ARTICLES.filter((a: any) => a.cat.includes(cat));
  // دستهٔ بی‌مقاله (مثل cardio) → چرخش عمومی همهٔ مقاله‌ها تا هر پست ۲ لینک داشته باشد
  if (!arts.length) arts = ARTICLES;
  const lines: string[] = [];
  if (isSales) {
    lines.push(`📲 ${SITE_LINKS[0].label}:
${rawLink('/go')}`);
    const brandArts = ARTICLES.filter((a: any) => a.cat.includes('brand'));
    const a = brandArts[state.artIndex++ % brandArts.length];
    lines.push(`📖 ${a.anchor}:
${rawLink('/article/' + a.slug)}`);
  } else {
    const useArticleFirst = state.postCount % 2 === 0;
    if (useArticleFirst) {
      const a = arts[state.artIndex++ % arts.length];
      lines.push(`📖 ${a.anchor}:
${rawLink('/article/' + a.slug)}`);
      const t = tools[state.toolIndex++ % tools.length];
      lines.push(`🛠 ${t.label}:
${rawLink(t.url)}`);
    } else {
      const t = tools[state.toolIndex++ % tools.length];
      lines.push(`🛠 ${t.label}:
${rawLink(t.url)}`);
      const a = arts[state.artIndex++ % arts.length];
      lines.push(`📖 ${a.anchor}:
${rawLink('/article/' + a.slug)}`);
    }
  }
  return lines.join('\n');
}

// ─── کاور مقاله: فایل محلی → دانلود از خود سایت → تصویر تولیدی ──
async function articleCover(coverPath: string): Promise<Buffer | null> {
  // ۱) مستقیم از پوشهٔ public سایت روی همان سرور (سریع‌ترین — بدون شبکه)
  try {
    const p = path.join(DIR, '..', '..', 'public', String(coverPath).replace(/^\//, ''));
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch {}
  // ۲) دانلود از خود سایت (کاورها عمومی‌اند)
  try {
    const res = await fetch(SITE + coverPath, { signal: AbortSignal.timeout(30_000) });
    if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); if (b.length > 2000) return b; }
  } catch (e: any) { log('COVER_FETCH_FAIL: ' + e.message.slice(0, 80)); }
  return null;
}

// ─── ارسال به بله (HTML) ───────────────────────────────────────
async function baleSendText(text: string) {
  const res = await fetch(`https://tapi.bale.ai/bot${CFG.botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // پیش‌نمایش لینک فعال تا URL خام، کارتِ قابل لمس هم بگیرد (دیرکتیو مالک: لینک خام)
    body: JSON.stringify({ chat_id: CFG.channel, text: text.slice(0, 3800), parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(30_000),
  });
  const j: any = await res.json();
  if (!j.ok) throw new Error('sendMessage: ' + JSON.stringify(j).slice(0, 200));
}
async function baleSendPhoto(photo: Buffer, caption: string) {
  const fd = new FormData();
  fd.append('chat_id', CFG.channel);
  fd.append('caption', caption.slice(0, 1000));
  fd.append('parse_mode', 'HTML');
  fd.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'post.png');
  const res = await fetch(`https://tapi.bale.ai/bot${CFG.botToken}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60_000) });
  const j: any = await res.json();
  if (!j.ok) throw new Error('sendPhoto: ' + JSON.stringify(j).slice(0, 200));
}
async function baleSend(text: string, photo: Buffer | null, dry: boolean) {
  if (dry || !CFG.botToken) return { ok: true, dry: true };
  if (photo) {
    if (text.length <= 950) await baleSendPhoto(photo, text);
    // خط اول خودِ HTML سالم ماست (esc نمی‌خواهد — وگرنه <b> عرفی نمایش داده می‌شد)
    else { await baleSendPhoto(photo, text.split('\n')[0] + '\n\n👇'); await baleSendText(text); }
  } else await baleSendText(text);
  return { ok: true, dry: false };
}

// ─── ساخت پست صبح از ساختار خطی مدل ───────────────────────────
function buildMorningHtml(raw: string, cat: Cat, tags: string[]): string {
  const get = (k: string) => raw.split('\n').filter(l => l.startsWith(k + ':')).map(l => l.slice(k.length + 1).trim()).filter(Boolean);
  const title = get('TITLE')[0] || 'فیتاپ';
  const hook = get('HOOK')[0] || '';
  const body = get('BODY');
  const tips = get('TIP');
  const golden = get('GOLDEN')[0] || '';
  const q = get('QUESTION')[0] || 'نظرت رو برام بنویس!';
  let h = `🎓 <b>${esc(title)}</b>\n\n<i>${esc(hook)}</i>\n\n`;
  h += body.map(b => esc(b)).join('\n\n') + '\n\n';
  if (tips.length) {
    h += `✅ <b>از امروز چیکار کنی؟</b>\n` + tips.map(t => `🔸 ${esc(t)}`).join('\n') + '\n\n';
  }
  if (golden) h += `💎 <b>نکتهٔ طلایی:</b> ${esc(golden)}\n\n`;
  h += `💬 <b>${esc(q)}</b>\n\n`;
  h += `🔍 <b>ادامهٔ مسیر با فیتاپ:</b>\n${pickLinks(cat, false)}\n\n`;
  h += ['فیتاپ', ...tags].map(t => '#' + t).join(' ');
  return h;
}

// ─── انتشار یک اسلات ───────────────────────────────────────────
let inFlight = false;
type Slot = 'morning' | 'noon' | 'evening' | 'article';
async function fireSlot(slot: Slot, live = false) {
  if (inFlight) { log('SKIP: in-flight'); return { ok: false, skip: true }; }
  inFlight = true;
  try {
    const catDef = CATEGORIES[state.catIndex % CATEGORIES.length];
    let text = '', photo: Buffer | null = null, title = '', imgVia = 'none';

    if (slot === 'article') {
      // دیرکتیو مالک (v243): هر روز یک مقالهٔ سایت، خیلی خلاصه + عکس کاور + لینک خواندن
      // دیرکتیو مالک (v244): لیست مقاله‌ها «زنده» است — فقط منتشرشده‌ها؛
      // مقالهٔ تازه‌منتشرشده در همین اسلات وارد چرخه می‌شود (جدیدترین اول)
      await refreshArticles();
      const a = ARTICLES[state.articlePostIndex % ARTICLES.length];
      state.articlePostIndex++;
      if (a.cover) {
        const cov = await articleCover(a.cover);
        if (cov) { photo = await signImage(cov); imgVia = 'cover+sign'; }
      }
      if (!photo && CFG.imageSource === 'avalai') {
        const im = await avalaiImage(state.imgIndex++);
        if (im) { photo = await signImage(im); imgVia = `avalai:${state.avalaiModel}+sign`; }
      }
      let teaser = a.excerpt || '';
      try {
        const raw = await genText([{ role: 'user', content: articlePrompt(a.anchor, a.excerpt) }]);
        if (raw) teaser = raw.replace(/^TEASER:\s*/i, '').trim();
      } catch {}
      if (!teaser) teaser = 'مقالهٔ کامل را از دست نده!';
      title = a.anchor;
      text = `📖 <b>مقالهٔ امروز ${esc(CFG.brand)}</b>\n\n<b>${esc(a.anchor)}</b>\n\n<i>${esc(teaser)}</i>\n\n🔗 <b>خواندن کامل مقاله:</b>\n${rawLink('/article/' + a.slug)}\n\n📲 ${SITE_LINKS[0].label}:\n${rawLink('/go')}\n\n${['فیتاپ', 'مقاله_ورزشی'].map(t => '#' + t).join(' ')}`;
    } else if (slot === 'morning') {
      const raw = await genText([{ role: 'user', content: guidePrompt(catDef.name) }]);
      if (CFG.imageSource === 'avalai') {
        const im = await avalaiImage(state.imgIndex++);
        if (im) { photo = await signImage(im); imgVia = `avalai:${state.avalaiModel}+sign`; }
      }
      text = buildMorningHtml(raw, catDef.cat, catDef.tags);
      title = raw.split('\n').find(l => l.startsWith('TITLE:'))?.slice(6).trim() || 'morning';
    } else if (slot === 'evening') {
      const raw = await genText([{ role: 'user', content: motivatePrompt() }]);
      const lines = raw.split('\n').filter(Boolean);
      const head = (lines[0] || '').replace(/^TITLE:\s*/i, '');
      const rest = lines.slice(1).join('\n');
      text = `🔥 <b>${esc(head)}</b>\n\n<i>${esc(rest)}</i>\n\n`;
      text += `━━━━━━━━━━━━\n💪 <b>${esc(CFG.brand)}</b> — قوی‌تر از دیروز باش\n`;
      text += pickLinks(catDef.cat, false) + '\n\n';
      text += ['فیتاپ', ...catDef.tags].map(t => '#' + t).join(' ');
      title = head.slice(0, 60);
    } else {
      const reveal = state.pendingQuiz
        ? `✅ <b>پاسخ دیروز:</b> ${esc(state.pendingQuiz.answer)}\n<i>💡 ${esc(state.pendingQuiz.fact)}</i>\n\n━━━━━━━━━━━━\n\n`
        : '';
      const raw = await genText([{ role: 'user', content: quizPrompt() }]);
      const j = JSON.parse(raw.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      state.pendingQuiz = { q: String(j.question), answer: String(j.answer), fact: String(j.fact || '') };
      const L = ['الف', 'ب', 'ج', 'د'];
      text = `${reveal}🧠 <b>کوئیز ${esc(CFG.brand)}</b>\n\n<b>${esc(j.question)}</b>\n\n`
        + j.options.map((o: string, i: number) => `${L[i]}) ${esc(o)}`).join('\n')
        + `\n\n💬 <i>جوابت رو کامنت کن؛ پاسخ فردا با یک فکت شگفت‌انگیز اعلام می‌شه!</i>\n\n`;
      text += pickLinks(catDef.cat, false) + '\n\n';
      text += ['فیتاپ', 'کوئیز', ...catDef.tags].map(t => '#' + t).join(' ');
      title = j.question.slice(0, 60);
    }

    if (slot !== 'article') state.catIndex++;
    state.postCount++;
    if (state.postCount % 6 === 0 && text.includes('ادامهٔ مسیر')) {
      // پست فروش: CTA اصلی جای لینک‌های عادی (فقط وقتی بلوک لینک عادی وجود دارد)
      text = text.replace(/\n🔍 <b>ادامهٔ مسیر[\s\S]*?(?=\n#|\n━━|$)/, '\n' + pickLinks(catDef.cat, true));
    }

    const dry = (CFG.dryRun || !CFG.botToken) && !live;
    const mode = photo ? `photo(${imgVia})+text` : 'text';
    const r = await baleSend(text, photo, dry);
    const stamp = tehranDate().replace(/\//g, '-') + '_' + tehranHHMM().replace(':', '') + '_' + slot;
    fs.writeFileSync(path.join(OUTBOX, stamp + '.txt'), text.replace(/<[^>]+>/g, ''), 'utf8');
    if (photo) fs.writeFileSync(path.join(OUTBOX, stamp + '.png'), photo);
    state.lastFired[slot] = tehranDate();
    state.usedTitles.push(title);
    if (state.usedTitles.length > 60) state.usedTitles = state.usedTitles.slice(-60);
    state.sentLog.unshift({ at: new Date().toISOString(), slot, title, mode: r.dry ? 'DRY-' + mode : mode });
    if (state.sentLog.length > 30) state.sentLog = state.sentLog.slice(0, 30);
    saveState();
    log(`OK slot=${slot} dry=${r.dry} mode=${mode}`);
    return { ok: true, slot, dry: r.dry, text, hasPhoto: !!photo, imgVia };
  } catch (e: any) {
    const msg = `FAIL slot=${slot}: ${e.message}`;
    state.errors.unshift({ at: new Date().toISOString(), msg: msg.slice(0, 300) });
    state.errors = state.errors.slice(0, 10);
    saveState();
    log(msg);
    return { ok: false, error: e.message };
  } finally { inFlight = false; }
}

// ─── زمان‌بند — فیکس v243: جبرانِ دیرهنگام ممنوع ─────────────────
// ریشهٔ پست تکراری ۱۰:۱۵: بوت/بیداریِ دیرهنگام + catch-up بی‌مرز.
// از این پس اگر اسلات بیش از ۱۰ دقیقه گذشته باشد، فقط علامت می‌خورد و نمی‌رود.
const GRACE_MIN = 10;
const pastMin = (t: string, now: string) => {
  const [h1, m1] = t.split(':').map(Number), [h2, m2] = now.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
};
function tick() {
  const now = tehranHHMM();
  for (const [slot, time] of Object.entries(CFG.times)) {
    if (now >= (time as string) && state.lastFired[slot] !== tehranDate()) {
      const past = pastMin(time as string, now);
      if (past > GRACE_MIN) {
        log(`SKIP slot=${slot}: ${past}min late → بدون جبران (فیکس پست تکراری)`);
        state.lastFired[slot] = tehranDate(); saveState();
        continue;
      }
      log(`TICK slot=${slot} time=${now}`);
      fireSlot(slot as any);
    }
  }
}

// ─── وب‌سرور وضعیت/کنترل ───────────────────────────────────────
Bun.serve({
  port: CFG.port,
  idleTimeout: 255,
  async fetch(req) {
    const u2 = new URL(req.url);
    if (u2.pathname === '/status') {
      return Response.json({
        version: 'v244-0',
        dryRun: CFG.dryRun || !CFG.botToken, channel: CFG.channel, siteUrl: SITE,
        textModel: CFG.avalai?.textModel || null, textVia: state.textVia || null,
        imageSource: CFG.imageSource, imageModel: CFG.avalai?.imageModel || null,
        avalaiModel: state.avalaiModel || null, imageBlocked: state.imageBlocked,
        times: CFG.times, timezone: CFG.timezone, postCount: state.postCount,
        lastFired: state.lastFired, nowTehran: tehranHHMM(),
        articles: { count: ARTICLES.length, source: articlesSource, refreshedAt: articlesRefreshedAt, nextArticleSlug: ARTICLES.length ? ARTICLES[state.articlePostIndex % ARTICLES.length]?.slug || null : null },
        pendingQuiz: state.pendingQuiz, errors: state.errors, sentLog: state.sentLog,
      });
    }
    if (u2.pathname === '/check') {
      try {
        const me = await (await fetch(`https://tapi.bale.ai/bot${CFG.botToken}/getMe`, { signal: AbortSignal.timeout(15_000) })).json();
        const chat = await (await fetch(`https://tapi.bale.ai/bot${CFG.botToken}/getChat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CFG.channel }), signal: AbortSignal.timeout(15_000),
        })).json();
        return Response.json({ bot: me.ok ? { id: me.result.id, username: me.result.username } : me, channel: chat.ok ? { id: chat.result.id, title: chat.result.title } : chat });
      } catch (e: any) { return Response.json({ error: e.message }); }
    }
    if (u2.pathname === '/run' && req.method === 'POST') {
      if (u2.searchParams.get('key') !== ADMIN_KEY) return new Response('forbidden', { status: 403 });
      const slot = (u2.searchParams.get('slot') || 'morning') as any;
      // live=1 → حتی با dryRun=true سندباکس، همین یک پست واقعاً ارسال می‌شود (برای تست مالک)
      const r = await fireSlot(slot, u2.searchParams.get('live') === '1');
      return Response.json(r);
    }
    return new Response('bale-autopost v244-0 up');
  },
});

// ریست پیام خطای قدیمی — کلید تصویری مالک جدید است و تست شده
if (CFG.avalai?.imageApiKey && state.imageBlocked) { state.imageBlocked = null; saveState(); }

log(`BOOT v244-0 dryRun=${CFG.dryRun || !CFG.botToken} text=${CFG.avalai?.textModel} image=${CFG.avalai?.imageModel} port=${CFG.port} channel=${CFG.channel} times=${Object.entries(CFG.times).map(([k, v]) => k + '@' + v).join(',')} articles=${ARTICLES.length}(${articlesSource})`);
// v244 — چرخهٔ زندهٔ مقاله‌ها: بوت + هر ۶ ساعت (قبل هر اسلات مقاله هم تازه می‌شود)
refreshArticles();
setInterval(refreshArticles, 6 * 60 * 60 * 1000);
setInterval(tick, 30_000);
