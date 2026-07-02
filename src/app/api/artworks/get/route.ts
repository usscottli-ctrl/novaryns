import { NextResponse } from "next/server";
import { dbEnabled, listArtworksByIds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 只取指定 id 的几行作品(email 限定)。画布"创建/连线"后只补这几行,
// 取代整表重拉,显著降低数据库出站流量(Supabase egress)。
export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false, artworks: [] });
  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!email) {
    return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ persisted: true, artworks: [] });
  }
  try {
    const artworks = await listArtworksByIds(email, ids);
    return NextResponse.json({ persisted: true, artworks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据库读取失败" },
      { status: 500 }
    );
  }
}
