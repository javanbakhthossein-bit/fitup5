"use client";

/**
 * trackToolUsage — پیگیری سبک استفاده از ابزارهای رایگان (Task 5-e — قیف تبدیل)
 *
 * fire-and-forget: هرگز UX ابزار را خراب نمی‌کند (خطاها بی‌صدا نادیده).
 * برای جلوگیری از رشد بی‌رویهٔ جدول ToolUsage، هر ابزار در هر مرورگر حداکثر
 * یک بار در هر ۶ ساعت ثبت می‌شود (فلگ localStorage — مهمان هم همین‌طور).
 */

const VALID_TOOLS = new Set(["tdee", "foods", "exercises"]);
const FLAG_TTL_MS = 6 * 60 * 60 * 1000; // ۶ ساعت

export type FunnelTool = "tdee" | "foods" | "exercises";

export function trackToolUsage(tool: FunnelTool, result?: string): void {
  try {
    if (!VALID_TOOLS.has(tool)) return;
    const key = `fitup_tool_tracked_${tool}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const at = Number(raw);
      if (Number.isFinite(at) && Date.now() - at < FLAG_TTL_MS) return;
    }
    localStorage.setItem(key, String(Date.now()));
    void fetch("/api/tools/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, result: result ? String(result).slice(0, 64) : undefined }),
      keepalive: true,
    }).catch(() => {
      /* بی‌صدا — قیف نباید خطا تولید کند */
    });
  } catch {
    /* گارد storage (حالت خصوصی) — بی‌صدا */
  }
}
