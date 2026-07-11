import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 模板图片同源代理(自托管实例用):同步官方模板库后,图片地址被改写为
// /api/tpl-image?u=<R2地址> —— 浏览器只访问本站(避开大陆浏览器对 *.r2.dev
// 的 SNI 阻断),由服务器端去 R2 取图(服务器直连 R2 是通的;R2 出流量免费)。
// 仅放行 *.r2.dev,防开放代理;强缓存(模板图内容不变)。
export async function GET(request: Request) {
  const u = new URL(request.url).searchParams.get("u") || "";
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return NextResponse.json({ error: "URL 非法" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !target.host.endsWith(".r2.dev")) {
    return NextResponse.json({ error: "不允许的来源" }, { status: 403 });
  }
  try {
    const upstream = await fetch(target.toString(), {
      signal: AbortSignal.timeout(20_000),
      // 模板图不变,允许 Next 侧复用连接;浏览器端靠下方响应头强缓存
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `源站返回 ${upstream.status}` },
        { status: 502 }
      );
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        // 模板图内容不变:浏览器强缓存 30 天,翻页/回访不再回源
        "Cache-Control": "public, max-age=2592000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "取图超时" }, { status: 502 });
  }
}
