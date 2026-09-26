/**
 * Navigation Helper — مدیریت URL و History برای SPA-like navigation
 *
 * مشکلاتی که حل می‌کند:
 * 1. وقتی کاربر در articles/tool/article است و رفرش می‌کند، باید همان صفحه بالا بیاید
 * 2. دکمه back مرورگر باید مرحله به مرحله برگرداند (article → articles → landing)
 * 3. URL باید همیشه با screen فعلی هماهنگ باشد
 *
 * راه‌حل (v106 — مهاجرت کامل به مسیرهای واقعی):
 * - محتوای عمومی (مقاله/حرکت/غذا/رشته/لیست مقالات/ابزارها/terms/contact/about)
 *   حالا URL واقعی دارد: /article/<slug>، /exercise/<id>، /food/<id>،
 *   /articles، /exercises، /foods، /tdee، /terms، /contact، /about، /sport/<slug>
 *   → آدرس بار هیچ‌وقت ?article=/?exercise=/?food=/?tool= نشان نمی‌دهد.
 * - screenهای داخلی اپ (auth/panel/admin/onboarding) به‌صورت کوئری‌استایل می‌مانند
 *   (?screen=auth و…) — این‌ها صفحهٔ عمومی و ایندکس‌شدنی نیستند.
 * - هر navigation یک history entry اضافه/جایگزین می‌کند
 * - popstate handler (در page-client) تصمیم می‌گیرد کجا برگردد
 * - getScreenFromUrl هم پارامترهای کوئری قدیمی را می‌خواند (تاریخچهٔ داخلی
 *   قبل از مهاجرت) و هم مسیرهای واقعی — کوئری اولویت دارد (سازگاری رو به عقب)
 */

export type NavScreen =
  | "landing"
  | "auth"
  | "main"
  | "admin"
  | "onboarding";
  // v113 — «tool-exercises» و «exercise-detail» حذف شدند: بانک حرکات و صفحهٔ
  // حرکت فقط مسیر واقعی SSR دارند (/exercises ، /exercise/<id>) و هر ناوبری
  // با navigateToExercises/navigateToExercise انجام می‌شود — ریشه‌کنی باگ
  // «دو طراحی با رفرش» (گزارش مالک).
  // v118 — «tool-foods» و «food-detail» هم با همان الگو حذف شدند.
  // v119 — «articles» ، «article» ، «tool-tdee» ، «sport-detail» ، «terms» ،
  // «contact» و «about» هم حذف شدند (دیرکتیو مالک: «این مشکل در هیچ جای سایت
  // به هیچ وجه نباید وجود داشته باشه») — همهٔ صفحات عمومی فقط مسیر واقعی
  // SSR دارند و ناوبری با هلپرهای navigateTo* پایین انجام می‌شود.

/* ─── v113 — ناوبری واقعی بانک حرکات (تک‌نسخه‌سازی) ───
 * بانک حرکات و صفحهٔ حرکت «فقط» مسیر واقعی SSR دارند — از هر جای اپ که
 * بخواهیم کاربر را به حرکات برسانیم، با این هلپرهاست (بارگذاری کامل صفحه
 * = همان طراحی که با رفرش/گوگل دیده می‌شود؛ صفر ابهام دو-طراحی). */
export function navigateToExercises(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/exercises");
}

export function navigateToExercise(id: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(`/exercise/${encodeURIComponent(id)}`);
}

/** v113 — آیا این pathname از مسیرهای عمومی بانک حرکات است؟ */
export function isExercisePublicPath(pathname: string): boolean {
  return pathname === "/exercises" || /^\/exercise\/[^/]+\/?$/.test(pathname);
}

/* ─── v118 — ناوبری واقعی بانک کالری غذاها (تک‌نسخه‌سازی — همان الگوی بانک حرکات) ───
 * بانک غذاها و صفحهٔ غذا «فقط» مسیر واقعی SSR دارند — از لندینگ/نوار ابزار/چت/
 * ویجت نیکا با این هلپرها می‌رویم (بارگذاری کامل صفحه = همان طراحی که با
 * رفرش/لینک مقالات/گوگل دیده می‌شود؛ صفر ابهام دو-طراحی). */
export function navigateToFoods(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/foods");
}

export function navigateToFood(id: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(`/food/${encodeURIComponent(id)}`);
}

