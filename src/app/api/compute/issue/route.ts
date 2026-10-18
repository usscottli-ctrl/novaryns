import { NextResponse } from "next/server";
import { verifyProxyCaller } from "@/lib/proxy-identity";
import { issueCredits, relayConfigured } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 云端租户的**受限发放通道**(2026-08-26)。
//
// 为什么需要:发放守卫 `reserveIssue()` 要校验站点库存,得调 relay 的 /_manage —— 而那把
// `RELAY_ADMIN_SECRET` 是**整个 relay 的管理员密钥**(能改所有租户的配额),绝不能下发到
// 租户容器。结果就是租户里 `relayConfigured()` 永远为 false、守卫直接放行:
// **站长后台想加多少分就加多少分,relay 的 issued_total 纹丝不动**
// (实测 hzdemo 加了 100+ 分,issued_total 仍停在 1152)。
//
// 修法:租户不拿管理员密钥,改用**它自己的派生密钥**(与境外代跑同一套身份,见
// lib/proxy-identity)调这个端点。tokenId 取自**验签结果**而不是请求体 ——
// 所以一个租户只能动自己那一条配额,既改不了别人的,也伪造不出别人的身份。
//
// 只在签发站(配了 RELAY_MANAGE_URL/SECRET 的实例)可用。
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!relayConfigured()) {
    return NextResponse.json({ error: "服务未配置" }, { status: 503 });
  }
  const caller = verifyProxyCaller(req);
  // 只认租户身份:主密钥(我们自己的站)走后台面板,不走这条
  if (!caller || caller.kind !== "tenant") {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  let delta = 0;
  try {
    const body = (await req.json()) as { delta?: number };
    delta = Math.trunc(Number(body?.delta) || 0);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!delta || Math.abs(delta) > 10_000_000) {
    return NextResponse.json({ error: "delta 不合法" }, { status: 400 });
  }

  try {
    const r = await issueCredits(caller.tokenId, delta);
    if (r === null) {
      return NextResponse.json({ error: "服务未配置" }, { status: 503 });
    }
    if (!r.ok) {
      // 库存不足:把还能发多少告诉租户后台,站长据此去买算力
      return NextResponse.json(
        { error: "站点可发放算力不足", issuable: r.issuable },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      quotaTotal: r.quotaTotal,
      issuedTotal: r.issuedTotal,
      issuable: r.issuable,
    });
  } catch (e) {
    console.error("[compute/issue] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "发放服务暂时不可用" }, { status: 502 });
  }
}
