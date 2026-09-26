/**
 * ─── بکاپ دوره‌ای دیتابیس + ارسال به ربات بله (v69 + v78 — دیریکتیو مالک) ───
 *
 * درخواست مالک (v69):
 *  «گوگل درایور رو بی‌خیال شو چون تحریم هستیم و نمی‌شه — پاکش کن.
 *   می‌خوام دیتابیس به ربات من در پیام‌رسان ایرانی "بله" ارسال بشه.»
 *  (نسخهٔ قبلی: آپلود به Google Apps Script / Drive — به‌طور کامل حذف شد.)
 *
 * درخواست مالک (v78):
 *  «در بله فایل بیشتر از ۲۰ مگابایت ارسال نمی‌شود پس باید فشرده بشه» +
 *  «این همان دیتابیسی است که سیستم به ربات بله می‌فرستد و بکاپ من است؛
 *   پس باید دقیق و درست باشد.»
 *  → اگر فایل .db.gz فشرده از سقف ۲۰ مگابایتی بله بزرگ‌تر شد، خودکار به
 *    بخش‌های ≤۱۸ مگابایتی تقسیم می‌شود (fitup-db-….db.gz.part01، part02، …)
 *    و همهٔ بخش‌ها پشت‌سرهم با کپشن «بخش N از M» + دستور بازسازی cat ارسال
 *    می‌شود. وریفای integrity_check همچنان «قبل از» gzip انجام می‌شود و هیچ
 *    منطق محتوایی دیتابیس تغییر نکرده است.
 *
 * معماری:
 *  - بکاپ: SQLite «VACUUM INTO» (کپی سازگار و سالم حتی وسط تراکنش‌ها) → gzip
 *    → ذخیرهٔ محلی در db/backups/ (نگهداری قابل‌تنظیم — پیش‌فرض ۴۸ ساعت)
 *  - ارسال: Bot API پیام‌رسان بله (سازگار با تلگرام) —
 *      POST https://tapi.bale.ai/bot<TOKEN>/sendDocument  (multipart: chat_id + document)
 *      کشف chat_id با getUpdates (مالک فقط یک /start به ربات می‌دهد)
 *  - توکن: env «BALE_BOT_TOKEN» (اولویت) یا تنظیم پنل db_backup_bale_token
 *  - زمان‌بندی: جاروی داخلی instrumentation (startDbBackupSweep) هر ۱۰ دقیقه
 *    «سررسید» را چک می‌کند — تغییر بازه از پنل بلافاصله اعمال می‌شود (بدون ری‌استارت).
 *  - اتمی‌بودن: هر اجرا یک رکورد DbBackupRun ثبت می‌کند؛ سررسید بر اساس آخرین
 *    success/partial است (نه failed — تا خطای موقت، تقویم را جلو نیندازد).
 *
 * کلیدهای SiteSetting:
 *   db_backup_enabled         (۱/۰ — پیش‌فرض ۱)
 *   db_backup_interval_hours  (۱..۲۴ — پیش‌فرض ۲)
 *   db_backup_retention_hours (۱۲..۷۲۰ — پیش‌فرض ۴۸)
 *   db_backup_bale_token      (توکن ربات بله — خالی = از env BALE_BOT_TOKEN)
 *   db_backup_bale_chat_id    (شناسهٔ چت مقصد در بله — با «کشف خودکار» پر می‌شود)
 */

import { db } from "@/lib/db";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { gzip as gzipCb } from "zlib";
import { promisify } from "util";
import { PrismaClient } from "@prisma/client";

const gzipAsync = promisify(gzipCb);

/** آدرس پایهٔ Bot API بله (سازگار با تلگرام) */
const BALE_API_BASE = "https://tapi.bale.ai";

/** سقف حجم سند در Bot API بله (۲۰ مگابایت — محدودیت ارسال فایل بله) */
export const BALE_MAX_DOCUMENT_BYTES = 20_000_000;

/**
 * v78 — حجم هدف هر بخش هنگام تقسیم خودکار (≤۱۸ مگابایت) — حاشیهٔ امن زیر
 * سقف بالا؛ هر بخش دقیقاً به این اندازه است به‌جز بخش آخر (باقی‌مانده).
 */
export const BALE_PART_TARGET_BYTES = 18_000_000;

