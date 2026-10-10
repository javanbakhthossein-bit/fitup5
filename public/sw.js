/* FitUp Service Worker
 * ─── v165 — بازطراحی استراتژی کش (فیکس ریشه‌ای دو باگ P0 مالک) ───
 *
 *  باگ ۱ (صفحهٔ سفید ابدی): بعد از هر دیپلوی، دستگاه‌هایی که HTML قدیمی را
 *  از کش سرو می‌کردند به چانک‌های JS حذف‌شده برمی‌خوردند → هیچ JS اجرا
 *  نمی‌شد → صفحهٔ سفیدِ همیشه‌گی (تأیید: طوفان ChunkLoadError در لاگ خطاها).
 *  باگ ۲ (فلش «سشن قبلی» در هدر): HTML شخصی‌سازی‌شدهٔ دوران لاگین (با نام
 *  کاربر) در کش می‌ماند و در رفرشِ بعدی یک لحظه نشان داده می‌شد.
 *
 *  ریشهٔ مشترک: کش‌کردن HTML ناوبری‌ها. HTML این اپ «همیشه شخصی» است (سشن،
 *  نام کاربر، چانک‌های همان بیلد) و عمر مفیدش صفر است — هیچ حالتی از
 *  سروکردن HTML کش‌شده درست نیست.
 *
 *  سیاست جدید (هم‌تراز با اپ‌های استاندارد):
 *    • ناوبری‌ها (HTML): همیشه شبکه — بدون هیچ کشی. شکست لحظه‌ای → ۳ تلاش
 *      پشت‌سرهم؛ آفلاین واقعی → اسپلش خود فیتاپ (بدون هیچ متن/دکمهٔ خطا) با
 *      بازگشت خودکار. (v225 — دیرکتیو مالک)
 *    • فایل‌های استاتیک (چانک/عکس/فونت — نام‌شان content-hashed است):
 *      stale-while-revalidate مثل قبل امن است و می‌ماند.
 *    • پاک‌سازی درمانی: در activate هر entry از جنس text/html در «همهٔ»
 *      کش‌های قدیمی حذف می‌شود → دستگاه‌های همین الان گیرکرده خودشان
 *      حداکثر با ۱-۲ بار بازکردن اپ/رفرش کاملاً درمان می‌شوند.
 *    • skipWaiting در install: نسخهٔ جدید SW بدون انتظار فعال می‌شود تا
 *      پاک‌سازی درمانی سریع به همه برسد (صفحه‌های باز فقط یک رفرش می‌خواهند).
 *
 *  - Push notifications (نمایش RTL فارسی) — دست‌نخورده
 *  - notificationclick (focus + deep-link معتبر) — دست‌نخورده
 *  - Periodic sync (فقط refresh صفحات باز، بدون اعلان الکی) — دست‌نخورده
 *
 *  IMPORTANT: This SW is disabled in development (localhost) to prevent
 *  stale cache issues during HMR. It only runs in production.
 */

const CACHE_NAME = 'fitup-v16-2026-10'; // v225: بمپ نسخه — فال‌بک اسپلش بدون-خطا + ریتری ناوبری؛ کش قدیمی در activate پاک می‌شود // v189: بمپ نسخه — کش قدیمی (بدون ویدیو) در activate پاک می‌شود // v165: استراتژی بدون-HTML — بمپ نسخه، کش قدیمی در activate پاک می‌شود
// ⚠️ v165: '/' دیگر در precache نیست — HTML شخصی هرگز نباید کش شود
const APP_SHELL = ['/manifest.json', '/logo.svg', '/favicon.png'];

// Skip caching in development (localhost only)
// fitup.space-z.ai is treated as production
const isDev =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1';

