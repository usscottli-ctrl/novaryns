import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  SESSION_TTL_MS,
  hasAdminPassword,
  verifyAdminPassword,
  signSession,
  localAdminOk,
} from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 本地管理员登录(开源版 / 自托管无 Supabase 时用)。
//   GET    → { localAvailable, localAuthed } 供前端决定显不显示密码登录框。
//   POST   → { password } 校验通过 → 下发 HttpOnly 签名会话 cookie。
//   DELETE → 退出,清 cookie。
// 官方云走 Supabase,前端不会触发这里(localAvailable=false)。

export async function GET(req: Request) {
  return NextResponse.json({
    localAvailable: await hasAdminPassword(),
    localAuthed: localAdminOk(req),
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req) || "0.0.0.0";
  // 防爆破:每 IP 10 分钟最多 10 次尝试。
  if (!rateLimit(`admin-login:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "尝试过于频繁,请稍后再试" },
      { status: 429 }
    );
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyAdminPassword(password))) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, signSession(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    // 不设 secure:自托管常跑在 http://IP 上,secure 会让 cookie 被丢弃。
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
