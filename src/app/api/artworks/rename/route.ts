import { NextResponse } from "next/server";
import { dbEnabled, renameArtwork } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 画布:重命名节点(改作品标题)。email 限定。
export async function POST(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false });
  let body: { email?: string; id?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const id = (body.id ?? "").trim();
  const title = (body.title ?? "").trim();
  if (!email || !id || !title) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  try {
    await renameArtwork(email, id, title);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
