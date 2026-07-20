import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// Public exercises list (no auth)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const muscle = searchParams.get("muscle") || "";
  const equipment = searchParams.get("equipment") || "";
  const category = searchParams.get("category") || "";

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { muscle: { contains: search } },
      { description: { contains: search } },
    ];
  }
  if (muscle && muscle !== "all") where.muscle = muscle;
  if (category && category !== "all") where.category = category;
  if (equipment && equipment !== "all") {
    where.equipment = { contains: equipment };
  }

  const exercises = await db.exerciseLibrary.findMany({
    where,
    orderBy: { name: "asc" },
    take: 500,
  });

  return Response.json({ exercises });
}
