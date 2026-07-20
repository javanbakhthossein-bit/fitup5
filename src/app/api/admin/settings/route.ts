import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

// Default settings keys (labels + safe defaults)
const SETTING_KEYS: Record<string, string> = {
  brandName: "نام برند",
  slogan: "شعار برند",
  heroTitle: "عنوان صفحه اصلی",
  heroSubtitle: "زیرعنوان صفحه اصلی",
  primaryColor: "رنگ اصلی",
  referral_reward_amount: "مبلغ پاداش معرفی به دوست (تومان)",
};

// GET /api/admin/settings — admin: list all settings
export async function GET() {
  try {
    await requireAdmin();
    const rows = await db.siteSetting.findMany();
    const map = new Map(rows.map((r) => [r.key, r]));
    return Response.json({
      settings: Object.keys(SETTING_KEYS).map((k) => ({
        key: k,
        label: SETTING_KEYS[k],
        value: map.get(k)?.value ?? "",
        id: map.get(k)?.id ?? null,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// PUT /api/admin/settings — admin: update single setting (body: { key, value })
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const { key, value } = await req.json();
    if (!key || typeof key !== "string" || !SETTING_KEYS[key]) {
      return Response.json({ error: "کلید تنظیمات نامعتبر است." }, { status: 400 });
    }
    if (typeof value !== "string") {
      return Response.json({ error: "مقدار نامعتبر است." }, { status: 400 });
    }

    // Validate primaryColor is hex
    if (key === "primaryColor" && value && !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value)) {
      return Response.json({ error: "رنگ باید در قالب هگز (مثل #F4C542) باشد." }, { status: 400 });
    }

    const updated = await db.siteSetting.upsert({
      where: { key },
      create: { key, value, label: SETTING_KEYS[key] },
      update: { value },
    });

    return Response.json({ setting: updated });
  } catch (e) {
    return apiError(e);
  }
}
