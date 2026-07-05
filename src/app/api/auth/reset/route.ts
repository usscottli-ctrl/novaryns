import { NextResponse } from "next/server";
import { multiUserEnabled, verifyResetToken } from "@/lib/native-auth";
import { userExists, setUserPassword } from "@/lib/db";
import { hashPassword } from "@/lib/pw";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 用邮件里的令牌重设密码。
export async function POST(req: Request) {
  if (!(await multiUserEnabled())) {
    return NextResponse.json({ error: "本站未开放" }, { status: 403 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`reset:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  const email = verifyResetToken(token, Date.now());
  if (!email) {
    return NextResponse.json(
      { error: "重置链接无效或已过期,请重新申请" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }
  if (!(await userExists(email))) {
    return NextResponse.json({ error: "账号不存在" }, { status: 400 });
  }
  await setUserPassword(email, hashPassword(password));
  return NextResponse.json({ ok: true });
}
