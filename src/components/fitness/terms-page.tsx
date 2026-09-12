"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  Loader2,
  ShieldCheck,
  FileText,
  Calendar,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { toPersianDigits } from "@/lib/fitness/types";
import { Button } from "@/components/ui/button";
import { replaceScreen } from "@/lib/fitness/navigation";

// ─── اسناد حقوقی — «terms»: شرایط و قوانین، «privacy»: حریم خصوصی ───
// کنوانسیون URL: /?screen=terms (قوانین) و /?screen=terms&doc=privacy (حریم خصوصی)
type LegalDoc = "terms" | "privacy";

interface TermsData {
  id: string;
  version: number;
  slug?: string;
  title: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// وضعیت مستقل هر سند — هر دو سند موازی fetch می‌شوند و در state کش می‌شوند
interface DocState {
  data: TermsData | null;
  loading: boolean;
  error: string;
}

const INITIAL_DOC_STATE: DocState = { data: null, loading: true, error: "" };

// خواندن سند فعال از URL (فقط سمت کلاینت — SSR همیشه «terms» را رندر می‌کند)
function readDocFromUrl(): LegalDoc {
  if (typeof window === "undefined") return "terms";
  return new URLSearchParams(window.location.search).get("doc") === "privacy"
    ? "privacy"
    : "terms";
}

// همگام‌سازی URL با سند فعال — بدون ریلود (history.replaceState)
function syncDocUrl(doc: LegalDoc) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("screen", "terms");
  if (doc === "privacy") {
    url.searchParams.set("doc", "privacy");
  } else {
    url.searchParams.delete("doc");
  }
  window.history.replaceState({ screen: "terms", doc }, "", url.toString());
}

