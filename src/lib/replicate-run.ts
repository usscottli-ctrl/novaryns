// Replicate 调用的**唯一入口**:直连或经境外代跑,由环境自动决定。
//
// 为什么需要这层(2026-08-18 线上事故):
//   **阿里云杭州连不上 api.replicate.com**(实测 20s 超时 / HTTP 000)。
//   抠图与放大都直连 Replicate,于是在国内站:
//     · 抠图 → 每次 "Replicate failed, falling back" → 悄悄退到 gpt-image 透明底,
//       客户看到的是"重绘过的、不像抠图的图",但功能表面上"成功"了;
//     · 放大 → 直接失败。
//   两个功能坏了很久没人发现,因为**兜底把失败掩盖成了劣质成功**。
//
// 现在统一走这里:配了 REPLICATE_PROXY_URL 就让美国机代调,只回结果 URL。
// 新增任何用 Replicate 的功能都必须用这个函数,别再各自 fetch。
import { safeError } from "@/lib/api-error";
import { withProxyRetry } from "@/lib/proxy-retry";
import { proxyHeaders } from "@/lib/proxy-identity";

const VERSION_CACHE = new Map<string, string>();

async function resolveVersion(model: string, token: string): Promise<string> {
  const cached = VERSION_CACHE.get(model);
  if (cached) return cached;
  const r = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Replicate 模型查询失败 ${r.status}`);
  const j = (await r.json()) as { latest_version?: { id?: string } };
  const v = j.latest_version?.id;
  if (!v) throw new Error("Replicate 模型无可用版本");
  VERSION_CACHE.set(model, v);
  return v;
}

/** 本实例能否用 Replicate = 有 token(直连) 或 配了代跑通道。 */
export function replicateAvailable(): boolean {
  return (
    (process.env.REPLICATE_API_TOKEN ?? "").length > 0 ||
    ((process.env.REPLICATE_PROXY_URL ?? "").length > 0 &&
      (process.env.INTERNAL_API_SECRET ?? "").length > 0)
  );
}

/** 直连 Replicate 跑一次预测,返回输出(通常是图片 URL)。 */
export async function runReplicateDirect(
  model: string,
  input: Record<string, unknown>,
  token: string,
  timeoutMs = 240_000
): Promise<string> {
  const version = await resolveVersion(model, token);
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ version, input }),
    cache: "no-store",
  });
  let pred = (await create.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    output?: string | string[];
    error?: string;
    detail?: string;
  };
  if (!create.ok) {
    throw new Error(pred?.detail || pred?.error || `Replicate ${create.status}`);
  }
  const deadline = Date.now() + timeoutMs;
  while (pred.status && pred.status !== "succeeded") {
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(pred.error || "Replicate 生成失败");
    }
    if (Date.now() > deadline) throw new Error("Replicate 超时");
    await new Promise((r) => setTimeout(r, 2000));
    const g = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    pred = await g.json().catch(() => pred);
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error("Replicate 未返回结果");
  return out;
}

/**
 * 跑一次 Replicate 预测,返回结果 URL。
 * **国内站自动走 REPLICATE_PROXY_URL**(境外代跑) —— 那边直连不通。
 */
export async function runReplicate(
  model: string,
  input: Record<string, unknown>,
  timeoutMs = 240_000
): Promise<string> {
  const proxy = (process.env.REPLICATE_PROXY_URL || "").trim();
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  if (proxy && secret) {
    // 跨境链路会偶发 ECONNRESET,连接层错误自动重试(见 lib/proxy-retry)。
    return await withProxyRetry("replicate", async () => {
    const r = await fetch(proxy.replace(/\/$/, ""), {
      method: "POST",
      headers: proxyHeaders(), // 含 x-relay-token(云端租户的配额身份)
      body: JSON.stringify({ model, input }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok) throw new Error(j.error || `境外 Replicate 服务 ${r.status}`);
    if (!j.url) throw new Error("境外 Replicate 服务未返回结果");
    return j.url;
    });
  }
  const token = (process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) throw new Error("Replicate 未配置");
  return runReplicateDirect(model, input, token, timeoutMs);
}

/** 取回结果字节。代跑回来的是 R2 地址,直连回来的是 replicate.delivery 地址。 */
export async function fetchResultBytes(
  url: string
): Promise<{ buf: Buffer; contentType: string }> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`取结果失败 ${r.status}`);
  return {
    buf: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get("content-type") || "image/png",
  };
}

export { safeError };
