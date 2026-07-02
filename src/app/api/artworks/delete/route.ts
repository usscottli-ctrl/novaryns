import { NextResponse } from "next/server";
import { dbEnabled, deleteArtworksByIds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 画布内删除作品(可连同子孙,id 列表由前端按血缘算好)。email 限定,沿用本站信任模式。
export async function POST(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  let body: { email?: string; ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === "string").slice(0, 200)
    : [];
  if (!email || ids.length === 0) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  const deleted = await deleteArtworksByIds(email, ids).catch(() => 0);
  return NextResponse.json({ ok: true, deleted });
}
