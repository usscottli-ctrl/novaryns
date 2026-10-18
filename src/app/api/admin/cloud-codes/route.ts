import { NextResponse } from "next/server";
import {
  dbEnabled,
  listCloudCodes,
  generateCloudCodes,
  setCloudCodeStatus,
  cloudCodeStats,
} from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { proEnabled } from "@/lib/edition";
import { findCloudPlan } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request): Promise<NextResponse | null> {
  if (!dbEnabled) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "无权限" }, { status: 403 });
  if (!(await proEnabled())) return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  return null;
}

// 站长后台:列出云端开通码 + 统计。
export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const [codes, stats] = await Promise.all([listCloudCodes(), cloudCodeStats()]);
  return NextResponse.json({ codes, stats });
}

// 批量生成开通码(发给渠道自动发货用)。
export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: {
    planId?: string;
    count?: number;
    expiryDays?: number | null;
    batch?: string;
    note?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const plan = findCloudPlan(String(body.planId ?? ""));
  if (!plan) return NextResponse.json({ error: "套餐无效" }, { status: 400 });
  const count = Number(body.count);
  if (!(count > 0) || count > 500) {
    return NextResponse.json({ error: "数量需 1–500" }, { status: 400 });
  }
  const expiryDays =
    body.expiryDays == null || body.expiryDays === 0 ? null : Number(body.expiryDays);
  const codes = await generateCloudCodes({
    planId: plan.id,
    count,
    expiryDays,
    batch: String(body.batch ?? ""),
    note: String(body.note ?? ""),
  });
  const stats = await cloudCodeStats();
  return NextResponse.json({ codes, stats });
}

// 停用 / 恢复(已核销的不可改)。
export async function PATCH(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: { code?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "缺少 code" }, { status: 400 });
  await setCloudCodeStatus(code, body.status === "disabled" ? "disabled" : "unused");
  return NextResponse.json({ ok: true });
}
