import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { activateProLicense } from "@/lib/edition";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 站长在本实例激活 Pro:输入购买的 License Key → 校验通过则落库,本实例升级为 Pro。
// 需管理员身份(开源版即向导设的管理员密码登录后)。
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "请先登录管理员" }, { status: 403 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`pro-activate:${ip}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const r = await activateProLicense(String(body.key ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
