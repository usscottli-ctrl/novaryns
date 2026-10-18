import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { relayTokenIdFromBaseUrl, CLOUD_BUY_ORIGIN } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 租户实例后台:本实例的算力状态(托管积分模式才有)。
// 判定:env OPENAI_BASE_URL 形如 https://relay.../nvr-<id>/v1 → managed;
// 余额经购买站公开接口查询(本实例没有、也不应有 relay 管理密钥)。
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const tokenId = relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "");
  if (!tokenId) {
    // 自备 Key / 官方站 / 开源自托管:无托管算力概念
    return NextResponse.json({ managed: false });
  }
  // 充值页那个「接收凭证邮箱」默认要填**本站站长邮箱** —— 原来它取的是购买站上
  // 碰巧登录着的账号(我们自己的管理员或空),客户看到的邮箱根本不是他的。
  // 用 URL fragment 传:`#` 后面的内容浏览器**不会发给服务器**,不会落进访问日志;
  // 充值页读完即抹掉 hash。填错也能手改,这只是默认值。
  const billingEmail = (process.env.ADMIN_EMAIL || "").trim();
  const topupUrl =
    `${CLOUD_BUY_ORIGIN}/compute?token=${tokenId}` +
    (billingEmail ? `#email=${encodeURIComponent(billingEmail)}` : "");
  try {
    const r = await fetch(`${CLOUD_BUY_ORIGIN}/api/compute/balance?token=${tokenId}`, {
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return NextResponse.json({ managed: true, topupUrl, balance: null });
    const d = await r.json();
    return NextResponse.json({
      managed: true,
      topupUrl,
      balance: { status: d.status, quotaTotal: d.quotaTotal, quotaUsed: d.quotaUsed, quotaLeft: d.quotaLeft, issuedTotal: d.issuedTotal, issuable: d.issuable },
    });
  } catch {
    return NextResponse.json({ managed: true, topupUrl, balance: null });
  }
}
