import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile, rename } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { MEDIA_DIR } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 模板图片同源代理 + 本地磁盘缓存(自托管实例用)。
// 同步官方模板库后,图片地址为 /api/tpl-image?u=<R2地址>:
//   · 浏览器只访问本站(避开大陆浏览器对 *.r2.dev 的 SNI 阻断);
//   · 服务器第一次跨境取回后**落盘缓存**(MEDIA_DIR/tpl-cache,Docker 数据卷持久),
//     之后所有访客直接本地读,速度与本站静态图无异——热门图自动"镜像到本地"。
// 仅放行 *.r2.dev,防开放代理;浏览器侧再强缓存 30 天。
const CACHE_DIR = path.join(MEDIA_DIR, "tpl-cache");

const TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function cachePathFor(u: string): { file: string; type: string } {
  const ext = (path.extname(new URL(u).pathname) || ".jpg").toLowerCase();
  const safeExt = TYPE_BY_EXT[ext] ? ext : ".jpg";
  const name = crypto.createHash("sha1").update(u).digest("hex") + safeExt;
  return { file: path.join(CACHE_DIR, name), type: TYPE_BY_EXT[safeExt] };
}

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

  const { file, type } = cachePathFor(target.toString());
  const headers = {
    "Content-Type": type,
    // 模板图内容不变:浏览器强缓存 30 天
    "Cache-Control": "public, max-age=2592000, immutable",
  };

  // 1) 本地缓存命中 → 直接回(绝大多数请求走这里,本地磁盘速度)
  try {
    const buf = await readFile(file);
    return new NextResponse(new Uint8Array(buf), { headers });
  } catch {
    /* 未缓存 → 回源 */
  }

  // 2) 回源 R2(仅每张图全站第一次),落盘后返回
  try {
    const upstream = await fetch(target.toString(), {
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `源站返回 ${upstream.status}` },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    // 落盘:先写临时名再原子重命名,防并发读到半截文件;失败不影响本次返回
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, file);
    } catch {
      /* 缓存写失败仅影响下次速度 */
    }
    return new NextResponse(new Uint8Array(buf), { headers });
  } catch {
    return NextResponse.json({ error: "取图超时" }, { status: 502 });
  }
}
