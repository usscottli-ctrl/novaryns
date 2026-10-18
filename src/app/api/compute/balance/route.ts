import { NextResponse } from "next/server";
import { findToken, relayConfigured } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 云端租户算力余额查询(公开;token id 16位随机hex不可猜,本身即访问凭据)。
// 租户实例后台调它显示余额;只返回配额数字,不返回联系方式/地址等敏感字段。
// 只在签发站(配了 RELAY_MANAGE_URL/SECRET)可用。
export async function GET(req: Request) {
  if (!relayConfigured()) {
    return NextResponse.json({ error: "服务未配置" }, { status: 503 });
  }
  const token = (new URL(req.url).searchParams.get("token") || "").trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(token)) {
    return NextResponse.json({ error: "参数不正确" }, { status: 400 });
  }
  const t = await findToken(token).catch(() => null);
  if (!t || t.kind !== "managed") {
    return NextResponse.json({ error: "未找到" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    status: t.status,
    quotaTotal: t.quota_total,
    quotaUsed: t.quota_used,
    quotaLeft: t.quota_left, // null = 不限量
    // 已发放 / 还可发放。**后台「算力余额」要显示 issuable 而不是 quotaLeft**:
    // quotaLeft 是"还能烧多少",issuable 是"还能发给用户多少" —— 站长关心的是后者。
    issuedTotal: t.issued_total ?? 0,
    issuable: t.issuable ?? null,
  });
}
