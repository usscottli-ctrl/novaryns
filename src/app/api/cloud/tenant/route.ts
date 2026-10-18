import { NextResponse } from "next/server";
import { dbEnabled, getCloudTenantByOrder, type CloudTenantRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shape(t: CloudTenantRow | null) {
  if (!t) return null;
  return {
    status: t.status,
    subdomain: t.subdomain,
    url: t.url,
    adminEmail: t.email,
    adminPassword: t.status === "active" ? t.adminPassword : null,
    error: t.error,
    expiresAt: t.expiresAt,
  };
}

// 云端租户开通状态轮询(只读,不触发开通)。前端在 /api/cloud/provision 之后轮询它。
export async function GET(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  const orderId = new URL(req.url).searchParams.get("orderId") || "";
  if (!orderId) return NextResponse.json({ error: "缺少订单号" }, { status: 400 });
  const t = await getCloudTenantByOrder(orderId).catch(() => null);
  return NextResponse.json({ tenant: shape(t) });
}
