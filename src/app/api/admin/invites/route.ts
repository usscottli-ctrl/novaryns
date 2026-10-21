import { NextResponse } from "next/server";
import {
  dbEnabled,
  getInviteConfig,
  saveInviteConfig,
  listInvites,
  revokeInvite,
  type InviteConfig,
} from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request): Promise<NextResponse | null> {
  if (!dbEnabled) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "无权限" }, { status: 403 });
  return null;
}

// 站长后台「邀请奖励」:读设置 + 邀请记录总表(?q= 按邀请人/被邀请人/邀请码搜索)。
export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const [config, invites] = await Promise.all([getInviteConfig(), listInvites(q)]);
  return NextResponse.json({ config, invites });
}

// action=config 保存设置;action=revoke 撤销一条邀请(扣回邀请人已得奖励)。
export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: { action?: string; config?: Partial<InviteConfig>; invitee?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  if (body.action === "config") {
    return NextResponse.json({ config: await saveInviteConfig(body.config ?? {}) });
  }
  if (body.action === "revoke" && body.invitee) {
    return NextResponse.json(await revokeInvite(body.invitee));
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
