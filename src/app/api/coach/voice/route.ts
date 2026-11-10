import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { logAiUsage } from "@/lib/fitness/costs";

/**
 * v71 فال‌بک پیاده‌سازی صدا با جمنای — کلید AvalAI مالک برای مدل‌های صوتی
 * محدود شده است (403 «Access denied» برای whisper-1 و همهٔ /audio/transcriptions)
 * ولی جمنای از مسیر chat completions با input_audio صدا را می‌فهمد. این فال‌بک
 * مسیر ویس چت را بدون نیاز به تغییر کلید زنده نگه می‌دارد (تست واقعی: 200 ✓).
 * فرمت‌ها تست شدند: webm/ogg/mp3 همه 200 (مرورگر MediaRecorder خروجی webm می‌دهد).
 */
async function transcribeWithGemini(audio: File): Promise<string | null> {
  try {
    const apiKey = process.env.AVALAI_API_KEY;
    const baseURL = process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1";
    if (!apiKey) return null;
    const buf = Buffer.from(await audio.arrayBuffer());
    if (buf.length === 0) return null;
    // نگاشت mime → format پذیرفته‌شدهٔ input_audio
    const mime = (audio.type || "audio/webm").toLowerCase();
    const format = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : "webm";
    const t0 = Date.now();
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "این فایل صوتی را دقیقاً و کامل پیاده‌سازی (transcribe) کن. زبان اصلی گوینده را حفظ کن. فقط متن پیاده‌سازی را بنویس — هیچ توضیح، مقدمه، نقل‌قول یا پس‌وند اضافه ننویس. اگر هیچ گفتاری شنیده نشد فقط رشتهٔ خالی برگردان.",
              },
              { type: "input_audio", input_audio: { data: buf.toString("base64"), format } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });
    if (!r.ok) {
      console.error("[voice] gemini transcription fallback error:", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j: any = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    // پاک‌سازی پاسخ‌های توهمی روی سکوت/تن صدا (مثل whisper)
    const text = raw
      .replace(/^\[(تن|نویز|سکوت)\]$/i, "")
      .replace(/^["«']+|["»']+$/g, "")
      .trim();
    // حسابداری v70 — لاگ مصرف فال‌بک (best-effort)
    try {
      const usage = j?.usage;
      if (usage) {
        await logAiUsage({
          route: "voice:transcribe",
          model: String(j?.model ?? "gemini-3.8-flash"),
          promptTokens: Number(usage.prompt_tokens ?? 0) || 0,
          completionTokens: Number(usage.completion_tokens ?? 0) || 0,
          totalTokens: Number(usage.total_tokens ?? Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0)) || 0,
          latencyMs: Date.now() - t0,
          userId: null,
        });
      }
    } catch {
      // لاگ هرگز پاسخ را نمی‌شکند
    }
    return text || null;
  } catch (e) {
    console.error("[voice] gemini transcription fallback failed:", e);
    return null;
  }
}

/**
 * v72 حسابداری — کوت‌اف whisper مرده:
 * کلید AvalAI مالک برای /audio/transcriptions محدود است (403). قبلاً «هر» پیام ویس
 * اول یک کال whisper می‌فرستاد که همیشه 403 می‌شد (کال مرده + تأخیر اضافه) و بعد
 * فال‌بک جمنای اجرا می‌شد. حالا بعد از اولین 403، whisper تا ۲۴ ساعت دور زده
 * می‌شود و درخواست مستقیم به جمنای می‌رود (صفر کال مرده). اگر مالک بعداً کلید
 * بدون محدودیت بسازد، بعد از ۲۴ ساعت (یا ری‌استارت) whisper خودکار برمی‌گردد.
 */
let whisperBlockedUntil = 0;

/**
 * POST /api/coach/voice
 * دریافت فایل صوتی (audio/webm) و تبدیل به متن با Whisper API
 * Body: FormData with "audio" field
 * Response: { text: string }
 */
export async function POST(req: NextRequest) {
  try {
    // ─── M7: گیت پلن — ارسال ویس در چت مربی قابلیت پیشرفته (advanced+) است ───
    await requirePlanCapability("aiChat");
    const user = await requireAuth();

    // ─── H2/H6: محدودیت نرخ — ۲۰ درخواست در دقیقه برای هر کاربر ───
    const rl = rateLimit(`coach-voice:${user.id}`, 20, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return NextResponse.json({ error: "فایل صوتی یافت نشد" }, { status: 400 });
    }

    // ارسال به Whisper API (AvalAI — OpenAI compatible)
    // استفاده از کلید TTS (همان کلیدی که برای سرویس‌های صوتی استفاده می‌شود)
    const apiKey = process.env.AVALAI_TTS_API_KEY || process.env.AVALAI_API_KEY;
    const baseURL = process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1";

    if (!apiKey) {
      return NextResponse.json({ error: "سرویس صوتی پیکربندی نشده" }, { status: 503 });
    }

    // v72 — whisper فقط اگر کوت‌اف ۴۰۳ فعال نیست؛ وگرنه مستقیم فال‌بک جمنای
    if (Date.now() >= whisperBlockedUntil) {
      // ساخت FormData برای Whisper
      const whisperForm = new FormData();
      whisperForm.append("file", audioFile, "voice.webm");
      whisperForm.append("model", "whisper-1");
      whisperForm.append("language", "fa");

      const res = await fetch(`${baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: whisperForm,
      });

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ text: data.text || "" });
      }
      const errText = await res.text();
      console.error("[voice] Whisper error:", res.status, errText.slice(0, 300));
      if (res.status === 403 || res.status === 404) {
        // کلید برای مسیر صوتی محدود است — ۲۴ ساعت کوت‌اف (صفر کال مرده)
        whisperBlockedUntil = Date.now() + 24 * 60 * 60 * 1000;
        console.warn("[voice] whisper blocked (403/404) — short-circuited to gemini for 24h");
      }
    }

    // ─── v71: فال‌بک جمنای — کلید AvalAI برای مدل‌های صوتی محدود است (403)
    // و همهٔ کاربران 502 می‌گرفتند. جمنای صدا را می‌فهمد (تست واقعی ✓).
    const fallbackText = await transcribeWithGemini(audioFile);
    if (fallbackText) {
      return NextResponse.json({ text: fallbackText });
    }
    return NextResponse.json({ error: "خطا در تبدیل صدا به متن" }, { status: 502 });
  } catch (e) {
    return apiError(e);
  }
}
