import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { sendMail } from "@/lib/mailer";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 后台「邮件服务」发送测试邮件(仅管理员):配完 SMTP 一键验证连通性,
// 不用走完整的「忘记密码」流程。失败时把 SMTP 报错原样返回(认证失败/
// 连接超时等信息对排错很关键,且仅管理员可见,不经 safeError 净化)。
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  let body: { to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const to = String(body.to ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "收件邮箱格式不对" }, { status: 400 });
  }
  const r = await sendMail({
    to,
    subject: `${BRAND} · SMTP 测试邮件`,
    text: `这是一封来自 ${BRAND} 后台的 SMTP 测试邮件。收到即说明邮件服务配置成功,「忘记密码」等功能可正常发信。`,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error || "发送失败" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
