import { NextResponse } from "next/server";
import {
  dbEnabled,
  listCardKeys,
  generateCardKeys,
  setCardKeyStatus,
  cardKeyStats,
} from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  return null;
}

// 站长后台:列出兑换码 + 统计。
export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const [cards, stats] = await Promise.all([listCardKeys(), cardKeyStats()]);
  return NextResponse.json({ cards, stats });
}

// 批量生成兑换码。
export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: {
    credits?: number;
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
  const credits = Number(body.credits);
  const count = Number(body.count);
  const expiryDays =
    body.expiryDays == null || body.expiryDays === 0 ? null : Number(body.expiryDays);
  if (!(credits > 0) || !(count > 0) || count > 500) {
    return NextResponse.json(
      { error: "面额需 > 0,数量需 1–500" },
      { status: 400 }
    );
  }
  const cards = await generateCardKeys({
    credits,
    count,
    expiryDays,
    batch: String(body.batch ?? ""),
    note: String(body.note ?? ""),
  });
  const stats = await cardKeyStats();
  return NextResponse.json({ cards, stats });
}

// 停用 / 恢复。
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
  const status = body.status === "disabled" ? "disabled" : "unused";
  if (!code) return NextResponse.json({ error: "缺少 code" }, { status: 400 });
  await setCardKeyStatus(code, status);
  return NextResponse.json({ ok: true });
}
