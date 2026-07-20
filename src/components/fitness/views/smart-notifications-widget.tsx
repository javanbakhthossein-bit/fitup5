"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  ChevronLeft,
  Trophy,
  Dumbbell,
  Droplets,
  CreditCard,
  Sparkles,
  Info,
  Crown,
  Clock,
  RefreshCw,
  HeartPulse,
  ClipboardCheck,
  Bot,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits, type NotificationType } from "@/lib/fitness/types";

interface SmartNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  meta?: any;
  read: boolean;
  createdAt: string;
}

// Color + icon per notification type — gold theme
const TYPE_STYLES: Record<string, { icon: any; bg: string; ring: string; iconBg: string }> = {
  upgrade: { icon: Crown, bg: "from-amber-50 to-orange-50", ring: "border-amber-200", iconBg: "linear-gradient(135deg, #f59e0b, #f97316)" },
  renewal: { icon: Clock, bg: "from-amber-50 to-yellow-50", ring: "border-amber-200", iconBg: "linear-gradient(135deg, #f59e0b, #f97316)" },
  re_engagement: { icon: RefreshCw, bg: "from-cyan-50 to-sky-50", ring: "border-cyan-200", iconBg: "linear-gradient(135deg, #06b6d4, #0ea5e9)" },
  achievement: { icon: Trophy, bg: "from-emerald-50 to-teal-50", ring: "border-emerald-200", iconBg: "linear-gradient(135deg, #10b981, #14b8a6)" },
  checkup: { icon: ClipboardCheck, bg: "from-violet-50 to-purple-50", ring: "border-violet-200", iconBg: "linear-gradient(135deg, #8b5cf6, #a855f7)" },
  coach: { icon: Bot, bg: "from-violet-50 to-fuchsia-50", ring: "border-violet-200", iconBg: "linear-gradient(135deg, #8b5cf6, #d946ef)" },
  workout_reminder: { icon: Dumbbell, bg: "from-orange-50 to-red-50", ring: "border-orange-200", iconBg: "linear-gradient(135deg, #f97316, #ef4444)" },
  water_reminder: { icon: Droplets, bg: "from-cyan-50 to-blue-50", ring: "border-cyan-200", iconBg: "linear-gradient(135deg, #06b6d4, #3b82f6)" },
  subscription: { icon: CreditCard, bg: "from-amber-50 to-yellow-50", ring: "border-amber-200", iconBg: "linear-gradient(135deg, #f59e0b, #f97316)" },
  welcome: { icon: Sparkles, bg: "from-emerald-50 to-teal-50", ring: "border-emerald-200", iconBg: "linear-gradient(135deg, #10b981, #14b8a6)" },
  system: { icon: Info, bg: "from-slate-50 to-gray-50", ring: "border-slate-200", iconBg: "linear-gradient(135deg, #64748b, #475569)" },
};

const DEFAULT_STYLE = TYPE_STYLES.system;

function getStyle(type: string) {
  return TYPE_STYLES[type] ?? DEFAULT_STYLE;
}

function applyLink(link: string | null | undefined, setMainTab: (t: any) => void, setOverlay: (o: any) => void) {
  if (!link) return;
  try {
    const url = new URL(link, "http://localhost");
    // اگر survey=open در query بود، overlay نظرسنجی را باز کن
    if (url.searchParams.get("survey") === "open") {
      setOverlay("survey");
      return;
    }
    const tab = url.searchParams.get("tab");
    if (tab) {
      // همه تب‌های معتبر پنل — باید با page.tsx هماهنگ باشد
      const validTabs = ["dashboard", "programs", "nutrition", "progress", "chat", "plans", "referral", "support", "mobileapp"];
      if (validTabs.includes(tab)) {
        setMainTab(tab);
        return;
      }
    }
    // Fallback: open notifications overlay
    setOverlay("notifications");
  } catch {
    setOverlay("notifications");
  }
}

export function SmartNotificationsWidget() {
  const { setMainTab, setOverlay } = useAppStore();
  const [notifications, setNotifications] = useState<SmartNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // Poll هر ۲۰ ثانیه برای به‌روزرسانی real-time نوتیفیکیشن‌ها
    const interval = setInterval(() => load(true), 20000);
    return () => clearInterval(interval);
  }, []);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      setNotifications((data.notifications || []).slice(0, 5));
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function handleClick(n: SmartNotification) {
    // Mark as read (single)
    if (!n.read) {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      });
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    applyLink(n.link, setMainTab, setOverlay);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Card className="p-5 bg-white border-2 border-orange-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">اعلان‌های هوشمند</h3>
            <p className="text-[11px] text-slate-500">
              {unreadCount > 0
                ? `${toPersianDigits(unreadCount)} اعلان جدید`
                : "همه چیز مرتب است"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOverlay("notifications")}
          className="text-[11px] text-orange-600 flex items-center gap-0.5 hover:gap-1 transition-all font-medium"
        >
          مشاهده همه
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl p-6 text-center bg-slate-50 border border-dashed border-slate-200">
          <Bell className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">اعلانی وجود ندارد</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n, i) => {
            const style = getStyle(n.type);
            const Icon = style.icon;
            return (
              <motion.button
                key={n.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleClick(n)}
                className={`w-full text-right flex items-start gap-3 p-3 rounded-xl bg-gradient-to-l ${style.bg} border ${style.ring} hover:shadow-md transition relative group`}
              >
                {!n.read && (
                  <span className="absolute top-2 left-2 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
                  </span>
                )}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                  style={{ background: style.iconBg }}
                >
                  <Icon className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-bold ${n.read ? "text-slate-500" : "text-slate-900"}`}>
                    {n.title}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{n.body}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(n.createdAt).toLocaleString("fa-IR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
