import "server-only";
import { relayTokenIdFromBaseUrl } from "@/lib/cloud";
import { issueCredits, relayConfigured } from "@/lib/relay";
import { CLOUD_BUY_ORIGIN } from "@/lib/cloud";
import { proxyHeaders } from "@/lib/proxy-identity";

// ── 发放积分的唯一守卫 ──────────────────────────────────────────────────────
//
// 标准做法(大厂通用的三桶模型):
//   已购买 = 站点库存 + 用户钱包合计 + 已消耗
//   · 发放给用户 = **划拨**(库存↓、钱包↑),总量不变
//   · 用户生图   = **核销**(钱包↓、已消耗↑)
// 所以发放只动 issued_total、生图只动 quota_used,**不会双重扣减**。
//
// ⚠️ 任何"凭空产生积分"的入口都必须过这里,一个不漏 ——
// 管理员加分 / 发兑换码 / 新人赠送 / 用户购买。
// 历史教训:曾只在"管理员加分"处设限,站长改用兑换码即可绕过。
//
// **自托管 / Pro 买家不受限制**:他们用自己的模型 Key、花自己的钱,
// 没有 relay 配额这回事。判断依据 = OPENAI_BASE_URL 是否指向 relay 的 nvr- 通道。

/** 本实例是否为「云端托管租户」(算力由我们托管,需要受站点配额约束)。 */
export function isCloudTenant(): boolean {
  return !!relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "");
}


// ── 租户走「受限发放通道」──────────────────────────────────────────────────
// 租户容器**没有也不该有** relay 管理员密钥(那把钥匙能改所有租户的配额),
// 所以它不能直接调 relay。改成拿**自己的派生密钥**(与境外代跑同一套身份)
// 调签发站的 /api/compute/issue,那边按验签结果决定动哪条配额。
//
// 这条通道补上的正是 2026-08-26 发现的空转:以前租户里 relayConfigured()=false
// → 守卫直接放行 → 站长后台随便加分,relay 的 issued_total 根本不动。
async function issueViaBuyOrigin(
  delta: number
): Promise<{ ok: true } | { ok: false; issuable: number } | null> {
  try {
    const r = await fetch(`${CLOUD_BUY_ORIGIN}/api/compute/issue`, {
      method: "POST",
      headers: proxyHeaders(), // 含 x-relay-token + 本租户派生密钥
      body: JSON.stringify({ delta: Math.trunc(delta) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 409) {
      const d = (await r.json().catch(() => ({}))) as { issuable?: number };
      return { ok: false, issuable: Number(d?.issuable) || 0 };
    }
    if (!r.ok) return null; // 401/503/502 等 → 当作"够不到",按放行处理
    return { ok: true };
  } catch {
    return null;
  }
}

export type IssueResult =
  | { ok: true }
  | { ok: false; message: string; issuable: number };

/**
 * 发放前校验并扣减站点库存。
 *
 * @param amount 正数=发放(校验库存);负数=退回(扣用户分/作废兑换码)
 * @returns ok:false 时**调用方必须中止发放**并把 message 返给用户
 *
 * 非云端租户、或 relay 未配置 → 直接放行(返回 ok:true)。
 */
export async function reserveIssue(amount: number): Promise<IssueResult> {
  const n = Math.trunc(amount);
  if (!n) return { ok: true };
  // 退回永远放行(把额度还回库存,不该被任何条件挡住)
  const tokenId = relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "");
  if (!tokenId) return { ok: true }; // 自托管 / Pro 买家 → 用自己的 Key,不限制
  // 签发站自己有管理密钥就直连;租户没有(也不该有)→ 走受限发放通道。
  const r = relayConfigured()
    ? await issueCredits(tokenId, n).catch(() => null)
    : await issueViaBuyOrigin(n);
  // relay 不可达时**放行**:宁可短暂失去限制,也不能因为网络抖动就让站长发不了分。
  // 真实消耗那一侧仍有 quota_used 硬兜底,不会失控。
  if (r === null) return { ok: true };
  if (r.ok) return { ok: true };
  return {
    ok: false,
    message: `站点可发放算力不足(还可发放 ${r.issuable} 积分)，请先在「算力充值」补充`,
    issuable: r.issuable,
  };
}

/** 发放失败/回滚时把额度还回库存。失败不抛错(尽力而为,避免掩盖原始错误)。 */
export async function releaseIssue(amount: number): Promise<void> {
  const n = Math.trunc(amount);
  if (n <= 0) return;
  const tokenId = relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "");
  if (!tokenId) return;
  if (relayConfigured()) await issueCredits(tokenId, -n).catch(() => {});
  else await issueViaBuyOrigin(-n);
}
