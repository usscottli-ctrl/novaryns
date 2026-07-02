import { NextResponse } from "next/server";
import { dbEnabled, addArtworkParent, removeArtworkParent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 多输入:给某节点追加一个父节点(把一条线从源节点拉到已有目标节点上)。
// email 限定,沿用本站信任模式。
export async function POST(request: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "未启用存储" }, { status: 400 });
  let body: { email?: string; id?: string; parentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const id = (body.id ?? "").trim();
  const parentId = (body.parentId ?? "").trim();
  if (!email || !id || !parentId || id === parentId) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  try {
    await addArtworkParent(email, id, parentId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

// 剪断连线:把 parentId 从节点 id 的血缘里移除(primary 置空 / 从 parent_ids 移除)。
export async function DELETE(request: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "未启用存储" }, { status: 400 });
  let body: { email?: string; id?: string; parentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const id = (body.id ?? "").trim();
  const parentId = (body.parentId ?? "").trim();
  if (!email || !id || !parentId) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  try {
    await removeArtworkParent(email, id, parentId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
