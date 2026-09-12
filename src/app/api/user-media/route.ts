import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * GET /api/user-media
 *
 * دریافت تمام عکس‌ها، ویدیوها و تحلیل‌های کاربر به‌صورت دسته‌بندی شده.
 *
 * دسته‌ها:
 *  - bodyPhotos:     عکس‌های پیشرفت بدن (ProgressPhoto)
 *  - bloodTests:     نتایج تحلیل آزمایش خون (AnalysisResult type=blood_test)
 *  - videoAnalysis:  نتایج تحلیل ویدیو (AnalysisResult type=video_analysis)
 *  - bodyAnalysis:   نتایج تحلیل عکس بدن (AnalysisResult type=body_photo)
 *  - videos (v53):   همهٔ ویدیوهای کاربر از همه‌جا — برای تب «ویدیوها» گالری پیشرفت:
 *      · ChatMessage های mediaType="video" دارای mediaUrl (منبع: چت)
 *      · AnalysisResult های type="video_analysis" دارای mediaUrl (منبع: آنالیز ویدیو)
 *    هر آیتم: { id, url, createdAt, source: "chat" | "video_analysis" } — نزولی بر اساس تاریخ.
 */
export async function GET() {
  try {
    const user = await requireAuth();

    const [progressPhotos, analysisResults, chatVideos] = await Promise.all([
      db.progressPhoto.findMany({
        where: { userId: user.id },
        orderBy: { takenAt: "desc" },
      }),
      db.analysisResult.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      // v53: ویدیوهای ارسالی کاربر در چت مربی — فقط فایل واقعی (mediaUrl + mediaType=video)
      db.chatMessage.findMany({
        where: { userId: user.id, mediaType: "video", mediaUrl: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true, mediaUrl: true, createdAt: true },
      }),
    ]);

    const bloodTests = analysisResults
      .filter((r) => r.type === "blood_test")
      .map((r) => ({
        id: r.id,
        mediaUrl: r.mediaUrl,
        result: safeParse(r.result),
        createdAt: r.createdAt.toISOString(),
      }));

    const videoAnalysis = analysisResults
      .filter((r) => r.type === "video_analysis")
      .map((r) => ({
        id: r.id,
        mediaUrl: r.mediaUrl,
        result: safeParse(r.result),
        createdAt: r.createdAt.toISOString(),
      }));

    const bodyAnalysis = analysisResults
      .filter((r) => r.type === "body_photo")
      .map((r) => ({
        id: r.id,
        mediaUrl: r.mediaUrl,
        result: safeParse(r.result),
        createdAt: r.createdAt.toISOString(),
      }));

    // ─── v53: گروه videos — ویدیوهای چت + ویدیوهای آنالیز، مرتب نزولی ───
    const videos = [
      ...chatVideos
        .filter((c) => c.mediaUrl)
        .map((c) => ({
          id: c.id,
          url: c.mediaUrl as string,
          createdAt: c.createdAt.toISOString(),
          source: "chat" as const,
        })),
      ...analysisResults
        .filter((r) => r.type === "video_analysis" && r.mediaUrl)
        .map((r) => ({
          id: r.id,
          url: r.mediaUrl as string,
          createdAt: r.createdAt.toISOString(),
          source: "video_analysis" as const,
        })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return Response.json({
      bodyPhotos: progressPhotos.map((p) => ({
        id: p.id,
        imageUrl: p.imageUrl,
        type: p.type,
        note: p.note,
        takenAt: p.takenAt.toISOString(),
      })),
      bloodTests,
      videoAnalysis,
      bodyAnalysis,
      videos,
    });
  } catch (e) {
    return apiError(e);
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
