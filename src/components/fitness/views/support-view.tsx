"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Headphones,
  Plus,
  TicketCheck,
  ChevronLeft,
  Send,
  Loader2,
  MessageSquare,
  XCircle,
  Inbox,
  Search,
  Lightbulb,
  Wallet,
  Dumbbell,
  Apple,
  Gift,
  Bug,
  Sparkles,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackModal } from "@/components/fitness/feedback-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  TicketAttachmentPicker,
  TicketAttachmentViewList,
  type TicketAttachmentClientDto,
} from "@/components/fitness/ticket-attachments";
import { toast } from "sonner";

// ---------- Types ----------
interface TicketReplyDto {
  id: string;
  role: string; // user | admin
  message: string;
  createdAt: string;
  user: { id: string; name: string | null; mobile: string };
  attachments: TicketAttachmentClientDto[]; // v77
}

interface TicketDto {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string; // open | answered | closed
  message: string;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
  repliedAt: string | null;
  userId: string;
  user: { id: string; name: string | null; mobile: string; planName: string | null };
  replies: TicketReplyDto[];
  attachments: TicketAttachmentClientDto[]; // v77 — پیوست‌های خودِ تیکت
}

// ---------- Constants ----------
const CATEGORY_LABELS: Record<string, string> = {
  general: "عمومی",
  technical: "فنی",
  payment: "پرداخت",
  program: "برنامه",
  bug: "باگ",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "کم",
  normal: "معمولی",
  high: "مهم",
  urgent: "فوری",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-cyan-100 text-cyan-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  open: "باز",
  answered: "پاسخ داده شد",
  closed: "بسته شد",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  answered: "bg-emerald-100 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
};

function formatJalali(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("fa-IR");
  }
}

// ---------- Plan prices (dynamic from /api/payment/checkout) ----------
// قیمت‌ها از SiteSetting خوانده می‌شوند و قابل ویرایش توسط ادمین هستند.
// این الگو دقیقاً همان چیزی است که در /api/payment/checkout (GET) استفاده می‌شود.
interface PlanPrices {
  basic: number;
  standard: number;
  advanced: number;
  ultimate: number;
}

// قیمت‌های پیش‌فرض (در صورتی که API در دسترس نباشد یا هنوز لود نشده باشد)
// این مقادیر فقط fallback هستند — قیمت‌های واقعی همیشه از SiteSetting خوانده می‌شوند.
const DEFAULT_PLAN_PRICES: PlanPrices = {
  basic: 350000,
  standard: 800000,
  advanced: 1200000,
  ultimate: 1800000,
};

// قالب‌بندی قیمت به فارسی — برای نمایش در FAQ
// مثال: 350000 → "۳۵۰ هزار تومان"، 1200000 → "۱.۲ میلیون تومان"
function formatPriceToman(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "رایگان";
  if (price >= 1_000_000) {
    const millions = price / 1_000_000;
    const millionsStr = Number.isInteger(millions)
      ? toPersianDigits(millions)
      : toPersianDigits(millions.toFixed(1));
    return `${millionsStr} میلیون تومان`;
  }
  if (price >= 1000) {
    const thousands = Math.round(price / 1000);
    return `${toPersianDigits(thousands)} هزار تومان`;
  }
  return `${toPersianDigits(price)} تومان`;
}

