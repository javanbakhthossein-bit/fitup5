"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Apple,
  TrendingUp,
  MessageCircle,
  Crown,
  ClipboardList,
  Gift,
  Headphones,
  Smartphone,
} from "lucide-react";
import { useAppStore, type MainTab } from "@/lib/fitness/store";
import { DashboardView } from "@/components/fitness/views/dashboard-view";
import { ProgramsView } from "@/components/fitness/views/programs-view";
import { NutritionView } from "@/components/fitness/views/nutrition-view";
import { ProgressView } from "@/components/fitness/views/progress-view";
import { ChatView } from "@/components/fitness/views/chat-view";
import { PlansView } from "@/components/fitness/views/plans-view";
import { ReferralView } from "@/components/fitness/views/referral-view";
import { SupportView } from "@/components/fitness/views/support-view";
import { MobileAppView } from "@/components/fitness/views/mobile-app-view";
import { ActiveWorkoutSession } from "@/components/fitness/views/active-workout-session";
import { GymModeView } from "@/components/fitness/views/gym-mode-view";
import { VideoAnalysisView } from "@/components/fitness/views/video-analysis-view";
import { BloodTestView } from "@/components/fitness/views/blood-test-view";
import { NotificationsOverlay } from "@/components/fitness/views/notifications-overlay";
import { ProfileOverlay } from "@/components/fitness/views/profile-overlay";
import { SubscriptionOverlay } from "@/components/fitness/views/subscription-overlay";
import { AdminOverlay } from "@/components/fitness/views/admin-overlay";
import { ExerciseDetailOverlay } from "@/components/fitness/views/exercise-detail-overlay";
import { SurveyOverlay } from "@/components/fitness/views/survey-overlay";
import { TopBar } from "@/components/fitness/top-bar";
import { Sidebar } from "@/components/fitness/sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const NAV_ITEMS: { id: MainTab; label: string; icon: any }[] = [
  { id: "dashboard", label: "داشبورد", icon: LayoutDashboard },
  { id: "programs", label: "برنامه‌ها", icon: ClipboardList },
  { id: "nutrition", label: "دستیار تغذیه", icon: Apple },
  { id: "progress", label: "پیشرفت", icon: TrendingUp },
  { id: "chat", label: "چت با فیتاپ", icon: MessageCircle },
  { id: "referral", label: "معرفی به دوست", icon: Gift },
  { id: "support", label: "پشتیبانی", icon: Headphones },
  { id: "mobileapp", label: "اپ موبایل", icon: Smartphone },
  { id: "plans", label: "پلن‌ها", icon: Crown },
];

export function MainApp() {
  const {
    mainTab,
    setMainTab,
    overlay,
    setOverlay,
    unreadCount,
    notifications,
    setNotifications,
    activeSession,
  } = useAppStore();

  // ─── Polling نوتیف‌ها ───
  // وقتی overlay اعلانات باز است، polling سریع‌تر (هر ۱۰ ثانیه) می‌شود تا
  // حس real-time به کاربر بدهد. در حالت عادی هر ۳۰ ثانیه poll می‌کنیم تا
  // بار روی سرور کم باشد. وقتی نوتیف جدید می‌آید، setNotifications صدا
  // زده می‌شود که unreadCount را هم در-store به‌روز می‌کند و badge بلافاصله
  // آپدیت می‌شود.
  useEffect(() => {
    let cancelled = false;
    const loadNotifications = async () => {
      // همیشه poll می‌کنیم — حتی وقتی overlay باز است.
      // store یکپارچه است و overlay از همان state می‌خواند، بنابراین
      // به‌روزرسانی‌های real-time مستقیماً در overlay و badge نمایش داده می‌شود.
      // race condition بین mark-as-read و poll وجود ندارد چون PATCH قبل از
      // local update کامل می‌شود و poll بعدی state تازه را می‌آورد.
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          // فقط اگر داده واقعاً تغییر کرده باشد، state را آپدیت کن (جلوگیری از flicker)
          const newJson = JSON.stringify(data.notifications || []);
          const oldJson = JSON.stringify(notifications);
          if (newJson !== oldJson) {
            setNotifications(data.notifications || []);
          }
        }
      } catch {}
    };
    loadNotifications();
    // Polling تطبیقی: وقتی overlay اعلانات باز است، هر ۱۰ ثانیه؛ در غیر این
    // صورت هر ۳۰ ثانیه. فقط یک interval فعال است (نه دو interval همزمان).
    const pollInterval = overlay === "notifications" ? 10000 : 30000;
    const interval = setInterval(loadNotifications, pollInterval);
    // وقتی کاربر به تب برمی‌گردد (بعد از tab switch یا minimize)، فوراً یک
    // poll اجرا می‌کنیم تا badge همیشه به‌روز باشد.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        loadNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // ─── Real-time push listener ───
    // وقتی service worker یک push notification دریافت می‌کند (حتی اگر اپ باز
    // باشد)، یک پیام 'PUSH_RECEIVED' به صفحه ارسال می‌کند. این listener آن
    // پیام را می‌گیرد و فوراً نوتیف‌ها را از سرور refresh می‌کند — بدون
    // منتظر ماندن برای polling بعدی.
    const onControllerMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED" && !cancelled) {
        loadNotifications();
      }
    };
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", onControllerMessage);
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onControllerMessage);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  return (
    <div className="min-h-screen bg-white flex">
      {/* Desktop Sidebar */}
      <Sidebar navItems={NAV_ITEMS} />

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 lg:mr-72 bg-white">
        <TopBar />

        <main className="flex-1 overflow-hidden pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={mainTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full"
            >
              {mainTab === "dashboard" && <DashboardView />}
              {mainTab === "programs" && <ProgramsView />}
              {mainTab === "nutrition" && <NutritionView />}
              {mainTab === "progress" && <ProgressView />}
              {mainTab === "chat" && <ChatView />}
              {mainTab === "referral" && <ReferralView />}
              {mainTab === "support" && <SupportView />}
              {mainTab === "mobileapp" && <MobileAppView />}
              {mainTab === "plans" && <PlansView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Active workout session overlay (full-screen) */}
      <AnimatePresence>
        {activeSession && <ActiveWorkoutSession />}
      </AnimatePresence>

      {/* Sheet overlays */}
      <Sheet open={overlay === "notifications"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[85vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">اعلان‌ها</SheetTitle>
          <NotificationsOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "profile"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">پروفایل</SheetTitle>
          <ProfileOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "subscription"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">ارتقای اشتراک</SheetTitle>
          <SubscriptionOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "admin"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[95vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">پنل مدیریت</SheetTitle>
          <AdminOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "exerciseDetail"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[85vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">جزئیات حرکت</SheetTitle>
          <ExerciseDetailOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "gymMode"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[95vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">حالت باشگاه</SheetTitle>
          <GymModeView />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "videoAnalysis"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">تحلیل ویدیو</SheetTitle>
          <VideoAnalysisView />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "bloodTest"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">تست خون</SheetTitle>
          <BloodTestView />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "survey"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">نظرسنجی پایان پلن</SheetTitle>
          <SurveyOverlay />
        </SheetContent>
      </Sheet>
    </div>
  );
}
