import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { OPERATOR_EMAIL } from "@/lib/operator";
import { getOwnerEmail, setOwnerAccount, dbEnabled } from "@/lib/db";
import { hashPassword } from "@/lib/pw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 站长邮箱账号(仅管理员):设置后站长可在普通登录框用邮箱+密码登录,
// 与官方站一致;operator 名下的积分/作品/流水会整体迁移到该邮箱。
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  if (!dbEnabled) return NextResponse.json({ ownerEmail: null });
  return NextResponse.json({ ownerEmail: await getOwnerEmail() });
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  if (!dbEnabled) {
    return NextResponse.json({ error: "未配置数据库" }, { status: 503 });
  }
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }
  try {
    // 已设过站长邮箱 → 本次视为改绑:从旧站长邮箱迁到新邮箱;否则从 operator 迁。
    const prev = (await getOwnerEmail()) || OPERATOR_EMAIL;
    if (prev === email) {
      // 同邮箱重设 = 改密码
      const { setUserPassword } = await import("@/lib/db");
      await setUserPassword(email, hashPassword(password));
      return NextResponse.json({ ok: true, ownerEmail: email });
    }
    await setOwnerAccount(prev, email, hashPassword(password));
    return NextResponse.json({ ok: true, ownerEmail: email });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "设置失败" },
      { status: 500 }
    );
  }
}
