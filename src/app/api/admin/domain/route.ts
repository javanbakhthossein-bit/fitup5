import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

/**
 * GET /api/admin/domain
 * دریافت تنظیمات دامنه و رکوردها
 */
export async function GET() {
  try {
    await requireAdmin();
    const settings = await db.siteSetting.findMany({
      where: {
        OR: [
          { key: { startsWith: "domain_" } },
          { key: { startsWith: "dns_" } },
          { key: { startsWith: "redirect_" } },
          { key: "site_url" },
        ],
      },
    });
    const result: Record<string, string> = {};
    settings.forEach((s) => (result[s.key] = s.value));
    return Response.json({ settings: result });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/domain
 * ذخیره تنظیمات دامنه و رکوردها
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { settings } = body as { settings: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      return Response.json({ error: "داده نامعتبر است." }, { status: 400 });
    }

    for (const [key, value] of Object.entries(settings)) {
      const existing = await db.siteSetting.findUnique({ where: { key } });
      if (existing) {
        await db.siteSetting.update({ where: { key }, data: { value: String(value) } });
      } else {
        await db.siteSetting.create({ data: { key, value: String(value), label: key } });
      }
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