/** v118 — آیا این pathname از مسیرهای عمومی بانک غذاها است؟ */
export function isFoodPublicPath(pathname: string): boolean {
  return pathname === "/foods" || /^\/food\/[^/]+\/?$/.test(pathname);
}

/* ─── v119 — ناوبری واقعی بقیهٔ صفحات عمومی (تک‌نسخه‌سازی کامل سایت) ───
 * مجلهٔ مقالات، مقاله، TDEE، رشتهٔ ورزشی، قوانین، تماس و درباره — هر URL فقط
 * یک پیاده‌سازی (SSR) دارد و هر ورودی (کلیک/رفرش/لینک مقالات/گوگل) همان را
 * نشان می‌دهد. */
export function navigateToArticles(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/articles");
}

export function navigateToArticle(slug: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(`/article/${encodeURIComponent(slug)}`);
}

export function navigateToTdee(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/tdee");
}

export function navigateToSport(slug: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(`/sport/${encodeURIComponent(slug)}`);
}

export function navigateToTerms(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/terms");
}

export function navigateToContact(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/contact");
}

export function navigateToAbout(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/about");
}

/**
 * v119 — آیا این pathname از مسیرهای عمومی SSR است (که دیگر در SPA رندر
 * نمی‌شوند)؟ گارد page-client با این تابع هر ورودی stale (تاریخچهٔ pushState
 * قدیمی / پارامتر legacy) را با بارگذاری کامل صفحهٔ واقعی اصلاح می‌کند.
 */
export function isPublicSsrPath(pathname: string): boolean {
  return (
    isExercisePublicPath(pathname) ||
    isFoodPublicPath(pathname) ||
    pathname === "/articles" ||
    /^\/articles(\/|$)/.test(pathname) ||
    /^\/article\/[^/]+\/?$/.test(pathname) ||
    /^\/sport\/[^/]+\/?$/.test(pathname) ||
    pathname === "/tdee" ||
    pathname === "/terms" ||
    pathname === "/contact" ||
    pathname === "/about"
  );
}

/** پارامترهای کوئریِ ناوبری که از URL پاک می‌شوند */
const NAV_QUERY_PARAMS = ["article", "tool", "screen", "exercise", "food", "sport"] as const;

/**
 * پارامترهای URL را پاک می‌کند (article, tool, screen, exercise, food, sport)
 */
export function cleanNavParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const param of [...NAV_QUERY_PARAMS, "tab", "_logout"]) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState({}, "", url.toString());
  }
}

/**
 * URL را برای یک screen خاص می‌سازد
 *
 * v119 — همهٔ صفحات عمومی (مقالات/مقاله/tdee/رشته/terms/contact/about) مسیر
 * واقعی SSR دارند و با هلپرهای navigateTo* می‌روند — این تابع فقط برای
 * screenهای داخلی اپ (landing/auth/panel/admin/onboarding) کوئری‌استایل
 * می‌سازد. pathname همیشه به ریشه برمی‌گردد تا URL کهنهٔ مسیر واقعی نماند.
 */
export function buildScreenUrl(screen: NavScreen, extra?: Record<string, string>): string {
  if (typeof window === "undefined") return "/";

  // ─── screenهای داخلی اپ — کوئری‌استایل ───
  const url = new URL(window.location.href);
  // اگر از یک مسیر واقعی (مثلاً /article/x) به screen کوئری‌استایل می‌رویم،
  // pathname باید به ریشه برگردد وگرنه URL کهنه در آدرس بار می‌ماند.
  url.pathname = "/";
  for (const param of NAV_QUERY_PARAMS) {
    url.searchParams.delete(param);
  }

  if (screen === "auth") {
    url.searchParams.set("screen", "auth");
  } else if (screen === "admin") {
    url.searchParams.set("screen", "admin");
  } else if (screen === "main" || screen === "onboarding") {
    // پنل کاربری → ?screen=panel برای رفرش
    url.searchParams.set("screen", "panel");
  }
  // landing → هیچ پارامتری نیاز نیست

  return url.toString();
}

/**
 * یک history entry جدید اضافه می‌کند (push)
 * برای navigation به جلو (مثلاً از articles به article)
 */
