import { NextResponse } from "next/server";
import { dbEnabled, validateLicense } from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

// Pro 发货弹窗:买家输入 License Key(爱发电购买后获得)→ 校验有效 →
// 返回部署命令 + 授权信息。License Key 本身即产品,镜像公开,填 Key 解锁。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCKER_RUN =
  "docker run -d -p 3000:3000 -v novaryns-data:/data ghcr.io/novaryns/app:latest";

export async function POST(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
  const ip = clientIp(request);
  if (!rateLimit(`pro-redeem:${ip}`, 30, 600_000)) {
    return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
  }
  let body: { code?: string; key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const key = String(body.key ?? body.code ?? "").trim();
  const r = await validateLicense(key);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    licenseKey: r.key,
    tier: r.tier,
    expiresAt: r.expiresAt,
    dockerRun: DOCKER_RUN,
  });
}
