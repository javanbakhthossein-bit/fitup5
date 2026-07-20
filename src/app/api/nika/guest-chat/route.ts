import { NextRequest } from "next/server";
import { nikaChat } from "@/lib/fitness/ai";
import type { Plan } from "@/lib/fitness/types";

/**
 * چت نیکا بدون نیاز به ثبت‌نام (حالت مهمان).
 * تاریخچه در body ارسال می‌شود (stateless) — کلاینت در localStorage نگه می‌دارد.
 */
export async function POST(req: NextRequest) {
  try {
    const { message, history, userPlan } = (await req.json()) as {
      message: string;
      history: { role: string; content: string }[];
      userPlan?: Plan | null;
    };

    if (!message || typeof message !== "string") {
      return Response.json({ error: "پیام خالی است." }, { status: 400 });
    }

    const nikaResponse = await nikaChat(
      history || [],
      message,
      userPlan ?? null
    );

    return Response.json({
      nikaMessage: {
        id: `guest_${Date.now()}`,
        role: "assistant",
        content: nikaResponse,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته";
    console.error("[Nika Guest Chat Error]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
