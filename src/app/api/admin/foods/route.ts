import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET() {
  try {
    await requireAdmin();
    const foods = await db.foodLibrary.findMany({
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ foods });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const food = await db.foodLibrary.create({
      data: {
        name: body.name,
        category: body.category,
        calories: Number(body.calories),
        protein: Number(body.protein) || 0,
        carbs: Number(body.carbs) || 0,
        fat: Number(body.fat) || 0,
        servingSize: body.servingSize || "۱ وعده",
        imageUrl: body.imageUrl || "",
        isVegan: Boolean(body.isVegan),
      },
    });
    return Response.json({ food });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { id, ...data } = body;
    const food = await db.foodLibrary.update({
      where: { id },
      data: {
        ...data,
        calories: data.calories ? Number(data.calories) : undefined,
        protein: data.protein ? Number(data.protein) : undefined,
        carbs: data.carbs ? Number(data.carbs) : undefined,
        fat: data.fat ? Number(data.fat) : undefined,
      },
    });
    return Response.json({ food });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "ID نیاز است." }, { status: 400 });
    await db.foodLibrary.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
