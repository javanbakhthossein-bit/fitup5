import { NextRequest, NextResponse } from "next/server";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { db } from "@/lib/db";

/**
 * POST /api/coach/tts
 * تبدیل متن فارسی به صدا با Gemini 2.5 Flash TTS
 * Body: { text: string }
 * Response: audio/mpeg (MP3)
 *
 * مستندات: https://api.avalai.ir/v1/audio/speech (سازگار با OpenAI)
 * مدل: gemini-2.5-flash-tts
 *
 * انتخاب صدا بر اساس جنسیت کاربر:
 *   - مرد (male)   → alloy   (نگاشت به Kore در Gemini — صدای مرد)
 *   - زن (female)  → shimmer (نگاشت به چرنوبیل/زن در Gemini — صدای زن)
 *   - نامشخص       → alloy   (پیش‌فرض: صدای مرد)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { text } = await req.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "متن خالی است" }, { status: 400 });
    }

    // ─── تعیین صدای TTS بر اساس جنسیت کاربر ───
    // برای مرد→صدای مرد، برای زن→صدای زن
    let voice: string = "alloy"; // پیش‌فرض: صدای مرد
    try {
      const profile = await db.onboardingProfile.findUnique({
        where: { userId: user.id },
        select: { gender: true },
      });
      if (profile?.gender === "female") {
        voice = "shimmer"; // صدای زن
      }
      // male یا نامشخص → alloy (صدای مرد)
    } catch {
      // اگر پروفایل پیدا نشد، پیش‌فرض (alloy) استفاده می‌شود
    }

    // ─── خواندن کامل متن — بدون محدودیت ۵۰۰ کاراکتر ───
    // قبلاً متن به ۵۰۰ کاراکتر محدود می‌شد که باعث می‌شد پاسخ‌های طولانی ناقص خوانده شوند.
    // حالا کل متن خوانده می‌شود. اگر متن خیلی طولانی باشد، به بخش‌های ۹۰۰ کاراکتری تقسیم می‌شود.
    // API AvalAI محدودیت ۹۰۰ بایت برای هر فیلد دارد، پس متن‌های طولانی را chunk می‌کنیم.
    const MAX_CHUNK = 900; // حدود ۹۰۰ کاراکتر فارسی
    const chunks: string[] = [];
    if (text.length <= MAX_CHUNK) {
      chunks.push(text);
    } else {
      // تقسیم متن به بخش‌های ۹۰۰ کاراکتری در مرز جمله‌ها
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK) {
          chunks.push(remaining);
          break;
        }
        // پیدا کردن آخرین نقطه/علامت سوال در ۹۰۰ کاراکتر آخر
        let cutIdx = remaining.lastIndexOf("۔", MAX_CHUNK);
        if (cutIdx === -1 || cutIdx < MAX_CHUNK * 0.5) cutIdx = remaining.lastIndexOf(".", MAX_CHUNK);
        if (cutIdx === -1 || cutIdx < MAX_CHUNK * 0.5) cutIdx = remaining.lastIndexOf("؟", MAX_CHUNK);
        if (cutIdx === -1 || cutIdx < MAX_CHUNK * 0.5) cutIdx = remaining.lastIndexOf("\n", MAX_CHUNK);
        if (cutIdx === -1 || cutIdx < MAX_CHUNK * 0.5) cutIdx = MAX_CHUNK;
        else cutIdx += 1; // شامل نقطه
        chunks.push(remaining.slice(0, cutIdx));
        remaining = remaining.slice(cutIdx).trim();
      }
    }

    const apiKey = process.env.AVALAI_TTS_API_KEY || process.env.AVALAI_API_KEY;
    const baseURL = process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1";

    // اگر فقط یک chunk است، مستقیم برمی‌گردانیم
    if (chunks.length === 1) {
      const res = await fetch(`${baseURL}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash-tts",
          voice,
          input: chunks[0],
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[tts] AvalAI error:", res.status, errText);
        return NextResponse.json({ error: "خطا در تولید صدا" }, { status: 502 });
      }

      const audioBuffer = await res.arrayBuffer();
      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": 'inline; filename="speech.mp3"',
          "Cache-Control": "no-cache",
        },
      });
    }

    // ─── چند chunk: دریافت همه و ترکیب در یک MP3 ───
    // توجه: ترکیب MP3 به‌صورت باینری concatenation کار می‌کند چون MP3 فریم‌بنیاد است
    const audioChunks: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const res = await fetch(`${baseURL}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash-tts",
          voice,
          input: chunk,
          response_format: "mp3",
        }),
      });
      if (!res.ok) {
        console.error("[tts] AvalAI error on chunk:", res.status);
        return NextResponse.json({ error: "خطا در تولید صدا" }, { status: 502 });
      }
      audioChunks.push(await res.arrayBuffer());
    }

    // ترکیب همه chunks در یک Buffer
    const totalLength = audioChunks.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioChunks) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    return new NextResponse(combined.buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": 'inline; filename="speech.mp3"',
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
