import { NextResponse } from "next/server";
import {
  multiUserEnabled,
  signUserSession,
  USER_COOKIE,
  USER_TTL_MS,
} from "@/lib/native-auth";
import { getUser, getUserPasswordHash } from "@/lib/db";
import { verifyPassword } from "@/lib/pw";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 原生多用户:登录(邮箱+密码)。仅多用户模式开放。
export async function POST(req: Request) {
  if (!(await multiUserEnabled())) {
    return NextResponse.json({ error: "本站未开放登录" }, { status: 403 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`login:${ip}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "尝试过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const hash = await getUserPasswordHash(email);
  if (!hash || !verifyPassword(password, hash)) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }
  const user = await getUser(email);
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(USER_COOKIE, signUserSession(email, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(USER_TTL_MS / 1000),
  });
  return res;
}
