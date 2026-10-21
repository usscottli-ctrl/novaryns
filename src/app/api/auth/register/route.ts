import { NextResponse } from "next/server";
import {
  multiUserEnabled,
  signUserSession,
  USER_COOKIE,
  USER_TTL_MS,
} from "@/lib/native-auth";
import { userExists, getOrCreateUser, setUserPassword, getUser, bindInvite } from "@/lib/db";
import { inviteCodeFrom, INVITE_COOKIE } from "@/lib/invite";
import { hashPassword } from "@/lib/pw";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";
import { smtpConfigured } from "@/lib/mailer";
import { verifyEmailCode } from "@/lib/email-code";

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
  let body: {
    email?: string;
    password?: string;
    name?: string;
    code?: string;
    invite?: string;
  };
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
  // 邮箱验证码:站长配了 SMTP 就强制(与官方站一致,挡假邮箱裸注册薅赠送积分);
  // 未配 SMTP 时退回免验证码注册(否则没人能注册,站长会在后台看到 SMTP 未生效)。
  if (await smtpConfigured()) {
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code) || !verifyEmailCode(email, code)) {
      return NextResponse.json(
        { error: "验证码错误或已过期,请重新获取" },
        { status: 400 }
      );
    }
  }
  let user = await getOrCreateUser(email, name || email.split("@")[0]);
  await setUserPassword(email, hashPassword(password));
  // 邀请有奖:有邀请码(手填或邀请链接记下的)就绑定并发奖;功能没开/码无效时什么都不做
  const code = inviteCodeFrom(req, body.invite);
  if (code && (await bindInvite(email, code, ip).catch(() => 0)) > 0) {
    user = (await getUser(email)) ?? user; // 余额里带上刚发的邀请奖励
  }
  const res = NextResponse.json({ ok: true, user });
  if (code) res.cookies.set(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(USER_COOKIE, signUserSession(email, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(USER_TTL_MS / 1000),
  });
  return res;
}