export function TermsPage() {
  const { setScreen } = useAppStore();
  // سند فعال — SSR/hydration همیشه با «terms» شروع می‌شود تا mismatch رخ ندهد؛
  // بعد از mount از URL خوانده می‌شود (doc=privacy → تب حریم خصوصی)
  const [activeDoc, setActiveDoc] = useState<LegalDoc>("terms");
  const [docs, setDocs] = useState<Record<LegalDoc, DocState>>({
    terms: INITIAL_DOC_STATE,
    privacy: INITIAL_DOC_STATE,
  });

  const activeState = docs[activeDoc];

  // ─── URL + دکمه back مرورگر ───
  useEffect(() => {
    replaceScreen("terms"); // URL را برای refresh تنظیم کن (پارامتر doc حفظ می‌شود)
    setActiveDoc(readDocFromUrl());
    // همگام‌سازی با دکمه back/forward مرورگر — doc از URL خوانده می‌شود
    const onPopState = () => {
      setActiveDoc(readDocFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // ─── دریافت موازی هر دو سند (قوانین + حریم خصوصی) در mount ───
  const fetchDoc = useCallback(async (slug: LegalDoc) => {
    setDocs((prev) => ({ ...prev, [slug]: { ...prev[slug], loading: true, error: "" } }));
    try {
      const res = await fetch(`/api/terms${slug === "privacy" ? "?slug=privacy" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.terms) {
        throw new Error(
          data?.error || (slug === "privacy" ? "سند حریم خصوصی یافت نشد." : "قوانین یافت نشد.")
        );
      }
      setDocs((prev) => ({ ...prev, [slug]: { data: data.terms, loading: false, error: "" } }));
    } catch (e) {
      setDocs((prev) => ({
        ...prev,
        [slug]: {
          data: null,
          loading: false,
          error: e instanceof Error && e.message ? e.message : "خطا در دریافت سند.",
        },
      }));
    }
  }, []);

  useEffect(() => {
    fetchDoc("terms");
    fetchDoc("privacy");
  }, [fetchDoc]);

  // ─── SEO ─── (عنوان/توضیحات/canonical بر اساس سند فعال به‌روز می‌شود)
  useEffect(() => {
    const isPrivacy = activeDoc === "privacy";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
    const pageUrl = `${siteUrl}/?screen=terms${isPrivacy ? "&doc=privacy" : ""}`;
    const title = isPrivacy
      ? "سیاست حفظ حریم خصوصی | فیتاپ"
      : "قوانین و مقررات | فیتاپ";
    const description = isPrivacy
      ? "سیاست حفظ حریم خصوصی فیتاپ — نحوه جمع‌آوری، استفاده، نگهداری و حفاظت از داده‌های شخصی کاربران."
      : "قوانین و مقررات استفاده از خدمات اپلیکیشن فیتاپ — شرایط استفاده، حقوق کاربر، سیاست بازگشت وجه و حریم خصوصی.";
    const keywords = isPrivacy
      ? "حریم خصوصی فیتاپ، سیاست حفظ حریم خصوصی، داده‌های شخصی، کوکی، امنیت اطلاعات"
      : "قوانین فیتاپ، مقررات فیتاپ، شرایط استفاده، حریم خصوصی، سیاست بازگشت وجه";
    const ogImage = `${siteUrl}/fitup-logo.png`;

    document.title = title;
    setMetaTag("description", description);
    setMetaTag("keywords", keywords);
    setMetaTag("robots", "index,follow");
    setLinkTag("canonical", pageUrl);

    setMetaProp("og:title", title);
    setMetaProp("og:description", description);
    setMetaProp("og:type", "website");
    setMetaProp("og:locale", "fa_IR");
    setMetaProp("og:url", pageUrl);
    setMetaProp("og:image", ogImage);
    setMetaProp("og:site_name", "فیتاپ");

    setMetaProp("twitter:card", "summary_large_image");
    setMetaProp("twitter:title", title);
    setMetaProp("twitter:description", description);
    setMetaProp("twitter:image", ogImage);

    // BreadcrumbList schema
    setJsonLd("breadcrumb-schema", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "فیتاپ", item: siteUrl },
        {
          "@type": "ListItem",
          position: 2,
          name: isPrivacy ? "حریم خصوصی" : "قوانین",
          item: pageUrl,
        },
      ],
    });

    return () => {
      ["breadcrumb-schema"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      document.title =
        "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه با AI";
    };
  }, [activeDoc]);

  function goHome() {
    setScreen("landing");
    replaceScreen("landing");
  }

  // ─── تغییر تب — بدون ریلود، فقط replaceState ───
  function switchDoc(doc: LegalDoc) {
    if (doc === activeDoc) return;
    setActiveDoc(doc);
    syncDocUrl(doc);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const ActiveIcon = activeDoc === "privacy" ? Lock : ShieldCheck;

  return (
    <>
      <ToolsNav />
      <main className="min-h-screen bg-white pt-20 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Back button */}
          <button
            onClick={goHome}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4 transition"
          >
            <ArrowRight className="w-4 h-4" />
            بازگشت به صفحه اصلی
          </button>

          {/* ─── هدر صفحه + تب سگمنتی انتخاب سند ─── */}
          <div className="mb-5">
            <h1 className="text-lg sm:text-xl font-black text-slate-900 mb-3">
              قوانین و حریم خصوصی
            </h1>
            <div
              role="tablist"
              aria-label="انتخاب سند حقوقی"
              className="inline-flex w-full sm:w-auto items-stretch gap-1 rounded-2xl bg-slate-100 border border-slate-200 p-1"
            >
              <button
                role="tab"
                aria-selected={activeDoc === "terms"}
                onClick={() => switchDoc("terms")}
                className={`flex-1 sm:flex-none min-h-[44px] px-5 sm:px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
                  activeDoc === "terms"
                    ? "text-white shadow-lg shadow-orange-500/25"
                    : "text-slate-500 hover:text-slate-800 hover:bg-white/70"
                }`}
                style={
                  activeDoc === "terms"
                    ? { background: "linear-gradient(135deg, #f97316, #f59e0b)" }
                    : undefined
                }
              >
                <FileText className="w-4 h-4" />
                قوانین و شرایط
              </button>
              <button
                role="tab"
                aria-selected={activeDoc === "privacy"}
                onClick={() => switchDoc("privacy")}
                className={`flex-1 sm:flex-none min-h-[44px] px-5 sm:px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
                  activeDoc === "privacy"
                    ? "text-white shadow-lg shadow-orange-500/25"
                    : "text-slate-500 hover:text-slate-800 hover:bg-white/70"
                }`}
                style={
                  activeDoc === "privacy"
                    ? { background: "linear-gradient(135deg, #f97316, #f59e0b)" }
                    : undefined
                }
              >
                <ShieldCheck className="w-4 h-4" />
                حریم خصوصی
              </button>
            </div>
          </div>

          {/* ─── بدنه سند فعال ─── */}
          {activeState.loading ? (
            <DocSkeleton />
          ) : activeState.error || !activeState.data ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 bg-slate-50 rounded-3xl border border-slate-200">
              <FileText className="w-10 h-10 mb-3 text-slate-300" />
              <p className="text-sm px-4 text-center">
                {activeState.error || "سند در دسترس نیست."}
              </p>
              {/* تلاش مجدد — فقط همان سند دوباره fetch می‌شود */}
              <button
                onClick={() => fetchDoc(activeDoc)}
                className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-bold text-white shadow-md transition hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <RefreshCw className="w-4 h-4" />
                تلاش مجدد
              </button>
              <Button onClick={goHome} variant="outline" className="mt-2 rounded-xl">
                بازگشت
              </Button>
            </div>
          ) : (
            <article
              key={activeDoc}
              className="animate-fade-in-up bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <header className="px-6 sm:px-8 py-6 bg-gradient-to-l from-amber-50 via-white to-white border-b border-slate-100">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-md"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                  >
                    <ActiveIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    {/* نشان نسخه — هر سند شماره نسخه مستقل خودش را دارد */}
                    <span
                      className="inline-block text-[11px] font-bold text-amber-700 bg-amber-100 rounded-full px-2.5 py-0.5 mb-1"
                    >
                      نسخه {toPersianDigits(activeState.data.version)}
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
                      {activeState.data.title}
                    </h2>
                  </div>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-2">
                  <Calendar className="w-3.5 h-3.5" />
                  آخرین به‌روزرسانی:{" "}
                  {new Date(activeState.data.updatedAt).toLocaleDateString("fa-IR")}
                </p>
              </header>

              {/* Markdown body — هر دو سند با همین استایل‌های markdown رندر می‌شوند */}
              <div
                dir="rtl"
                className="terms-markdown px-6 sm:px-8 py-6 sm:py-8 text-slate-800 leading-relaxed"
              >
                <ReactMarkdown>{activeState.data.content}</ReactMarkdown>
              </div>
            </article>
          )}
        </div>

        <style jsx global>{`
          .terms-markdown h1 {
            font-size: 1.5rem;
            font-weight: 800;
            color: #0f172a;
            margin-top: 1.5rem;
            margin-bottom: 1rem;
            line-height: 1.4;
          }
          .terms-markdown h1:first-child { margin-top: 0; }
          .terms-markdown h2 {
            font-size: 1.15rem;
            font-weight: 700;
            color: #1e293b;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
            padding-bottom: 0.4rem;
            border-bottom: 1px solid #f1f5f9;
          }
          .terms-markdown h3 {
            font-size: 1rem;
            font-weight: 700;
            color: #334155;
            margin-top: 1.2rem;
            margin-bottom: 0.5rem;
          }
          .terms-markdown p {
            font-size: 0.95rem;
            color: #334155;
            margin-bottom: 0.85rem;
            line-height: 2;
          }
          .terms-markdown strong { font-weight: 700; color: #0f172a; }
          .terms-markdown ul, .terms-markdown ol {
            padding-right: 1.5rem;
            margin-bottom: 0.85rem;
            color: #334155;
            font-size: 0.95rem;
            line-height: 2;
          }
          .terms-markdown ul { list-style: disc; }
          .terms-markdown ol { list-style: decimal; }
          .terms-markdown li { margin-bottom: 0.3rem; }
          .terms-markdown a { color: #d97706; text-decoration: underline; }
          .terms-markdown blockquote {
            border-right: 3px solid #f59e0b;
            background: #fffbeb;
            padding: 0.6rem 1rem;
            border-radius: 0.5rem;
            margin: 0.85rem 0;
            color: #78350f;
            font-size: 0.9rem;
          }
          .terms-markdown code {
            background: #f1f5f9;
            color: #b91c1c;
            padding: 0.1rem 0.35rem;
            border-radius: 0.3rem;
            font-size: 0.85em;
            font-family: ui-monospace, monospace;
          }
          .terms-markdown pre {
            background: #0f172a;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 0.75rem;
            overflow-x: auto;
            margin: 0.85rem 0;
            direction: ltr;
            text-align: left;
          }
          .terms-markdown pre code {
            background: transparent;
            color: inherit;
            padding: 0;
          }
          .terms-markdown hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
          .terms-markdown table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.85rem 0;
            font-size: 0.9rem;
          }
          .terms-markdown th, .terms-markdown td {
            border: 1px solid #e2e8f0;
            padding: 0.5rem 0.75rem;
            text-align: right;
          }
          .terms-markdown th { background: #f8fafc; font-weight: 700; }
        `}</style>
      </main>
    </>
  );
}

// ─── اسکلتون بارگذاری سند (جای Loader دایره‌ای — UX بهتر برای سند بلند) ───
function DocSkeleton() {
  return (
    <div
      className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
      aria-hidden="true"
    >
      <div className="px-6 sm:px-8 py-6 border-b border-slate-100 bg-gradient-to-l from-amber-50 via-white to-white">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-200 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 bg-amber-100 rounded-full animate-pulse" />
            <div className="h-6 w-2/3 bg-slate-200 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
      <div className="px-6 sm:px-8 py-6 space-y-3.5">
        {[92, 100, 78, 100, 88, 64, 96, 82].map((w, i) => (
          <div
            key={i}
            className="h-4 bg-slate-100 rounded-md animate-pulse"
            style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
        <div className="flex items-center justify-center gap-2 pt-4 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
          <span className="text-xs">در حال بارگذاری سند...</span>
        </div>
      </div>
    </div>
  );
}

// ─── SEO helper functions ───
function setMetaTag(name: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaProp(prop: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", prop);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(id: string, data: any) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}
