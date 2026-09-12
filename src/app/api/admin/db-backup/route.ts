import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, requireAdmin } from "@/lib/fitness/auth";
import {
  getBackupSettings,
  runBackup,
  testBaleUpload,
  isBackupDue,
  discoverBaleChats,
  baleGetMe,
  resolveBaleToken,
  getDbFilePath,
} from "@/lib/fitness/db-backup";
import { statSync } from "fs";

/**
 * GET /api/admin/db-backup — وضعیت کامل بکاپ برای کارت ادمین (فقط ادمین)
 *   تنظیمات فعلی + وضعیت توکن/چت بله + سررسید بعدی + حجم DB + ۱۲ اجرای آخر
 *   ⚠️ توکن هرگز کامل به کلاینت فرستاده نمی‌شود — فقط پرچم‌های وضعیت.
 *
 * POST /api/admin/db-backup — اکشن‌ها (فقط ادمین)
 *   { action: "run" }           → بکاپ فوری کامل (اجرا از پنل)
 *   { action: "test_upload" }   → تست ارسال فایل آزمایشی به ربات بله
 *   { action: "discover_chat" } → کشف خودکار chat_id از پیام‌های دریافتی ربات
 */

export async function GET() {
  try {
    await requireAdmin();
    const settings = await getBackupSettings();
    const due = await isBackupDue();
    const lastRuns = await db.dbBackupRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
    });

    let dbSizeBytes: number | null = null;
    const dbPath = getDbFilePath();
    try {
      if (dbPath) dbSizeBytes = statSync(dbPath).size;
    } catch {}

    const tokenInfo = resolveBaleToken(settings);

    return Response.json({
      ok: true,
      // v69 — توکن پنل هرگز کامل به کلاینت نمی‌رود (مماسک می‌شود) — فقط وضعیت
      settings: {
        ...settings,
        baleToken: settings.baleToken ? `••••••••${settings.baleToken.slice(-4)}` : "",
      },
      // توکن هرگز کل به کلاینت نمی‌رود — فقط وضعیت
      baleStatus: {
        tokenSource: tokenInfo.source, // "env" | "panel" | "none"
        tokenSet: Boolean(tokenInfo.token),
        chatIdSet: Boolean(settings.baleChatId.trim()),
        chatId: settings.baleChatId.trim(),
      },
      due,
      dbSizeBytes,
      lastRuns,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { action?: string; token?: string };

    if (body.action === "run") {
      const result = await runBackup("manual");
      return Response.json({ ...result, action: "run" });
    }

    if (body.action === "test_upload") {
      const up = await testBaleUpload();
      return Response.json({ ...up, action: "test_upload" });
    }

    // کشف خودکار chat_id — توکن پاس‌شده (فرم ذخیره‌نشده) اولویت دارد
    if (body.action === "discover_chat") {
      const settings = await getBackupSettings();
      const token = (body.token ?? "").trim() || resolveBaleToken(settings).token;
      if (!token) {
        return Response.json({
          ok: false,
          action: "discover_chat",
          error: "توکن ربات بله تنظیم نشده — آن را در کارت بگذارید و ذخیره کنید، یا در فایل env مقدار BALE_BOT_TOKEN را بگذارید.",
        });
      }
      const chats = await discoverBaleChats(token);
      if (!chats.ok) {
        return Response.json({ ok: false, action: "discover_chat", error: chats.error });
      }
      const me = await baleGetMe(token);
      return Response.json({
        ok: true,
        action: "discover_chat",
        chats: chats.chats,
        botUsername: me.ok ? me.username : undefined,
      });
    }

    return Response.json({ error: "اکشن نامعتبر است." }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
