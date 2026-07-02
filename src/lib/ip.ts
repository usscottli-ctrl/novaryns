// Resolves the real client IP behind Cloudflare / a reverse proxy.
// Order: cf-connecting-ip (Cloudflare fronts image.novaryns.com) ->
// x-real-ip -> first hop of x-forwarded-for. Returns null if none present.
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
