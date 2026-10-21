import { NextResponse } from "next/server";
import { dbEnabled, getInviteConfig, getInviteOverview, saveInviteSlogan } from "@/lib/db";
import { resolveUserEmail } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 推广中心(邀请有奖):本人的邀请码、推广语、奖励规则、邀请记录。站长没开启时 404。
async function guard(request: Request): Promise<{ email: string } | NextResponse> {
  if (!dbEnabled) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  if (!(await getInviteConfig()).enabled) {
    return NextResponse.json({ error: "本站未开启邀请活动" }, { status: 404 });
  }
  const email = await resolveUserEmail(request).catch(() => null);
  if (!email) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return { email };
}

export async function GET(request: Request) {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;
  return NextResponse.json(await getInviteOverview(g.email));
}

// 保存推广语(最多 60 字)
export async function POST(request: Request) {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;
  let body: { slogan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  await saveInviteSlogan(g.email, String(body.slogan ?? ""));
  return NextResponse.json({ ok: true });
}
