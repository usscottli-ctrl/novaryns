// FLUX.2 [pro] 生图(经 Replicate)。
//
// 为什么走 Replicate 而不是 BFL 官方(2026-08-18 逐档核价):
//   两家计价结构不同 —— Replicate = $0.015/次 + $0.015/输入兆像素 + $0.015/输出兆像素;
//   BFL 官方 = $0.03/输出兆像素(文生图)、$0.045(改图),**每兆像素是 Replicate 的 2~3 倍**。
//   1K 两家打平(¥0.218 vs ¥0.224),2K 便宜 38%,4K 便宜 44%,图生图 4K 便宜 58%。
//   而且 Replicate 我们**已有 token**(抠图/放大在用),不必为此再开一个户。
//
// 成本参考(¥,汇率 7.1):1K ¥0.218 · 2K ¥0.553 · 4K ¥0.989 —— 1K/2K 是三个模型里最便宜的,
// 4K 让给 GPT(¥0.726)。按现行 6/12/23 积分收费,三档毛利 +51%/+19%/+28%。
import { resolutionLongSide } from "@/lib/mock-data";
import { proxyHeaders } from "@/lib/proxy-identity";

const MODEL = process.env.FLUX_MODEL || "black-forest-labs/flux-2-pro";

export type FluxGenParams = {
  prompt: string;
  ratio: string;
  resolution: string;
  /** 参考图(图生图)。FLUX.2 pro 官方支持最多 8 张。 */
  images: { buf: Buffer; type: string }[];
};

/** 本实例能否用 FLUX = 有 Replicate token,或配了境外代跑通道。 */
export function fluxConfigured(): boolean {
  return (
    (process.env.REPLICATE_API_TOKEN ?? "").length > 0 ||
    ((process.env.FLUX_PROXY_URL ?? "").length > 0 &&
      (process.env.INTERNAL_API_SECRET ?? "").length > 0)
  );
}

// Replicate 的模型版本会变,按模型名解析一次后缓存(与 upscale 路由同做法)。
const VERSION_CACHE = new Map<string, string>();
async function resolveVersion(model: string, token: string): Promise<string> {
  const cached = VERSION_CACHE.get(model);
  if (cached) return cached;
  const r = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Replicate 模型查询失败 ${r.status}`);
  const j = (await r.json()) as { latest_version?: { id?: string } };
  const v = j.latest_version?.id;
  if (!v) throw new Error("Replicate 模型无可用版本");
  VERSION_CACHE.set(model, v);
  return v;
}

/** 分辨率档 → FLUX 的 `resolution` 枚举值。
 *
 * ⚠️ **两边的"分辨率"不是一个概念,直接对等会出小图**(2026-08-25 线上事故):
 *   · 我们的档位按**长边**定义:2K = 长边 2048;
 *   · FLUX 的 `resolution` 是**总像素**:"2 MP" = 总共 200 万像素。
 * 曾经写成 `long >= 2048 ? "2 MP" : "1 MP"`,结果 3:4 的 2K 只出到
 * **1232×1648(2.03MP,长边 1648)** —— 用户按 2K 付了 12 积分,拿到的比 2K 小一圈。
 *
 * 正确做法:按比例反推该长边需要的**总像素**,再向上取到 FLUX 的档。
 * 实测各比例所需(长边 2048):1:1 4.19MP · 3:4 3.15MP · 16:9 2.36MP
 * —— **全都超过 2 MP,所以 2K 档一律要给 "4 MP"**。
 * 可选枚举只有 0.5 / 1 / 2 / 4 MP,且最大边长 2048(见 schema)。 */
function fluxResolution(resolution: string, ratio: string): string {
  const long = resolutionLongSide(resolution) || 1024; // 1K 档 longSide=0
  const [rw, rh] = (ratio && ratio !== "auto" ? ratio : "1:1")
    .split(":")
    .map(Number);
  const k = rw > 0 && rh > 0 ? rw / rh : 1;
  const w = k >= 1 ? long : long * k;
  const h = k >= 1 ? long / k : long;
  const mp = (w * h) / 1_000_000;
  if (mp > 2) return "4 MP";
  if (mp > 1) return "2 MP";
  return "1 MP";
}

/** 直连 Replicate 出图,返回图片 URL(Replicate 自带 CDN 地址)。 */
export async function fluxGenerate(p: FluxGenParams): Promise<string> {
  const token = (process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) throw new Error("FLUX 未配置");
  const version = await resolveVersion(MODEL, token);

  // ⚠️ 参数名**必须与 Replicate schema 完全一致**。Replicate 对不认识的字段**静默忽略**,
  // 不报错 —— 2026-08-18 就因为把 input_images 写成 image_prompt、resolution 写成
  // megapixels,导致参考图被整个丢掉:用户传了模特+服装两张图,模型却当纯文生图跑,
  // 出来一件完全无关的衣服,而且没有任何报错。改这里前先拉一次 versions API 核对字段。
  const input: Record<string, unknown> = {
    prompt: p.prompt,
    resolution: fluxResolution(p.resolution, p.ratio),
    output_format: "png",
    // 安全阈值 1(最严)~5(最宽),官方默认 2。**服装电商必须放宽一档**:
    // 大量涉及模特、泳装、内衣、贴身衣物,默认档容易误判成违规直接拒绝出图。
    // 固定在服务端、**不暴露给前台用户** —— 这是合规相关开关,交给终端用户调
    // 等于把责任推给他们,而真出事是我们的账号被封。
    safety_tolerance: 3,
  };
  // aspect_ratio 只接受固定枚举;传了图就用 match_input_image 跟随首图比例。
  const RATIOS = ["1:1", "16:9", "3:2", "2:3", "4:5", "5:4", "9:16", "3:4", "4:3"];
  if (p.images.length > 0 && (!p.ratio || p.ratio === "auto")) {
    input.aspect_ratio = "match_input_image";
  } else if (RATIOS.includes(p.ratio)) {
    input.aspect_ratio = p.ratio;
  }
  // 图生图:官方上限 8 张,接受 data: URI。
  if (p.images.length > 0) {
    input.input_images = p.images
      .slice(0, 8)
      .map((im) => `data:${im.type};base64,${im.buf.toString("base64")}`);
  }

  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // 让 Replicate 直接同步返回结果(最长等 60s),省掉一轮轮询。
      Prefer: "wait=60",
    },
    body: JSON.stringify({ version, input }),
    cache: "no-store",
  });
  const j = (await create.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    output?: string | string[];
    error?: string;
    detail?: string;
  };
  if (!create.ok) throw new Error(j.detail || j.error || `FLUX ${create.status}`);

  let out = j.output;
  let status = j.status;
  // Prefer:wait 超时后仍是 processing → 轮询到出结果(4K 可能要 1~2 分钟)。
  if (status !== "succeeded" && j.id) {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const g = await fetch(`https://api.replicate.com/v1/predictions/${j.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const gj = (await g.json().catch(() => ({}))) as typeof j;
      status = gj.status;
      out = gj.output;
      if (status === "succeeded") break;
      if (status === "failed" || status === "canceled") {
        throw new Error(gj.error || "FLUX 生成失败");
      }
    }
  }
  const url = Array.isArray(out) ? out[0] : out;
  if (!url) throw new Error("FLUX 未返回图片");
  return url;
}

