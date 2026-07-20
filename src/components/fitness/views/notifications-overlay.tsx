"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Bell,
  CheckCheck,
  Trash2,
  Trophy,
  Dumbbell,
  Droplets,
  CreditCard,
  Sparkles,
  Info,
  Crown,
  Clock,
  RefreshCw,
  ClipboardCheck,
  Bot,
  ChevronLeft,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits, type NotificationDto } from "@/lib/fitness/types";

const TYPE_ICONS: Record<string, any> = {
  welcome: Sparkles,
  workout_reminder: Dumbbell,
  water_reminder: Droplets,
  subscription: CreditCard,
  achievement: Trophy,
  system: Info,
  upgrade: Crown,
  renewal: Clock,
  re_engagement: RefreshCw,
  checkup: ClipboardCheck,
  coach: Bot,
};

const TYPE_COLORS: Record<string, string> = {
  welcome: "from-emerald-500 to-teal-500",
  workout_reminder: "from-orange-500 to-red-500",
  water_reminder: "from-cyan-500 to-blue-500",
  subscription: "from-amber-500 to-yellow-500",
  achievement: "from-emerald-500 to-teal-500",
  system: "from-gray-500 to-slate-500",
  upgrade: "from-amber-500 to-orange-500",
  renewal: "from-amber-500 to-orange-500",
  re_engagement: "from-cyan-500 to-sky-500",
  checkup: "from-violet-500 to-purple-500",
  coach: "from-violet-500 to-fuchsia-500",
};

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
        setOverlay(null);
        return;
      }
    }
  } catch {
    // ignore parse errors
  }
}

export function NotificationsOverlay() {
  const { setOverlay, setMainTab, notifications, setNotifications } = useAppStore();
  const [loading, setLoading] = useState(true);

  // fetch notifications هنگام باز شدن overlay
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setNotifications(data.notifications || []);
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // وقتی overlay باز می‌شود، بعد از ۲.۵ ثانیه همه را read کن
  // استفاده از functional update برای دسترسی به latest state
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        // functional update — latest state را می‌گیرد
        setNotifications((prev: any[]) => prev.map((n) => ({ ...n, read: true })));
      } catch {}
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markAllRead() {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotifications((prev: any[]) => prev.map((n) => ({ ...n, read: true })));
    } catch {}
  }

  async function markOneRead(id: string) {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev: any[]) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {}
  }

  async function deleteNotif(id: string) {
    try {
      await fetch(`/api/notifications?id=${id}`, { method: "DELETE" });
      setNotifications((prev: any[]) => prev.filter((n) => n.id !== id));
    } catch {}
  }

  async function clearAll() {
    await fetch("/api/notifications", { method: "DELETE" });
    setNotifications([]);
  }

  async function handleClick(n: NotificationDto) {
    if (!n.read) await markOneRead(n.id);
    applyLink(n.link, setMainTab, setOverlay);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" />
          <h2 className="font-bold">اعلان‌ها</h2>
          {notifications.some((n) => !n.read) && (
            <span className="text-[11px] bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded-full">
              {toPersianDigits(notifications.filter((n) => !n.read).length)} جدید
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {notifications.some((n) => !n.read) && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs rounded-lg">
              <CheckCheck className="w-4 h-4" />
              خواندن همه
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setOverlay(null)} className="rounded-full">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bell className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">اعلانی وجود ندارد</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n, i) => {
              const Icon = TYPE_ICONS[n.type] || Info;
              const color = TYPE_COLORS[n.type] || TYPE_COLORS.system;
              const hasLink = !!n.link;
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleClick(n)}
                  disabled={!hasLink}
                  className={`w-full text-right flex gap-3 p-3 rounded-2xl border transition relative ${
                    n.read ? "bg-card opacity-70" : "bg-primary/5 border-primary/20"
                  } ${hasLink ? "cursor-pointer hover:bg-primary/10" : "cursor-default"}`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-sm flex items-center gap-1">
                        {n.title}
                        {hasLink && <ChevronLeft className="w-3 h-3 text-primary/60" />}
                      </p>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 animate-pulse" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString("fa-IR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotif(n.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            deleteNotif(n.id);
                          }
                        }}
                        className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
            {notifications.length > 1 && (
              <Button
                variant="ghost"
                onClick={clearAll}
                className="w-full text-destructive text-xs mt-2"
              >
                <Trash2 className="w-4 h-4" />
                پاک کردن همه
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
