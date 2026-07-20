import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logError } from "@/lib/error-logger";
import { requireAdmin, apiError, getCurrentUser } from "@/lib/fitness/auth";

/**
 * POST /api/error-log
 * Public endpoint — anyone can submit error logs (client-side errors).
 * Rate limiting is handled by the DB (we don't want to lose errors).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Try to get user ID from session (optional — errors can be anonymous)
    let userId: string | undefined;
    try {
      const user = await getCurrentUser();
      if (user) userId = user.id;
    } catch {
      // anonymous error — that's fine
    }
    await logError({
      source: body.source || "client",
      message: body.message || "Unknown error",
      stack: body.stack,
      url: body.url,
      method: body.method,
      statusCode: body.statusCode,
      userId,
      userAgent: body.userAgent,
      context: body.context,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/error-log
 * Admin-only — returns error logs with filtering.
 * Query params: ?source=client|api|server &reviewed=true|false &limit=50 &offset=0
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || undefined;
    const reviewed = url.searchParams.get("reviewed");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const where: {
      source?: string;
      reviewed?: boolean;
    } = {};
    if (source) where.source = source;
    if (reviewed === "true") where.reviewed = true;
    if (reviewed === "false") where.reviewed = false;

    const [logs, total] = await Promise.all([
      db.errorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, name: true, mobile: true },
          },
        },
      }),
      db.errorLog.count({ where }),
    ]);

    return Response.json({ logs, total, limit, offset });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * PATCH /api/error-log
 * Admin-only — mark error(s) as reviewed.
 * Body: { ids: string[] } or { markAll: true }
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    if (body.markAll) {
      const result = await db.errorLog.updateMany({
        where: { reviewed: false },
        data: { reviewed: true },
      });
      return Response.json({ ok: true, updated: result.count });
    } else if (Array.isArray(body.ids)) {
      const result = await db.errorLog.updateMany({
        where: { id: { in: body.ids } },
        data: { reviewed: true },
      });
      return Response.json({ ok: true, updated: result.count });
    }
    return Response.json({ ok: true, updated: 0 });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/error-log
 * Admin-only — delete error log(s).
 * Body: { ids: string[] } or { deleteAll: true }
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    if (body.deleteAll) {
      const result = await db.errorLog.deleteMany({});
      return Response.json({ ok: true, deleted: result.count });
    } else if (Array.isArray(body.ids)) {
      const result = await db.errorLog.deleteMany({
        where: { id: { in: body.ids } },
      });
      return Response.json({ ok: true, deleted: result.count });
    }
    return Response.json({ ok: true, deleted: 0 });
  } catch (e) {
    return apiError(e);
  }
}
