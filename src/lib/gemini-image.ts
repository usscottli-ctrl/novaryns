import "server-only";
import { proxyHeaders } from "@/lib/proxy-identity";
import { withProxyRetry } from "@/lib/proxy-retry";

// ---------------------------------------------------------------------------
// Google Gemini 生图(俗称 "Nano Banana")。
//
// 走 REST 的 generateContent 接口,不引 @google/genai SDK —— 少一个依赖、
// 部署两站不用再 npm install(客户催得紧,能不加依赖就不加)。
//
// 与 OpenAI 的三点关键差异(踩过就知道):
//  ① 出图不是 images/generations,而是把图当作 **多模态回复的一部分** 返回:
//     candidates[].content.parts[].inlineData.data 里才是 base64 图。
//  ② 尺寸不是 "1024x1536" 这种字符串,而是 imageConfig.aspectRatio("3:4")
//     + imageConfig.imageSize("1K"/"2K"/"4K")。
//  ③ 图生图 = 把参考图作为 inlineData 一并放进 parts,没有单独的 edit 接口。
// ---------------------------------------------------------------------------

// ⚠️ **国内服务器直连 Google 不通**(实测阿里云杭州 curl generativelanguage
// .googleapis.com = HTTP 000,被墙)。国内站必须经我们美国机的 relay 出海:
// 在 .env.local 配 GEMINI_BASE_URL=https://relay.novaryns.com/_gemini/v1beta。
// 海外站不配这个变量,直连官方。
const BASE = (
  process.env.GEMINI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/$/, "");

export function geminiEnabled(): boolean {
  return (process.env.GEMINI_API_KEY || "").length > 0;
}

/** Gemini 只认这几档比例;把任意 "w:h" 归一到最接近的一档。 */
function nearestAspect(ratio: string): string {
  const supported: [string, number][] = [
    ["1:1", 1],
    ["2:3", 2 / 3],
    ["3:2", 1.5],
    ["3:4", 0.75],
    ["4:3", 4 / 3],
    ["4:5", 0.8],
    ["5:4", 1.25],
    ["9:16", 0.5625],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
  ];
  if (ratio === "auto") return "1:1";
  const [rw, rh] = ratio.split(":").map(Number);
  const k = rw > 0 && rh > 0 ? rw / rh : 1;
  let best = supported[0];
  for (const s of supported) {
    if (Math.abs(s[1] - k) < Math.abs(best[1] - k)) best = s;
  }
  return best[0];
}

/** 站内分辨率档 → Gemini 的 imageSize。 */
function imageSize(resolution: string): "1K" | "2K" | "4K" {
  if (resolution === "4K") return "4K";
  if (resolution === "2K") return "2K";
  return "1K";
}

export type GeminiGenParams = {
  prompt: string;
  ratio: string;
  resolution: string;
  model: string;
  /** 参考图(图生图):原始字节 + MIME。 */
  images: { buf: Buffer; type: string }[];
};

/**
 * 生成一张图。
 * 返回 `{ b64 }`(图片字节)或 `{ url }`(已由境外机传好 R2 的地址)—— 二选一。
 *
 * **国内站走 GEMINI_PROXY_URL(境外代跑)**:让美国机调 Gemini + 传 R2,只回 URL。
 * 直连 Google 在国内不通;经 relay 透传字节又太慢(157ms RTT + 25% 丢包,
 * 1K 图 24s→72s、4K 十几分钟没结果)。图片不跨境才是根治。
 */
export async function geminiGenerateSmart(
  p: GeminiGenParams
): Promise<{ b64?: string; url?: string; tokens?: number }> {
  const proxy = (process.env.GEMINI_PROXY_URL || "").trim();
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  if (proxy && secret) {
    // 跨境链路会偶发 ECONNRESET,连接层错误自动重试(见 lib/proxy-retry)。
    return await withProxyRetry("gemini", async () => {
    const r = await fetch(proxy.replace(/\/$/, ""), {
      method: "POST",
      // 云端租户会自动带上 x-relay-token,美国机据此扣它自己的算力配额。
      headers: proxyHeaders(),
      body: JSON.stringify({
        prompt: p.prompt,
        ratio: p.ratio,
        resolution: p.resolution,
        model: p.model,
        images: p.images.map((im) => ({
          b64: im.buf.toString("base64"),
          type: im.type,
        })),
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as {
      url?: string;
      b64?: string;
      tokens?: number;
      error?: string;
    };
    if (!r.ok) throw new Error(j.error || `境外生图服务 ${r.status}`);
    if (!j.url && !j.b64) throw new Error("境外生图服务未返回图片");
    return { url: j.url, b64: j.b64, tokens: j.tokens };
    });
  }
  return await geminiGenerate(p);
}

/** 本实例能否出香蕉图 = 直连 Key,或配了境外代跑通道。
 *  /api/config 与生图路由共用它,避免两处判断写法不一致跑偏。 */
export function geminiConfigured(): boolean {
  return (
    (process.env.GEMINI_API_KEY ?? "").length > 0 ||
    ((process.env.GEMINI_PROXY_URL ?? "").length > 0 &&
      (process.env.INTERNAL_API_SECRET ?? "").length > 0)
  );
}

/**
 * 生成一张图,返回 PNG/JPEG 的 base64(不带 data: 前缀)。
 * 失败抛错,调用方负责退积分。
 */
// 返回值带 tokens:**成本核算的唯一可靠依据**。Gemini 把它放在 usageMetadata
// .candidatesTokenCount(输出 token,不含提示词那 20 个)。实测 1K/2K/4K =
// 1532/2107/2906,**各档并不同价**,所以必须逐张记,别再按倍率外推(见记忆里的教训)。
export async function geminiGenerate(
  p: GeminiGenParams
): Promise<{ b64: string; tokens: number }> {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) throw new Error("Nano Banana 未配置");

  const parts: Record<string, unknown>[] = [{ text: p.prompt }];
  for (const im of p.images) {
    parts.push({
      inlineData: {
        mimeType: im.type || "image/png",
        data: im.buf.toString("base64"),
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: nearestAspect(p.ratio),
        imageSize: imageSize(p.resolution),
      },
    },
  };

  const r = await fetch(
    `${BASE}/models/${encodeURIComponent(p.model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  const j = (await r.json().catch(() => ({}))) as {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string } }[] };
      finishReason?: string;
    }[];
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { candidatesTokenCount?: number; totalTokenCount?: number };
  };
  if (!r.ok) {
    throw new Error(j.error?.message || `Gemini ${r.status}`);
  }
  if (j.promptFeedback?.blockReason) {
    throw new Error(`内容未通过安全审核(${j.promptFeedback.blockReason})`);
  }
  const b64 = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)
    ?.inlineData?.data;
  if (!b64) {
    const reason = j.candidates?.[0]?.finishReason;
    throw new Error(reason ? `未返回图片(${reason})` : "未返回图片");
  }
  return { b64, tokens: j.usageMetadata?.candidatesTokenCount ?? 0 };
}
