import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin download proxy: streams a whitelisted image back with
// Content-Disposition: attachment so the browser saves it (cross-origin R2
// URLs otherwise just open in a new tab). Host-whitelisted to avoid an open
// proxy / SSRF.
function allowed(u: URL): boolean {
  const r2 = (process.env.R2_PUBLIC_BASE_URL ?? "").trim();
  if (r2) {
    try {
      if (u.host === new URL(r2).host) return true;
    } catch {
      /* ignore bad env */
    }
  }
  return (
    u.protocol === "https:" &&
    (u.host === "images.unsplash.com" || u.host.endsWith(".r2.dev"))
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
  const sameOrigin = raw.startsWith("/") && !raw.startsWith("//");
  let target: URL;
  try {
    target = sameOrigin ? new URL(raw, reqUrl.origin) : new URL(raw);
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
