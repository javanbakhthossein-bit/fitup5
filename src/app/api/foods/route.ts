import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// Public food list (no auth)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "";

  const where: any = {};
  if (search) {
    where.OR = [{ name: { contains: search } }];
  }
  if (category && category !== "all") where.category = category;

  const foods = await db.foodLibrary.findMany({
    where,
    orderBy: { name: "asc" },
    take: 2000,
  });

  return Response.json({ foods });
}
