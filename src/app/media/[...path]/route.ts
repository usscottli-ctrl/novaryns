import { readFile } from "fs/promises";
import path from "path";
import { MEDIA_DIR } from "@/lib/storage";

// 本地磁盘存储的图片对外伺服(STORAGE_DRIVER=local 时用)。
// R2/OSS 部署下图片走绝对 CDN URL,不会打到这里 —— 此路由留着无害。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export async function GET(
  _req: Request,
  { params }: { params: { path: string[] } }
) {
  const segs = params.path || [];
  // 防目录穿越:段内不允许 .. / 空字节 / 分隔符
  if (
    !segs.length ||
    segs.some(
      (s) => s === ".." || s.includes("\0") || s.includes("/") || s.includes("\\")
    )
  ) {
    return new Response("Bad request", { status: 400 });
  }

  const rel = segs.join("/");
  const base = path.resolve(MEDIA_DIR);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buf = await readFile(full);
    const ext = (rel.split(".").pop() || "").toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": TYPES[ext] || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
