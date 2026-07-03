// Optional per-instance image CDN.
//
// When NEXT_PUBLIC_IMAGE_BASE_URL is set (国内 instance →
// https://cdn.starzeco.com, an Aliyun OSS domain that mirror-back-sources from
// our R2 bucket), rewrite our R2 public image URLs to that domain so
// mainland-China users load images from a domestic, ICP-filed CDN instead of
// *.r2.dev (which has no reliable China edge). The 海外 instance leaves the var
// unset → this is a no-op and images keep loading straight from R2.
//
// Only *.r2.dev URLs are rewritten; data:/blob:/relative URLs and any other
// host (e.g. images.unsplash.com) are left untouched. We rewrite at the render
// layer only — the underlying URL kept in state/DB stays the canonical R2 URL,
// so the same-origin /api/download proxy (which allowlists *.r2.dev) keeps
// working.
const IMG_BASE = (process.env.NEXT_PUBLIC_IMAGE_BASE_URL ?? "").replace(
  /\/$/,
  ""
);

export function cdnUrl(src: string | null | undefined): string {
  const s = src ?? "";
  if (!IMG_BASE || !s) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith(".r2.dev")) {
      return IMG_BASE + u.pathname + u.search;
    }
  } catch {
    // relative path / data: / blob: URL — leave as-is
  }
  return s;
}

// CDN 可达性主动探测(2026-07-03):开代理的用户,浏览器对 cdn.starzeco.com 的
// 请求会被代理「挂起」——既不成功也不触发 onerror,被动回退等不到。所以首次用
// 改写源前先探测一张(3.5s 超时),不通 → 本会话内全部直接用原始源。
// 结果模块级缓存,全站只探一次;海外/自托管(无改写)不会调用到。
let cdnHealthy: boolean | null = null;
let cdnProbe: Promise<boolean> | null = null;
export function probeCdnHealth(sampleRewrittenUrl: string): Promise<boolean> {
  if (cdnHealthy !== null) return Promise.resolve(cdnHealthy);
  if (cdnProbe) return cdnProbe;
  cdnProbe = new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      cdnHealthy = ok;
      resolve(ok);
    };
    try {
      const im = new Image();
      const t = setTimeout(() => done(false), 3500);
      im.onload = () => {
        clearTimeout(t);
        done(true);
      };
      im.onerror = () => {
        clearTimeout(t);
        done(false);
      };
      im.src =
        sampleRewrittenUrl +
        (sampleRewrittenUrl.includes("?") ? "&" : "?") +
        "nvprobe=1";
    } catch {
      done(true); // 探测本身出错就当可用,走原逻辑
    }
  });
  return cdnProbe;
}

// 图片加载失败时的「换源重试」(onError 用):
//   当前用改写地址(国内 CDN)失败 → 回退原始 R2;当前用原始失败 → 试改写(若不同)。
// 场景(2026-07-03 实测):开全局代理的用户,浏览器出口在境外 → 访问不了仅限
// 中国内地的 cdn.starzeco.com;而直连用户又访问不了被墙的 r2.dev。两个源总有
// 一个能通,失败就换到另一个。dataset 标记只换一次,防两边都挂时死循环。
// 返回 true = 已换源重试(调用方先别进 error 态);false = 没得换了。
export function onImgError(
  e: { currentTarget: unknown },
  original: string | null | undefined
): boolean {
  const img = e.currentTarget as HTMLImageElement | null;
  const orig = original ?? "";
  if (!img || !orig || !/^https?:/.test(orig)) return false;
  if (img.dataset.nvFallback) return false; // 已回退过一次,放弃
  const rewritten = cdnUrl(orig);
  if (rewritten === orig) return false; // 没配 CDN(海外/自托管),无源可换
  // 当前 src 若是原始地址 → 换改写;否则(改写/缩略地址)→ 换回原始
  const next = img.src === orig ? rewritten : orig;
  if (next === img.src) return false;
  img.dataset.nvFallback = "1";
  img.src = next;
  return true;
}

// 列表缩略图:在 CDN(阿里 OSS 镜像)上按宽度实时缩放 + 压缩 + 转 WebP。
// 实测 390KB → 84KB(4.6×),列表场景(首页/模板库/作品库)提速数倍。
// 仅当 URL 已被重写到国内 CDN 域时才追加参数;海外站(无 IMG_BASE,直连 r2.dev)
// 原样返回 —— r2.dev 不认这些参数。点开大图的场景请继续用 cdnUrl(原图)。
export function cdnThumb(
  src: string | null | undefined,
  width = 640
): string {
  const out = cdnUrl(src);
  if (!IMG_BASE || !out.startsWith(IMG_BASE)) return out;
  if (out.includes("?")) return out; // 已带查询参数的不叠加
  return `${out}?x-oss-process=image/resize,w_${width}/quality,q_82/format,webp`;
}
