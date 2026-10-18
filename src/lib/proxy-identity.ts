import "server-only";
import crypto from "node:crypto";
import { relayTokenIdFromBaseUrl } from "@/lib/cloud";

// ---------------------------------------------------------------------------
// 「境外代跑」通道的身份判定 —— 谁在打这四个 /api/internal/* 端点。
//
// 为什么需要(2026-08-26 修的洞):
//   代跑端点用的是**我们主站的 Key**,原本只认一个共享的 INTERNAL_API_SECRET,
//   而这个值**也发给了每个云端租户**(2026-08-18 为解决跨境慢发的)。于是租户
//   只要直接打端点就能无上限烧我们的账户 —— relay 的配额闸门(/_auth)管不到,
//   因为代跑根本不走 relay。
//
// 修法:**主密钥不再下发给租户**。
//   · 我们自己的站(US / CN 主站)= 持有主密钥 INTERNAL_API_SECRET,不带 token 头 → 可信,不限量;
//   · 云端租户 = 只拿到 `HMAC(主密钥, "proxy:<relay token id>")` 这个**派生值**,
//     调用时必须带 `x-relay-token: <id>`;服务端按 id 重算 HMAC 比对。
//     → 租户拿不到主密钥、也伪造不出别的租户的密钥,且身份必然可归属到一个配额账户。
//
// ⚠️ 租户实例的 env 名仍叫 INTERNAL_API_SECRET(装的是派生值),所以租户侧代码无需改。
// ---------------------------------------------------------------------------

/** 由主密钥派生某个云端租户的专属代跑密钥。provision 时写进租户 env。 */
export function deriveTenantProxySecret(masterSecret: string, tokenId: string): string {
  return crypto
    .createHmac("sha256", masterSecret.trim())
    .update(`proxy:${tokenId}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export type ProxyCaller =
  /** 我们自己的站(主密钥),不计配额。 */
  | { kind: "trusted" }
  /** 云端租户,必须过配额闸门。 */
  | { kind: "tenant"; tokenId: string };

/** 判定来访者;返回 null = 未授权(调用方应回 401)。 */
export function verifyProxyCaller(req: Request): ProxyCaller | null {
  const master = (process.env.INTERNAL_API_SECRET || "").trim();
  if (!master) return null; // 没配主密钥 = 这些端点整体不启用
  const got = (req.headers.get("x-internal-secret") || "").trim();
  if (!got) return null;
  const tokenId = (req.headers.get("x-relay-token") || "").trim().toLowerCase();
  if (tokenId) {
    if (!/^[0-9a-f]{16}$/.test(tokenId)) return null;
    return safeEqual(got, deriveTenantProxySecret(master, tokenId))
      ? { kind: "tenant", tokenId }
      : null;
  }
  if (safeEqual(got, master)) return { kind: "trusted" };
  // 轮换窗口:换主密钥时两个站不可能同一秒生效,配上旧值可以零中断切换。
  // ⚠️ **轮换做完必须删掉 INTERNAL_API_SECRET_PREV 并重启** —— 旧值还在租户手里,
  // 留着它等于洞没堵上。它只是为了不打断正在生图的客户。
  const prev = (process.env.INTERNAL_API_SECRET_PREV || "").trim();
  return prev && safeEqual(got, prev) ? { kind: "trusted" } : null;
}

// ── 调用方(国内站 / 云端租户)────────────────────────────────────────────────

/** 本实例的 relay token id(云端租户才有;主站/自部署为 null)。 */
export function ownRelayTokenId(): string | null {
  return relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "");
}

/**
 * 打代跑端点要带的头。**五个调用点统一走这里**,别再各自拼 x-internal-secret ——
 * 漏带 x-relay-token 的话租户侧会被判 401(主密钥对不上)。
 */
export function proxyHeaders(): Record<string, string> {
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  const tokenId = ownRelayTokenId();
  return {
    "Content-Type": "application/json",
    "x-internal-secret": secret,
    ...(tokenId ? { "x-relay-token": tokenId } : {}),
  };
}
