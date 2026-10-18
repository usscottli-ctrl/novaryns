import "server-only";
import OpenAI, { toFile } from "openai";
import { storageEnabled, uploadImage, deleteImageByUrl } from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { getOpenAIBaseUrl } from "@/lib/openai-base";
import { proxyHeaders } from "@/lib/proxy-identity";

// ---------------------------------------------------------------------------
// 生图统一入口 —— 各工具路由(套图/去皱/服装提取/…)都走这里,别再各自 new OpenAI。
//
// 两种模式,由 env 自动决定,路由无感:
//   · **本地模式**(海外站 / 自部署):直接调 OpenAI,拿 b64 → 传 R2 → 返回 url。
//   · **境外代跑**(国内站,配了 OPENAI_PROXY_URL):把请求发给美国机,由它调 OpenAI
//     并**按调用方指定的 key 直接传 R2**,只回 URL。
//
// 为什么要代跑(2026-08-15 实测):国内站经 relay.novaryns.com(Hetzner)调 OpenAI 时,
// 图片 base64 要整个跨境回传,而那条链路 157ms + **25% 丢包** —— 4K 图传一小时都回不来。
// 改代跑后同一请求 45.3s(国内) vs 45.3s(美国本地),**跨境开销归零**。
//
// ⚠️ key 由调用方给(如 `suite/xxx.png`),代跑端按同一个 key 落库 → **不会产生两份存储**,
// 调用方拿到 url 后不要再传一次。
// ---------------------------------------------------------------------------

export type EditParams = {
  /** 提示词。 */
  prompt: string;
  /** 参考图(至少一张走 edit;空数组走 generate 文生图)。 */
  images: { buf: Buffer; type?: string }[];
  model: string;
  size: string;
  quality?: "low" | "medium" | "high" | "auto";
  /** 透明底(仅 gpt-image-1 支持)。 */
  transparent?: boolean;
  /** 局部重绘蒙版(inpaint 用)。 */
  mask?: Buffer;
};

/**
 * 出一张图,返回**字节**(给还要自己后处理/自己落库的工具路由用)。
 *
 * 国内站会走境外代跑:美国机出图 → 传 R2 临时对象 → 本地**从 R2 下载**(实测
 * 3.58MB/s,一张 1K 图约 0.3 秒)→ 删掉临时对象。
 * 比原来「base64 经 Hetzner 回传」快很多(那条链路 25% 丢包,1K 图要多花约 30 秒)。
 *
 * 想省掉这次下载+删除的,用 `generateToR2()` 直接拿最终 URL(需要调用方能接受 URL)。
 */
export async function generateBuffer(p: EditParams): Promise<Buffer> {
  if (proxyEnabled()) {
    const tmpKey = `tmp/gen-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
    const url = await generateToR2(p, tmpKey);
    if (url.startsWith("data:")) {
      return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`取回结果图失败 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // 临时对象用完即删,别在桶里堆垃圾(R2 免费额度有限)。
    void deleteImageByUrl(url).catch(() => {});
    return buf;
  }
  // 本地模式:直接调 OpenAI 拿字节,不绕 R2
  return Buffer.from(await rawGenerate(p), "base64");
}

export function proxyEnabled(): boolean {
  return (
    (process.env.OPENAI_PROXY_URL || "").trim().length > 0 &&
    (process.env.INTERNAL_API_SECRET || "").trim().length > 0
  );
}

/**
 * 出一张图并落到 R2 的 `key`,返回可直接用的 URL。
 * 存储没配时返回 data: URL(自部署裸机场景)。失败抛错,调用方负责退积分。
 */
export async function generateToR2(p: EditParams, key: string): Promise<string> {
  // ── 境外代跑 ──
  if (proxyEnabled()) {
    const r = await fetch((process.env.OPENAI_PROXY_URL || "").trim(), {
      method: "POST",
      // 云端租户会自动带上 x-relay-token,美国机据此扣它自己的算力配额。
      headers: proxyHeaders(),
      body: JSON.stringify({
        prompt: p.prompt,
        model: p.model,
        size: p.size,
        quality: p.quality || "medium",
        n: 1,
        transparent: p.transparent,
        key, // 让美国机按这个 key 落库,避免两份
        mask: p.mask ? p.mask.toString("base64") : undefined,
        images: p.images.map((im) => ({
          b64: im.buf.toString("base64"),
          type: im.type || "image/png",
        })),
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as {
      images?: { url?: string; b64?: string }[];
      error?: string;
    };
    if (!r.ok) throw new Error(j.error || `境外生图服务 ${r.status}`);
    const first = j.images?.[0];
    if (first?.url) return first.url;
    if (first?.b64) {
      // 代跑端没配存储 → 退回字节,本地再传一次
      const buf = Buffer.from(first.b64, "base64");
      return storageEnabled
        ? await uploadImage(new Uint8Array(buf), "image/png", key)
        : `data:image/png;base64,${first.b64}`;
    }
    throw new Error("境外生图服务未返回图片");
  }

  // ── 本地模式 ──
  const b64 = await rawGenerate(p);
  const buf = Buffer.from(b64, "base64");
  return storageEnabled
    ? await uploadImage(new Uint8Array(buf), "image/png", key)
    : `data:image/png;base64,${b64}`;
}

/** 直调 OpenAI,返回 b64。generateToR2 / generateBuffer 的本地分支共用。 */
async function rawGenerate(p: EditParams): Promise<string> {
  const { apiKey } = await getOpenAISettings();
  if (!apiKey) throw new Error("生图服务未配置");
  const client = new OpenAI({
    apiKey,
    baseURL: (await getOpenAIBaseUrl()) || undefined,
    timeout: 880_000,
    maxRetries: 0,
  });

  let b64: string | undefined;
  if (p.images.length > 0) {
    const files = await Promise.all(
      p.images.map((im, i) =>
        toFile(im.buf, `ref-${i}.png`, { type: im.type || "image/png" })
      )
    );
    const base = {
      model: p.model,
      image: files,
      prompt: p.prompt,
      n: 1,
      size: p.size as never,
      quality: p.quality || "medium",
    };
    const r = await client.images.edit(
      p.mask
        ? {
            ...base,
            mask: await toFile(p.mask, "mask.png", { type: "image/png" }),
          }
        : p.transparent
          ? { ...base, background: "transparent" as const }
          : base
    );
    b64 = r.data?.[0]?.b64_json;
  } else {
    const r = await client.images.generate({
      model: p.model,
      prompt: p.prompt,
      n: 1,
      size: p.size as never,
      quality: p.quality || "medium",
    });
    b64 = r.data?.[0]?.b64_json;
  }
  if (!b64) throw new Error("未返回结果图");
  return b64;
}
