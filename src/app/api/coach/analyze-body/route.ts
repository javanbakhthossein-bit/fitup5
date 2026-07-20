import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeBodyPhoto } from "@/lib/fitness/ai";

export async function POST(req: NextRequest) {
  try {
    await requirePlanCapability("bodyPhotoAnalysis");
    const { base64Image, mimeType, userContext } = await req.json();
    if (!base64Image) return Response.json({ error: "تصویر ارسال نشده." }, { status: 400 });
    const result = await analyzeBodyPhoto(base64Image, mimeType || "image/jpeg", userContext || "");
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
