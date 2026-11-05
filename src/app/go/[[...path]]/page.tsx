import type { Metadata } from "next";
import { GoClient, type GoTarget } from "./go-client";

/**
 * /go — لینک هوشمند پیامک‌ها (v47)
 *
 * مالک: «کاربری که هر کدوم از اپ‌ها رو نصب داشت باید با کلیک روی هر لینکی
 * که به داخل پنل کاربری اشاره می‌کنه، اپ باز بشه نه سایت.»
 *
 * چرا مستقیم https کار نمی‌کند؟ روی اکثر دستگاه‌های ایرانی بدون سرویس‌های
 * گوگل، App Links verification (autoVerify) بی‌سروصدا شکست می‌خورد و
 * لینک https همیشه در مرورگر باز می‌شود. راه‌حل: این صفحهٔ میانی با
 * intent:// (مبتنی بر اسکیم اختصاصی fitup:// که در هر دو APK ثبت می‌شود)
 * اپ را مستقیم صدا می‌زند و اگر اپ نبود، خودش به نسخهٔ وب fallback می‌کند.
 *
 * مسیرها:
 *   /go                      → /?screen=panel&tab=plans  (پیش‌فرض: پلن‌ها)
 *   /go/plans?ref=CODE       → /?screen=panel&tab=plans&ref=CODE
 *   /go/panel?tab=dashboard  → /?screen=panel&tab=dashboard  (v56 — لینک پیامکی پنل)
 *   /go/renew?t=...          → /renew?t=...
 *   /go/r/<هر مسیر>?...      → /<هر مسیر>?...  (فورواردر عمومی)
 */

export const metadata: Metadata = {
  title: "فیتاپ",
  robots: { index: false, follow: false },
};

function buildTarget(
  path: string[] | undefined,
  search: URLSearchParams
): GoTarget {
  const qs = search.toString();
  const suffix = qs ? `?${qs}` : "";
  const segments = path ?? [];

  if (segments.length === 0) {
    // /go → پلن‌ها
    return {
      webUrl: `/?screen=panel&tab=plans${suffix ? "&" + qs : ""}`,
      kind: "panel",
    };
  }

  const [head, ...rest] = segments;

  if (head === "plans") {
    return {
      webUrl: `/?screen=panel&tab=plans${suffix ? "&" + qs : ""}`,
      kind: "panel",
    };
  }

  // v56 — لینک پیامکی پنل: /go/panel?tab=dashboard → اپ باز می‌شود (نه مرورگر)
  if (head === "panel") {
    return {
      webUrl: `/?screen=panel${suffix ? "&" + qs : ""}`,
      kind: "panel",
    };
  }

  if (head === "renew") {
    return { webUrl: `/renew${suffix}`, kind: "renew" };
  }

  if (head === "r") {
    // فورواردر عمومی: /go/r/<path>?<query> → /<path>?<query>
    const restPath = rest.join("/");
    return { webUrl: `/${restPath}${suffix}`, kind: "web" };
  }

  // مسیر ناشناخته → همان مسیر را باز کن
  return { webUrl: `/${segments.join("/")}${suffix}`, kind: "web" };
}

export default async function GoPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  const sp = await searchParams;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => search.append(k, x));
    else search.set(k, v);
  }
  const target = buildTarget(path, search);
  return <GoClient target={target} />;
}
