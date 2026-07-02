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
