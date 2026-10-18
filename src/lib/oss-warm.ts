import "server-only";

// ---------------------------------------------------------------------------
// 把刚生成的图**立刻**灌进阿里云 OSS(国内站/租户专用)。
//
// 背景(2026-09-03 线上事故):国内展示链路是
//   cdn.starzeco.com(阿里云CDN)→ OSS starzeco-img(杭州)→ 镜像回源 → R2。
// 而 R2 的 `pub-*.r2.dev` 那天在国内被墙,OSS 回源拿不到任何响应 → 全站图裂。
// 已改成回源到 R2 自定义域名 img.novaryns.com(走 Cloudflare 边缘,国内可达),
// 并把存量 1.7 万个对象全部预热进了 OSS。
//
// 但**写入端仍然是 R2**(图由美国机代跑生成后直接写 R2),所以新图进 OSS 只有两条路:
//   ① 有人第一次浏览它,触发镜像回源;② 每天 04:30 的预热脚本扫进去。
// 也就是说"当天新生成、又没人看过"的图,在 OSS 里是缺的 —— 万一 Cloudflare 再被墙,
// 这批就取不到。
//
// 这里补第三条路:**落库后立刻 GET 一次 OSS 地址**,让 OSS 当场回源落盘。
// 只是一个 GET,不需要 OSS 密钥;失败也无所谓(前两条路还在),所以整段 fire-and-forget。
//
// 开关:`OSS_WARM_BASE`(如 https://starzeco-img.oss-cn-hangzhou.aliyuncs.com)。
// 不配 = 完全不启用(海外站、开源自托管走这条分支,零影响)。
// ---------------------------------------------------------------------------

const BASE = (process.env.OSS_WARM_BASE || "").replace(/\/+$/, "");

/** 从图片 URL 取出对象 key。只认我们自己的图片主机,外链一律忽略。 */
function keyOf(url: string): string | null {
  const m = /^https?:\/\/([^/]+)\/(.+)$/.exec((url || "").trim());
  if (!m) return null;
  const host = m[1];
  const ours =
    host.endsWith(".r2.dev") ||
    host === "img.novaryns.com" ||
    host === "cdn.starzeco.com" ||
    host.endsWith(".aliyuncs.com");
  if (!ours) return null;
  const key = m[2].split("?")[0];
  return key || null;
}

/**
 * 让 OSS 立刻把这些图回源落盘。**不 await、不抛错** —— 这是锦上添花,
 * 绝不能因为它失败而影响出图或落库。
 */
export function warmOss(urls: (string | null | undefined)[]): void {
  if (!BASE) return;
  const keys = Array.from(
    new Set(urls.map((u) => (u ? keyOf(u) : null)).filter((k): k is string => !!k))
  );
  if (!keys.length) return;
  void Promise.allSettled(
    keys.map((k) =>
      fetch(`${BASE}/${k}`, {
        method: "GET",
        cache: "no-store",
        // 回源是 OSS 那边去拉,慢一点无所谓;超时兜底避免挂住连接
        signal: AbortSignal.timeout(30_000),
      }).then((r) => r.arrayBuffer())
    )
  ).catch(() => {});
}