self.addEventListener('install', (event) => {
  if (isDev) {
    // In dev: skip caching entirely, activate immediately
    self.skipWaiting();
    return;
  }
  // Precache app shell (بدون HTML!) + فعال‌سازی فوری نسخهٔ جدید.
  // v165 — skipWaiting همیشه: نسخهٔ جدید باید سریع برسد چون activate آن
  // «پاک‌سازی درمانی HTML» را انجام می‌دهد (درمان دستگاه‌های گیرکرده).
  // صفحه‌های باز با SW قدیمی کار می‌کنند تا رفرش بعدی؛ آسیبی ندارند
  // (چانک‌های لودشدهٔ خودشان را دارند — فقط HTML جدید در رفرش می‌آید).
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL).catch(() => {});
      } catch (e) {}
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // ۱) همهٔ کش‌های نسخه‌های قبلی حذف می‌شوند (رفتار قبلی)
      const deleteOld = keys
        .filter((k) => k !== CACHE_NAME)
        .map((k) => caches.delete(k));
      // ۲) پاک‌سازی درمانی v165: هر response از جنس HTML (شخصی‌سازی‌شده/
      //    مالکِ چانک‌های بیلدِ خودش) از «هر» کشی حذف می‌شود — حتی از کش
      //    فعلی. این همان مکانیزمی است که دستگاه‌های قربانیِ HTML قدیمی
      //    (صفحهٔ سفید / فلش سشن) را بدون نصب مجدد درمان می‌کند.
      const purgeHtml = keys.map(async (k) => {
        try {
          const cache = await caches.open(k);
          const reqs = await cache.keys();
          await Promise.all(
            reqs.map(async (req) => {
              try {
                const resp = await cache.match(req);
                const type = resp ? resp.headers.get('content-type') || '' : '';
                if (type.includes('text/html')) await cache.delete(req);
              } catch (e) {}
            })
          );
        } catch (e) {}
      });
      await Promise.all([...deleteOld, ...purgeHtml]);
      // FE-M11: clients.claim — صفحات بازِ بدون controller هم پوشش داده شوند
      await self.clients.claim();
    })()
  );
});

// ─── فال‌بک آفلاین (v225) — «اسپلش خود فیتاپ»، نه هیچ صفحهٔ خطایی ───
// دیرکتیو مالک (۱۰ بار تکرار شد): «این صفحهٔ اتصال برقرار نیست / فیتاپ به اینترنت
// نیاز دارد باید حذف بشه؛ به جاش همون اسپلش خود اپ‌ها رو بذار.»
// پس فال‌بک = بازسازی پیکسل‌به‌پیکسل اسپلش برند اپ (زمینهٔ سفید + لوگوی نارنجی +
// «فیتاپ» + شعار + اسپینر) — صفر کلمهٔ خطا، صفر دکمه. حلقهٔ بی‌صدا هر ثانیه
// مسیر شبکه را پروب می‌کند و به‌محض جواب، خودکار به همان صفحه برمی‌گردد.
// نکتهٔ فنی: پروب عمداً روی مسیر /api/ است (SW هرگز /api/ را هندل نمی‌کند و
// هیچ کشی وسطش نیست) + cache:'no-store' → جوابِ هر وضعیتی (حتی ۴۰۱) یعنی
// مسیر شبکه زنده است. (باگ قبلی: پروبِ manifest.json از کش SW جواب الکی
// می‌گرفت و reload حلقه‌ای می‌ساخت.)
const SPLASH_HTML = '<!DOCTYPE html><html lang="fa" dir="rtl"><head>' +
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>فیتاپ</title><style>' +
  'body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  "background:#fff;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,Arial,sans-serif}" +
  '.logo{width:84px;height:84px;border-radius:22px;display:flex;align-items:center;justify-content:center;' +
  'color:#fff;font-size:42px;font-weight:900;background:linear-gradient(135deg,#f59e0b,#f97316);' +
  'box-shadow:0 10px 30px rgba(249,115,22,.35)}' +
  '.t{margin-top:18px;font-size:26px;font-weight:800;color:#0f172a}' +
  '.s{margin-top:6px;font-size:14px;color:#64748b}' +
  '.sp{margin-top:26px;width:30px;height:30px;border-radius:50%;' +
  'border:3px solid #fed7aa;border-top-color:#ea580c;animation:spin 1s linear infinite}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '</style></head><body>' +
  '<div class="logo">ف</div>' +
  '<div class="t">فیتاپ</div>' +
  '<div class="s">هر بدنی فیتاپ میخواد!</div>' +
  '<div class="sp"></div>' +
  '<script>(function loop(){' +
  'fetch("/api/push/vapid-key",{cache:"no-store"}).then(function(){' +
  'try{location.replace(location.href)}catch(e){location.reload()}})' +
  '.catch(function(){setTimeout(loop,1000)})})();' +
  '</script></body></html>';

