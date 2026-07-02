import JSZip from "jszip";

export const runtime = "nodejs";
export const maxDuration = 120;

// 服务端打包套图为 ZIP:前端传图片 URL 列表,服务器逐张拉取(server→R2,无跨域)
// 后压成 zip 流回客户端。避免浏览器 fetch 跨域 R2 的 CORS 问题。
type Item = { url: string; name: string };

function safeName(s: string, i: number): string {
  const cleaned = (s || `image-${i + 1}`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return cleaned || `image-${i + 1}`;
}

export async function POST(request: Request) {
  let items: Item[] = [];
  try {
    const body = (await request.json()) as { items?: Item[] };
    items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  } catch {
    return new Response(JSON.stringify({ error: "请求格式不正确" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "没有可下载的图片" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const zip = new JSZip();
  let ok = 0;
  await Promise.all(
    items.map(async (it, i) => {
      try {
        // 只允许我们自己的 R2 / CDN 域,防 SSRF
        const u = new URL(it.url);
        const allowed =
          u.hostname.endsWith(".r2.dev") ||
          u.hostname.endsWith("starzeco.com") ||
          u.hostname.endsWith("novaryns.com");
        if (!allowed) return;
        const res = await fetch(it.url, { cache: "no-store" });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (it.url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "png").toLowerCase();
        zip.file(`${String(i + 1).padStart(2, "0")}-${safeName(it.name, i)}.${ext}`, buf);
        ok++;
      } catch {
        /* 单张失败跳过 */
      }
    })
  );

  if (ok === 0) {
    return new Response(JSON.stringify({ error: "图片拉取失败" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const blob = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(blob, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="suite-${Date.now()}.zip"`,
      "content-length": String(blob.length),
    },
  });
}
