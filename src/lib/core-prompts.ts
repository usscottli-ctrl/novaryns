import "server-only";
import { licenseCredentials } from "@/lib/edition";
import { proxyHeaders } from "@/lib/proxy-identity";

// ---------------------------------------------------------------------------
// 核心提示词(套图规划 / 设计方向 / 平台风格 / 防编造 / AI帮写 / 智能优化 / 标题)
// **不在本仓源码里** —— 由授权服务器(默认 ai.starzeco.com 的 /api/internal/core-prompts)
// 凭本站授权码(商业版)或内部密钥(官方站 / 云端租户)下发,只放进程内存,不落盘、不进
// 后台、不进 GitHub。没有授权 → 依赖这些提示词的功能整体不可用(产品决定:不提供简化版)。
//
// 可用性:拿到一次后缓存 1 小时;到期刷新失败就继续用手里这份(授权服务器偶尔抖动
// 不影响已授权站点)。只有「进程启动后一次都没拿到」时才不可用。
// ---------------------------------------------------------------------------

export type CorePrompts = {
  suiteSystem: string;
  suiteDirectionsSystem: string;
  styleInspirations: string[];
  suitePlatformHints: Record<string, string>;
  assistSystem: string;
  optimizeSystem: string;
  assistToolHints: Record<string, string>;
  titleSystem: string;
  /** 每张套图出图提示词的固定开头 */
  shotLead: string;
  /** 「严格不编造参数」开着时追加在开头后的约束 */
  shotLeadStrict: string;
  /** 用户关掉「严格不编造参数」时追加到规划指令末尾 */
  looseClaimsOverride: string;
  /** 产品事实红线模板,{extra} = 用户填的卖点 */
  redLine: string;
};

export class CorePromptsUnavailable extends Error {
  constructor(msg = "该功能需要商业授权，或暂时无法连接授权服务，请联系站长") {
    super(msg);
    this.name = "CorePromptsUnavailable";
  }
}

const TTL = 60 * 60 * 1000;
let cache: { at: number; p: CorePrompts } | null = null;
let inflight: Promise<CorePrompts | null> | null = null;

async function fetchCorePrompts(): Promise<CorePrompts | null> {
  const { server, key, host } = await licenseCredentials();
  const internal = (process.env.INTERNAL_API_SECRET || "").trim();
  // 官方站 / 云端租户走内部密钥;商业版客户站走授权码。两样都没有 = 未授权,不必发请求。
  if (!internal && !key) return null;
  try {
    const res = await fetch(`${server}/api/internal/core-prompts`, {
      method: "POST",
      headers: internal ? proxyHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify(internal ? {} : { key, host }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const d = (await res.json().catch(() => null)) as { ok?: boolean; prompts?: CorePrompts } | null;
    if (!res.ok || !d?.ok || !d.prompts?.suiteSystem) {
      console.warn("[core-prompts] 授权服务器拒绝或返回异常:", res.status);
      return null;
    }
    return d.prompts;
  } catch (e) {
    console.warn("[core-prompts] 连不上授权服务器:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** 取核心提示词;没有授权(且手里也没有缓存)时抛 CorePromptsUnavailable。 */
export async function getCorePrompts(): Promise<CorePrompts> {
  if (cache && Date.now() - cache.at < TTL) return cache.p;
  inflight ??= fetchCorePrompts().finally(() => {
    inflight = null;
  });
  const p = await inflight;
  if (p) {
    cache = { at: Date.now(), p };
    return p;
  }
  if (cache) return cache.p; // 刷新失败:继续用上一次拿到的
  throw new CorePromptsUnavailable();
}

/** 本站是否能用核心提示词(用于在扣积分之前就拦住)。 */
export async function corePromptsAvailable(): Promise<boolean> {
  try {
    await getCorePrompts();
    return true;
  } catch {
    return false;
  }
}
