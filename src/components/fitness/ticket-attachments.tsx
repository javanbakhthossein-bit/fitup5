"use client";

import { useRef, useState } from "react";
import { Paperclip, X, Loader2, FileText, Download, Film, ImageIcon, File as FileIcon } from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * v77 — پیوست فایل تیکت پشتیبانی (عکس/ویدیو/فایل) — درخواست مالک:
 * «کاربر و مدیر باید بتونن عکس/ویدیو/فایل توی تیکت بفرستن و فایل‌ها همیشه
 * بمونن». این فایل مشترک بین پنل کاربر (support-view) و پنل ادمین
 * (admin-overlay) است تا رفتار هر دو دقیقاً یکسان باشد.
 *
 * جریان آپلود: فایل بلافاصله بعد از انتخاب به /api/support/attachments
 * می‌رود و شناسهٔ رکورد برمی‌گردد؛ هنگام ثبت تیکت/پاسخ، attachmentIds
 * ارسال می‌شود. فایل روی دیسک ماندگار است (policy=forever) و فقط
 * آپلودکننده/مالک تیکت/ادمین به آن دسترسی دارد.
 */

export interface TicketAttachmentClientDto {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  uploaderId: string;
  createdAt: string;
}

/** حداکثر فایل در هر پیام — هم‌سو با سرور */
export const TICKET_MAX_ATTACHMENTS = 8;

const ACCEPT_ATTR =
  "image/*,video/*,application/pdf,.zip,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp3,.wav,.ogg,.m4a";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

/** آپلود فایل‌های انتخابی → رکوردهای standalone (قبل از ثبت تیکت/پاسخ) */
export async function uploadTicketAttachments(
  files: File[]
): Promise<TicketAttachmentClientDto[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const res = await fetch("/api/support/attachments", {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "آپلود فایل ناموفق بود");
  return (data?.attachments ?? []) as TicketAttachmentClientDto[];
}

/* ───────────────────────── انتخابگر پیوست ───────────────────────── */

export function TicketAttachmentPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: TicketAttachmentClientDto[];
  onChange: (next: TicketAttachmentClientDto[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const remaining = TICKET_MAX_ATTACHMENTS - value.length;
    if (picked.length > remaining) {
      toast.error(`حداکثر ${toPersianDigits(TICKET_MAX_ATTACHMENTS)} فایل برای هر پیام`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadTicketAttachments(picked);
      onChange([...value, ...uploaded]);
      if (uploaded.length > 0) toast.success("فایل پیوست شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "آپلود فایل ناموفق بود");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={disabled || uploading || value.length >= TICKET_MAX_ATTACHMENTS}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-slate-200 bg-white/70 hover:bg-slate-50 hover:border-slate-300 transition px-2.5 h-8 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="پیوست عکس، ویدیو یا فایل (تا ۲ گیگابایت — ویدیوها خودکار فشرده می‌شوند)"
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Paperclip className="w-3.5 h-3.5" />
          )}
          {uploading ? "در حال آپلود…" : "پیوست فایل"}
        </button>
        {!compact && (
          <span className="text-[10px] text-slate-400">
            عکس، ویدیو، PDF و فایل‌های دیگر — تا ۲ گیگابایت — ویدیوها خودکار فشرده می‌شوند
          </span>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {value.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 text-[11px] rounded-lg bg-slate-100 border border-slate-200 px-2 py-1 max-w-[220px]"
            >
              {a.fileType.startsWith("image/") ? (
                <ImageIcon className="w-3 h-3 shrink-0 text-slate-500" />
              ) : a.fileType.startsWith("video/") ? (
                <Film className="w-3 h-3 shrink-0 text-slate-500" />
              ) : (
                <FileText className="w-3 h-3 shrink-0 text-slate-500" />
              )}
              <span className="truncate" title={a.fileName}>{a.fileName}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x.id !== a.id))}
                className="text-slate-400 hover:text-red-500 transition disabled:opacity-40"
                title="حذف پیوست"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── نمایش پیوست‌ها ───────────────────────── */

export function TicketAttachmentViewList({
  attachments,
  side,
}: {
  attachments: TicketAttachmentClientDto[];
  /** کاربر پیام را از کدام سمت می‌بیند — برای گوشه‌گردی حباب */
  side?: "user" | "admin";
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {attachments.map((a) => {
        const url = a.fileUrl;
        if (a.fileType.startsWith("image/")) {
          return (
            <a key={a.id} href={url} target="_blank" rel="noopener noreferrer" className="block group/img">
              <img
                src={url}
                alt={a.fileName || "پیوست"}
                loading="lazy"
                className="max-w-full max-h-64 rounded-xl border border-black/5 object-contain bg-white/60 cursor-zoom-in group-hover/img:opacity-90 transition"
              />
            </a>
          );
        }
        if (a.fileType.startsWith("video/")) {
          return (
            <video
              key={a.id}
              src={url}
              controls
              preload="metadata"
              playsInline
              className="max-w-full max-h-64 rounded-xl border border-black/5 bg-black/90"
            />
          );
        }
        // فایل عمومی — چیپ دانلود
        return (
          <a
            key={a.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition hover:bg-slate-50 ${
              side === "admin"
                ? "bg-white/70 border-orange-200"
                : "bg-white/80 border-slate-200"
            }`}
          >
            <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <FileIcon className="w-4 h-4 text-slate-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold text-slate-700 truncate">{a.fileName}</span>
              <span className="block text-[10px] text-slate-400">{formatFileSize(a.fileSize)}</span>
            </span>
            <Download className="w-4 h-4 text-slate-400 shrink-0" />
          </a>
        );
      })}
    </div>
  );
}
