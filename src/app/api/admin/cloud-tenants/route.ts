import { NextResponse } from "next/server";
import { dbEnabled, listAllCloudTenants, cloudTenantAdminAction, type CloudTenantRow } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // purge/resume 可能耗时

// 后台「云端租户」列表(不含初始密码)。
function shape(t: CloudTenantRow) {
  return {
    subdomain: t.subdomain, email: t.email, status: t.status, url: t.url,
    error: t.error, expiresAt: t.expiresAt, createdAt: t.createdAt,
    provisionedAt: t.provisionedAt, renewals: t.renewals, orderId: t.orderId,
    customDomains: t.customDomains,
  };
}

export async function GET(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const tenants = (await listAllCloudTenants()).map(shape);
  return NextResponse.json({ tenants });
}

// 动作:suspend | resume | purge | retry。
export async function POST(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "未授权" }, { status: 401 });
  let body: { subdomain?: string; action?: string; domain?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求格式不正确" }, { status: 400 }); }
  const sub = (body.subdomain || "").trim();
  const action = body.action as "suspend" | "resume" | "purge" | "retry" | "set-domain";
  if (!sub || !["suspend", "resume", "purge", "retry", "set-domain"].includes(action)) {
    return NextResponse.json({ error: "参数不正确" }, { status: 400 });
  }
  const r = await cloudTenantAdminAction(sub, action, { domain: body.domain });
  return NextResponse.json(
    r.ok ? { ok: true, warnings: r.warnings, tenant: r.tenant ? shape(r.tenant) : null } : { ok: false, error: r.error },
    { status: r.ok ? 200 : 500 }
  );
}
