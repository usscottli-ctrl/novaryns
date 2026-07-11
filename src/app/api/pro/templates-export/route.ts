import { NextResponse } from "next/server";
import { dbEnabled, validateLicense, listTemplatesPaged } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pro 权益:官方模板库导出(**含 prompt 完整字段**)。
// 公开的 /api/templates 故意不带 prompt(提示词库是核心资产,防爬);
// 本端点凭**有效 License Key** 分页导出完整模板,供买家实例一键同步。
// 非签发站(app_licenses 空)校验必失败 → 天然只在官方站生效。
export async function POST(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`tpl-export:${ip}`, 240, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "请求过于频繁" }, { status: 429 });
  }
  let body: { key?: string; page?: number; pageSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ error: "缺少 License Key" }, { status: 400 });
  const lic = await validateLicense(key);
  if (!lic.ok) {
    return NextResponse.json(
      { error: `License 校验失败:${lic.error}` },
      { status: 403 }
    );
  }
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(body.pageSize) || 200));
  const { items, total } = await listTemplatesPaged({ page, pageSize });
  return NextResponse.json({ templates: items, total, page, pageSize });
}
