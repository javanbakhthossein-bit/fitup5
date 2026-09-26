import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/fitness/auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * POST /api/tools/track — ثبت استفاده از ابزارهای رایگان (Task 5-e — قیف تبدیل)
 *
 * بدنه: { tool: "tdee" | "foods" | "exercises", result?: string }
 *
 *  - احراز هویت اختیاری است: کاربر لاگین → ردیف ToolUsage با userId ثبت می‌شود؛
 *    مهمان → بدون ثبت، { ok:true, guest:true } برمی‌گردد (کلاینت فلگ localStorage
 *    نگه می‌دارد تا هر سشن فقط یک بار پیگیری شود — بدون رشد بی‌رویهٔ جدول).
 *  - Rate limit per-IP: ۲۰ درخواست در دقیقه.
 *  - Fire-and-forget سمت کلاینت: هر خطای این روت هرگز UX ابزار را خراب نمی‌کند.
 */

const VALID_TOOLS = new Set(["tdee", "foods", "exercises"]);

export async function POST(req: NextRequest) {
  // ─── Rate limit per-IP ───
  const rl = rateLimit(`tools-track:${getClientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { tool?: unknown; result?: unknown }
      | null;

    const tool = typeof body?.tool === "string" ? body.tool.trim() : "";
    if (!VALID_TOOLS.has(tool)) {
      return Response.json(
        { ok: false, error: "ابزار نامعتبر است." },
        { status: 400 }
      );
    }

    // خلاصهٔ نتیجه — حداکثر ۶۴ کاراکتر، تک‌خطی (پاک‌سازی کاراکترهای کنترلی)
    const result =
      typeof body?.result === "string"
        ? body.result.replace(/[\r\n\t]/g, " ").trim().slice(0, 64) || null
        : null;

    // احراز هویت اختیاری — مهمان بدون ردیف برگردد
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ ok: true, guest: true });
    }

    await db.toolUsage.create({
      data: { userId: user.id, tool, result },
    });

    return Response.json({ ok: true, guest: false });
  } catch {
    // ثبت قیف هرگز نباید جلوی کاربر را بگیرد — پاسخ موفق ظاهری
    return Response.json({ ok: true });
  }
}
