"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import {
  AlertCircle,
  Calendar,
  FileText,
  Loader2,
  RefreshCw,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/fitness/store";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * Global new-terms modal — v32 پذیرش «درجا»
 *
 * Mount once در layout.tsx؛ وقتی فلگ `termsUpdateRequired` در store فعال باشد
 * (/api/auth/me آن را برمی‌گرداند) این مودال روی هر صفحه‌ای که کاربر باشد باز
 * می‌شود و تا پذیرش بسته نمی‌شود.
 *
 * رفتار جدید (تغییر نسبت به نسخه قبل): دیگر کاربر به صفحه auth هدایت نمی‌شود —
 * سشن سمت سرور دیگر پاک نمی‌شود؛ با POST /api/terms/accept فقط
 * acceptedTermsVersion کاربر به‌روز می‌شود و مودال همان‌جا بسته می‌شود.
 *
 * عدم‌قابل‌بستن: ESC/کلیک بیرون/دکمه بستن ندارد — کاربر باید بپذیرد.
 */

type LegalDoc = "terms" | "privacy";

interface TermsData {
  id: string;
  version: number;
  slug?: string;
  title: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
}

export function GlobalNewTermsModal() {
  const open = useAppStore((s) => s.termsUpdateRequired);
  const setTermsUpdateRequired = useAppStore((s) => s.setTermsUpdateRequired);

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<LegalDoc>("terms");
  const [docs, setDocs] = useState<Record<LegalDoc, TermsData | null>>({
    terms: null,
    privacy: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  // SSR-safe: portal فقط سمت کلاینت رندر می‌شود (الگوی canonical پروژه)
  useEffect(() => {
    setMounted(true);
  }, []);

  // ─── دریافت محتوای قوانین هنگام باز شدن مودال (هر دو سند به‌صورت موازی) ───
  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [termsRes, privacyRes] = await Promise.all([
        fetch("/api/terms", { cache: "no-store" }),
        fetch("/api/terms?slug=privacy", { cache: "no-store" }).catch(() => null),
      ]);
      const termsData = termsRes.ok ? await termsRes.json().catch(() => null) : null;
      const privacyData = privacyRes?.ok
        ? await privacyRes.json().catch(() => null)
        : null;
      setDocs({
        terms: termsData?.terms || null,
        // حریم خصوصی اختیاری است — اگر منتشر نشده باشد فقط پیش‌نمایش خالی می‌شود
        privacy: privacyData?.terms || null,
      });
      if (!termsData?.terms) {
        setError(termsData?.error || "نسخه فعلی قوانین یافت نشد.");
      }
    } catch {
      setError("خطا در دریافت قوانین.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveTab("terms");
    fetchDocs();
  }, [open, fetchDocs]);

  // ─── قفل اسکرول بدنه تا زمان پذیرش ───
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ─── پذیرش درجا: POST /api/terms/accept → پاک کردن فلگ → بستن ───
  async function handleAccept() {
    if (accepting) return; // گارد دابل‌کلیک
    setAccepting(true);
    try {
      const res = await fetch("/api/terms/accept", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "خطا در ثبت پذیرش قوانین.");
      }
      // موفقیت — فلگ store پاک می‌شود و مودال خودکار بسته می‌شود
      setTermsUpdateRequired(false);
      toast.success("پذیرش قوانین ثبت شد 🧡");
    } catch (e) {
      // خطا → مودال باز می‌ماند و توست خطا نشان داده می‌شود
      toast.error(e instanceof Error ? e.message : "خطا در ثبت پذیرش قوانین.");
    } finally {
      setAccepting(false);
    }
  }

  // SSR-safe: تا mount نشد / فلگ خاموش بود هیچ چیزی رندر نشود
  if (!mounted) return null;
  if (!open) return null;

  const activeTerms = docs[activeTab];

  return createPortal(
    <div
      dir="rtl"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="new-terms-modal-title"
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
    >
      {/* بک‌دراپ — عمداً هیچ onClick ندارد (مودال قابل بستن نیست) */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden="true" />

      {/* ─── قاب گرادیانی کهربایی + بدنه تیره پرمیوم ─── */}
      <div
        className="relative w-full max-w-2xl rounded-2xl p-[1.5px] shadow-2xl shadow-black/50"
        style={{
          background:
            "linear-gradient(135deg, rgba(251,191,36,0.9), rgba(249,115,22,0.5), rgba(251,191,36,0.8))",
        }}
      >
        <div
          className="relative overflow-hidden rounded-[15px]"
          style={{
            background: "linear-gradient(140deg, #292524 0%, #1c1917 45%, #0c0a09 100%)",
          }}
        >
          {/* هاله‌های گرم */}
          <div
            aria-hidden="true"
            className="absolute -top-14 -left-10 w-44 h-44 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ background: "#f59e0b" }}
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl opacity-15 pointer-events-none"
            style={{ background: "#f97316" }}
          />

          {/* ─── هدر ─── */}
          <div className="relative px-5 pt-5 pb-3.5 sm:px-6">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <ScrollText className="w-5.5 h-5.5 text-white" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="new-terms-modal-title"
                  className="text-base sm:text-lg font-black text-amber-50 leading-tight"
                >
                  قوانین جدید فیتاپ
                </h2>
                <p className="text-[11px] sm:text-xs text-amber-200/70 mt-0.5 leading-relaxed">
                  اسناد فیتاپ به‌روزرسانی شده‌اند؛ برای ادامه باید نسخه جدید را مطالعه و
                  بپذیرید.
                </p>
              </div>
            </div>

            {/* ─── تب داخلی: پیش‌نمایش حریم خصوصی هم موجود است ─── */}
            <div className="mt-3.5 flex items-stretch gap-1.5">
              <button
                onClick={() => setActiveTab("terms")}
                aria-pressed={activeTab === "terms"}
                className={`flex-1 min-h-[44px] px-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === "terms"
                    ? "text-stone-950 shadow-md"
                    : "text-amber-100/60 bg-white/5 hover:bg-white/10 hover:text-amber-100"
                }`}
                style={
                  activeTab === "terms"
                    ? { background: "linear-gradient(135deg, #fbbf24, #f97316)" }
                    : undefined
                }
              >
                <ShieldCheck className="w-4 h-4" />
                قوانین و شرایط
                {docs.terms && (
                  <span className="text-[10px] font-black opacity-70">
                    · نسخه {toPersianDigits(docs.terms.version)}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("privacy")}
                aria-pressed={activeTab === "privacy"}
                className={`flex-1 min-h-[44px] px-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === "privacy"
                    ? "text-stone-950 shadow-md"
                    : "text-amber-100/60 bg-white/5 hover:bg-white/10 hover:text-amber-100"
                }`}
                style={
                  activeTab === "privacy"
                    ? { background: "linear-gradient(135deg, #fbbf24, #f97316)" }
                    : undefined
                }
              >
                <ShieldCheck className="w-4 h-4" />
                حریم خصوصی
                {docs.privacy && (
                  <span className="text-[10px] font-black opacity-70">
                    · نسخه {toPersianDigits(docs.privacy.version)}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ─── بدنه اسکرول‌شونده — سند مارک‌داون ─── */}
          <div className="relative mx-4 sm:mx-5 rounded-2xl bg-white overflow-hidden">
            <div className="max-h-[55vh] overflow-y-auto custom-scrollbar px-4 sm:px-5 py-4">
              {loading ? (
                /* اسکلتون بارگذاری */
                <div className="space-y-3" aria-hidden="true">
                  <div className="h-5 w-1/2 bg-slate-200 rounded-lg animate-pulse" />
                  {[100, 94, 88, 100, 76, 96, 84, 100, 70].map((w, i) => (
                    <div
                      key={i}
                      className="h-3.5 bg-slate-100 rounded-md animate-pulse"
                      style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
                    />
                  ))}
                </div>
              ) : error || !activeTerms ? (
                /* خطا + تلاش مجدد */
                <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                  <FileText className="w-8 h-8 mb-2 text-slate-300" />
                  <p className="text-sm text-center px-2">
                    {activeTab === "privacy" && !docs.privacy && !error
                      ? "سند حریم خصوصی هنوز منتشر نشده است."
                      : error || "سند در دسترس نیست."}
                  </p>
                  <button
                    onClick={fetchDocs}
                    className="mt-3 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-xs font-bold text-orange-600 hover:text-orange-700 hover:bg-orange-50 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    تلاش مجدد
                  </button>
                </div>
              ) : (
                <div dir="rtl" className="global-terms-modal-markdown text-slate-800 leading-relaxed">
                  <div className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-100">
                    <span className="text-sm font-black text-slate-900">
                      {activeTerms.title}
                    </span>
                    <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                      نسخه {toPersianDigits(activeTerms.version)}
                    </span>
                  </div>
                  <ReactMarkdown>{activeTerms.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>

          {/* ─── فوتر: بنر اطلاع + دکمه پذیرش ─── */}
          <div className="relative px-4 sm:px-5 py-3.5 flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
            <p className="text-[11px] text-amber-100/50 flex items-start gap-1.5 flex-1 leading-relaxed">
              <Calendar className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                با پذیرش، نسخه فعلی قوانین به پروفایل شما متصل می‌شود؛ متن کامل هر دو سند
                همیشه در صفحه «قوانین و حریم خصوصی» در دسترس است.
              </span>
            </p>
            <button
              onClick={handleAccept}
              disabled={accepting || loading || !!error || !docs.terms}
              className="shrink-0 min-h-[44px] px-6 rounded-xl text-white text-sm font-black shadow-lg shadow-orange-950/40 transition hover:opacity-90 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {accepting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال ثبت...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  مطالعه کردم و می‌پذیرم 🧡
                </>
              )}
            </button>
          </div>

          {/* بنر خطا برای پذیرش وقتی سند لود نشده — کاربر باید بداند چرا دکمه خاموش است */}
          {!loading && (error || !docs.terms) && (
            <div className="relative mx-4 sm:mx-5 mb-3 flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300 leading-relaxed">
                بدون نمایش متن قوانین امکان پذیرش نیست — ابتدا با «تلاش مجدد» سند را
                بارگذاری کنید.
              </p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .global-terms-modal-markdown h1 {
          font-size: 1.15rem;
          font-weight: 800;
          color: #0f172a;
          margin-top: 1.1rem;
          margin-bottom: 0.7rem;
          line-height: 1.4;
        }
        .global-terms-modal-markdown h1:first-child { margin-top: 0; }
        .global-terms-modal-markdown h2 {
          font-size: 1rem;
          font-weight: 700;
          color: #1e293b;
          margin-top: 1.1rem;
          margin-bottom: 0.5rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid #f1f5f9;
        }
        .global-terms-modal-markdown h3 {
          font-size: 0.92rem;
          font-weight: 700;
          color: #334155;
          margin-top: 0.95rem;
          margin-bottom: 0.4rem;
        }
        .global-terms-modal-markdown p {
          font-size: 0.85rem;
          color: #334155;
          margin-bottom: 0.6rem;
          line-height: 1.9;
        }
        .global-terms-modal-markdown strong { font-weight: 700; color: #0f172a; }
        .global-terms-modal-markdown ul, .global-terms-modal-markdown ol {
          padding-right: 1.4rem;
          margin-bottom: 0.6rem;
          color: #334155;
          font-size: 0.85rem;
          line-height: 1.9;
        }
        .global-terms-modal-markdown ul { list-style: disc; }
        .global-terms-modal-markdown ol { list-style: decimal; }
        .global-terms-modal-markdown li { margin-bottom: 0.2rem; }
        .global-terms-modal-markdown a { color: #d97706; text-decoration: underline; }
        .global-terms-modal-markdown blockquote {
          border-right: 3px solid #f59e0b;
          background: #fffbeb;
          padding: 0.5rem 0.9rem;
          border-radius: 0.5rem;
          margin: 0.6rem 0;
          color: #78350f;
          font-size: 0.83rem;
        }
        .global-terms-modal-markdown code {
          background: #f1f5f9;
          color: #b91c1c;
          padding: 0.1rem 0.3rem;
          border-radius: 0.3rem;
          font-size: 0.82em;
          font-family: ui-monospace, monospace;
        }
        .global-terms-modal-markdown pre {
          background: #0f172a;
          color: #e2e8f0;
          padding: 0.8rem;
          border-radius: 0.6rem;
          overflow-x: auto;
          margin: 0.6rem 0;
          direction: ltr;
          text-align: left;
        }
        .global-terms-modal-markdown pre code {
          background: transparent;
          color: inherit;
          padding: 0;
        }
        .global-terms-modal-markdown hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.1rem 0; }
        .global-terms-modal-markdown table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.6rem 0;
          font-size: 0.82rem;
        }
        .global-terms-modal-markdown th, .global-terms-modal-markdown td {
          border: 1px solid #e2e8f0;
          padding: 0.4rem 0.6rem;
          text-align: right;
        }
        .global-terms-modal-markdown th { background: #f8fafc; font-weight: 700; }
      `}</style>
    </div>,
    document.body
  );
}
