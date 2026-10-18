import "server-only";

// ---------------------------------------------------------------------------
// 把模型返回的图片「拿到手」—— 兼容两种返回形式,并可经代取通道加速。
//
// 为什么需要(2026-10-19,首个大陆商业版客户实测):
//   OpenAI 官方返回 `b64_json`(整图随响应回来);但不少第三方中转返回的是
//   **图片链接 `url`**。旧代码只认 b64:
//     · 各工具页(套图/局改/印花提取…)直接报「未返回结果图」;
//     · 生图页把中转的链接原样落库 —— 用户每次看图都要现从中转的海外机器拉,
//       而且这类链接通常会过期,作品库里的图会慢慢打不开。
//   现在统一:拿到链接就下载下来,交给调用方存进本站自己的存储。
//
// 代取加速 `IMAGE_FETCH_PROXY`(可选):
//   实测某中转的图片服务器在美国普通 VPS,大陆下载 4K 图(8.7MB)要 10 分钟。
//   配一个代取地址(如 Cloudflare Worker:`https://xxx/?t=<token>`),本模块会
//   请求 `<代取地址>&u=<图片URL>`,让图走 Cloudflare 的线路回大陆。
//   代取失败自动退回直连,不会因为它挂了就出不了图。不配 = 直连,行为同旧版。
// ---------------------------------------------------------------------------

const PROXY = (process.env.IMAGE_FETCH_PROXY || "").trim();

/** 是不是本站自己的存储地址(这类不需要再下载转存)。 */
export function isOwnStorageUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return true; // 相对路径 /media/... 、data: 都算自己的
  try {
    const host = new URL(url).host;
    const own = [process.env.R2_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_IMAGE_BASE_URL]
      .map((u) => {
        try {
          return u ? new URL(u).host : "";
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return own.includes(host) || host.endsWith(".r2.dev") || host === "img.novaryns.com";
  } catch {
    return false;
  }
}

async function fetchBytes(u: string, timeoutMs: number): Promise<Buffer> {
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`取图失败 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** 下载一张远程图片。配了代取地址先走代取,失败再直连。 */
export async function fetchRemoteImage(url: string, timeoutMs = 900_000): Promise<Buffer> {
  if (PROXY) {
    const sep = PROXY.includes("?") ? "&" : "?";
    try {
      return await fetchBytes(`${PROXY}${sep}u=${encodeURIComponent(url)}`, timeoutMs);
    } catch (e) {
      console.warn("[remote-image] 代取失败,改直连:", e instanceof Error ? e.message : e);
    }
  }
  return fetchBytes(url, timeoutMs);
}

/**
 * 模型返回的一项图片 → base64。b64_json 直接用;只有 url 就下载下来。
 * 两者都没有返回 undefined,由调用方报「未返回结果图」。
 */
export async function resultToB64(
  d: { b64_json?: string | null; url?: string | null } | undefined
): Promise<string | undefined> {
  if (!d) return undefined;
  if (d.b64_json) return d.b64_json;
  if (d.url) return (await fetchRemoteImage(d.url)).toString("base64");
  return undefined;
}
