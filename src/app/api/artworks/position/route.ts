import { NextResponse } from "next/server";
import { dbEnabled, setArtworkPosition } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 画布拖拽后记住节点坐标。email 限定,沿用本站信任模式。
export async function POST(request: Request) {
  if (!dbEnabled) return NextResponse.json({ ok: false });
  let body: { email?: string; id?: string; x?: number; y?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const id = (body.id ?? "").trim();
  const x = Number(body.x);
  const y = Number(body.y);
  if (!email || !id || !Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  await setArtworkPosition(email, id, x, y).catch(() => {});
  return NextResponse.json({ ok: true });
}
