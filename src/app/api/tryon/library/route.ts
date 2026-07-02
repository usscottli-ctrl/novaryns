import { NextResponse } from "next/server";
import { getTryonLibrary } from "@/lib/tryon-store";

// 公开:服装上身页读取模特库 + 场景库(含后台增删改后的最新状态)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lib = await getTryonLibrary();
    return NextResponse.json(lib, {
      headers: { "cache-control": "public, max-age=60" },
    });
  } catch {
    return NextResponse.json({ models: [], scenes: [] });
  }
}
