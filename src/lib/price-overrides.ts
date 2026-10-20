import "server-only";
import { dbEnabled, getSetting, setSetting } from "@/lib/db";
import { PRICE_BOARDS, setPriceOverrides } from "@/lib/mock-data";

// 后台「各板块积分」覆盖表(站长自定义价格)的读写。说明见 mock-data.ts 的 PRICE_BOARDS 段。
// 存为 app_settings.credit_prices = {"suite.2K":10,"cutout":2,...};没填的键 = 用默认价。
const K = "credit_prices";
const TTL = 15_000; // 每次计价都读库太浪费;站长改价后最多 15 秒全站生效(本进程保存时立即生效)

let cache: { at: number; v: Record<string, number> } | null = null;

/** 合法的价格键:固定价板块 id,或「板块.档位」。 */
function validKeys(): Set<string> {
  const out = new Set<string>();
  for (const b of PRICE_BOARDS) {
    if (b.tiers) b.tiers.forEach((t) => out.add(`${b.id}.${t}`));
    else out.add(b.id);
  }
  return out;
}

function sanitize(raw: unknown): Record<string, number> {
  const keys = validKeys();
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (keys.has(k) && Number.isFinite(n) && n >= 0 && n <= 100000) out[k] = Math.round(n);
  }
  return out;
}

export async function getPriceOverrides(): Promise<Record<string, number>> {
  if (!dbEnabled) return {};
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  let v: Record<string, number> = {};
  try {
    const raw = await getSetting(K);
    v = raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    v = cache?.v ?? {}; // 读失败沿用上次的,别因为一次抖动把价格打回默认
  }
  cache = { at: Date.now(), v };
  return v;
}

/** 服务端计价前调用:把站长定的价灌进 mock-data 的计价函数。 */
export async function loadPriceOverrides(): Promise<void> {
  setPriceOverrides(await getPriceOverrides());
}

export async function savePriceOverrides(raw: unknown): Promise<Record<string, number>> {
  const v = sanitize(raw);
  await setSetting(K, JSON.stringify(v));
  cache = { at: Date.now(), v };
  setPriceOverrides(v);
  return v;
}