/** کلیدهای تنظیمات بکاپ + پیش‌فرض‌ها */
export const BACKUP_SETTING_DEFAULTS = {
  db_backup_enabled: "1",
  db_backup_interval_hours: "2",
  db_backup_retention_hours: "48",
  db_backup_bale_token: "",
  db_backup_bale_chat_id: "",
} as const;

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  retentionHours: number;
  /** توکن ربات بله — پنل؛ خالی یعنی از env خوانده می‌شود */
  baleToken: string;
  /** شناسهٔ چت مقصد در بله */
  baleChatId: string;
}

/** خواندن تنظیمات بکاپ از SiteSetting (با پیش‌فرض) */
export async function getBackupSettings(): Promise<BackupSettings> {
  const rows = await db.siteSetting.findMany({
    where: { key: { in: Object.keys(BACKUP_SETTING_DEFAULTS) } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const enabledRaw = map.get("db_backup_enabled") ?? BACKUP_SETTING_DEFAULTS.db_backup_enabled;
  const intervalRaw = Number(map.get("db_backup_interval_hours") ?? BACKUP_SETTING_DEFAULTS.db_backup_interval_hours);
  const retentionRaw = Number(map.get("db_backup_retention_hours") ?? BACKUP_SETTING_DEFAULTS.db_backup_retention_hours);
  return {
    enabled: enabledRaw.trim() === "1",
    intervalHours: Number.isFinite(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 24 ? Math.floor(intervalRaw) : 2,
    retentionHours: Number.isFinite(retentionRaw) && retentionRaw >= 12 && retentionRaw <= 720 ? Math.floor(retentionRaw) : 48,
    baleToken: (map.get("db_backup_bale_token") ?? "").trim(),
    baleChatId: (map.get("db_backup_bale_chat_id") ?? "").trim(),
  };
}

export interface BaleTokenInfo {
  /** توکن مؤثر (env اولویت دارد) — برای فراخوانی API؛ هرگز به کلاینت ندهید */
  token: string;
  /** منبع توکن — برای نمایش وضعیت در پنل */
  source: "env" | "panel" | "none";
}

/** توکن مؤثر ربات بله: env BALE_BOT_TOKEN اولویت دارد، بعد تنظیم پنل */
export function resolveBaleToken(settings: BackupSettings): BaleTokenInfo {
  const env = (process.env.BALE_BOT_TOKEN ?? "").trim();
  if (env) return { token: env, source: "env" };
  if (settings.baleToken) return { token: settings.baleToken, source: "panel" };
  return { token: "", source: "none" };
}

/** مسیر فایل دیتابیس از DATABASE_URL — file:/path/to.db */
export function getDbFilePath(): string | null {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) return null;
  let p = url.slice("file:".length);
  // SQLite اجازهٔ کوئری‌پارامتر ندارد ولی برای اطمینان پاک می‌کنیم
  p = p.split("?")[0];
  if (!p) return null;
  if (!p.startsWith("/")) {
    // مسیر نسبی — نسبت به cwd پروژه
    p = join(process.cwd(), p);
  }
  return p;
}

/** پوشهٔ بکاپ‌های محلی — کنار db (db/backups) */
function backupDir(): string {
  const dbPath = getDbFilePath() ?? join(process.cwd(), "db", "custom.db");
  return join(dirname(dbPath), "backups");
}

/** نام فایل بکاپ بر اساس زمان تهران — برای مرتب‌بودن طبیعی در تاریخچهٔ بله */
export function backupFileName(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `fitup-db-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.db.gz`;
}

export interface BackupResult {
  ok: boolean;
  fileName?: string;
  sizeBytes?: number;
  uploaded: boolean;
  uploadError?: string;
  deletedOld: number;
  durationMs: number;
  error?: string;
  /** v72 — آمار اثبات کامل‌بودن بکاپ (برای کپشن بله و پنل) */
  rawBytes?: number;
  tables?: number;
  rows?: number;
  integrity?: string;
  /** v78 — اگر بکاپ به چند بخش تقسیم شد: تعداد کل بخش‌ها */
  parts?: number;
  /** v78 — شمارهٔ بخش‌هایی که در بله ارسال نشدند (۱-پایه؛ فقط در حالت ناقص) */
  failedParts?: number[];
}

export interface BackupStats {
  raw: number;
  gz: number;
  tables: number;
  rows: number;
  integrity: string;
}

/**
 * v72 — اثبات کامل‌بودن بکاپ (خواستهٔ مالک: «چک کن ببین دیتابیسی که در بله
 * ارسال می‌شه کامله»). فایل ۵ مگابایتی در بله «همان» دیتابیس کاملِ ۲۵ مگابایتی
 * است که با gzip فشرده شده (SQLite نسبت ~۴.۵x — تست واقعی: ۲۰.۶۵MB → ۴.۷۱MB
 * و roundtrip بایت‌به‌بایت یکسان). این تابع روی فایلِ vacuum‌شده سه اثبات می‌گیرد:
 *   ۱) PRAGMA integrity_check → «ok"
 *   ۲) تعداد کل جدول‌ها
 *   ۳) جمع ردیف‌های همهٔ جدول‌ها
 * و همه در کپشن پیام بله درج می‌شوند تا کامل‌بودن در هر ارسال قابل‌مشاهده باشد.
 */
async function verifyBackupFile(filePath: string): Promise<Pick<BackupStats, "tables" | "rows" | "integrity">> {
  const client = new PrismaClient({ datasources: { db: { url: `file:${filePath}` } } });
  try {
    const chk = (await client.$queryRawUnsafe("PRAGMA integrity_check")) as Array<{ integrity_check: string }>;
    const integrity = String(chk?.[0]?.integrity_check ?? "unknown");
    const tables = (await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )) as Array<{ name: string }>;
    let rows = 0;
    if (tables.length > 0) {
      const unions = tables
        .map((t) => ({ name: String(t.name) }))
        .map((t) => `SELECT count(*) AS c FROM "${t.name.replace(/"/g, '""')}"`)
        .join(" UNION ALL ");
      const counts = (await client.$queryRawUnsafe(unions)) as Array<{ c: bigint | number }>;
      rows = counts.reduce((s, r) => s + Number(r.c), 0);
    }
    return { tables: tables.length, rows, integrity };
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/** ساخت فایل بکاپ: VACUUM INTO → وریفای → gzip(حداکثر فشرده‌سازی) → db/backups/ */
async function createBackupFile(): Promise<{ path: string; name: string; size: number; stats: BackupStats }> {
  const dbPath = getDbFilePath();
  if (!dbPath || !existsSync(dbPath)) {
    throw new Error(`فایل دیتابیس یافت نشد: ${dbPath ?? "(DATABASE_URL خالی)"}`);
  }
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const name = backupFileName();
  const rawPath = join(dir, `${name}.tmp-vacuum`);

  // VACUUM INTO — کپی سازگارِ خود-مکمل؛ فایل مقصد نباید از قبل وجود داشته باشد
  try {
    rmSync(rawPath, { force: true });
  } catch {}
  // اتصال مستقل (نه db جهانی) تا بکاپ حتی وسط تراکنش‌های در جریان همسالم باشد
  const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    await client.$executeRawUnsafe(`VACUUM INTO '${rawPath}'`);
  } finally {
    await client.$disconnect().catch(() => {});
  }

  const raw = statSync(rawPath).size;
  let tables = 0;
  let rows = 0;
  let integrity = "skip";
  try {
    const v = await verifyBackupFile(rawPath);
    tables = v.tables;
    rows = v.rows;
    integrity = v.integrity;
  } catch (e) {
    console.warn("[db-backup] verify failed (upload continues):", String((e as Error)?.message ?? e).slice(0, 120));
  }

  // سطح ۹ فشرده‌سازی — بیشترین حاشیهٔ امن زیر سقف ۲۰ مگابایت بله
  const gz = await gzipAsync(await readFile(rawPath), { level: 9 });
  rmSync(rawPath, { force: true });
  const gzPath = join(dir, name);
  await writeFile(gzPath, gz);
  console.log(`[db-backup] created ${name} (raw ${(raw / 1e6).toFixed(1)}MB → gz ${(gz.length / 1e6).toFixed(1)}MB, tables ${tables}, rows ${rows}, integrity ${integrity})`);
  return { path: gzPath, name, size: gz.length, stats: { raw, gz: gz.length, tables, rows, integrity } };
}

/**
 * حذف بکاپ‌های محلی قدیمی‌تر از retention — تعداد حذف‌شده برمی‌گردد.
 * v78 — فایل‌های بخش‌بندی‌شده (fitup-db-….db.gz.partNN) هم با همین سیاست
 * نگهداری پاک می‌شوند (ازجمله بخش‌های یتیمِ اجراهای نیمه‌کارهٔ قبلی).
 */
export function pruneLocalBackups(retentionHours: number): number {
  const dir = backupDir();
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of readdirSync(dir)) {
    // الگوی فایل بخش: <base>.db.gz.partNN — جدا از فایل اصلی .db.gz
    const isPart = /\.db\.gz\.part\d+$/.test(f);
    if (!f.endsWith(".db.gz") && !isPart) continue;
    const p = join(dir, f);
    try {
      if (statSync(p).mtimeMs < cutoff) {
        rmSync(p, { force: true });
        deleted++;
      }
    } catch {}
  }
  return deleted;
}

// ───────────────────────── ربات بله (Bot API) ─────────────────────────

/** برگرداندن خطای قابل‌فهم فارسی از پاسخ بله */
function baleErrorMessage(status: number, body: string): string {
  let desc = "";
  try {
    const j = JSON.parse(body);
    desc = String(j?.description ?? "");
  } catch {
    desc = body.replace(/\s+/g, " ").slice(0, 160);
  }
  if (status === 401) {
    return "توکن ربات بله نامعتبر است (401) — توکن را با BotFather بله چک کنید.";
  }
  if (/chat not found/i.test(desc)) {
    return "چت مقصد پیدا نشد — کاربر باید اول در بله به ربات یک پیام (مثلاً /start) بدهد و بعد «کشف خودکار» بزنید.";
  }
  if (status === 413 || /file is too big|too large/i.test(desc)) {
    return "فایل بکاپ برای بله بیش از حد بزرگ است.";
  }
  if (/too many requests|429/i.test(desc) || status === 429) {
    return "بله محدودیت نرخ (429) — کمی بعد دوباره تلاش می‌شود.";
  }
  return desc || `HTTP ${status}`;
}

/** فراخوانی سبک API بله — برگرداندن JSON یا خطای فارسی */
async function baleApiCall<T = any>(
  token: string,
  method: string,
  init?: RequestInit
): Promise<{ ok: boolean; result?: T; error?: string; status: number }> {
  if (!token) return { ok: false, error: "توکن ربات بله تنظیم نشده است.", status: 0 };
  try {
    const res = await fetch(`${BALE_API_BASE}/bot${token}/${method}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(60_000),
    });
    const text = (await res.text().catch(() => "")).slice(0, 4000);
    if (!res.ok) return { ok: false, error: baleErrorMessage(res.status, text), status: res.status };
    try {
      const j = JSON.parse(text) as { ok?: boolean; result?: T; description?: string };
      if (j && j.ok === false) return { ok: false, error: baleErrorMessage(res.status, text), status: res.status };
      return { ok: true, result: j.result as T, status: res.status };
    } catch {
      return { ok: false, error: "پاسخ غیر JSON از بله.", status: res.status };
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    return { ok: false, error: /timeout|abort/i.test(msg) ? "اتصال به بله تایم‌اوت شد." : msg, status: 0 };
  }
}

/** اطلاعات عمومی ربات (getMe) — برای نمایش وضعیت اتصال در پنل */
export async function baleGetMe(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const r = await baleApiCall<{ username?: string; first_name?: string }>(token, "getMe");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, username: r.result?.username };
}

export interface DiscoveredChat {
  chatId: string;
  title: string;
  type: string;
  at: string;
}

/**
 * کشف خودکار chat_id — مالک یک /start (هر پیامی) به ربات می‌دهد،
 * این تابع آخرین پیام‌ها را می‌خواند و چت(های) پیدا‌شده را برمی‌گرداند.
 */
export async function discoverBaleChats(token: string): Promise<{ ok: boolean; chats?: DiscoveredChat[]; error?: string }> {
  const r = await baleApiCall<any[]>(token, "getUpdates", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const updates = Array.isArray(r.result) ? r.result : [];
  const seen = new Map<string, DiscoveredChat>();
  for (const u of updates) {
    const chat = u?.message?.chat ?? u?.channel_post?.chat;
    if (!chat?.id) continue;
    const id = String(chat.id);
    if (!seen.has(id)) {
      seen.set(id, {
        chatId: id,
        title: [chat.first_name, chat.last_name, chat.title, chat.username ? `@${chat.username}` : ""]
          .filter(Boolean)
          .join(" ")
          .slice(0, 60),
        type: String(chat.type ?? "unknown"),
        at: new Date((Number(u?.message?.date ?? u?.channel_post?.date ?? 0) * 1000) || Date.now()).toISOString(),
      });
    }
  }
  const chats = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at));
  if (chats.length === 0) {
    return { ok: false, error: "هیچ پیامی به ربات نرسیده — اول در بله به ربات یک پیام (/start) بدهید و دوباره امتحان کنید." };
  }
  return { ok: true, chats };
}

/**
 * کپشن فارسی فایل بکاپ — v72 با اثبات کامل‌بودن:
 * حجم اصلی → حجم فشرده، تعداد جدول/ردیف و نتیجهٔ integrity_check در خودِ پیام
 * بله نوشته می‌شود تا دیگر ابهامی بین «۵ مگابایت فشرده» و «۲۵ مگابایت اصلی» نباشد.
 */
function backupCaption(
  fileName: string,
  sizeBytes: number,
  stats?: { raw?: number; tables?: number; rows?: number; integrity?: string }
): string {
  const date = new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date());
  const size = sizeBytes >= 1e6 ? `${(sizeBytes / 1e6).toFixed(1)} مگابایت` : `${Math.round(sizeBytes / 1e3)} کیلوبایت`;
  const lines = [
    "🗄 بکاپ دیتابیس فیتاپ",
    `📅 ${date}`,
    `💾 حجم فایل فشرده (gzip): ${size}`,
  ];
  if (stats?.raw != null && stats.raw > 0) {
    lines.push(`📦 حجم اصلی دیتابیس: ${(stats.raw / 1e6).toFixed(1)} مگابایت (فشرده‌شده ${Number((stats.raw / Math.max(1, sizeBytes)).toFixed(1)).toLocaleString("fa-IR")} برابر)`);
  }
  if (stats?.tables != null && stats.tables > 0) {
    lines.push(`📊 جداول: ${stats.tables.toLocaleString("fa-IR")} | ردیف‌ها: ${(stats.rows ?? 0).toLocaleString("fa-IR")}`);
  }
  if (stats?.integrity) {
    lines.push(stats.integrity === "ok" ? "✅ سلامت فایل: تأیید شد (integrity_check = ok)" : `⚠️ سلامت فایل: ${stats.integrity}`);
  }
  lines.push("📄 " + fileName);
  lines.push("ℹ️ فایل با gzip فشرده شده — پس از دانلود، با نرم‌افزار unzip/7zip باز و پسوند .gz برداشته شود تا فایل دیتابیس به‌دست آید.");
  return lines.join("\n");
}

/**
 * ارسال فایل بکاپ به ربات بله (sendDocument).
 * پاسخ موفق: {ok:true, result:{...}} — هر خطا با پیام فارسی برمی‌گردد.
 * v78 — پارامتر اختیاری captionOverride: کپشن آماده (برای بخش‌های چندتایی).
 * امضای قبلی بدون تغییر کار می‌کند (پارامتر جدید اختیاری است).
 */
export async function uploadBackupToBale(
  filePath: string,
  fileName: string,
  settings: BackupSettings,
  sizeOverride?: number,
  statsOverride?: { raw?: number; tables?: number; rows?: number; integrity?: string },
  captionOverride?: string
): Promise<{ uploaded: boolean; error?: string }> {
  const { token, source } = resolveBaleToken(settings);
  if (!token) {
    return {
      uploaded: false,
      error: source === "none" ? "no_token" : undefined,
    };
  }
  const chatId = settings.baleChatId.trim();
  if (!chatId) return { uploaded: false, error: "no_chat_id" };
  try {
    const gz = await readFile(filePath);
    const size = sizeOverride ?? gz.length;
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", captionOverride ?? backupCaption(fileName, size, statsOverride));
    form.append(
      "document",
      new Blob([new Uint8Array(gz)], { type: "application/gzip" }),
      fileName
    );
    const res = await fetch(`${BALE_API_BASE}/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const text = (await res.text().catch(() => "")).slice(0, 4000);
    if (!res.ok) return { uploaded: false, error: baleErrorMessage(res.status, text) };
    try {
      const j = JSON.parse(text) as { ok?: boolean; description?: string };
      if (j && j.ok === false) return { uploaded: false, error: baleErrorMessage(res.status, text) };
    } catch {
      return { uploaded: false, error: "پاسخ غیر JSON از بله." };
    }
    return { uploaded: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    return { uploaded: false, error: /timeout|abort/i.test(msg) ? "ارسال فایل به بله تایم‌اوت شد." : msg };
  }
}

// ───────────── v78 — تقسیم خودکار بکاپ بزرگ و ارسال چندبخشی ─────────────

/** اطلاعات یک بخش از بکاپ چندبخشی */
export interface BackupPartInfo {
  /** شمارهٔ بخش (۱-پایه) */
  index: number;
  /** تعداد کل بخش‌ها */
  total: number;
  /** مسیر کامل فایل بخش روی دیسک */
  path: string;
  /** نام فایل بخش — مثل fitup-db-2026-09-14-1200.db.gz.part01 */
  name: string;
  /** حجم بخش به بایت */
  size: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * حذف بخش‌های نیمه‌کارهٔ قبلیِ همین نام بکاپ — «هر اجرا جایگزین بخش‌های
 * قبلیِ همان پیشوند است» تا هیچ حالت نیمه‌کارهٔ گمراه‌کننده‌ای باقی نماند.
 */
function removeStalePartsFor(dir: string, baseName: string): void {
  try {
    const re = new RegExp(`^${escapeRegExp(baseName)}\\.part\\d+$`);
    for (const f of readdirSync(dir)) {
      if (re.test(f)) {
        try {
          rmSync(join(dir, f), { force: true });
        } catch {}
      }
    }
  } catch {}
}

/**
 * v78 — تقسیم فایل بکاپ فشرده (.db.gz) به بخش‌های ≤ BALE_PART_TARGET_BYTES
 * و ذخیره در همان پوشهٔ بکاپ‌ها با الگوی <name>.partNN (دو رقمی).
 * محتوای بایت‌به‌بایت حفظ می‌شود — چسباندن بخش‌ها دقیقاً فایل اصلی را می‌دهد.
 * قبل از نوشتن، بخش‌های قبلیِ همین نام پاک می‌شوند (بدون حالت نیمه‌کاره).
 */
export async function splitBackupFileIntoParts(gzPath: string): Promise<BackupPartInfo[]> {
  const dir = dirname(gzPath);
  const base = basename(gzPath);
  const buf = await readFile(gzPath);
  const total = Math.max(1, Math.ceil(buf.length / BALE_PART_TARGET_BYTES));
  removeStalePartsFor(dir, base);
  const parts: BackupPartInfo[] = [];
  for (let i = 0; i < total; i++) {
    const name = `${base}.part${String(i + 1).padStart(2, "0")}`;
    const p = join(dir, name);
    const chunk = buf.subarray(i * BALE_PART_TARGET_BYTES, Math.min((i + 1) * BALE_PART_TARGET_BYTES, buf.length));
    await writeFile(p, chunk);
    parts.push({ index: i + 1, total, path: p, name, size: chunk.length });
  }
  return parts;
}

/**
 * کپشن فارسی هر بخش — «بخش N از M» + نام فایل + دستور بازسازی cat،
 * تا مالک بتواند بخش‌ها را در لینوکس به فایل .db.gz اصلی برگرداند.
 */
function backupPartCaption(
  part: BackupPartInfo,
  totalBytes: number,
  stats?: { raw?: number; tables?: number; rows?: number; integrity?: string }
): string {
  const date = new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date());
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const baseName = part.name.replace(/\.part\d+$/, "");
  const lines = [
    `🗄 بکاپ دیتابیس فیتاپ — بخش ${fa(part.index)} از ${fa(part.total)}`,
    `📄 ${baseName}`,
    `🧩 این پیام: ${part.name} (${(part.size / 1e6).toFixed(1)} مگابایت از ${(totalBytes / 1e6).toFixed(1)} مگابایت)`,
    "🔧 بازسازی فایل اصلی — همهٔ بخش‌ها را در یک پوشه بگذارید، سپس در لینوکس/مک:",
    `cat ${baseName}.part* > ${baseName}`,
    "ℹ️ فایل به‌دست‌آمده فشردهٔ gzip است — پسوند .gz را با unzip/7zip بردارید تا فایل دیتابیس به‌دست آید.",
  ];
  if (stats?.tables != null && stats.tables > 0) {
    lines.push(`📊 جداول: ${fa(stats.tables)} | ردیف‌ها: ${fa(stats.rows ?? 0)}`);
  }
  if (stats?.integrity) {
    lines.push(stats.integrity === "ok" ? "✅ سلامت فایل: تأیید شد (integrity_check = ok)" : `⚠️ سلامت فایل: ${stats.integrity}`);
  }
  lines.push(`📅 ${date}`);
  return lines.join("\n");
}

/** نتیجهٔ ارسال چندبخشی */
export interface BaleMultiPartResult {
  /** true فقط وقتی «همهٔ» بخش‌ها در بله تحویل شده باشند */
  uploaded: boolean;
  /** تعداد کل بخش‌ها */
  parts: number;
  /** شمارهٔ بخش‌های ناموفق (۱-پایه) — در حالت کامل خالی است */
  failedParts: number[];
  /** توضیح فارسی بخش‌های ناموفق (برای uploadError رکورد و پنل) */
  error?: string;
}

/**
 * v78 — ارسال چندبخشی: فایل .db.gz را تقسیم و «تک‌تک» بخش‌ها را با
 * sendDocument و کپشن «بخش N از M» می‌فرستد. اگر بخشی شکست بخورد،
 * ادامهٔ بخش‌ها هم تلاش می‌شود و در پایان فهرست بخش‌های ناموفق برمی‌گردد
 * (اجرای بعدی بکاپ تازه می‌سازد، دوباره تقسیم و کامل می‌فرستد).
 */
export async function uploadBackupToBaleMultiPart(
  gzPath: string,
  settings: BackupSettings,
  statsOverride?: { raw?: number; tables?: number; rows?: number; integrity?: string }
): Promise<BaleMultiPartResult> {
  const parts = await splitBackupFileIntoParts(gzPath);
  const totalBytes = statSync(gzPath).size;
  const failed: number[] = [];
  let lastError: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i > 0) {
      // مکث کوتاه بین بخش‌ها — احترام به محدودیت نرخ بله
      await new Promise((r) => setTimeout(r, 1_000));
    }
    const up = await uploadBackupToBale(part.path, part.name, settings, part.size, statsOverride, backupPartCaption(part, totalBytes, statsOverride));
    if (!up.uploaded) {
      failed.push(part.index);
      lastError = up.error;
      console.error(`[db-backup] part ${part.index}/${parts.length} (${part.name}) failed: ${up.error ?? "?"}`);
    } else {
      console.log(`[db-backup] part ${part.index}/${parts.length} (${part.name}, ${(part.size / 1e6).toFixed(1)}MB) sent`);
    }
  }
  if (failed.length === 0) {
    return { uploaded: true, parts: parts.length, failedParts: [] };
  }
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const okCount = parts.length - failed.length;
  return {
    uploaded: false,
    parts: parts.length,
    failedParts: failed,
    error:
      `بکاپ چندبخشی ناقص ماند — ${fa(okCount)} از ${fa(parts.length)} بخش در بله ارسال شد؛ ` +
      `بخش‌های ناموفق: ${failed.map(fa).join(" و ")} (اجرای بعدی، بکاپ تازه را دوباره تقسیم و کامل می‌فرستد)` +
      (lastError ? ` — علت آخرین خطا: ${String(lastError).slice(0, 240)}` : ""),
  };
}

/** اجرای کامل یک بکاپ + ثبت رکورد DbBackupRun */
export async function runBackup(trigger: "sweep" | "manual" = "sweep"): Promise<BackupResult> {
  const startedAt = Date.now();
  let result: BackupResult = {
    ok: false,
    uploaded: false,
    deletedOld: 0,
    durationMs: 0,
  };
  try {
    const settings = await getBackupSettings();
    const { path, name, size, stats } = await createBackupFile();
    const deletedOld = pruneLocalBackups(settings.retentionHours);
    let uploaded = false;
    let uploadError: string | undefined;
    let partsCount: number | undefined;
    let failedParts: number[] | undefined;
    const tokenInfo = resolveBaleToken(settings);
    if (!tokenInfo.token) {
      uploadError = "no_token";
    } else if (!settings.baleChatId.trim()) {
      uploadError = "no_chat_id";
    } else if (size > BALE_MAX_DOCUMENT_BYTES) {
      // v78 — فایل فشرده از سقف ۲۰ مگابایتی بله بزرگ‌تر است → به‌جای ردشدن،
      // خودکار به بخش‌های ≤۱۸ مگابایتی تقسیم و «همهٔ» بخش‌ها ارسال می‌شود.
      console.log(`[db-backup] gz ${(size / 1e6).toFixed(1)}MB exceeds Bale ${BALE_MAX_DOCUMENT_BYTES / 1e6}MB limit → splitting into parts of ≤${BALE_PART_TARGET_BYTES / 1e6}MB`);
      const mp = await uploadBackupToBaleMultiPart(path, settings, stats);
      uploaded = mp.uploaded;
      partsCount = mp.parts;
      if (!mp.uploaded) {
        failedParts = mp.failedParts;
        uploadError = mp.error;
        console.error(`[db-backup] multi-part upload incomplete: ${mp.failedParts.length}/${mp.parts} part(s) failed`);
      } else {
        console.log(`[db-backup] multi-part upload complete: all ${mp.parts} part(s) sent to Bale`);
      }
    } else {
      const up = await uploadBackupToBale(path, name, settings, size, stats);
      uploaded = up.uploaded;
      if (!up.uploaded) uploadError = up.error;
    }
    result = {
      ok: true,
      fileName: name,
      sizeBytes: size,
      uploaded,
      uploadError,
      deletedOld,
      durationMs: Date.now() - startedAt,
      rawBytes: stats.raw,
      tables: stats.tables,
      rows: stats.rows,
      integrity: stats.integrity,
      parts: partsCount,
      failedParts: failedParts?.length ? failedParts : undefined,
    };
    await db.dbBackupRun.create({
      data: {
        status: uploaded ? "success" : "partial",
        trigger,
        fileName: name,
        sizeBytes: size,
        localPath: join("backups", name),
        uploaded,
        uploadError: uploadError ?? null,
        deletedOld,
        durationMs: result.durationMs,
      },
    });
    return result;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 400);
    result.error = msg;
    result.durationMs = Date.now() - startedAt;
    try {
      await db.dbBackupRun.create({
        data: {
          status: "failed",
          trigger,
          error: msg,
          durationMs: result.durationMs,
        },
      });
    } catch {}
    console.error("[db-backup] failed:", msg);
    return result;
  }
}

/**
 * «آیا سررسید بکاپ رسیده؟» — بر اساس آخرین success/partial و بازهٔ تنظیم‌شده.
 * اگر رکورد موفقی نیست و DB تازه است، بلافاصله سررسید حساب می‌شود.
 */
export async function isBackupDue(): Promise<{ due: boolean; lastAt: string | null; nextDueAt: string | null; intervalHours: number; enabled: boolean }> {
  const settings = await getBackupSettings();
  const last = await db.dbBackupRun.findFirst({
    where: { status: { in: ["success", "partial"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last) {
    return { due: settings.enabled, lastAt: null, nextDueAt: null, intervalHours: settings.intervalHours, enabled: settings.enabled };
  }
  const dueAt = new Date(last.createdAt.getTime() + settings.intervalHours * 60 * 60 * 1000);
  return {
    due: settings.enabled && Date.now() >= dueAt.getTime(),
    lastAt: last.createdAt.toISOString(),
    nextDueAt: dueAt.toISOString(),
    intervalHours: settings.intervalHours,
    enabled: settings.enabled,
  };
}

/** نقطهٔ ورود جاروی زمان‌بندی — فقط وقتی سررسید رسیده بکاپ می‌گیرد */
export async function runBackupIfDue(trigger: "sweep" | "manual" = "sweep"): Promise<{ ran: boolean; reason?: string; result?: BackupResult }> {
  const status = await isBackupDue();
  if (!status.enabled) return { ran: false, reason: "disabled" };
  if (!status.due) return { ran: false, reason: "not_due", result: undefined };
  const result = await runBackup(trigger);
  return { ran: true, result };
}

/**
 * تست ارسال به بله — فایل کوچک آزمایشی به چت مقصد می‌فرستد
 * تا ادمین مطمئن شود توکن/chat_id/ربات درست کار می‌کند.
 */
export async function testBaleUpload(): Promise<{ uploaded: boolean; error?: string }> {
  const settings = await getBackupSettings();
  const { token } = resolveBaleToken(settings);
  if (!token) return { uploaded: false, error: "توکن ربات بله تنظیم نشده — آن را در env (BALE_BOT_TOKEN) یا همین کارت بگذارید." };
  if (!settings.baleChatId.trim()) return { uploaded: false, error: "شناسهٔ چت (chat_id) خالی است — دکمهٔ «کشف خودکار» را بزنید." };
  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "fitup-bktest-"));
  try {
    const name = "fitup-db-TEST-CONNECTION.txt";
    const p = join(dir, name);
    await writeFile(
      p,
      `FitUp DB-backup Bale test — ${new Date().toISOString()}\nاگر این فایل را در بله می‌بینید، مسیر بکاپ درست کار می‌کند. (فایل تست — می‌توانید حذفش کنید)`
    );
    return await uploadBackupToBale(p, name, settings);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