/**
 * 生成一张图,返回 `{ url }`。
 * **国内站走 FLUX_PROXY_URL(境外代跑)** —— 阿里云杭州**连不上 api.replicate.com**
 * (2026-08-18 实测 20 秒超时、HTTP 000),直连必挂;让美国机调用 + 传 R2,只回 URL。
 */
/** 连接层错误(不是业务错误)才值得重试 —— 这类错误通常意味着请求没送达。 */
function isTransient(e: unknown): boolean {
  const m = String((e as Error)?.message || e);
  const code = String((e as { cause?: { code?: string } })?.cause?.code || "");
  return (
    /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network/i.test(m) ||
    /ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code)
  );
}

/**
 * 生成一张图,返回 `{ url }`。
 * **国内站走 FLUX_PROXY_URL(境外代跑)** —— 阿里云杭州**连不上 api.replicate.com**
 * (2026-08-18 实测 20 秒超时、HTTP 000),直连必挂;让美国机调用 + 传 R2,只回 URL。
 *
 * ⚠️ **必须重试**:这条跨境链路本身不稳(实测偶发 ECONNRESET,客户连着失败两次)。
 * 只对**连接层错误**重试 —— 业务错误(参数错、内容被拒)重试没意义还多花钱。
 * 上游若已扣费而连接被重置,重试会重复计费一次(约 ¥0.2),但比让客户看到失败划算。
 */
export async function fluxGenerateSmart(
  p: FluxGenParams
): Promise<{ url: string }> {
  const proxy = (process.env.FLUX_PROXY_URL || "").trim();
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  if (proxy && secret) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(proxy.replace(/\/$/, ""), {
          method: "POST",
          headers: proxyHeaders(), // 含 x-relay-token(云端租户的配额身份)
          body: JSON.stringify({
            prompt: p.prompt,
            ratio: p.ratio,
            resolution: p.resolution,
            images: p.images.map((im) => ({
              b64: im.buf.toString("base64"),
              type: im.type,
            })),
          }),
          cache: "no-store",
        });
        const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!r.ok) throw new Error(j.error || `境外生图服务 ${r.status}`);
        if (!j.url) throw new Error("境外生图服务未返回图片");
        return { url: j.url };
      } catch (e) {
        lastErr = e;
        if (attempt === 3 || !isTransient(e)) throw e;
        console.warn(
          `[flux] 第 ${attempt} 次连接失败(${String((e as Error)?.message || e).slice(0, 60)}),重试`
        );
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    throw lastErr;
  }
  return { url: await fluxGenerate(p) };
}
