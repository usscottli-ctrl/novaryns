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
  quota_total: number; // managed 的算力配额上限(次);0=不限量
  quota_used: number;
  quota_left: number | null; // null=不限量
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

export async function deleteToken(id: string): Promise<void> {
  const r = await call(`/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("删除中转密钥失败");
}
