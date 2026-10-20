// 批量打包下载(浏览器端)。
//
// 优先在浏览器里直接从图片 CDN 取图、本地打 zip:下载流量走 CDN(流量包 ~¥0.1/GB),
// 不再经服务器公网(¥0.8/GB),也不占服务器内存拼大 zip(2026-10-21 客户站按百万张核算成本后改)。
// 前提是图片域名对本站开了跨域(客户站 CDN 已加 Access-Control-Allow-Origin);
// 不通(没开跨域/相对地址/网络中断)就整批退回原来的服务端打包 /api/suite/download。
import { cdnUrl } from "@/lib/cdn";

export type ZipItem = { url: string; name: string };

// 跨域不通的图片域名,本次会话内不再尝试(避免每次都先白下一张图再被浏览器拦下)
const corsBlocked = new Set<string>();

function safeName(s: string, i: number): string {
  const cleaned = (s || `image-${i + 1}`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return cleaned || `image-${i + 1}`;
}

/** 浏览器直接取图(走 CDN)。跨域不通或失败返回 null,调用方退回服务端代理。 */
export async function fetchImageDirect(url: string): Promise<Blob | null> {
  const src = cdnUrl(url);
  let host: string;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.origin === window.location.origin) return null; // 同源的走服务端代理即可
    host = u.host;
  } catch {
    return null; // 相对地址(本地存储)
  }
  if (corsBlocked.has(host)) return null;
  try {
    const res = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    corsBlocked.add(host); // 跨域被拦(或网络断)→ 本次会话这个域名都走服务端
    return null;
  }
}

async function zipInBrowser(items: ZipItem[]): Promise<Blob | null> {
  // 先试第一张:跨域不通就别把整批都白下一遍
  const first = await fetchImageDirect(items[0].url);
  if (!first) return null;
  const rest = await Promise.all(items.slice(1).map((it) => fetchImageDirect(it.url)));
  const blobs = [first, ...rest];
  if (blobs.some((b) => !b)) return null; // 有张取不到 → 整批交给服务端,保证不缺图
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  items.forEach((it, i) => {
    const ext = (it.url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "png").toLowerCase();
    zip.file(`${String(i + 1).padStart(2, "0")}-${safeName(it.name, i)}.${ext}`, blobs[i]!);
  });
  // PNG/JPG 本身已压缩,再压只费时间
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

async function zipOnServer(items: ZipItem[]): Promise<Blob> {
  const res = await fetch("/api/suite/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("zip failed");
  return res.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 打包下载:浏览器直取 CDN 打包 → 不行退回服务端打包。两条都失败抛错(调用方再逐张兜底)。 */
export async function downloadZip(items: ZipItem[], filename: string): Promise<void> {
  if (!items.length) return;
  const list = items.slice(0, 30); // 与服务端上限一致
  let blob: Blob | null = null;
  try {
    blob = await zipInBrowser(list);
  } catch {
    blob = null;
  }
  if (!blob) blob = await zipOnServer(list);
  saveBlob(blob, filename);
}
