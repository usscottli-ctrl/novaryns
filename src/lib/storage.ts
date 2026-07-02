import "server-only";
import { AwsClient } from "aws4fetch";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// 图片对象存储。两种后端,按环境自动选择(也可用 STORAGE_DRIVER 显式指定):
//
//  - "r2"   : Cloudflare R2(S3 兼容)。需 R2_* 环境变量齐全。用于云端部署。
//  - "local": 本地磁盘。零配置即可用 —— 自托管/开源版没配任何云存储时的默认,
//             写入 MEDIA_DIR(默认 ./data/media,Docker 里挂 /data/media),
//             返回相对 URL /media/<key>,由 app 的 /media/[...path] 路由对外伺服。
//
// 自动选择规则:R2_* 配齐 → "r2"(保持现有云端部署行为完全不变);否则 → "local"。
// 上传失败或存储被禁用时,调用方保留原始 URL(data URL / 原图),不阻断主流程。
// ---------------------------------------------------------------------------

const accountId = process.env.R2_ACCOUNT_ID ?? "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
const bucket = process.env.R2_BUCKET ?? "";
const publicBase = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const hasR2 = Boolean(
  accountId && accessKeyId && secretAccessKey && bucket && publicBase
);

const envDriver = (process.env.STORAGE_DRIVER ?? "").toLowerCase();
export const storageDriver: "local" | "r2" =
  envDriver === "r2" || envDriver === "local"
    ? (envDriver as "local" | "r2")
    : hasR2
      ? "r2"
      : "local";

// 本地盘:文件根目录 + 对外相对 URL 前缀。相对 URL 渲染时相对 app 自己 origin,
// cdnUrl() 只改写 *.r2.dev、不碰相对路径,所以无需额外配置就能显示。
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "./data/media");
const MEDIA_URL_PREFIX = "/media";

// 本地盘始终可用;R2 需配齐才算可用(否则调用方退回 data URL,不持久化)。
export const storageEnabled = storageDriver === "local" ? true : hasR2;

let client: AwsClient | null = null;

function getClient(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }
  return client;
}

// 我们的对象 key 都带时间戳/uuid/哈希、永不覆盖,可放心长缓存 + immutable。
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** 规整并校验存储 key(去掉前导 /,拒绝 .. 与空字节,防目录穿越)。 */
function safeKey(key: string): string {
  const k = key.replace(/^\/+/, "");
  if (!k || k.includes("..") || k.includes("\0")) {
    throw new Error("非法存储 key");
  }
  return k;
}

/** 上传字节,返回可访问 URL(R2 为绝对 URL,本地为相对 /media/<key>)。失败抛错。 */
export async function uploadImage(
  bytes: Uint8Array,
  contentType: string,
  key: string,
  cacheControl: string = CACHE_CONTROL
): Promise<string> {
  const k = safeKey(key);

  if (storageDriver === "local") {
    const full = path.join(MEDIA_DIR, k);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(bytes));
    return `${MEDIA_URL_PREFIX}/${k}`;
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${k}`;
  // R2's PutObject requires an explicit Content-Length; Node fetch doesn't
  // always set it for typed-array bodies, which yields "411 Length Required".
  const body = Buffer.from(bytes);
  const res = await getClient().fetch(endpoint, {
    method: "PUT",
    body,
    headers: {
      "content-type": contentType,
      "content-length": String(body.byteLength),
      "cache-control": cacheControl,
    },
  });
  if (!res.ok) {
    throw new Error(`R2 上传失败：${res.status} ${res.statusText}`);
  }
  return `${publicBase}/${k}`;
}

/** Best-effort delete by public URL. No-op if the URL isn't one of ours (e.g. a
 *  third-party image). Never throws; treats a missing object as success. */
export async function deleteImageByUrl(url: string): Promise<boolean> {
  if (!url) return false;

  if (storageDriver === "local") {
    if (!url.startsWith(MEDIA_URL_PREFIX + "/")) return false;
    try {
      const k = safeKey(url.slice(MEDIA_URL_PREFIX.length + 1));
      await unlink(path.join(MEDIA_DIR, k));
      return true;
    } catch {
      return false; // 文件不存在等,视作无需删除
    }
  }

  if (!hasR2 || !url.startsWith(publicBase + "/")) return false;
  const key = url.slice(publicBase.length + 1);
  if (!key) return false;
  try {
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    const res = await getClient().fetch(endpoint, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Converts a `data:` URL into bytes, or returns null if not a data URL. */
export function dataUrlToBytes(
  url: string
): { bytes: Uint8Array; contentType: string } | null {
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  return {
    contentType: m[1],
    bytes: new Uint8Array(Buffer.from(m[2], "base64")),
  };
}
