import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin download proxy: streams a whitelisted image back with
// Content-Disposition: attachment so the browser saves it (cross-origin R2
// URLs otherwise just open in a new tab). Host-whitelisted to avoid an open
// proxy / SSRF.
function allowed(u: URL): boolean {
  // 允许的图片来源:R2 公共域、国内镜像 CDN(NEXT_PUBLIC_IMAGE_BASE_URL,如
  // cdn.starzeco.com)、以及 *.r2.dev / unsplash。国内站渲染层会把 r2.dev 改写成
  // CDN 域,下载/导出时传进来的就是 CDN 地址——必须放行,否则被白名单拒成 403,
  // 浏览器报「无法从网站上提取文件」。CDN 与 R2 服务器端都可达,取哪个都行。
  for (const base of [
    process.env.R2_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL,
  ]) {
    const b = (base ?? "").trim();
    if (b) {
      try {
        if (u.host === new URL(b).host) return true;
      } catch {
        /* ignore bad env */
      }
    }
  }
  return (
    u.protocol === "https:" &&
    (u.host === "images.unsplash.com" ||
      u.host.endsWith(".r2.dev") ||
      u.host === "img.novaryns.com") // R2 自定义域名(2026-09-03 起)
  );
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get("u");
  const name = (reqUrl.searchParams.get("n") || "novaryns.png").replace(
    /[^\w.\-]+/g,
    "_"
  );
  if (!raw) {
    return NextResponse.json({ error: "缺少参数 u" }, { status: 400 });
  }

  // 同源相对路径(如本地存储的 /media/...):相对 app 自己 origin 解析并放行。
  // 排除 //host(协议相对 = 外站)防 SSRF;其余外站走 allowed() 白名单。
  //
  // ⚠️ **必须回环到 127.0.0.1,不能用 reqUrl.origin**(2026-08-17 线上事故):
  // 反代后 Next 拿到的 request.url 带**内部监听端口**(如 https://站点域名:3000),
  // 而那个端口只在容器内监听、公网并不开放 → 容器 fetch 自己的公网地址必然
  // UND_ERR_CONNECT_TIMEOUT,导出一律 502「fetch failed」。
  // 只在**本地存储的实例**(云端租户/自托管)暴露——主站图在 R2 走绝对地址,
  // 压根进不到这个分支,所以主站永远测不出来。回环还省掉一次绕公网的往返。
  const sameOrigin = raw.startsWith("/") && !raw.startsWith("//");
  const selfOrigin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  let target: URL;
  try {
    target = sameOrigin ? new URL(raw, selfOrigin) : new URL(raw);
  } catch {
    return NextResponse.json({ error: "URL 非法" }, { status: 400 });
  }
  if (!sameOrigin && !allowed(target)) {
    return NextResponse.json({ error: "不允许的来源" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `源站返回 ${upstream.status}` },
        { status: 502 }
      );
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "image/png",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "下载失败" },
      { status: 502 }
    );
  }
}
