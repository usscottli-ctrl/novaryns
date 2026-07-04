import { NextResponse } from "next/server";
import {
  multiUserEnabled,
  signUserSession,
  USER_COOKIE,
  USER_TTL_MS,
} from "@/lib/native-auth";
import { userExists, getOrCreateUser, setUserPassword } from "@/lib/db";
import { hashPassword } from "@/lib/pw";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 原生多用户:注册(邮箱+密码)。仅多用户模式开放。新用户自动发放"新人赠送"积分。
export async function POST(req: Request) {
  if (!(await multiUserEnabled())) {
    return NextResponse.json({ error: "本站未开放注册" }, { status: 403 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`register:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }
  if (await userExists(email)) {
    return NextResponse.json(
      { error: "该邮箱已注册,请直接登录" },
      { status: 409 }
    );
  }
  const user = await getOrCreateUser(email, name || email.split("@")[0]);
  await setUserPassword(email, hashPassword(password));
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(USER_COOKIE, signUserSession(email, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(USER_TTL_MS / 1000),
  });
  return res;
}