// ---------- Main view ----------
export function SupportView() {
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TicketDto | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");
  const [planPrices, setPlanPrices] = useState<PlanPrices>(DEFAULT_PLAN_PRICES);
  // v46: مبلغ پاداش معرفی از تنظیمات ادمین — FAQ همیشه هم‌گام تنظیمات است
  const [referralReward, setReferralReward] = useState(150000);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.tickets)) setTickets(data.tickets);
    } catch {
      toast.error("خطا در دریافت تیکت‌ها");
    } finally {
      setLoading(false);
    }
  }, []);

  // دریافت قیمت‌های به‌روز پلن‌ها از /api/payment/checkout (GET)
  // این قیمت‌ها از SiteSetting خوانده می‌شوند و با تغییر در پنل ادمین به‌روز می‌شوند.
  const fetchPlanPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/payment/checkout", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const plans: Array<{ id: string; price: number }> = Array.isArray(data?.plans) ? data.plans : [];
      const next: PlanPrices = { ...DEFAULT_PLAN_PRICES };
      for (const p of plans) {
        if (p && (p.id === "basic" || p.id === "standard" || p.id === "advanced" || p.id === "ultimate") && Number.isFinite(p.price)) {
          next[p.id] = Math.round(p.price);
        }
      }
      setPlanPrices(next);
    } catch {
      // در صورت خطا، مقادیر پیش‌فرض باقی می‌مانند — UI همچنان کار می‌کند.
    }
  }, []);

  useEffect(() => {
    void fetchTickets();
    void fetchPlanPrices();
    // v46: مبلغ پاداش معرفی (best-effort — در صورت خطا پیش‌فرض ۱۵۰هزار می‌ماند)
    (async () => {
      try {
        const res = await fetch("/api/referral/code", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (Number.isFinite(data?.rewardAmount) && data.rewardAmount > 0) {
          setReferralReward(data.rewardAmount);
        }
      } catch {
        // پیش‌فرض باقی می‌ماند
      }
    })();
  }, [fetchTickets, fetchPlanPrices]);

  function handleCreated(t: TicketDto) {
    setTickets((prev) => [t, ...prev]);
    setShowNew(false);
    setSelected(t);
    toast.success("تیکت شما ثبت شد ✅");
  }

  // FIX: useCallback — قبلاً این تابع در هر رندر جدید ساخته می‌شد و چون در
  // deps اثر TicketDetail بود → حلقه بی‌نهایت GET /api/support/tickets/[id].
  const handleTicketUpdated = useCallback((t: TicketDto) => {
    setTickets((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    setSelected(t);
  }, []);

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-500/20"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">پشتیبانی</h1>
            <p className="text-xs text-slate-500">
              سوالات متداول، تیکت‌ها و پیشنهادات
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setFeedbackOpen(true)}
            className="rounded-xl gap-1.5 text-xs"
          >
            <Lightbulb className="w-4 h-4 text-orange-500" />
            <span className="hidden sm:inline">پیشنهادات</span>
          </Button>
          <Button
            onClick={() => setShowNew(true)}
            className="rounded-xl gap-1.5 text-white text-xs font-bold px-4"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {/* v46: به‌جای آیکون + — متن واضح «ثبت تیکت» روی موبایل و دسکتاپ */}
            <TicketCheck className="w-4 h-4" />
            <span>ثبت تیکت</span>
          </Button>
        </div>
      </div>

      {/* FAQ Section */}
      {!selected && (
        <FaqSection
          search={faqSearch}
          setSearch={setFaqSearch}
          planPrices={planPrices}
          referralReward={referralReward}
        />
      )}

      {/* Tickets */}
      {!selected && (
        <div>
          <div className="flex items-center gap-2 mb-3 mt-6">
            <div className="h-px flex-1 bg-orange-100" />
            <span className="text-xs font-bold text-slate-400 px-2">تیکت‌های پشتیبانی</span>
            <div className="h-px flex-1 bg-orange-100" />
          </div>
          <p className="text-xs text-slate-500 text-center mb-3">
            پاسخ خود را در سوالات متداول پیدا نکردید؟ تیکت بزنید تا پشتیبانی پاسخ دهد:
          </p>
        </div>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {selected ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
          >
            <TicketDetail
              ticket={selected}
              onBack={() => setSelected(null)}
              onUpdated={handleTicketUpdated}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
          >
            <TicketList
              tickets={tickets}
              loading={loading}
              onOpen={(t) => setSelected(t)}
              onRetry={fetchTickets}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* New ticket dialog */}
      {showNew && (
        <NewTicketDialog
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Feedback modal */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

// ---------- Ticket list ----------
function TicketList({
  tickets,
  loading,
  onOpen,
  onRetry,
}: {
  tickets: TicketDto[];
  loading: boolean;
  onOpen: (t: TicketDto) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <Card className="p-10 text-center glass">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mb-3">
          <Inbox className="w-8 h-8 text-orange-400" />
        </div>
        <p className="text-slate-700 font-bold mb-1">هنوز تیکتی ثبت نکرده‌اید</p>
        <p className="text-xs text-slate-500 mb-4">
          اگر سوال یا مشکلی دارید، اولین تیکت خود را ثبت کنید
        </p>
        <Button onClick={onRetry} variant="outline" size="sm" className="rounded-xl">
          تلاش مجدد
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {tickets.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpen(t)}
          className="w-full text-right"
        >
          <Card className="p-3.5 glass hover:border-orange-300 transition-all hover:shadow-md hover:shadow-orange-500/10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 mt-0.5">
                  <MessageSquare className="w-4 h-4 text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-slate-900 truncate">{t.subject}</p>
                  <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">
                    {t.message}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Badge className={`text-[10px] ${STATUS_COLORS[t.status] || "bg-slate-100"}`}>
                      {STATUS_LABELS[t.status] || t.status}
                    </Badge>
                    <Badge className={`text-[10px] ${PRIORITY_COLORS[t.priority] || "bg-slate-100"}`}>
                      {PRIORITY_LABELS[t.priority] || t.priority}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABELS[t.category] || t.category}
                    </Badge>
                    {t.replies.length > 0 && (
                      <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                        <MessageSquare className="w-3 h-3" />
                        {toPersianDigits(t.replies.length)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <ChevronLeft className="w-4 h-4 text-slate-400" />
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {formatJalali(t.updatedAt)}
                </span>
              </div>
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}

// ---------- Ticket detail ----------
function TicketDetail({
  ticket,
  onBack,
  onUpdated,
}: {
  ticket: TicketDto;
  onBack: () => void;
  onUpdated: (t: TicketDto) => void;
}) {
  const [reply, setReply] = useState("");
  const [attachments, setAttachments] = useState<TicketAttachmentClientDto[]>([]);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Refresh ticket on mount to ensure replies are up-to-date
  useEffect(() => {
    void (async () => {
      try {
        setRefreshing(true);
        const res = await fetch(`/api/support/tickets/${ticket.id}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.ticket) onUpdated(data.ticket);
        }
      } catch {} finally {
        setRefreshing(false);
      }
    })();
  }, [ticket.id, onUpdated]);

  // Auto-scroll to bottom when replies change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ticket.replies.length]);

  async function sendReply(e?: React.FormEvent) {
    e?.preventDefault();
    if (!reply.trim() && attachments.length === 0) {
      toast.error("متن پاسخ یا حداقل یک فایل لازم است");
      return;
    }
    // تیکت بسته دیگر بلاک نیست — ارسال پاسخ توسط مالک، تیکت را دوباره باز می‌کند
    // (PATCH در سمت سرور admin-only است؛ POST پیام مالک روی تیکت بسته = reopen خودکار).
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: reply.trim() || (attachments.length > 0 ? "📎 پیوست" : ""),
          attachmentIds: attachments.map((a) => a.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در ارسال پاسخ");
      onUpdated(data.ticket);
      setReply("");
      setAttachments([]);
      toast.success("پاسخ شما ارسال شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition"
      >
        <ChevronLeft className="w-4 h-4 rotate-180" />
        بازگشت به لیست تیکت‌ها
      </button>

      {/* Ticket header card */}
      <Card className="p-4 glass">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-orange-600" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-slate-900 truncate">{ticket.subject}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatJalali(ticket.createdAt)}
              </p>
            </div>
          </div>
          <Badge className={`text-[10px] ${STATUS_COLORS[ticket.status] || "bg-slate-100"}`}>
            {STATUS_LABELS[ticket.status] || ticket.status}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px]">
            {CATEGORY_LABELS[ticket.category] || ticket.category}
          </Badge>
          <Badge className={`text-[10px] ${PRIORITY_COLORS[ticket.priority] || "bg-slate-100"}`}>
            اولویت: {PRIORITY_LABELS[ticket.priority] || ticket.priority}
          </Badge>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed mt-3 whitespace-pre-wrap">
          {ticket.message}
        </p>
        {/* v77 — پیوست‌های خودِ تیکت */}
        <TicketAttachmentViewList attachments={ticket.attachments ?? []} side="user" />
      </Card>

      {/* Replies thread */}
      <Card className="p-3 glass">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs font-bold text-slate-700">گفتگو</h3>
          {refreshing && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
          )}
        </div>

        <div
          ref={scrollRef}
          className="max-h-[40vh] overflow-y-auto custom-scrollbar space-y-2.5 pr-1"
        >
          {ticket.replies.length === 0 && (
            <div className="text-center py-6 text-xs text-slate-500">
              هنوز پاسخی ثبت نشده است. اولین نفر باشید!
            </div>
          )}
          {ticket.replies.map((r) => (
            <ReplyBubble key={r.id} reply={r} />
          ))}
        </div>
      </Card>

      {/* Reply input */}
      <Card className="p-3 glass">
        {ticket.status === "closed" && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            این تیکت بسته شده است — با ارسال پاسخ، دوباره باز می‌شود.
          </p>
        )}
        <form onSubmit={sendReply} className="space-y-2">
          <Label className="text-xs text-slate-700">پاسخ شما</Label>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="متن پاسخ خود را بنویسید..."
            rows={3}
            className="rounded-xl resize-none"
            dir="rtl"
          />
          {/* v77 — پیوست فایل (عکس/ویدیو/فایل) */}
          <TicketAttachmentPicker
            value={attachments}
            onChange={setAttachments}
            disabled={sending}
            compact
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={sending || (!reply.trim() && attachments.length === 0)}
              className="rounded-xl gap-1.5"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              ارسال پاسخ
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------- Reply bubble ----------
function ReplyBubble({ reply }: { reply: TicketReplyDto }) {
  const isAdmin = reply.role === "admin";
  return (
    <div className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
          isAdmin
            ? "bg-orange-50 border border-orange-200 text-slate-800 rounded-bl-md"
            : "bg-slate-100 text-slate-800 rounded-br-md"
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {isAdmin ? (
            <Badge className="text-[9px] bg-orange-500 text-white">پشتیبانی</Badge>
          ) : (
            <span className="text-[10px] font-bold text-slate-600">شما</span>
          )}
          <span className="text-[9px] text-slate-400">{formatJalali(reply.createdAt)}</span>
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{reply.message}</p>
        {/* v77 — پیوست‌های همین پاسخ */}
        <TicketAttachmentViewList attachments={reply.attachments ?? []} side={isAdmin ? "admin" : "user"} />
      </div>
    </div>
  );
}

// ---------- New ticket dialog ----------
function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: TicketDto) => void;
}) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<TicketAttachmentClientDto[]>([]); // v77
  const [saving, setSaving] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (subject.trim().length < 3) {
      toast.error("موضوع باید حداقل ۳ کاراکتر باشد");
      return;
    }
    if (message.trim().length < 5) {
      toast.error("متن پیام باید حداقل ۵ کاراکتر باشد");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          priority,
          message: message.trim(),
          // v77 — پیوست‌های آپلودشده (فقط شناسه‌ها — فایل‌ها قبلاً آپلود شده‌اند)
          attachmentIds: attachments.map((a) => a.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در ثبت تیکت");
      onCreated(data.ticket);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            تیکت جدید
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">موضوع</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="مثلاً: مشکل در ورود به حساب کاربری"
              className="rounded-xl"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">دسته‌بندی</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">عمومی</SelectItem>
                  <SelectItem value="technical">فنی</SelectItem>
                  <SelectItem value="payment">پرداخت</SelectItem>
                  <SelectItem value="program">برنامه</SelectItem>
                  <SelectItem value="bug">باگ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">اولویت</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">کم</SelectItem>
                  <SelectItem value="normal">معمولی</SelectItem>
                  <SelectItem value="high">مهم</SelectItem>
                  <SelectItem value="urgent">فوری</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">متن پیام</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="مشکل یا سوال خود را با جزئیات شرح دهید..."
              rows={5}
              className="rounded-xl resize-none"
              dir="rtl"
            />
          </div>

          {/* v77 — پیوست فایل (عکس/ویدیو/فایل) — فایل‌ها بلافاصله آپلود و ماندگار می‌شوند */}
          <div className="space-y-1.5">
            <Label className="text-xs">پیوست‌ها (اختیاری)</Label>
            <TicketAttachmentPicker value={attachments} onChange={setAttachments} disabled={saving} />
          </div>

          <DialogFooter>
            <Button type="button" onClick={onClose} variant="outline" className="rounded-xl">
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="rounded-xl gap-1.5"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              ثبت تیکت
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- FAQ Section ----------
// NOTE: این داده‌ها به‌صورت static تعریف شده‌اند ولی قیمت‌ها به‌صورت پارامتر پاس داده
// می‌شوند تا با تغییر قیمت در پنل ادمین (SiteSetting)، FAQ هم به‌روز شود.
// الگوی خواندن قیمت‌ها دقیقاً مشابه /api/payment/checkout (GET) است که از
// getActivePlans() در lib/fitness/pricing.ts استفاده می‌کند.
type FaqData = { category: string; icon: any; items: { q: string; a: string }[] }[];

function buildFaqData(prices: PlanPrices, referralReward = 150000): FaqData {
  const plansSummary = `اقتصادی (${formatPriceToman(prices.basic)})، استاندارد (${formatPriceToman(prices.standard)})، پیشرفته (${formatPriceToman(prices.advanced)}) و حرفه‌ای (${formatPriceToman(prices.ultimate)})`;
  const reward = `${toPersianDigits(referralReward.toLocaleString("en-US"))} تومان`;
  return [
    {
      category: "شروع کار با فیتاپ",
      icon: Sparkles,
      items: [
        { q: "چگونه در فیتاپ ثبت‌نام کنم؟", a: "کافیست شماره موبایل خود را وارد کنید، کد ۴ رقمی پیامکی را تایید کنید و سپس اطلاعات آنبوردینگ (سن، قد، وزن، هدف) را تکمیل کنید. ثبت‌نام کاملاً رایگان است." },
        { q: "آنبوردینگ چیست و چرا مهم است؟", a: "آنبوردینگ جمع‌آوری اطلاعات فیزیکی شما (سن، قد، وزن، هدف، سطح فعالیت، تجهیزات، آسیب‌دیدگی‌ها و تجربه تمرینی) است. این اطلاعات برای تولید برنامه تمرینی و غذایی شخصی‌سازی‌شده و گزارش هوشمند ضروری است — هرچه دقیق‌تر پر کنید، برنامه دقیق‌تری می‌گیرید." },
        { q: "گزارش هوشمند چیست؟", a: "پس از تکمیل آنبوردینگ، فیتاپ یک گزارش هوشمند شامل BMI، BMR، TDEE، درشت‌مغذی‌های هدف، مسیر رسیدن به وزن هدف و پیشنهاد پلن مناسب نمایش می‌دهد." },
        { q: "دوره آنبوردینگ را نیمه‌کاره رها کردم؛ چه کنم؟", a: "نگران نباشید — با ورود دوباره، از همان مرحله‌ای که رها کردید ادامه می‌دهید. فیتاپ پیشرفت شما را ذخیره می‌کند و اگر وسط راه پیامک نیامد یا صفحه بسته شد، با ورود مجدد همه‌چیز سر جای خودش است." },
      ],
    },
    {
      category: "پلن‌ها و امکانات هر پلن",
      icon: Dumbbell,
      items: [
        { q: "هر پلن چه امکاناتی دارد؟", a: `اقتصادی: برنامه تمرینی + غذایی هوشمند ۴۵ روزه. استاندارد: + برنامه مکمل، ۳ چکاپ دوره‌ای و داشبورد پیشرفته. پیشرفته: + چت نامحدود با مربی هوشمند (متن و عکس)، آنالیز عکس غذا و بدن، حالت باشگاه، کامپنیون تغذیه و کتابخانه کامل حرکات. حرفه‌ای: + آنالیز ویدیویی بدن، اصلاح تکنیک با ویدیو، آنالیز آزمایش خون (۱ بار) و نظارت مربی انسانی. قیمت‌ها: ${plansSummary}.` },
        { q: "مدت اشتراک چقدر است؟", a: "تمام پلن‌ها ۴۵ روزه هستند و شامل ۱ فاز تمرینی کامل می‌باشند. در طول دوره، پیشرفت شما (وزن، چکاپ‌ها، تمرین‌ها) ثبت می‌شود تا برنامه‌های بعدی دقیق‌تر شوند." },
        { q: "چگونه پلن مناسب خود را انتخاب کنم؟", a: "اگر فقط برنامه تمرین و تغذیه می‌خواهید، اقتصادی یا استاندارد کافی است. اگر مربی هوشمند ۲۴ ساعته، آنالیز عکس و حالت باشگاه می‌خواهید، پیشرفته (محبوب‌ترین). اگر آنالیز ویدیو، اصلاح تکنیک و آزمایش خون می‌خواهید، حرفه‌ای." },
        { q: "تفاوت چت با فیتاپ و چت با نیکا چیست؟", a: "«چت با فیتاپ» مربی هوشمند شماست (پلن پیشرفته و بالاتر) — سوال فنی تمرین/تغذیه می‌پرسید و به پرونده کامل شما دسترسی دارد. «نیکا» کارشناس راهنمای خرید است و برای همه (حتی بدون خرید) فعال است — سوال درباره پلن‌ها، قیمت‌ها و نحوه استفاده را از او بپرسید." },
      ],
    },
    {
      category: "پرداخت، کیف پول و تخفیف",
      icon: Wallet,
      items: [
        { q: "پرداخت چگونه انجام می‌شود؟", a: "پرداخت از طریق درگاه امن زرین‌پال یا کیف پول فیتاپ انجام می‌شود. پس از پرداخت موفق، اشتراک شما فوراً فعال می‌شود و تولید برنامه به‌صورت خودکار شروع می‌شود." },
        { q: "کیف پول چیست و چگونه شارژ کنم؟", a: "کیف پول اعتبار داخلی فیتاپ است. از بخش کیف پول می‌توانید شارژ کنید و بعداً بدون درگاه، با یک کلیک پلن بخرید یا تمدید کنید. پاداش معرفی به دوست هم داخل همین کیف پول واریز می‌شود." },
        { q: "کد تخفیف چگونه دریافت می‌شود؟", a: "پس از تکمیل آنبوردینگ، یک کد تخفیف پیامکی برای اولین خرید برایتان ارسال می‌شود. اگر اشتراکتان رو به اتمام باشد یا منقضی شود هم کد تخفیف تمدید خودکار پیامک می‌شود. کد را در صفحه پرداخت وارد کنید." },
        { q: "تمدید اشتراک چگونه است؟", a: "۳ روز قبل از انقضا به شما اطلاع می‌دهیم و کد تخفیف تمدید می‌گیرید. از بخش «مدیریت اشتراک» می‌توانید با یک کلیک پلن را تمدید کنید؛ تاریخ انقضا و وضعیت برنامه‌ها آنجا نمایش داده می‌شود." },
        { q: "پرداخت من موفق شد ولی پلن فعال نشد؛ چه کنم؟", a: "کمی صبر کنید و صفحه را رفرش کنید — فیتاپ پرداخت‌های ناقص را خودکار بازیابی می‌کند. اگر بعد از چند دقیقه فعال نشد، از بخش پرداخت‌های در انتظار دوباره تلاش کنید یا تیکت بزنید تا رسیدگی دستی انجام شود." },
      ],
    },
    {
      category: "برنامه تمرینی و غذایی",
      icon: Dumbbell,
      items: [
        { q: "چگونه برنامه تمرینی دریافت کنم؟", a: "پس از خرید، برنامه تمرینی و غذایی به‌صورت خودکار توسط هوش مصنوعی ساخته می‌شود و با نوتیفیکیشن و پیامک به شما اطلاع می‌دهیم (معمولاً چند دقیقه طول می‌کشد). برای پلن پیشرفته و حرفه‌ای، ابتدا باید عکس بدن ارسال کنید تا برنامه دقیق‌تر طراحی شود." },
        { q: "پلن پیشرفته/حرفه‌ای چرا نیاز به عکس بدن دارد؟", a: "برای شخصی‌سازی دقیق‌تر برنامه، فیتاپ عکس‌های بدن شما را با هوش مصنوعی تحلیل می‌کند و بر اساس فرم بدن، تقارن عضلانی و نقاط ضعف، برنامه را طراحی می‌کند. عکس‌های شما خصوصی است و فقط برای طراحی برنامه استفاده می‌شود." },
        { q: "آیا می‌توانم حرکات برنامه را عوض کنم؟", a: "بله — برای هر حرکت گزینه جایگزین وجود دارد (جایگزینی هوشمند با تجهیزات در دسترس). اگر حرکتی را بلد نیستید یا تجهیزاتش را ندارید، از دکمه جایگزینی استفاده کنید یا از چت مربی هوشمند کمک بگیرید." },
        { q: "برنامه غذایی شامل چه چیزی است؟", a: "برنامه غذایی شامل کالری هدف روزانه، درشت‌مغذی‌ها (پروتئین/کربو/چربی)، وعده‌های غذایی با ترکیب غذاها، غذاهای جایگزین و (در پلن استاندارد به بالا) برنامه مکمل با دوز ایمن است." },
        { q: "وزنم تغییر کرد؛ برنامه به‌روز می‌شود؟", a: "وزن جدید را از بخش پیشرفت ثبت کنید. در چکاپ‌های دوره‌ای (پلن استاندارد به بالا) برنامه بر اساس پیشرفت واقعی شما به‌روزرسانی می‌شود و تمدید بعدی دقیق‌تر طراحی می‌شود." },
      ],
    },
    {
      category: "چت با فیتاپ (مربی هوشمند)",
      icon: MessageSquare,
      items: [
        { q: "مربی هوشمند چیست و چه کسی دسترسی دارد؟", a: "مربی هوشمند یک چت ۲۴ ساعته با هوش مصنوعی است که به پرونده کامل شما (آنبوردینگ، برنامه، پیشرفت) دسترسی دارد. دسترسی چت نامحدود مخصوص پلن پیشرفته و حرفه‌ای است." },
        { q: "چه سوالاتی می‌توانم بپرسم؟", a: "تکنیک حرکات، اصلاح برنامه، تغذیه، مکمل‌ها، کالری، جایگزینی غذا، ریکاوری و هر موضوع مرتبط با تناسب اندام. پاسخ‌ها بر اساس پرونده خود شما شخصی‌سازی می‌شود." },
        { q: "آیا می‌توانم عکس یا ویدیو بفرستم؟", a: "بله — پلن پیشرفته: عکس (غذا، بدن، تجهیزات). پلن حرفه‌ای: عکس + ویدیو (تحلیل فرم حرکت و اصلاح تکنیک). هوش مصنوعی تصاویر را تحلیل و بازخورد دقیق می‌دهد." },
        { q: "تحلیل عکس غذا چگونه کار می‌کند؟", a: "عکس غذای خود را در چت مربی بفرستید. هوش مصنوعی مواد تشکیل‌دهنده، کالری تخمینی و درشت‌مغذی‌ها را تحلیل می‌کند و می‌تواند جایگزین‌های سالم پیشنهاد دهد." },
      ],
    },
    {
      category: "حالت باشگاه و امکانات ویژه",
      icon: Apple,
      items: [
        { q: "حالت باشگاه (جیم مود) چیست؟", a: "محیط تمرین ویژه پلن پیشرفته و حرفه‌ای: پخش موزیک انگیزشی، نمایش تمرین روز، ثبت وزنه و تکرار هر ست با تیک، و چت زنده با مربی هوشمند در حین تمرین — همه در یک صفحه." },
        { q: "کتابخانه حرکات چیست؟", a: "بانک کامل حرکات با ویدیوی اجرای صحیح و توضیح فنی. دسترسی کامل مخصوص پلن پیشرفته و بالاتر است؛ جستجوی حرکت برای همه کاربران باز است." },
        { q: "تحلیل آزمایش خون چیست؟", a: "ویژه پلن حرفه‌ای (۱ بار در دوره): عکس آزمایش خون خود را بفرستید تا ۴۷ ماده آزمایشی در ۱۰ دسته (CBC، چربی، کبد، کلیه، هورمون‌ها، ویتامین‌ها و...) تحلیل و نتیجه مستقیماً در برنامه شما اعمال شود." },
        { q: "آنالیز ویدیویی چیست؟", a: "ویژه پلن حرفه‌ای: ویدیوی اجرای حرکات خود را بفرستید؛ هوش مصنوعی فرم بدن، تقارن و تکنیک را بررسی و اصلاحات لازم را پیشنهاد می‌دهد." },
        { q: "چکاپ دوره‌ای چیست؟", a: "ویژه پلن استاندارد به بالا: در طول ۴۵ روز، ۳ چکاپ برای رصد پیشرفت (وزن، اندازه‌های بدن، سطح انرژی و رعایت برنامه) انجام می‌شود و نتایج در به‌روزرسانی برنامه استفاده می‌شود." },
      ],
    },
    {
      category: "معرفی به دوست",
      icon: Gift,
      items: [
        { q: "سیستم معرفی چگونه کار می‌کند؟", a: `لینک اختصاصی معرفی خود را از بخش «معرفی به دوست» در پنل دریافت کنید. هر دوست که با لینک شما ثبت‌نام و پلن خرید کند، هر دو طرف ${reward} پاداش دریافت می‌کنید.` },
        { q: "پاداش کجا واریز می‌شود؟", a: "پاداش مستقیماً به کیف پول فیتاپ شما واریز می‌شود و می‌توانید از آن برای خرید یا تمدید پلن استفاده کنید." },
      ],
    },
    {
      category: "مشکلات فنی",
      icon: Bug,
      items: [
        { q: "پیامک تایید نیامد", a: "۲ دقیقه صبر کنید و دوباره درخواست کد بدهید. پوشه پیامک‌های ناشناس/بلاک‌شده گوشی را هم چک کنید. اگر باز نیامد، شماره را با فرمت درست (۰۹...) وارد کنید یا تیکت بزنید تا پشتیبانی بررسی کند." },
        { q: "پرداخت موفق بود ولی پلن فعال نشد", a: "فیتاپ پرداخت‌های ناتمام را خودکار بازیابی می‌کند — یک بار صفحه را رفرش کنید. اگر بعد از ۵ دقیقه فعال نشد، تیکت بزنید؛ شماره پیگیری پرداخت خودکار ثبت شده و رسیدگی دستی سریع انجام می‌شود." },
        { q: "برنامه تمرینی نمایش داده نمی‌شود", a: "اگر پلن پیشرفته یا حرفه‌ای دارید، ابتدا باید عکس بدن خود را از بنر «ارسال عکس بدن» ارسال کنید. وضعیت تولید برنامه را از تب «برنامه‌ها» دنبال کنید؛ اگر خطا خورد، دکمه تلاش مجدد همان‌جا هست و تولید دوباره شروع می‌شود." },
        { q: "سایت کند است یا درست لود نمی‌شود", a: "کش مرورگر را پاک کنید (Ctrl+Shift+R) یا از آخرین نسخه کروم استفاده کنید. اپ فیتاپ را می‌توانید از کافه‌بازار نصب کنید — سریع‌تر و پایدارتر از مرورگر است." },
        { q: "اپ می‌گوید باید آپدیت کنم", a: "نسخه جدید اپ فیتاپ را از کافه‌بازار آپدیت کنید. برخی آپدیت‌ها اجباری‌اند تا همه امکانات درست کار کند. اگر آپدیت در بازار نمایش داده نمی‌شود، چند ساعت صبر کنید یا تیکت بزنید." },
      ],
    },
  ];
}

function FaqSection({
  search,
  setSearch,
  planPrices,
  referralReward,
}: {
  search: string;
  setSearch: (s: string) => void;
  planPrices: PlanPrices;
  referralReward?: number;
}) {
  const faqData = useMemo(() => buildFaqData(planPrices, referralReward), [planPrices, referralReward]);
  const filtered = search.trim()
    ? faqData.map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.q.includes(search) ||
            item.a.includes(search) ||
            cat.category.includes(search)
        ),
      })).filter((cat) => cat.items.length > 0)
    : faqData;

  return (
    <div>
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو در سوالات متداول..."
          className="w-full rounded-xl border border-slate-200 pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
        />
      </div>

      {/* FAQ accordion */}
      <Accordion type="single" collapsible className="space-y-3">
        {filtered.map((cat, ci) => {
          const CatIcon = cat.icon;
          return (
            <AccordionItem
              key={ci}
              value={`cat-${ci}`}
              className="rounded-2xl border border-orange-100 bg-white overflow-hidden shadow-sm"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-orange-50/50 transition">
                <div className="flex items-center gap-2.5 text-right flex-1">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                    <CatIcon className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-bold text-sm text-slate-900">{cat.category}</span>
                  <span className="text-[10px] text-slate-400 mr-auto">{cat.items.length} سوال</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3 pt-1">
                <div className="space-y-3">
                  {cat.items.map((item, ii) => (
                    <div key={ii} className="rounded-xl bg-orange-50/40 p-3 border border-orange-50">
                      <p className="text-xs font-bold text-slate-900 mb-1.5 flex items-start gap-1.5">
                        <span className="text-orange-500 shrink-0">س:</span>
                        {item.q}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
                        <span className="text-emerald-500 shrink-0 font-bold">ج:</span>
                        {item.a}
                      </p>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {filtered.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">نتیجه‌ای یافت نشد. تیکت بزنید تا پشتیبانی پاسخ دهد.</p>
        </div>
      )}
    </div>
  );
}
