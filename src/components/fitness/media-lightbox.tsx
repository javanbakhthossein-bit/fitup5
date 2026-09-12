"use client";

/**
 * ═══════════════════════════════════════════════════════════════
 *  MediaLightbox — لایت‌باکس مشترک رسانه (v53)
 *
 *  بزرگ‌نمایی عکس / پخش ویدیو در تمام‌صفحه — مصرف‌کنندگان:
 *   - گالری پیشرفت (progress-view): عکس‌ها + ویدیوها
 *   - پروفایل (profile-overlay): آزمایش‌های خون
 *   - ادمین (admin-overlay → UserMediaGalleryDialog): همهٔ رسانه‌های کاربر
 *
 *  الگوی ضدلگ v50/v51 (مطابق daily-medal.tsx):
 *   - createPortal روی document.body + pointerEvents:auto صریح
 *   - بدون backdrop-blur سنگین (پس‌زمینه مشکی ۹۵٪ ساده)
 *   - قفل اسکرول با useScrollLock (ref-count — هم‌زیستی با مودال‌های دیگر)
 *
 *  تعامل:
 *   - بستن: دکمهٔ X بالا-چپ (RTL) + کلیک روی پس‌زمینه + Escape
 *   - ناوبری: فلش چپ/راست + کیبورد (RTL: فلش چپ = بعدی، فلش راست = قبلی)
 *   - عکس: دبل‌کلیک/دبل‌تپ → toggle زوم ۱x ↔ ۲.۵x؛ در حالت زوم، درگ با pointer
 *   - ویدیو: <video controls autoPlay playsInline> بزرگ
 *
 *  نکتهٔ ساختاری: هر اسلاید با key={index} mount می‌شود — تعویض آیتم،
 *  زوم/آفست را به‌طور طبیعی ریست می‌کند (بدون setState در effect —
 *  قانون react-hooks/set-state-in-effect).
 * ═══════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { toPersianDigits } from "@/lib/fitness/types";

export interface LightboxItem {
  type: "image" | "video";
  url: string;
  title?: string;
}

const MAX_SCALE = 2.5;

export function MediaLightbox({
  items,
  index,
  onClose,
  onIndexChange,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const item = typeof index === "number" ? items[index] : undefined;
  const hasMultiple = items.length > 1;

  const goPrev = useCallback(() => {
    if (!hasMultiple || typeof index !== "number") return;
    onIndexChange((index - 1 + items.length) % items.length);
  }, [hasMultiple, index, items.length, onIndexChange]);

  const goNext = useCallback(() => {
    if (!hasMultiple || typeof index !== "number") return;
    onIndexChange((index + 1) % items.length);
  }, [hasMultiple, index, items.length, onIndexChange]);

  // کیبورد: Escape بستن — RTL: فلش چپ = بعدی، فلش راست = قبلی
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goNext();
      else if (e.key === "ArrowRight") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, onClose]);

  useScrollLock(true);

  // الگوی daily-medal: در SSR هیچ، در کلاینت portal روی body (بدون state اضافه)
  if (typeof document === "undefined" || !item) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[160] flex items-center justify-center"
      style={{ pointerEvents: "auto" }}
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={item.title || "نمایش رسانه"}
    >
      {/* پس‌زمینهٔ مشکی ۹۵٪ — بدون blur سنگین (قانون ضدلگ) */}
      <div
        className="absolute inset-0 bg-black/95"
        onClick={onClose}
        aria-hidden
      />

      {/* شمارنده + عنوان — بالا-راست */}
      <div className="absolute top-3 right-4 left-14 z-10 flex items-center gap-2 pointer-events-none">
        {hasMultiple && (
          <span className="text-[11px] font-bold text-white/80 bg-white/10 rounded-full px-2.5 py-1">
            {toPersianDigits(index + 1)} از {toPersianDigits(items.length)}
          </span>
        )}
        {item.title && (
          <span className="text-[11px] text-white/70 truncate">{item.title}</span>
        )}
      </div>

      {/* دکمهٔ بستن — بالا-چپ (RTL) */}
      <button
        type="button"
        onClick={onClose}
        aria-label="بستن"
        className="absolute top-3 left-3 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95"
      >
        <X className="w-5 h-5" />
      </button>

      {/* فلش قبلی — سمت راست (RTL: قبلی در راست) */}
      {hasMultiple && (
        <button
          type="button"
          onClick={goPrev}
          aria-label="رسانهٔ قبلی"
          className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* فلش بعدی — سمت چپ (RTL: بعدی در چپ) */}
      {hasMultiple && (
        <button
          type="button"
          onClick={goNext}
          aria-label="رسانهٔ بعدی"
          className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* محتوای رسانه — key={index}: هر تعویض آیتم، اسلاید تازه (زوم ریست) */}
      <LightboxSlide key={index} item={item} onClose={onClose} />

      {/* راهنمای زیر رسانه — فقط عکس */}
      {item.type === "image" && (
        <div className="absolute bottom-3 inset-x-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-white/60 bg-white/10 rounded-full px-3 py-1">
            <ImageIcon className="w-3 h-3" />
            برای بزرگ‌نمایی دبل‌کلیک کنید
          </span>
        </div>
      )}
    </motion.div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────
//  اسلاید تکی — زوم/درگ عکس یا پخش ویدیو (با هر تعویض آیتم remount می‌شود)
// ─────────────────────────────────────────────────────────────

function LightboxSlide({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // وضعیت درگ برای استایل (بدون خواندن ref در render — قانون lint)
  const [isDragging, setIsDragging] = useState(false);
  // وضعیت درگ — pointer events (موس + لمس یکجا)
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // دبل‌کلیک/دبل‌تپ — toggle بین 1x و 2.5x
  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    setScale((s) => (s > 1 ? 1 : MAX_SCALE));
    setOffset({ x: 0, y: 0 });
  }

  function clampOffset(x: number, y: number): { x: number; y: number } {
    const rect = frameRef.current?.getBoundingClientRect();
    const maxX = rect ? ((scale - 1) * rect.width) / 2 : 200 * (scale - 1);
    const maxY = rect ? ((scale - 1) * rect.height) / 2 : 200 * (scale - 1);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setOffset(clampOffset(d.baseX + dx, d.baseY + dy));
  }

  function handlePointerUp() {
    dragRef.current = null;
    setIsDragging(false);
  }

  return (
    <div
      ref={frameRef}
      className="relative z-10 w-full h-full flex items-center justify-center p-10 sm:p-14 overflow-hidden"
      onClick={(e) => {
        // کلیک روی حاشیهٔ خالیِ قاب (نه خود رسانه) → بستن
        if (e.target === e.currentTarget) onClose();
      }}
      onDoubleClick={item.type === "image" ? handleDoubleClick : undefined}
      onPointerDown={item.type === "image" ? handlePointerDown : undefined}
      onPointerMove={item.type === "image" ? handlePointerMove : undefined}
      onPointerUp={item.type === "image" ? handlePointerUp : undefined}
      onPointerCancel={item.type === "image" ? handlePointerUp : undefined}
      style={{ touchAction: item.type === "image" && scale > 1 ? "none" : "auto" }}
    >
      {item.type === "video" ? (
        <motion.video
          src={item.url}
          controls
          autoPlay
          playsInline
          preload="metadata"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="max-w-full max-h-full rounded-xl shadow-2xl bg-black"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={item.url}
            alt={item.title || "رسانه"}
            draggable={false}
            className="max-w-full max-h-full object-contain select-none rounded-lg shadow-2xl"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.25s ease-out",
              cursor: scale > 1 ? "grab" : "zoom-in",
            }}
          />
        </motion.div>
      )}
    </div>
  );
}
