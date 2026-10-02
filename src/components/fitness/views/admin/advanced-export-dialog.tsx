"use client";

/**
 * ─── v178 — خروجی اکسل پیشرفته کاربران ───
 *
 * دیرکتیو مالک:
 *  «فایل اکسل اطلاعات کاربران باید سالم و دقیق و با همهٔ اطلاعات دانلود بشه؛
 *   قابلیت‌های زیادی برای دانلود اکسل بذاریم — با گروه‌ها و دسته‌بندی‌های
 *   مختلف جدا اکسل بگیرم، در زمان‌بندی‌های مختلف جدا اکسل بگیرم.»
 *
 * فیلترها: منبع ثبت‌نام / نصب اپ / پلن / وضعیت خرید / بازهٔ ثبت‌نام /
 * بازهٔ خرید / آنبوردینگ / مسدود — فایل شامل همهٔ ستون‌ها است (۲۱ ستون).
 */

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";
import { downloadBlob } from "@/lib/fitness/bazaar-bridge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PersianDatePicker } from "@/components/fitness/persian-date-picker";

export function AdvancedExportDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState("all");
  const [appSource, setAppSource] = useState("all");
  const [plan, setPlan] = useState("all");
  const [purchaseStatus, setPurchaseStatus] = useState("any");
  const [onboarding, setOnboarding] = useState("");
  const [blocked, setBlocked] = useState("");
  const [regFrom, setRegFrom] = useState<string | null>(null);
  const [regTo, setRegTo] = useState<string | null>(null);
  const [buyFrom, setBuyFrom] = useState<string | null>(null);
  const [buyTo, setBuyTo] = useState<string | null>(null);
  const [extraMobiles, setExtraMobiles] = useState("");
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (source !== "all") params.set("source", source);
      if (appSource !== "all") params.set("appSource", appSource);
      if (plan !== "all") params.set("plan", plan);
      if (purchaseStatus !== "any") params.set("purchaseStatus", purchaseStatus);
      if (onboarding) params.set("onboarding", onboarding);
      if (blocked) params.set("blocked", blocked);
      if (regFrom) params.set("registeredFrom", regFrom);
      if (regTo) params.set("registeredTo", regTo);
      if (buyFrom) params.set("purchaseFrom", buyFrom);
      if (buyTo) params.set("purchaseTo", buyTo);
      const mobiles = extraMobiles
        .split(/[\n,،\s]+/)
        .map((m) => m.replace(/[^\d]/g, ""))
        .filter((m) => /^09\d{9}$/.test(m));
      if (mobiles.length) params.set("mobiles", mobiles.join(","));

      toast.success("در حال آماده‌سازی فایل اکسل...");
      const res = await fetch(`/api/admin/users/export?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "خطا در تولید فایل");
      }
      const blob = await res.blob();
      const dr = await downloadBlob(`fitap-users-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
      if (dr === "browser") toast.success("فایل اکسل دانلود شد");
      else if (dr === "failed") toast.error("خطا در دانلود فایل");
      else onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در دانلود فایل");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            خروجی اکسل پیشرفته کاربران
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            فایل شامل <b>همهٔ ستون‌ها</b> است: نام، موبایل، پلن (شروع/انقضا)، اشتراک فعال، کیف پول،
            آنبوردینگ، مسدود، تاریخ ثبت‌نام، <b>منبع ثبت‌نام</b>، نصب اپ، معرفی دوستان، آخرین فعالیت،
            مجموع/تعداد/اولین/آخرین خرید. فیلترهای زیر اختیاری‌اند.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block">منبع ثبت‌نام</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="instagram">اینستاگرام</SelectItem>
                  <SelectItem value="google">گوگل</SelectItem>
                  <SelectItem value="cafebazaar">کافه‌بازار</SelectItem>
                  <SelectItem value="app_panel">اپ اختصاصی</SelectItem>
                  <SelectItem value="web">وب‌سایت (مستقیم)</SelectItem>
                  <SelectItem value="other">سایر</SelectItem>
                  <SelectItem value="unknown">نامشخص (قبل از v178)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">اپ نصب‌شده</Label>
              <Select value={appSource} onValueChange={setAppSource}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="panel">اپ اختصاصی</SelectItem>
                  <SelectItem value="bazaar">اپ کافه‌بازار</SelectItem>
                  <SelectItem value="none">بدون اپ نیتیو</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">پلن</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="basic">اقتصادی</SelectItem>
                  <SelectItem value="standard">استاندارد</SelectItem>
                  <SelectItem value="advanced">پیشرفته</SelectItem>
                  <SelectItem value="ultimate">حرفه‌ای</SelectItem>
                  <SelectItem value="none">بدون پلن</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">وضعیت خرید</Label>
              <Select value={purchaseStatus} onValueChange={setPurchaseStatus}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">همه</SelectItem>
                  <SelectItem value="purchased">خرید کرده</SelectItem>
                  <SelectItem value="never">هرگز خرید نداشته</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">آنبوردینگ</Label>
              <Select value={onboarding || "all"} onValueChange={(v) => setOnboarding(v === "all" ? "" : v)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="done">انجام‌شده</SelectItem>
                  <SelectItem value="pending">انجام‌نشده</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">وضعیت حساب</Label>
              <Select value={blocked || "all"} onValueChange={(v) => setBlocked(v === "all" ? "" : v)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="active">عادی</SelectItem>
                  <SelectItem value="blocked">مسدود</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PersianDatePicker value={regFrom} onChange={setRegFrom} label="ثبت‌نام از تاریخ" />
            <PersianDatePicker value={regTo} onChange={setRegTo} label="ثبت‌نام تا تاریخ" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PersianDatePicker value={buyFrom} onChange={setBuyFrom} label="خرید از تاریخ" />
            <PersianDatePicker value={buyTo} onChange={setBuyTo} label="خرید تا تاریخ" />
          </div>

          <div>
            <Label className="mb-1 block">فقط این شماره‌ها (اختیاری — هر خط یک شماره)</Label>
            <Textarea
              dir="ltr"
              value={extraMobiles}
              onChange={(e) => setExtraMobiles(e.target.value)}
              placeholder={"09123456789\n09129876543"}
              rows={3}
              className="rounded-xl resize-none text-left font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline" className="rounded-xl">بستن</Button>
          <Button
            onClick={download}
            disabled={busy}
            className="rounded-xl gap-2 bg-gradient-to-l from-emerald-500 to-teal-500 text-white hover:opacity-95"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            دانلود اکسل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
