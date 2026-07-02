import { NextResponse } from "next/server";
import { dbEnabled, listTemplateCategories } from "@/lib/db";
import { TEMPLATES as SEED } from "@/lib/templates-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbEnabled) {
    const counts = new Map<string, number>();
    for (const t of SEED) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return NextResponse.json({
      categories: Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      persisted: false,
    });
  }
  try {
    const categories = await listTemplateCategories();
    return NextResponse.json({ categories, persisted: true });
  } catch (e) {
    return NextResponse.json({
      categories: [],
      persisted: false,
      error: e instanceof Error ? e.message : "db read failed",
    });
  }
}
