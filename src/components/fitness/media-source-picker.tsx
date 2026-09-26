"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  v120 — انتخابگر «دوربین یا گالری» — دیرکتیو مالک (رفع تذکر کافه‌بازار)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  نقل قول مالک:
 *  «کاربر در همه جا هم باید دسترسی به دوربین داشته باشد و هم دسترسی به
 *   گالری گوشی. یعنی هر دو باید وجود داشته باشد نه یکی.»
 *
 *  تذکر کافه‌بازار (versionCode 15): «پس از خرید پلن حرفه‌ای، در بخش‌های
 *  پیش‌نیازهای ساخت برنامه، گالری پیشرفت، تحلیل عکس غذا، دستیار تغذیه و
 *  چت با فیتاپ امکان استفاده از دوربین وجود ندارد و صرفاً می‌توان از
 *  تصاویر حافظهٔ گوشی استفاده کرد — یا دسترسی CAMERA را حذف کنید یا
 *  امکان استفاده از دوربین را فراهم کنید.»
 *
 *  راه‌حل کامل (وب + اپ):
 *  • وب/سایت: قبل از هر آپلود عکس/ویدیو، شیت زیبای فیتاپ با دو گزینهٔ
 *    «گرفتن با دوربین» و «انتخاب از گالری» باز می‌شود. گزینهٔ دوربین به یک
 *    input مخفی با صفت capture="environment" وصل است — در مرورگرهای موبایل
 *    دوربین را مستقیم باز می‌کند.
 *  • اپ اندروید (WebView): همان input با صفت capture باعث می‌شود
 *    onShowFileChooser با isCaptureEnabled=true صدا زده شود و MainActivity
 *    اپ (هر دو نسخهٔ اختصاصی و بازار) با ACTION_IMAGE_CAPTURE /
 *    ACTION_VIDEO_CAPTURE دوربین را باز می‌کند — یعنی مجوز CAMERA در
 *    مانیفست حالا «واقعاً استفاده» می‌شود و تذکر بازار برطرف است.
 *
 *  این هوک مشترک همهٔ نقاط آپلود کاربر است: چت با فیتاپ (عکس/ویدیو)،
 *  تحلیل عکس غذا، گالری پیشرفت، پیش‌نیاز عکس بدن، عکس پروفایل، آزمایش
 *  خون، آنالیز ویدیو و پیوست تیکت پشتیبانی.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Camera, FolderOpen, ImagePlus, Video, X } from "lucide-react";
import { useRef, useState } from "react";
import { requestPermissionWithGate } from "@/lib/fitness/permission-gate";

export type MediaSourceMode = "camera" | "gallery" | "file";

interface MediaSourcePickerOptions {
  /** نوع اصلی رسانه — عنوان/آیکون شیت و accept گزینهٔ دوربین */
  kind?: "image" | "video";
  /** accept سفارشی برای گالری/فایل (مثلاً تیکت: عکس+ویدیو+PDF) */
  accept?: string;
  /** گزینه‌های شیت — پیش‌فرض: ["camera", "gallery"] */
  modes?: MediaSourceMode[];
  /** انتخاب چندتایی (فقط گالری/فایل) */
  multiple?: boolean;
  /** گارد قبل از باز شدن شیت (مثل قفل پلن) — false = باز نشو */
  beforeOpen?: () => boolean;
  /** فایل(های) انتخاب‌شده از دوربین یا گالری */
  onFiles: (files: File[]) => void;
}

const CAMERA_ACCEPT: Record<"image" | "video", string> = {
  image: "image/*",
  video: "video/*",
};

