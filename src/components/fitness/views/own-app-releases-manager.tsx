"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Smartphone,
  Upload,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Package,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";

interface ReleaseRow {
  id: string;
  versionName: string;
  versionCode: number;
  changelog: string;
  fileSize: number;
  downloads: number;
  forceUpdate: boolean;
  isActive: boolean;
  createdAt: string;
}

function fmtSize(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${toPersianDigits(kb)}KB`;
  return `${toPersianDigits((bytes / 1024 / 1024).toFixed(1))}MB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fa-IR");
  } catch {
    return "";
  }
}

/**
 * مدیریت نسخه‌های اپ اندروید «اختصاصی» فیتاپ — داخل دیالوگ تنظیمات سایت ادمین.
 *
 *  - لیست نسخه‌ها (جدیدترین اول) با آمار دانلود
 *  - آپلود نسخهٔ جدید: فایل APK + نام نسخه + کد نسخه + تغییرات + آپدیت اجباری
 *  - حذف نسخه
 *
 * API: /api/app/own/releases (GET/POST) و DELETE ?id=
 */
export function OwnAppReleasesManager() {
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [changelog, setChangelog] = useState("");
  const [forceUpdate, setForceUpdate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/app/own/releases", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setReleases(data.releases || []);
    } catch {
      toast.error("خطا در دریافت نسخه‌های اپ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload() {
    if (!file) {
      toast.error("فایل APK را انتخاب کنید");
      return;
    }
    if (!/^\d+(\.\d+){0,3}$/.test(versionName.trim())) {
      toast.error("نام نسخه را مثل 1.0.0 وارد کنید");
      return;
    }
    const code = Math.floor(Number(versionCode));
    if (!Number.isFinite(code) || code < 1) {
      toast.error("کد نسخه باید عدد بزرگ‌تر از صفر باشد");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("apk", file);
      fd.set("versionName", versionName.trim());
      fd.set("versionCode", String(code));
      fd.set("changelog", changelog.trim());
      fd.set("forceUpdate", String(forceUpdate));
      const res = await fetch("/api/app/own/releases", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "خطا در آپلود نسخه");
        return;
      }
      toast.success(`نسخه ${versionName.trim()} منتشر شد — کاربران نسخه قدیمی مودال آپدیت می‌گیرند 🎉`);
      setFile(null);
      setVersionName("");
      setVersionCode("");
      setChangelog("");
      setForceUpdate(false);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch {
      toast.error("خطا در آپلود نسخه");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/app/own/releases?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "خطا در حذف نسخه");
        return;
      }
      toast.success("نسخه حذف شد");
      await load();
    } catch {
      toast.error("خطا در حذف نسخه");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-orange-200 bg-orange-50/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
          <Smartphone className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-slate-800">اپ اندروید اختصاصی فیتاپ</p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            انتشار نسخه جدید → کاربران نسخه قدیمی مودال «نسخه جدید» با changelog می‌گیرند
          </p>
        </div>
      </div>

      {/* آپلود نسخه جدید */}
      <div className="space-y-2.5 rounded-xl bg-white border border-orange-100 p-3">
        <Label className="text-xs">آپلود نسخه جدید</Label>
        <input
          ref={fileRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-xs rounded-xl border border-input px-3 py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-1.5 file:text-orange-700 file:text-xs file:font-bold"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">نام نسخه (مثل 1.0.1)</Label>
            <Input
              dir="ltr"
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="1.0.1"
              className="rounded-xl h-9 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px]">کد نسخه (عدد، همیشه بالاتر)</Label>
            <Input
              dir="ltr"
              type="number"
              value={versionCode}
              onChange={(e) => setVersionCode(e.target.value)}
              placeholder="2"
              className="rounded-xl h-9 text-sm font-stat"
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px]">تغییرات این نسخه (هر خط یک مورد)</Label>
          <Textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={3}
            placeholder={"افزودن حالت تاریک\nرفع مشکل اسکرول در داشبورد"}
            className="rounded-xl text-xs resize-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={forceUpdate}
            onChange={(e) => setForceUpdate(e.target.checked)}
            className="w-4 h-4 accent-orange-500"
          />
          آپدیت اجباری (کاربران نسخه قدیمی نمی‌توانند رد کنند)
        </label>
        <Button
          onClick={upload}
          disabled={uploading || !file}
          className="w-full rounded-xl gap-1.5 h-10 text-white"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "در حال آپلود…" : "انتشار نسخه جدید"}
        </Button>
        {file && (
          <p className="text-[10px] text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {file.name} — {fmtSize(file.size)}
          </p>
        )}
      </div>

      {/* لیست نسخه‌ها */}
      <div>
        <p className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-orange-500" />
          نسخه‌های منتشرشده
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
          </div>
        ) : releases.length === 0 ? (
          <div className="rounded-xl bg-white border border-dashed border-orange-200 px-3 py-4 text-center">
            <p className="text-xs text-slate-500">هنوز نسخه‌ای منتشر نشده است</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar">
            {releases.map((r) => (
              <div
                key={r.id}
                className={`rounded-xl border p-2.5 flex items-center gap-2.5 ${
                  r.isActive ? "border-orange-200 bg-white" : "border-slate-100 bg-slate-50/60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-slate-800" dir="ltr">
                      v{r.versionName}
                    </span>
                    <span className="text-[10px] font-stat text-slate-400">#{r.versionCode}</span>
                    {r.isActive && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">
                        فعلی
                      </span>
                    )}
                    {r.forceUpdate && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        اجباری
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <Download className="w-2.5 h-2.5" />
                      {toPersianDigits(r.downloads)}
                    </span>
                    <span>{fmtSize(r.fileSize)}</span>
                    <span>{fmtDate(r.createdAt)}</span>
                  </div>
                </div>
                <a
                  href={`/api/app/own/download?versionCode=${r.versionCode}`}
                  className="p-2 rounded-lg hover:bg-orange-50 text-orange-500 transition"
                  title={`دانلود v${r.versionName}`}
                  aria-label={`دانلود نسخه ${r.versionName}`}
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => remove(r.id)}
                  disabled={deletingId === r.id}
                  className="p-2 rounded-lg hover:bg-red-50 text-red-400 transition disabled:opacity-50"
                  title="حذف نسخه"
                  aria-label={`حذف نسخه ${r.versionName}`}
                >
                  {deletingId === r.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
