import { NextResponse } from "next/server";
import {
  dbEnabled,
  listDeletedArtworks,
  undeleteArtworksByIds,
  purgeArtworksByIds,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 回收站:GET 列出已软删除的作品(顺手清理过期);POST 恢复/彻底删除。
export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false, artworks: [] });
  const email = new URL(request.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
  }
  try {
    const artworks = await listDeletedArtworks(email);
    return NextResponse.json({ persisted: true, artworks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据库读取失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false });
  let body: { email?: string; action?: string; ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!email || ids.length === 0) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  try {
    const n =
      body.action === "purge"
        ? await purgeArtworksByIds(email, ids)
        : await undeleteArtworksByIds(email, ids);
    return NextResponse.json({ ok: true, count: n });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
