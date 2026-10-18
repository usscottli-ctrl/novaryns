import "server-only";

// 云端开通编排服务(ops/cloud/provisioner.js,CN ECS 上 systemd nv-provisioner)的 HTTP 客户端。
// 只在服务端调用。地址/密钥从 env 读:
//   PROVISIONER_URL     例 http://host.docker.internal:9710(应用容器经 host-gateway 达宿主)
//   PROVISIONER_SECRET  与服务端 provisioner.env 的 PROVISIONER_SECRET 一致(Bearer)
const BASE = (process.env.PROVISIONER_URL || "").replace(/\/$/, "");
const SECRET = process.env.PROVISIONER_SECRET || "";

export function provisionerConfigured(): boolean {
  return !!BASE && !!SECRET;
}

type Resp = { httpOk: boolean; ok?: boolean; error?: string; [k: string]: unknown };

async function call(path: string, method: string, body: unknown, timeoutMs: number): Promise<Resp> {
  if (!provisionerConfigured()) return { httpOk: false, ok: false, error: "云端开通服务未配置(PROVISIONER_URL/SECRET)" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { httpOk: r.ok, ...j };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { httpOk: false, ok: false, error: aborted ? "开通服务响应超时" : "开通服务不可达" };
  } finally {
    clearTimeout(timer);
  }
}

export type ProvisionResult = {
  ok: boolean;
  url?: string;
  adminEmail?: string;
  adminPassword?: string;
  error?: string;
};

// 开通一个租户实例。可能耗时数分钟(首次含镜像构建),超时给足 10 分钟。
export async function provisionTenant(args: {
  name: string;
  email: string;
  site?: string;
  region?: string;
  /** 本套餐赠送的算力积分(月付1000/年付12000);不传则由服务端脚本默认值决定。 */
  credits?: number;
}): Promise<ProvisionResult> {
  const r = await call("/provision", "POST", { region: "cn", ...args }, 600_000);
  return { ok: !!r.ok, url: r.url as string, adminEmail: r.adminEmail as string, adminPassword: r.adminPassword as string, error: r.error };
}

// 下线:purge=true 彻底销毁,否则挂起(可逆)。
export async function deprovisionTenant(name: string, purge = false): Promise<{ ok: boolean; error?: string }> {
  const r = await call("/deprovision", "POST", { name, mode: purge ? "purge" : "suspend" }, 200_000);
  return { ok: !!r.ok, error: r.error };
}

// 恢复:挂起 → 活跃(续费后调用)。
export async function resumeTenant(name: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call("/resume", "POST", { name }, 200_000);
  return { ok: !!r.ok, error: r.error };
}

// 设置租户自定义域名(声明式:传入即最终集合,空数组=清空)。
export async function setTenantDomains(name: string, domains: string[]): Promise<{ ok: boolean; error?: string; domains?: string[]; warnings?: string[] }> {
  const r = await call("/set-domains", "POST", { name, domains }, 200_000);
  return { ok: !!r.ok, error: r.error, domains: r.domains as string[], warnings: r.warnings as string[] };
}

export async function listTenants(): Promise<{ ok: boolean; tenants?: unknown[]; error?: string }> {
  const r = await call("/tenants", "GET", null, 15_000);
  return { ok: !!r.ok, tenants: r.tenants as unknown[], error: r.error };
}
