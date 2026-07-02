import "server-only";

// ---------------------------------------------------------------------------
// 极简内存版按-IP 滑动窗口限流。单 pm2 fork 实例内有效(与生图 JOBS 同模式)。
// 防止有人脚本化刷生图/套图接口烧 token。非分布式,够用;要更强可换 Redis。
// ---------------------------------------------------------------------------

type Bucket = { hits: number[]; };
const store = new Map<string, Bucket>();
let lastSweep = 0;

/**
 * 返回 true=放行, false=超限。
 * @param key   维度键(如 `gen:1.2.3.4`)
 * @param limit 窗口内最大次数
 * @param windowMs 窗口毫秒
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // 周期性清理过期桶,避免内存无限增长
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of Array.from(store.entries())) {
      if (!b.hits.length || now - b.hits[b.hits.length - 1] > windowMs) store.delete(k);
    }
  }
  let b = store.get(key);
  if (!b) { b = { hits: [] }; store.set(key, b); }
  // 丢弃窗口外的命中
  const cutoff = now - windowMs;
  while (b.hits.length && b.hits[0] < cutoff) b.hits.shift();
  if (b.hits.length >= limit) return false;
  b.hits.push(now);
  return true;
}
