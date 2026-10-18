// 中转密钥管理:签发站后台 → 美国 relay-auth 服务的管理 API 的瘦客户端。
//
// 只在签发站(ai.starzeco.com)配置这两个 env,别处不配 → relayConfigured()=false,
// 面板自动隐藏/提示未配置。密钥只存签发站服务端 env,永不下发到浏览器。
//   RELAY_MANAGE_URL    形如 https://relay.novaryns.com/_manage
//   RELAY_ADMIN_SECRET  relay-auth 的 Bearer 密钥
import "server-only";

const MANAGE_URL = (process.env.RELAY_MANAGE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.RELAY_ADMIN_SECRET || "";

export function relayConfigured(): boolean {
  return Boolean(MANAGE_URL && SECRET);
}

export interface RelayToken {
  id: string;
  label: string;
  contact: string;
  // byok = Pro 买家自带 OpenAI Key(透传);managed = 云端租户,relay 注入我们的 Key + 计量配额
  kind: "byok" | "managed";
  status: "active" | "disabled" | "expired";
  stored_status: "active" | "disabled";
  created_at: string;
  expires_at: string | null;
  request_count: number;
  quota_total: number; // managed 的算力配额上限(积分,1张=6;2026-07-14 前单位是次);0=不限量
  quota_used: number;
  quota_left: number | null; // null=不限量
  // 已发放给终端用户的总量。**与 quota_used 是两个桶**:
  //   issued_total = 发出去多少(站长加分/发兑换码/用户购买时累加)
  //   quota_used   = 实际烧掉多少(生图时 relay 累加)
  // 站点库存 = quota_total - issued_total,后台「算力余额」显示的是这个。
  issued_total?: number;
  issuable?: number | null; // = quota_total - issued_total;null=不限量
  last_used_at: string | null;
  address: string;
}

async function call(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${MANAGE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  return { ok: res.ok, status: res.status, data };
}

export async function listTokens(): Promise<RelayToken[]> {
  const r = await call("/tokens");
  if (!r.ok) throw new Error("列取中转密钥失败");
  return ((r.data as { tokens?: RelayToken[] })?.tokens) || [];
}

export async function createToken(input: {
  label?: string;
  contact?: string;
  months?: number | null;
  kind?: "byok" | "managed";
  quota?: number; // managed 初始配额
}): Promise<RelayToken> {
  const r = await call("/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("生成中转密钥失败");
  return (r.data as { token: RelayToken }).token;
}

export async function patchToken(
  id: string,
  input: {
    status?: "active" | "disabled";
    addMonths?: number;
    addQuota?: number; // 充/收算力配额(managed)
    kind?: "byok" | "managed";
    label?: string;
    contact?: string;
    expires_at?: string | null;
  }
): Promise<RelayToken> {
  const r = await call(`/tokens/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("更新中转密钥失败");
  return (r.data as { token: RelayToken }).token;
}

// 按 id 找单个 token(算力余额查询用;列表量小,过滤即可)。
export async function findToken(id: string): Promise<RelayToken | null> {
  const tokens = await listTokens();
  return tokens.find((t) => t.id === id) ?? null;
}

/** 发放/退回积分额度(站点库存 ↔ 用户钱包的划拨)。
 *
 * delta>0 = 发放:relay 端**原子校验库存**,不足直接 409(不会超发,并发也安全);
 * delta<0 = 退回(管理员扣用户分、作废兑换码)。
 *
 * ⚠️ 这是"划拨"不是"消耗" —— 只动 issued_total,不动 quota_used。
 * 生图时的真实消耗由 relay 自己累加 quota_used,两者互不影响,不会双重扣减。
 *
 * 返回 null = 未配置 relay(自托管实例),调用方应视为**不限制**放行。
 */
export async function issueCredits(
  tokenId: string,
  delta: number
): Promise<
  | { ok: true; quotaTotal: number; issuedTotal: number; issuable: number | null }
  | { ok: false; reason: "insufficient"; issuable: number }
  | null
> {
  if (!relayConfigured()) return null;
  const r = await call(`/tokens/${encodeURIComponent(tokenId)}/issue`, {
    method: "POST",
    body: JSON.stringify({ delta: Math.trunc(delta) }),
  });
  const d = r.data as {
    ok?: boolean;
    quota_total?: number;
    issued_total?: number;
    issuable?: number | null;
    error?: string;
  };
  if (r.status === 409) {
    return { ok: false, reason: "insufficient", issuable: Number(d?.issuable) || 0 };
  }
  if (!r.ok) throw new Error(d?.error || `relay ${r.status}`);
  return {
    ok: true,
    quotaTotal: Number(d?.quota_total) || 0,
    issuedTotal: Number(d?.issued_total) || 0,
    issuable: d?.issuable === null ? null : Number(d?.issuable) || 0,
  };
}

export async function deleteToken(id: string): Promise<void> {
  const r = await call(`/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("删除中转密钥失败");
}

/** 消耗/退回算力配额(**代跑通道的计费闸门**)。
 *
 * credits>0 = 消耗:relay 端**原子校验余额**(quota_used+credits ≤ quota_total)
 * 并顺手校验 token 状态与到期,不足/停用/过期直接 403;
 * credits<0 = 退回(代跑失败时回滚,不校验,下限 0)。
 *
 * 为什么在这儿扣:云端租户的生图走「境外代跑」端点时**根本不经过 relay 的 /_auth**,
 * relay 原来那道 quota 闸门够不着 —— 代跑端点用的是我们主站的 Key,不堵就是无上限。
 * 这里补上后,两条路径(relay 转发 / 代跑)记的是**同一个 quota_used**。
 *
 * 返回 null = 未配置 relay。**安全语义由调用方决定**:代跑端点对租户请求应
 * 视为「配额服务不可用」而拒绝(fail closed),不能放行。
 */
export async function consumeCredits(
  tokenId: string,
  credits: number
): Promise<
  | { ok: true; quotaTotal: number; quotaUsed: number; quotaLeft: number | null }
  | { ok: false; reason: "quota" | "inactive" | "notfound" }
  | null
> {
  if (!relayConfigured()) return null;
  const r = await call(`/tokens/${encodeURIComponent(tokenId)}/consume`, {
    method: "POST",
    body: JSON.stringify({ credits: Math.trunc(credits) }),
  });
  const d = r.data as {
    ok?: boolean;
    reason?: string;
    quota_total?: number;
    quota_used?: number;
    quota_left?: number | null;
    error?: string;
  };
  if (r.status === 404) return { ok: false, reason: "notfound" };
  if (r.status === 403) {
    return { ok: false, reason: d?.reason === "inactive" ? "inactive" : "quota" };
  }
  if (!r.ok) throw new Error(d?.error || `relay ${r.status}`);
  return {
    ok: true,
    quotaTotal: Number(d?.quota_total) || 0,
    quotaUsed: Number(d?.quota_used) || 0,
    quotaLeft: d?.quota_left === null ? null : Number(d?.quota_left) || 0,
  };
}
