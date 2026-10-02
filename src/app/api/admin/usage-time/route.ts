/**
 * GET /api/admin/usage-time — «میانگین زمان مصرف اپ‌ها» (v104 — درخواست مالک)
 *
 * پنجرهٔ ۲۴ ساعت اخیر (rolling — نه تقویمی) از ردیف‌های AppUsageLog که
 * /api/usage/heartbeat ثبت کرده است:
 *
 *   برای هر پلتفرم (bazaar = اپ کافه‌بازار | own = اپ اختصاصی | web = وب/PWA):
 *     - totalSeconds       → جمع ثانیه‌های فعالیت «قابل‌مشاهده»
 *     - activeUsers        → کاربران متمایز با حداقل یک فلاش معتبر
 *     - avgSecondsPerUser  → مجموع ÷ کاربران فعال (میانگین واقعی، نه کل کاربران)
 *     - screens[]          → تفکیک زمان بر اساس تب فعال پنل (مرتب نزولی)
 *
 * و overall (جمع همهٔ پلتفرم‌ها با همان معیارها).
 *
 * دقت: هر ردیف حداکثر ۱۲۰ ثانیه دارد (سقف سرور در heartbeat) و فقط فعالیت
 * قابل‌مشاهده ثبت می‌شود — باز بودن تب پشت‌زمینه شمرده نمی‌شود.
 */
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";

export async function GET() {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewDashboard");

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const where = { createdAt: { gte: since } };

    const [byPlatform, byScreen, userPlatformPairs] = await Promise.all([
      db.appUsageLog.groupBy({
        by: ["platform"],
        where,
        _sum: { seconds: true },
        _count: { _all: true },
      }),
      db.appUsageLog.groupBy({
        by: ["platform", "screen"],
        where,
        _sum: { seconds: true },
      }),
      // کاربران متمایز به‌ازای هر پلتفرم (جفت یکتای userId+platform)
      db.appUsageLog.findMany({
        where,
        distinct: ["userId", "platform"],
        select: { userId: true, platform: true },
      }),
    ]);

    const activeUsersByPlatform = new Map<string, number>();
    for (const row of userPlatformPairs) {
      activeUsersByPlatform.set(
        row.platform,
        (activeUsersByPlatform.get(row.platform) || 0) + 1
      );
    }

    const screensByPlatform = new Map<string, { screen: string; seconds: number }[]>();
    for (const row of byScreen) {
      const list = screensByPlatform.get(row.platform) || [];
      list.push({ screen: row.screen, seconds: row._sum.seconds || 0 });
      screensByPlatform.set(row.platform, list);
    }
    for (const list of screensByPlatform.values()) {
      list.sort((a, b) => b.seconds - a.seconds);
    }

    const order = ["bazaar", "own", "web"];
    const platforms = order
      .filter((p) => byPlatform.some((row) => row.platform === p))
      .map((p) => {
        const row = byPlatform.find((r) => r.platform === p)!;
        const totalSeconds = row._sum.seconds || 0;
        const activeUsers = activeUsersByPlatform.get(p) || 0;
        return {
          platform: p,
          totalSeconds,
          activeUsers,
          avgSecondsPerUser: activeUsers > 0 ? Math.round(totalSeconds / activeUsers) : 0,
          flushes: row._count._all,
          screens: (screensByPlatform.get(p) || []).slice(0, 6),
        };
      });

    const overallTotal = platforms.reduce((acc, p) => acc + p.totalSeconds, 0);
    const overallUsers = new Set(userPlatformPairs.map((r) => r.userId)).size;

    return Response.json({
      ok: true,
      windowHours: 24,
      since: since.toISOString(),
      platforms,
      overall: {
        totalSeconds: overallTotal,
        activeUsers: overallUsers,
        avgSecondsPerUser: overallUsers > 0 ? Math.round(overallTotal / overallUsers) : 0,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
