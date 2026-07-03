import { NextResponse } from "next/server";
import {
  dbEnabled,
  listLicenses,
  generateLicenses,
  licenseStats,
  setLicenseStatus,
} from "@/lib/db";
import { isAdminToken, bearer } from "@/lib/supabase-admin";
import { proEnabled, isLicenseIssuer } from "@/lib/edition";

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
  // issuer:本站是否为许可证签发站。前端据此决定是否允许「生成」并给出提示。
  return NextResponse.json({ licenses, stats, issuer: isLicenseIssuer(request) });
}

export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  // 只有签发站能生成:其它站(如海外站)生成的 Key 落本站独立库,
  // 买家实例默认校验官方签发站查不到 → 是激活不了的「死 Key」,直接拦掉。
  if (!isLicenseIssuer(request)) {
    return NextResponse.json(
      {
        error:
          "本站不是许可证签发站,请到国内主站(ai.starzeco.com)后台生成许可证。此处生成的 Key 买家将无法激活。",
      },
      { status: 403 }
    );
  }
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
