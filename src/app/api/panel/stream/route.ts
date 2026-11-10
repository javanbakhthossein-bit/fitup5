/**
 * ─── v172 — /api/panel/stream — endpoint زندهٔ پنل کاربر (SSE) ───
 *
 * سند مالک «زنده‌سازی پنل کاربری» — بخش ۱:
 *  • Content-Type: text/event-stream (حروف کوچک) + no-transform + بدون بافر.
 *  • فقط کاربران لاگین‌شده (401 برای مهمان).
 *  • سقف نرخ: حداکثر ۱۰ اتصال جدید در دقیقه برای هر کاربر + حداکثر ۳ اتصال
 *    همزمان (هاب).
 *  • Last-Event-ID: هدر استاندارد EventSource یا ?lastEventId= — رویدادهای
 *    ازدست‌رفتهٔ ۱۵ دقیقهٔ اخیر ری‌پلی می‌شوند.
 *  • Idle timeout: اتصال بی‌رویداد بعد از ۱۰ دقیقه بسته می‌شود؛ EventSource
 *    کلاینت خودش دوباره وصل می‌شود (ری‌کانکت خودکار سند).
 *  • Keep-alive: کامنت ": ping" هر ۲۵ ثانیه — ضد بستن توسط پروکسی/لودبالانسر.
 *  • حالت پولینگ (فال‌بک سند): GET ?poll=<lastEventId> → پاسخ JSON رویدادهای
 *    ازدست‌رفته — فقط وقتی SSE در دسترس نیست کلاینت این را هر ۳۰ ثانیه می‌زند.
 *
 * امنیت (OWASP): بدون اجرای هیچ ورودی، بدون reflect روی پاسخ، مسیر فقط-خواندنی،
 * بدون کش، سقف نرخ/اتصال، لاگ خطا بدون دادهٔ حساس.
 */

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  panelConnect,
  panelDisconnect,
  panelEventsAfter,
  panelLastEventId,
  type PanelEvent,
} from "@/lib/realtime/panel-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // ۱۰ دقیقه بی‌کاری → بستن (ری‌کانکت خودکار)
const SSE_PING_INTERVAL_MS = 25 * 1000; // keep-alive ضد پروکسی

// شناسه‌ساز اتصال — per-process یکتا، مقاوم به HMR
const g = globalThis as unknown as { __fitupPanelConnSeq?: number };

/** GET /api/panel/stream — SSE زنده یا پولینگ JSON فال‌بک */
export async function GET(req: NextRequest) {
  // ─── احراز هویت — فقط کاربران لاگین‌شده (سند بخش امنیت) ───
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return Response.json(
      { ok: false, error: "برای دریافت رویدادهای زنده باید وارد شوید." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // ─── حالت پولینگ (فال‌بک ۳۰ ثانیه‌ای — فقط وقتی SSE فعال نیست) ───
  const pollParam = req.nextUrl.searchParams.get("poll");
  if (pollParam != null) {
    const rl = rateLimit(`panel-poll:${user.id}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
    const after = Math.max(0, Number.parseInt(pollParam, 10) || 0);
    const events: PanelEvent[] = panelEventsAfter(user.id, after);
    return Response.json(
      {
        ok: true,
        events,
        lastEventId: events.length > 0 ? events[events.length - 1].id : Math.max(after, 0),
        serverTime: Date.now(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ─── سقف نرخ ساخت اتصال (ضد سیل اتصال — OWASP) ───
  const rl = rateLimit(`panel-sse-connect:${user.id}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const lastEventIdHeader =
    req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("lastEventId") ?? null;

  const encoder = new TextEncoder();
  let registeredConnId = 0; // شناسهٔ اتصالِ ثبت‌شده در هاب (برای cleanup)
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (registeredConnId) {
      panelDisconnect(user.id, registeredConnId);
      registeredConnId = 0;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          return false;
        }
      };

      // عضویت در هاب — شناسهٔ اتصال همین‌جا ساخته می‌شود (اتمیک در یک تیک)
      g.__fitupPanelConnSeq = (g.__fitupPanelConnSeq ?? 0) + 1;
      const connId = g.__fitupPanelConnSeq;
      if (!panelConnect(user.id, { id: connId, write })) {
        // سقف ۳ اتصال همزمان پر است — رد درخواست (سند بخش امنیت)
        write(`event: rejected\ndata: {"type":"rejected","reason":"max_connections"}\n\n`);
        closed = true;
        try {
          controller.close();
        } catch {}
        return;
      }
      registeredConnId = connId;

      // ری‌کانکت سریع کلاینت بعد از قطعی سرور (سند ممیزی: restart سرور)
      write(`retry: 3000\n`);
      write(`: connected ${new Date().toISOString()}\n\n`);

      // ۱) رویداد خوش‌آمد — کلاینت حالت اتصال را می‌داند
      write(
        `id: 0\ndata: ${JSON.stringify({
          type: "connected",
          serverEventId: panelLastEventId(user.id),
          serverTime: Date.now(),
        })}\n\n`
      );

      // ۲) ری‌پلی رویدادهای ازدست‌رفته (last-event-id — سند بخش ۱)
      if (lastEventIdHeader) {
        const after = Math.max(0, Number.parseInt(lastEventIdHeader, 10) || 0);
        if (after > 0) {
          for (const ev of panelEventsAfter(user.id, after)) {
            const frame = `id: ${ev.id}\ndata: ${JSON.stringify({
              type: ev.type,
              ...ev.data,
              ts: ev.ts,
            })}\n\n`;
            if (!write(frame)) break;
          }
        }
      }

      // ۳) keep-alive هر ۲۵ ثانیه (ضد بستن idle توسط پروکسی)
      pingTimer = setInterval(() => {
        if (!write(`: ping\n\n`)) cleanup();
      }, SSE_PING_INTERVAL_MS);

      // ۴) idle timeout — اتصال خواب‌آلود بسته می‌شود؛ کلاینت خودش وصل می‌شود
      idleTimer = setTimeout(() => {
        if (write(`event: idle\ndata: {"type":"idle"}\n\n`)) {
          // فریم رفت؛ یک لحظه بعد بستن تمیز
          setTimeout(() => {
            cleanup();
            try {
              controller.close();
            } catch {}
          }, 50);
        } else {
          cleanup();
          try {
            controller.close();
          } catch {}
        }
      }, SSE_IDLE_TIMEOUT_MS);

      // ۵) قطع سمت کلاینت — پاکسازی فوری از هاب (ضد نشت اتصال)
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      // سند: Content-Type با حروف کوچک text/event-stream
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // ضد بافرینگ Nginx/پروکسی (سند: proxy_buffering off)
      "X-Accel-Buffering": "no",
    },
  });
}
