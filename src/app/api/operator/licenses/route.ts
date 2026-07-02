import { NextResponse } from "next/server";
import {
  dbEnabled,
  listLicenses,
  generateLicenses,
  licenseStats,
  setLicenseStatus,
} from "@/lib/db";
import { isAdminToken, bearer } from "@/lib/supabase-admin";
import { proEnabled } from "@/lib/edition";

// 站长后台:Pro License 管理(列表/统计、批量生成、启用/吊销)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
  if (!(await isAdminToken(bearer(request)))) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const [licenses, stats] = await Promise.all([listLicenses(), licenseStats()]);
  return NextResponse.json({ licenses, stats });
}

export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: {
    count?: number;
    tier?: string;
    deviceLimit?: number;
    expiryDays?: number | null;
    batch?: string;
    note?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const count = Number(body.count);
  if (!(count > 0) || count > 500) {
    return NextResponse.json({ error: "数量需 1–500" }, { status: 400 });
  }
  const expiryDays =
    body.expiryDays == null || body.expiryDays === 0
      ? null
      : Number(body.expiryDays);
  const licenses = await generateLicenses({
    count,
    tier: body.tier,
    deviceLimit: Number(body.deviceLimit) || undefined,
    expiryDays,
    batch: String(body.batch ?? ""),
    note: String(body.note ?? ""),
  });
  const stats = await licenseStats();
  return NextResponse.json({ licenses, stats });
}

export async function PATCH(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: { key?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const key = String(body.key ?? "").trim();
  const status = body.status === "revoked" ? "revoked" : "active";
  if (!key) return NextResponse.json({ error: "缺少 key" }, { status: 400 });
  await setLicenseStatus(key, status);
  return NextResponse.json({ ok: true });
}