// ─── Periodic Sync — برای اجرای همیشگی در پس‌زمینه (Chrome Android) ───
// این event هر ۱۲ ساعت (یا کمتر) توسط Chrome fire می‌شود تا SW را زنده نگه دارد.
// نیاز به permission 'periodic-background-sync' دارد.
//
// ⚠️ FIX (نوتیف الکی): در نسخه قدیمی، این‌جا نوتیف‌های سرور fetch می‌شد و
// showNotification صدا زده می‌شد — بی‌خبر از read/shown بودن → اعلان‌های قدیمی
// (مثلاً «برنامه پیشرفته شما آماده شد» چند ساعت/روز بعد از رویداد) دوباره
// نمایش داده می‌شد و برای کاربر «الکی» بود. اکنون فقط صفحات باز را به‌روز
// می‌کند؛ نمایش اعلان سیستم فقط وقتی است که سرور push واقعی بفرستد (لحظه
// رویداد). اگر اپ بسته باشد، web-push که همراه createNotification ارسال
// می‌شود همان لحظه اعلان سیستم را نشان می‌دهد.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'fitup-content-sync') {
    event.waitUntil(
      (async () => {
        try {
          const res = await fetch('/api/notifications?_t=' + Date.now(), {
            cache: 'no-store',
          });
          if (res.ok) {
            const data = await res.json();
            // اگر نوتیف جدید هست، به صفحات باز اطلاع بده (فقط refresh داخلی —
            // هیچ showNotification انجام نمی‌شود)
            const unread = (data.notifications || []).some((n) => !n?.read);
            if (unread) {
              const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
              for (const client of clientList) {
                client.postMessage({ type: 'PUSH_RECEIVED', payload: data });
              }
            }
          }
        } catch (e) {
          // ignore — شبکه ممکن است در دسترس نباشد
        }
      })()
    );
  }
});

// ─── message handler — برای نگه‌داشتن SW زنده ───
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'KEEPALIVE') {
    // پاسخ به keepalive ping — SW را زنده نگه می‌دارد
    if (event.ports[0]) event.ports[0].postMessage({ type: 'ALIVE' });
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only handle same-origin GET requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // ⚠️ NEVER cache API responses — always go to network.
  // این مهم است: API‌ها همیشه باید از network خوانده شوند تا داده‌های تازه نمایش داده شوند.
  // بدون این، کاربر مقالات جدید، برنامه‌های جدید، کاربران جدید و ... را تا Ctrl+Shift+R نمی‌بیند.
  if (event.request.url.includes('/api/')) {
    return; // Let the browser handle it normally (no SW caching)
  }

  // v189 — ویدیوها هرگز کش نشوند: ۱۰۱۱ فایل mp4 (~۳۵۱MB) نباید در Cache Storage
  // کاربر ذخیره شوند؛ پخش/seek ویدیو هم با Range request خود مرورگر بهترین است.
  try {
    const path = new URL(event.request.url).pathname.toLowerCase();
    if (path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.m4v') || path.endsWith('.mov')) {
      return; // Let the browser handle it normally (no SW caching)
    }
  } catch { /* آدرس نامعتبر — ادامه */ }

  // In dev: bypass cache entirely (network-only)
  if (isDev) {
    return; // Let the browser handle it normally
  }

  // ─── v225 — ناوبری‌ها (HTML): همیشه شبکه، بدون کش + ریتری داخلی ───
  // HTML این اپ شخصی و بیلد-خاص است؛ هیچ نسخهٔ کش‌شده‌ای نباید سرو شود.
  // 🩹 ریشهٔ «اتصال برقرار نیست» در شروع سرد: اولین fetch ناوبری گاهی یک‌بار
  // شکست می‌خورد (DNS/سوکت هنوز کامل بیده نشده) و قبلاً بلافاصله صفحهٔ خطا
  // می‌آمد. حالا تا ۳ تلاش پشت‌سرهم (فاصلهٔ ۶۰۰ms/۱۵۰۰ms) انجام می‌شود —
  // تقریباً همهٔ این شکست‌های لحظه‌ای بی‌صدا جذب می‌شوند و کاربر هیچ‌چیز
  // نمی‌بیند. فقط اگر هر ۳ تلاش شکست خورد، فال‌بک = اسپلش خود فیتاپ
  // (SPLASH_HTML) با حلقهٔ بازگشت خودکار — دیگر هیچ صفحهٔ خطایی وجود ندارد.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await fetch(event.request, { cache: 'no-cache' });
          } catch (e) {
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, attempt === 0 ? 600 : 1500));
            }
          }
        }
        return new Response(SPLASH_HTML, {
          status: 503,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      })()
    );
    return;
  }

  // For static assets: stale-while-revalidate (content-hashed URLs — امن).
  // ⚠️ نکتهٔ v165: پاسخ‌های HTML دیگر هیچ‌وقت به این مسیر نمی‌آیند (بالا
  // هندل شدند) و اگر از کش‌های خیلی قدیمی HTMLی باقی مانده باشد، activate
  // آن‌ها را پاک کرده است.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            // دفاع دو-لایه: پاسخ HTML (اگر به هر دلیلی به اینجا رسید) کش نمی‌شود
            const type = response.headers.get('content-type') || '';
            if (!type.includes('text/html')) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push notifications — handles both server push AND local notifications