export function useMediaSourcePicker(opts: MediaSourcePickerOptions) {
  const kind = opts.kind ?? "image";
  const modes = opts.modes ?? ["camera", "gallery"];
  const galleryAccept = opts.accept ?? CAMERA_ACCEPT[kind];

  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  /** گارد حلقه: کلیک برنامه‌ای input پس از گیت مجوز نباید دوباره شیت باز کند */
  const busyRef = useRef(false);

  /** ارسال فایل‌های انتخاب‌شده به مصرف‌کننده + ریست input */
  function emit(files: FileList | null) {
    const picked = files ? Array.from(files) : [];
    if (picked.length > 0) opts.onFiles(picked);
  }

  /** باز کردن شیت انتخاب منبع (دوربین/گالری/فایل) */
  function openPicker() {
    if (busyRef.current) return;
    if (opts.beforeOpen && !opts.beforeOpen()) return;
    setOpen(true);
  }

  /** دوربین: گیت مجوز دوربین (فقط اپ اختصاصی) → input با capture */
  function pickWithCamera() {
    if (busyRef.current) return;
    busyRef.current = true;
    (async () => {
      try {
        // در اپ اختصاصی بار اول، مودال زیبای «اجازهٔ دوربین» نشان داده می‌شود؛
        // در مرورگر/بازار بدون مودال true برمی‌گردد.
        const ok = await requestPermissionWithGate("camera");
        if (!ok) {
          busyRef.current = false;
          return;
        }
        setOpen(false);
        // صبر کوتاه تا بسته‌شدن شیت؛ کلیک input در همان زنجیرهٔ ژست کاربر می‌ماند
        setTimeout(() => {
          cameraRef.current?.click();
          busyRef.current = false;
        }, 50);
      } catch {
        busyRef.current = false;
      }
    })();
  }

  function pickWithGallery() {
    if (busyRef.current) return;
    busyRef.current = true;
    setOpen(false);
    setTimeout(() => {
      galleryRef.current?.click();
      busyRef.current = false;
    }, 50);
  }

  function pickWithFile() {
    if (busyRef.current) return;
    busyRef.current = true;
    setOpen(false);
    setTimeout(() => {
      fileRef.current?.click();
      busyRef.current = false;
    }, 50);
  }

  /* ─── زیرساخت مخفی: سه input + شیت انتخاب ─── */
  const machinery = (
    <>
      {/* گالری — بدون capture (در اپ: SAF picker، در وب: انتخاب فایل) */}
      <input
        ref={galleryRef}
        type="file"
        accept={galleryAccept}
        multiple={opts.multiple}
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
      {/* دوربین — صفت capture: در مرورگر موبایل دوربین؛ در WebView اپ،
          onShowFileChooser با isCaptureEnabled=true → ACTION_IMAGE/VIDEO_CAPTURE */}
      <input
        ref={cameraRef}
        type="file"
        accept={CAMERA_ACCEPT[kind]}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
      {/* فایل عمومی (اختیاری — فقط برای modes شامل "file") */}
      {modes.includes("file") && (
        <input
          ref={fileRef}
          type="file"
          accept={galleryAccept}
          multiple={opts.multiple}
          className="hidden"
          onChange={(e) => {
            emit(e.target.files);
            e.target.value = "";
          }}
        />
      )}
      <MediaSourceSheet
        open={open}
        kind={kind}
        modes={modes}
        onClose={() => setOpen(false)}
        onCamera={pickWithCamera}
        onGallery={pickWithGallery}
        onFile={pickWithFile}
      />
    </>
  );

  return { openPicker, machinery };
}

/* ═════════════════════ شیت انتخاب منبع رسانه ═════════════════════ */

const TITLES: Record<"image" | "video", string> = {
  image: "افزودن عکس",
  video: "افزودن ویدیو",
};

function MediaSourceSheet({
  open,
  kind,
  modes,
  onClose,
  onCamera,
  onGallery,
  onFile,
}: {
  open: boolean;
  kind: "image" | "video";
  modes: MediaSourceMode[];
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onFile: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="media-source-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[130] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={TITLES[kind]}
        >
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-orange-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {/* دستگیرهٔ شیت */}
            <div className="pt-3 flex justify-center sm:hidden">
              <span className="w-10 h-1.5 rounded-full bg-slate-200" />
            </div>

            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
                  {kind === "image" ? (
                    <ImagePlus className="w-5 h-5 text-orange-500" />
                  ) : (
                    <Video className="w-5 h-5 text-orange-500" />
                  )}
                </span>
                <h3 className="font-black text-slate-800 text-sm">{TITLES[kind]}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="بستن"
                className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 transition active:scale-95"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="px-4 pb-5 pt-1 space-y-2">
              {modes.includes("camera") && (
                <button
                  type="button"
                  onClick={onCamera}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-orange-100 bg-orange-50/60 hover:bg-orange-100/70 active:scale-[0.98] transition text-right"
                >
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0 shadow-md shadow-orange-200">
                    <Camera className="w-5 h-5 text-white" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-black text-slate-800">گرفتن با دوربین 📷</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      همین حالا با دوربین گوشی {kind === "image" ? "عکس بگیر" : "ویدیو ضبط کن"}
                    </span>
                  </span>
                </button>
              )}

              {modes.includes("gallery") && (
                <button
                  type="button"
                  onClick={onGallery}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.98] transition text-right"
                >
                  <span className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <ImagePlus className="w-5 h-5 text-slate-600" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-black text-slate-800">انتخاب از گالری 🖼️</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      از عکس‌های ذخیره‌شدهٔ گوشی انتخاب کن
                    </span>
                  </span>
                </button>
              )}

              {modes.includes("file") && (
                <button
                  type="button"
                  onClick={onFile}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.98] transition text-right"
                >
                  <span className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-5 h-5 text-slate-600" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-black text-slate-800">انتخاب فایل 📎</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      PDF، فایل و انواع دیگر
                    </span>
                  </span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
