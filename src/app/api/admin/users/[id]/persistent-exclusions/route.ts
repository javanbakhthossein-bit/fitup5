import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { sanitizeConstraints } from "@/lib/fitness/plan-redesign-constraints";
import {
  readPersistentExclusions,
  replacePersistentExclusions,
} from "@/lib/fitness/persistent-exclusions";

// ═══════════════════════════════════════════════════════════════
//  POST /api/admin/users/[id]/persistent-exclusions — v157
//
//  مدیریت «ممنوعیت‌های ماندگار» کاربر توسط مدیر (پنل ادمین):
//  این ممنوعیت‌ها در «همهٔ» تولیدهای برنامهٔ آیندهٔ همین کاربر اعمال
//  می‌شوند (خرید/چکاپ/بازطراحی چت/بازنویسی مدیر/به‌روزرسانی وزن) و
//  هرگز خودکار منقضی یا پاک نمی‌شوند — فقط مدیر اینجا کنترلشان می‌کند.
//
//  body: { add?: { kind, value } , remove?: { kind, value }, clear?: true }
//  خروجی: { ok, persistentExclusions }
// ═══════════════════════════════════════════════════════════════

type Kind = "movement" | "food" | "supplement";

interface ExclBucket {
  forbiddenMovements: string[];
  forbiddenFoods: string[];
  forbiddenSupplements: string[];
}

function bucketOf(c: ExclBucket, kind: Kind): string[] {
  return kind === "movement" ? c.forbiddenMovements : kind === "food" ? c.forbiddenFoods : c.forbiddenSupplements;
}

const KINDS: Kind[] = ["movement", "food", "supplement"];

function isKind(k: unknown): k is Kind {
  return typeof k === "string" && (KINDS as string[]).includes(k);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // گارد ادمین — دقیقاً هم‌الگوی سایر مسیرهای مدیریت کاربران
    await requireAdmin();
    await requireAdminPerm("canManageUsers");

    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
    }

    const profile = await db.onboardingProfile.findUnique({ where: { userId: id }, select: { id: true } });
    if (!profile) {
      return Response.json({ ok: false, error: "پروفایل آنبوردینگ این کاربر یافت نشد" }, { status: 404 });
    }

    const current: ExclBucket = (await readPersistentExclusions(id)) ?? {
      forbiddenMovements: [],
      forbiddenFoods: [],
      forbiddenSupplements: [],
    };

    let next: ExclBucket | null = current;

    // پاک‌کردن کامل
    if (body.clear === true) {
      next = null;
    } else {
      const draft: ExclBucket = {
        forbiddenMovements: [...current.forbiddenMovements],
        forbiddenFoods: [...current.forbiddenFoods],
        forbiddenSupplements: [...current.forbiddenSupplements],
      };
      // افزودن قلم یا چند قلم (v157.1 — ثبت گروهی با ویرگول)
      if (body.add && typeof body.add === "object") {
        const kind = body.add.kind;
        const rawValues: unknown[] = Array.isArray(body.add.values)
          ? body.add.values
          : typeof body.add.value === "string"
            ? [body.add.value]
            : [];
        if (isKind(kind)) {
          const b = bucketOf(draft, kind);
          for (const rv of rawValues) {
            const value = typeof rv === "string" ? rv.trim().slice(0, 60) : "";
            if (value && !b.includes(value) && b.length < 24) b.push(value);
          }
        }
      }
      // حذف قلم
      if (body.remove && typeof body.remove === "object") {
        const kind = body.remove.kind;
        const value = typeof body.remove.value === "string" ? body.remove.value : "";
        if (value && isKind(kind)) {
          const b = bucketOf(draft, kind);
          const idx = b.indexOf(value);
          if (idx >= 0) b.splice(idx, 1);
        }
      }
      next = draft;
    }

    const sanitized = sanitizeConstraints(next);
    await replacePersistentExclusions(id, sanitized);
    const saved = await readPersistentExclusions(id);
    return Response.json({ ok: true, persistentExclusions: saved });
  } catch (e) {
    return apiError(e);
  }
}
