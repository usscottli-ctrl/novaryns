import { NextResponse } from "next/server";
import { dbEnabled, redeemCardKey, getUser } from "@/lib/db";
import { resolveUserEmail } from "@/lib/admin-auth";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 用户兑换兑换码 → 加积分。email 一律取自登录 token(不信任请求体,防越权)。
export async function POST(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
  const email = await resolveUserEmail(request);
  if (!email) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });
  }
  try {
    const { credits } = await redeemCardKey(code, email);
    const user = await getUser(email);
    return NextResponse.json({ credits, user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "兑换失败" },
      { status: 400 }
    );
  }
}
