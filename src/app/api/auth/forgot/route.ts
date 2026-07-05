import { NextResponse } from "next/server";
import { multiUserEnabled, signResetToken } from "@/lib/native-auth";
import { userExists } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { getRuntimeBrand } from "@/lib/brand-runtime";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 忘记密码:发一封含重置链接的邮件。为防枚举邮箱,无论邮箱是否存在都返回同样的成功。
export async function POST(req: Request) {
  if (!(await multiUserEnabled())) {
    return NextResponse.json({ error: "本站未开放" }, { status: 403 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`forgot:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (EMAIL_RE.test(email) && (await userExists(email))) {
    try {
      const host = req.headers.get("host") || new URL(req.url).host;
      const proto = req.headers.get("x-forwarded-proto") || "https";
      const link = `${proto}://${host}/reset?token=${encodeURIComponent(
        signResetToken(email, Date.now())
      )}`;
      const brand = (await getRuntimeBrand()).name;
      await sendMail({
        to: email,
        subject: `${brand} · 重置登录密码`,
        text: `你正在重置 ${brand} 的登录密码。点击以下链接在 30 分钟内完成重置(若非本人操作请忽略):\n\n${link}`,
        html: `<p>你正在重置 <b>${brand}</b> 的登录密码。</p><p>点击下面的链接在 <b>30 分钟</b>内完成重置(若非本人操作请忽略本邮件):</p><p><a href="${link}">${link}</a></p>`,
      });
    } catch {
      /* 发信失败也不暴露给前端,统一成功响应 */
    }
  }
  return NextResponse.json({ ok: true });
}
