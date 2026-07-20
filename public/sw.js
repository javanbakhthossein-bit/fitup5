/* FitUp Service Worker
 * - Caches the app shell for offline use
 * - Network-first for HTML navigations, cache-first for static assets
 * - Handles push notifications (display them, RTL Persian)
 * - Handles notification clicks (focus the app)
 * - Periodic sync for background updates (Chrome Android only)
 * - Keepalive: SW را زنده نگه می‌دارد برای دریافت push حتی با بسته بودن اپ
 *
 * IMPORTANT: This SW is disabled in development (localhost) to prevent
 * stale cache issues during HMR. It only runs in production.
 */

const CACHE_NAME = 'fitup-v6-2025-09';
const APP_SHELL = ['/', '/manifest.json', '/logo.svg', '/favicon.png'];

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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Delete ALL old caches (including fitup-v1)
      const deletePromises = keys
        .filter((k) => k !== CACHE_NAME)
        .map((k) => caches.delete(k));
      // In dev, delete ALL caches
      if (isDev) {
        deletePromises.push(...keys.map((k) => caches.delete(k)));
      }
      return Promise.all(deletePromises);
    })
  );
  self.clients.claim();
});

// ─── Periodic Sync — برای اجرای همیشگی در پس‌زمینه (Chrome Android) ───
// این event هر ۱۲ ساعت (یا کمتر) توسط Chrome fire می‌شود تا SW را زنده نگه دارد.
// نیاز به permission 'periodic-background-sync' دارد.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'fitup-content-sync') {
    event.waitUntil(
      (async () => {
        try {
          // دریافت نوتیف‌های جدید از سرور
          const res = await fetch('/api/notifications?_t=' + Date.now(), {
            cache: 'no-store',
          });
          if (res.ok) {
            const data = await res.json();
            // اگر نوتیف جدید هست، به صفحات باز اطلاع بده
            if (data.notifications && data.notifications.length > 0) {
              const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
              for (const client of clientList) {
                client.postMessage({ type: 'PERIODIC_SYNC_DONE', payload: data });
              }
            }
          }
        } catch (e) {
          // ignore — شبکہ ممکن است در دسترس نباشد
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
    event.ports[0] && event.ports[0].postMessage({ type: 'ALIVE' });
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only handle same-origin GET requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // In dev: bypass cache entirely (network-only)
  if (isDev) {
    return; // Let the browser handle it normally
  }

  // Production: network-first for navigations (always get latest version)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          // Cache successful navigation responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // For static assets: stale-while-revalidate (but with short cache time)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
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
      data: { url: data.url || '/' },
      tag: data.tag || 'fitup-notification',
      requireInteraction: data.requireInteraction || false,
    })
  );
});

// Handle messages from the page (for local notifications + keepalive)
// (merged with the keepalive handler above — but this one handles SHOW_NOTIFICATION too)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const data = event.data.payload || {};
    self.registration.showNotification(data.title || 'فیتاپ', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'fa',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' },
      tag: data.tag || 'fitup-notification',
    });
  }
});

// ─── pushsubscriptionchange: وقتی مرورگر subscription را تجدید می‌کند ───
// این برای پایداری بلندمدت حیاتی است — بدون این، پس از مدتی subscription
// منقضی می‌شود و نوتیف‌ها دیگر ارسال نمی‌شوند.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const reg = await self.registration;
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
      // ثبت subscription جدید در سرور
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSub),
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

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data.url || '/');
    })
  );
});
