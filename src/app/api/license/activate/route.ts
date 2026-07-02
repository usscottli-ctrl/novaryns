import { NextResponse } from "next/server";
import { dbEnabled, activateLicense } from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

// Pro 自托管实例调用:{ key, host } → 校验 License + 绑定该部署 host + 设备数上限。
// 返回 { ok, tier, expiresAt, deviceLimit, activatedDevices }。实例据此解锁 Pro 能力,
// 并应定期复验(吊销/到期后失效)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json(
      { ok: false, error: "服务暂不可用" },
      { status: 503 }
    );
  }
  const ip = clientIp(request);
  if (!rateLimit(`license-activate:${ip}`, 60, 600_000)) {
    return NextResponse.json(
      { ok: false, error: "请求过于频繁" },
      { status: 429 }
    );
  }
  let body: { key?: string; host?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求无效" }, { status: 400 });
  }
  const r = await activateLicense(String(body.key ?? ""), String(body.host ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