self.addEventListener('push', (event) => {
  let data = { title: 'فیتاپ', body: 'یادآوری از فیتاپ', url: '/' };
  try {
    if (event.data) data = JSON.parse(event.data.text());
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }
  // Notify all open pages that a push arrived — so they can refresh the
  // in-app notification list immediately (without waiting for the next poll).
  // این پیام در main-app.tsx توسط navigator.serviceWorker.addEventListener('message')
  // دریافت می‌شود و یک fetch فوری روی /api/notifications را trigger می‌کند.
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      client.postMessage({ type: 'PUSH_RECEIVED', payload: data });
    }
  });
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'fa',
      vibrate: [100, 50, 100],
      data: { url: sanitizeNotificationUrl(data.url || '/') },
      tag: data.tag || 'fitup-notification',
      requireInteraction: data.requireInteraction || false,
    })
  );
});

// v36 — رفع «Chrome detected spam from fittup.ir»:
// هندلر SHOW_NOTIFICATION حذف شد — قبلاً به هر کد صفحه‌ای اجازه می‌داد بدون
// push و بدون تعامل کاربر، نوتیف سیستم‌عامل نشان دهد («اعلان بدون gesture» —
// یکی از سیگنال‌های کلاسیک اعلان مزاحم برای گوگل). کدی هم از آن استفاده
// نمی‌کرد (dead code). حالا تنها راه نمایش نوتیف، push واقعی سرور است
// و پیام‌های صفحه (keepalive) در هندلر بالای فایل پاسخ داده می‌شوند.

// ─── pushsubscriptionchange: وقتی مرورگر subscription را تجدید می‌کند ───
// این برای پایداری بلندمدت حیاتی است — بدون این، پس از مدتی subscription
// منقضی می‌شود و نوتیف‌ها دیگر ارسال نمی‌شوند.
// v63 — ضد نوتیف تکراری: previousEndpoint هم به سرور می‌رود تا ردیف قدیمیِ
// همین دستگاه بلافاصله حذف شود (قبلاً ردیف قبلی یتیم می‌ماند و سرور به هر
// دو endpoint push می‌فرستد = نوتیف دوباره).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const reg = await self.registration;
      const previousEndpoint = event.oldSubscription?.endpoint || null;
      // درخواست subscription جدید با همان کلید VAPID
      const vapidKey = await fetch('/api/push/vapid-key')
        .then(r => r.json())
        .then(d => d.publicKey)
        .catch(() => null);
      if (!vapidKey) return;
      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      // ثبت subscription جدید در سرور (+ حذف endpoint قبلی سمت سرور)
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newSub.toJSON(),
          ...(previousEndpoint ? { previousEndpoint: previousEndpoint } : {}),
        }),
      });
    })()
  );
});

// تبدیل base64url به Uint8Array (برای VAPID key)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ─── Notification click ───
// FIX (باز شدن سورس sw.js): در نسخه قدیمی، مقصد نوتیف بدون اعتبارسنجی
// بود و در برخی حالت‌ها آدرس فایل خود service worker (/sw.js) باز می‌شد و
// کاربر سورس‌کد را به‌جای صفحه اپ می‌دید. اکنون مقصد قبل از ناوبری
// اعتبارسنجی می‌شود:
//   • فقط same-origin
//   • هرگز مسیر /sw.js یا /api/* یا فایل‌های داخلی
//   • مسیرهای نسبی (مثل «?tab=programs») در برابر origin حل می‌شوند
// اگر نامعتبر بود → صفحه اصلی اپ باز می‌شود.
function sanitizeNotificationUrl(raw) {
  try {
    const u = new URL(String(raw || '/'), self.location.origin);
    if (u.origin !== self.location.origin) return '/';
    if (
      u.pathname === '/sw.js' ||
      u.pathname.startsWith('/api/') ||
      u.pathname.startsWith('/_next/') ||
      u.pathname.startsWith('/src/')
    ) {
      return '/';
    }
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // FE-M11: مقصد deep-link نوتیف — اگر پنجره‌ای باز است، علاوه بر focus
  // به مقصد هم ناوبری کن (قبلاً فقط focus می‌شد و url نادیده گرفته می‌شد)
  const targetUrl = sanitizeNotificationUrl(
    (event.notification.data && event.notification.data.url) || '/'
  );
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            if (
              typeof client.navigate === 'function' &&
              targetUrl &&
              targetUrl !== '/'
            ) {
              // ناوبری به مقصد نوتیف؛ خطا (مثلاً scope) بی‌صدا نادیده گرفته می‌شود
              client.navigate(targetUrl).catch(() => {});
            }
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
