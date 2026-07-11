import { NextResponse } from "next/server";
import { multiUserEnabled } from "@/lib/native-auth";
import { userExists } from "@/lib/db";
import { sendMail, smtpConfigured } from "@/lib/mailer";
import { issueEmailCode } from "@/lib/email-code";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 原生多用户注册:发送邮箱验证码。仅多用户模式 + 已配 SMTP 时开放。
export async function POST(req: Request) {
  if (!(await multiUserEnabled())) {
    return NextResponse.json({ error: "本站未开放注册" }, { status: 403 });
  }
  if (!(await smtpConfigured())) {
    return NextResponse.json(
      { error: "本站未配置邮件服务,请联系站长" },
      { status: 503 }
    );
  }
  const ip = clientIp(req) || "0.0.0.0";
  // 限流:同 IP 10 分钟 5 次;同邮箱 60 秒 1 次(防轰炸别人的邮箱)。
  if (!rateLimit(`sendcode:ip:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (!rateLimit(`sendcode:mail:${email}`, 1, 60 * 1000)) {
    return NextResponse.json({ error: "发送太频繁,请 60 秒后再试" }, { status: 429 });
  }
  if (await userExists(email)) {
    return NextResponse.json(
      { error: "该邮箱已注册,请直接登录" },
      { status: 409 }
    );
  }
  const code = issueEmailCode(email);
  const r = await sendMail({
    to: email,
    subject: `${BRAND} · 注册验证码`,
    text: `你的注册验证码是:${code}\n\n10 分钟内有效。如果这不是你的操作,请忽略本邮件。`,
  });
  if (!r.ok) {
    // 公开端点:不把 SMTP 原始报错透给访客(可能含主机名等),站长用后台「发送测试邮件」排错。
    return NextResponse.json(
      { error: "验证码发送失败,请稍后再试或联系站长" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
