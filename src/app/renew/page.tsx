import type { Metadata } from "next";
import RenewClient from "./renew-client";

export const metadata: Metadata = {
  title: "تمدید پلن | فیتاپ",
  description: "تمدید سریع و خودکار پلن فیتاپ با یک پرداخت — هر بدنی فیتاپ می‌خواد!",
  robots: { index: false, follow: false },
};

/**
 * صفحهٔ مجزای تمدید — لینک اختصاصی پیامک‌های تمدید (v37):
 *   https://fittup.ir/renew?t=<token>
 *
 * بدون نیاز به لاگین کار می‌کند (توکن HMAC = هویت کاربر + چرخهٔ اشتراک).
 * کال‌بک زرین‌پال هم به همین صفحه برمی‌گردد (?payment_verify=1&Authority=...&Status=...)
 * و تأیید/تحویل با POST /api/renew/verify انجام می‌شود.
 */
export default async function RenewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  // ⚠️ raw(value) — مقدار پارامتر، نه نام کلید (باگ v37-اول که token="t" می‌داد)
  const token = raw(sp.t);
  const isVerifyReturn = raw(sp.payment_verify) === "1";
  const authority = raw(sp.Authority);
  const status = raw(sp.Status).toUpperCase();

  return (
    <RenewClient
      token={token}
      autoVerify={isVerifyReturn ? { authority, status } : null}
    />
  );
}
