import { NextResponse } from "next/server";
import { dbEnabled, getOrder, ensureCloudTenantForOrder, getCloudTenantByOrder, type CloudTenantRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 开通可能耗时数分钟(首次含镜像构建)。standalone Node 无 serverless 超时。
export const maxDuration = 600;

function shape(t: CloudTenantRow | null) {
  if (!t) return null;
  return {
    status: t.status,
    subdomain: t.subdomain,
    url: t.url,
    adminEmail: t.email,
    // 初始密码仅在开通成功时随本次响应回传给买家(应尽快修改);另有邮件送达。
    adminPassword: t.status === "active" ? t.adminPassword : null,
    error: t.error,
    expiresAt: t.expiresAt,
  };
}

// 触发/推进一个已付 cloud 订单的开通(幂等)。前端付款成功后调用一次,
// 再轮询 GET /api/cloud/tenant 直到 active/failed。订单号不可猜 = 访问凭据。
export async function POST(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  let body: { orderId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求格式不正确" }, { status: 400 }); }
  const orderId = (body.orderId || "").trim();
  if (!orderId) return NextResponse.json({ error: "缺少订单号" }, { status: 400 });

  const o = await getOrder(orderId);
  if (!o) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  if (o.kind !== "cloud") return NextResponse.json({ error: "非云端订单" }, { status: 400 });
  if (o.status !== "paid") {
    // 未支付:返回当前(可能已有 pending 记录),前端据此继续等待支付。
    return NextResponse.json({ ok: false, paid: false, tenant: shape(await getCloudTenantByOrder(orderId)) });
  }

  const t = await ensureCloudTenantForOrder(o.id, o.email, o.itemId).catch(() => null);
  return NextResponse.json({ ok: t?.status === "active", paid: true, tenant: shape(t) });
}
