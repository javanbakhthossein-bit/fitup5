import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET() {
  try {
    await requireAdmin();
    const exercises = await db.exerciseLibrary.findMany({
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ exercises });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const ex = await db.exerciseLibrary.create({
      data: {
        name: body.name,
        muscle: body.muscle,
        category: body.category,
        equipment: body.equipment || "",
        description: body.description || "",
        tips: body.tips || "",
        mediaUrl: body.mediaUrl || "",
        youtubeUrl: body.youtubeUrl || "",
        difficulty: body.difficulty || "intermediate",
      },
    });
    return Response.json({ exercise: ex });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { id, ...data } = body;
    const ex = await db.exerciseLibrary.update({
      where: { id },
      data,
    });
    return Response.json({ exercise: ex });
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
    await db.exerciseLibrary.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
