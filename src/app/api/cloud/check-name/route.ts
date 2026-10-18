import { NextResponse } from "next/server";
import { dbEnabled, isCloudSubdomainTaken } from "@/lib/db";
import { subdomainError, normalizeSubdomain } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 云端托管:子域名可用性查询。前端选名时实时调用。
// 校验:格式/保留字(subdomainError)+ 未被在途/活跃租户占用(app_cloud_tenants)。
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("name") || "";
  const sub = normalizeSubdomain(raw);
  const fmtErr = subdomainError(sub);
  if (fmtErr) return NextResponse.json({ available: false, error: fmtErr });
  if (!dbEnabled) return NextResponse.json({ available: true, subdomain: sub });
  try {
    if (await isCloudSubdomainTaken(sub)) {
      return NextResponse.json({ available: false, error: "该名称已被占用" });
    }
    return NextResponse.json({ available: true, subdomain: sub });
  } catch {
    // 表还没建/查询异常时不阻断下单,交由开通阶段的唯一约束兜底。
    return NextResponse.json({ available: true, subdomain: sub });
  }
}