export function pushScreen(screen: NavScreen, extra?: Record<string, string>): void {
  if (typeof window === "undefined") return;
  const url = buildScreenUrl(screen, extra);
  window.history.pushState({ screen, ...extra }, "", url);
}

/**
 * ناوبری هوشمند — اگر کاربر لاگین کرده، به پنل می‌رود؛ اگر نه، به صفحه auth.
 *
 * این تابع باید به‌جای `setScreen("auth")` در همه دکمه‌های «شروع کنید»،
 * «ورود/ثبت‌نام» و CTA استفاده شود تا کاربر لاگین‌شده به صفحه OTP هدایت نشود.
 *
 * @param isAuthed — آیا کاربر فعلی لاگین کرده است؟ (useAppStore.user !== null)
 * @param setScreen — تابع setScreen از store
 * @param onboardingDone — آیا آنبوردینگ تکمیل شده؟ (اگر لاگین کرده ولی آنبوردینگ نکرده، به onboarding)
 */
export function smartNavigate(
  isAuthed: boolean,
  setScreen: (s: NavScreen) => void,
  onboardingDone?: boolean
): void {
  if (!isAuthed) {
    // کاربر لاگین نکرده — به صفحه auth برو
    setScreen("auth");
    pushScreen("auth");
    return;
  }
  // کاربر لاگین کرده
  if (onboardingDone === false) {
    // آنبوردینگ تکمیل نشده — به صفحه onboarding برو
    setScreen("onboarding");
    pushScreen("onboarding");
    return;
  }
  // همه چیز کامل — به پنل برو
  setScreen("main");
  pushScreen("main");
}

/**
 * URL فعلی را جایگزین می‌کند (replace)
 * برای navigation که نباید history اضافه کند (مثلاً بازگشت از article به articles)
 */
export function replaceScreen(screen: NavScreen, extra?: Record<string, string>): void {
  if (typeof window === "undefined") return;
  const url = buildScreenUrl(screen, extra);
  window.history.replaceState({ screen, ...extra }, "", url);
}

export interface ScreenFromUrl {
  screen: NavScreen | null;
}

/**
 * screen فعلی را از URL استخراج می‌کند (فقط screenهای داخلی اپ)
 * برای استفاده هنگام mount (refresh) و popstate (back/forward)
 *
 * v119 — همهٔ صفحات عمومی (مقالات/مقاله/tdee/رشته/terms/contact/about و
 * بانک حرکات/غذاها) فقط مسیر واقعی SSR دارند؛ page-client قبل از این تابع
 * با isPublicSsrPath و پارامترهای legacy هر ورودی stale را با بارگذاری کامل
 * صفحهٔ واقعی اصلاح می‌کند. اینجا فقط کوئری‌های داخلی اپ خوانده می‌شوند:
 *   ?screen=panel → main ، ?screen=admin → admin ، ?screen=auth → auth
 */
export function getScreenFromUrl(loc?: { pathname: string; search: string }): ScreenFromUrl {
  if (typeof window === "undefined") return { screen: null };
  const { search } = loc ?? window.location;
  const params = new URLSearchParams(search);

  const screenParam = params.get("screen");
  if (screenParam === "panel") {
    return { screen: "main" as NavScreen };
  }
  // v32: ?screen=admin → پنل مدیریت (دیپ‌لینک + رفرش در تب جاری — درخواست مالک)
  if (screenParam === "admin") {
    return { screen: "admin" as NavScreen };
  }
  if (screenParam === "auth") {
    return { screen: "auth" as NavScreen };
  }

  return { screen: null };
}

/**
 * ─── v106 — آیا SPA (page-client) مونت است؟ ───
 *
 * کامپوننت‌های بازاستفاده‌شده (ToolsNav/TermsPage/ContactPage/AboutPage/…)
 * هم داخل SPA (روت /) و هم در روت‌های مستقل (/terms، /tdee و…) رندر می‌شوند.
 * page-client هنگام mount فلگ سراسری می‌گذارد؛ بیرون از SPA این فلگ نیست و
 * همان کامپوننت‌ها ناوبری واقعی (window.location.assign) را انتخاب می‌کنند —
 * وگرنه setScreen/store هیچ اثری نداشت و کاربر در صفحه گیر می‌کرد.
 */
export function isSpaMounted(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __fitupSpaMounted?: boolean }).__fitupSpaMounted === true;
}
