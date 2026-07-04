import { NextResponse } from "next/server";
import { TOOL_COST } from "@/lib/mock-data";
import OpenAI, { toFile } from "openai";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  addArtworks,
  getUser,
  isBanned,
  addLedgerEntry,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { resolveUserEmail } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { getCutoutSettings, getOpenAISettings } from "@/lib/settings";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 抠图(背景移除 / 透明底)专用端点。
//
// 与 /api/generate-image 的本质区别:抠图不重绘主体。主力走 Replicate BiRefNet
// (men1scus/birefnet,发丝级、像素保真),把主体原样抠出、背景置透明。
// 失败/未配 token 时兜底走 gpt-image background:transparent(会重绘、慢、烧 token)。
// (早期的自托管 rembg 微服务已于 2026-06-21 停用下线,不再回退自托管。)
//
// 同步返回(抠图很快),完成后落库为源节点的子节点,扣固定小额积分。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120; // Replicate 冷启动可能需要 1-2 分钟

// 抠图只保留「发丝级」(Replicate BiRefNet),统一 1 积分/张
// (2026-06-17 用户去掉免费极速档:画布与 AI 抠图都只发丝级、扣 1 分)。
const CUTOUT_COST = TOOL_COST.cutout;

type CutoutInput = {
  bytes: Buffer;
  type: string;
  email: string;
  parentId: string;
  title: string;
  category: string;
  ratio: string;
  resolution: string;
  // 用户在前端选的质量档:fast=极速(自托管)/ fine=发丝级(Replicate)/ ""=用后台默认
  quality: "fast" | "fine" | "";
};

async function parseInput(request: Request): Promise<CutoutInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();

  let bytes: Buffer | null = null;
  let type = "image/png";
  const file = f.get("image");
  if (file instanceof File && file.size > 0) {
    bytes = Buffer.from(await file.arrayBuffer());
    type = file.type || "image/png";
  } else {
    // 也支持传 sourceUrl(画布里对已有节点抠图,不必先下载再上传)
    const src = s("sourceUrl").trim();
    if (src) {
      const r = await fetch(src, { cache: "no-store" });
      if (r.ok) {
        bytes = Buffer.from(await r.arrayBuffer());
        type = r.headers.get("content-type") || "image/png";
      }
    }
  }
  if (!bytes) return null;

  const q = s("quality").trim();
  return {
    bytes,
    type,
    email: s("email").trim(),
    parentId: s("parentId").trim(),
    title: s("title").trim() || "抠图",
    category: s("category") || "main",
    ratio: s("ratio") || "1:1",
    resolution: s("resolution") || "1K",
    quality: q === "fine" ? "fine" : q === "fast" ? "fast" : "",
  };
}

async function loadSharp(): Promise<typeof import("sharp") | null> {
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// 解析社区模型的最新版本哈希(进程内缓存,pm2 重启即刷新)。
const REPLICATE_VERSION_CACHE = new Map<string, string>();
async function resolveReplicateVersion(
  model: string,
  token: string
): Promise<string> {
  const cached = REPLICATE_VERSION_CACHE.get(model);
  if (cached) return cached;
  const r = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Replicate 模型查询失败 ${r.status}`);
  const j = (await r.json()) as { latest_version?: { id?: string } };
  const version = j.latest_version?.id;
  if (!version) throw new Error("Replicate 模型无可用版本");
  REPLICATE_VERSION_CACHE.set(model, version);
  return version;
}

// Replicate 托管 GPU 上的 BiRefNet(顶配,发丝级,按次付费)。
// 输出可能是「透明 PNG」或「灰度 mask」——运行时探测:带 alpha 直接用;
// 否则用 sharp 把 mask 当 alpha 合成回原图,保证拿到真正的透明底图。
async function cutoutReplicate(
  bytes: Buffer,
  type: string,
  token: string,
  model: string
): Promise<Buffer> {
  const dataUri = `data:${type || "image/png"};base64,${bytes.toString(
    "base64"
  )}`;
  // men1scus/birefnet 是社区模型 → 必须用版本哈希走 /v1/predictions
  // (/v1/models/.../predictions 仅限官方模型,社区模型会 404)。
  const version = await resolveReplicateVersion(model, token);
  // Prefer:wait 尽量同步拿结果(热启动 ~8s,冷启动更久则下面轮询)。
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input: { image: dataUri } }),
  });
  let pred = (await create.json()) as {
    status?: string;
    output?: string | string[];
    error?: string;
    detail?: string;
    urls?: { get?: string };
  };
  if (!create.ok) {
    throw new Error(pred?.detail || pred?.error || `Replicate ${create.status}`);
  }
  // 没在 wait 窗口内完成 → 轮询(冷启动场景)
  const deadline = Date.now() + 110_000;
  while (
    pred.status &&
    pred.status !== "succeeded" &&
    pred.status !== "failed" &&
    pred.status !== "canceled"
  ) {
    if (Date.now() > deadline) throw new Error("Replicate 超时");
    if (!pred.urls?.get) break;
    await new Promise((r) => setTimeout(r, 2000));
    const g = await fetch(pred.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    pred = await g.json();
  }
  if (pred.status !== "succeeded") {
    throw new Error(`Replicate 失败:${pred.error || pred.status || "未知"}`);
  }
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!outUrl || typeof outUrl !== "string") {
    throw new Error("Replicate 未返回图片");
  }
  const dl = await fetch(outUrl);
  if (!dl.ok) throw new Error("下载 Replicate 结果失败");
  const outBuf = Buffer.from(await dl.arrayBuffer());

  // 探测输出类型:已是透明 PNG 直接用;否则当 mask 合成回原图。
  const sharp = await loadSharp();
  if (!sharp) return outBuf; // sharp 不可用 → 原样返回(多半已是透明图)
  try {
    const outMeta = await sharp(outBuf).metadata();
    if (outMeta.hasAlpha && (outMeta.channels ?? 0) >= 4) {
      return outBuf; // 模型已直接输出透明抠图
    }
    // mask 路径:缩放到原图尺寸 → 作为 alpha 通道合成
    const origMeta = await sharp(bytes).metadata();
    const w = origMeta.width ?? outMeta.width ?? 0;
    const h = origMeta.height ?? outMeta.height ?? 0;
    if (!w || !h) return outBuf;
    const maskRaw = await sharp(outBuf)
      .resize(w, h, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    return await sharp(bytes)
      .removeAlpha()
      .joinChannel(maskRaw, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toBuffer();
  } catch {
    return outBuf; // 任何处理异常 → 返回 Replicate 原始输出
  }
}

// 兜底:gpt-image 透明底(主要用于本地开发没有自托管服务时)。
async function cutoutOpenAI(
  bytes: Buffer,
  type: string,
  apiKey: string,
  model: string
): Promise<Buffer> {
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 120_000,
    maxRetries: 0,
  });
  // 先用 sharp 规整成干净 PNG,避免 "Invalid image file"
  let png = bytes;
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    png = await sharp(bytes).rotate().png().toBuffer();
  } catch {
    /* sharp 不可用 → 用原图 */
  }
  const fileType = png === bytes ? type || "image/png" : "image/png";
  const file = await toFile(png, "input.png", { type: fileType });
  const r = await client.images.edit({
    // 透明底兜底:只 gpt-image-1 支持 background:transparent(主路径是第三方 BiRefNet)。
    model: model || "gpt-image-1",
    image: file,
    prompt: "精确沿主体边缘抠出主体,移除背景,输出干净的透明底 PNG",
    n: 1,
    size: "auto" as "1024x1024",
    background: "transparent" as const,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("抠图未返回结果");
  return Buffer.from(b64, "base64");
}

export async function POST(request: Request) {
  let input: CutoutInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json({ error: "缺少待抠图的图片" }, { status: 400 });
  }
  if (input.bytes.length > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`cutout:${ip}`, 60, 600_000)) {
      return NextResponse.json(
        { error: "请求过于频繁,请稍后再试" },
        { status: 429 }
      );
    }

    // 生产(接库)必须凭有效登录态;用 token 里的 email 作准,不信任请求体。
    if (dbEnabled) {
      const tokenEmail = await resolveUserEmail(request);
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    // 抠图统一 1 积分/张(只发丝级)。
    const cost = CUTOUT_COST;

    if (dbEnabled && (await isBanned(input.email, ip))) {
      return NextResponse.json(
        { error: "账号或 IP 已被封禁" },
        { status: 403 }
      );
    }

    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok) {
        return NextResponse.json(
          { error: "积分不足,请升级方案后重试" },
          { status: 402 }
        );
      }
    }

    let out: Buffer;
    try {
      const cfg = await getCutoutSettings();
      // 抠图统一走发丝级(Replicate);失败退 OpenAI(gpt-image-1 透明底)。
      // 自托管 rembg 免费抠图已下线(2026-06-21 用户停用),不再回退自托管。
      const fallback = async (): Promise<Buffer> => {
        const { apiKey } = await getOpenAISettings();
        if (!apiKey) throw new Error("抠图后端不可用");
        return await cutoutOpenAI(
          input.bytes,
          input.type,
          apiKey,
          cfg.openaiModel
        );
      };
      if (cfg.backend === "openai" || !cfg.replicateToken) {
        out = await fallback(); // 主用 gpt-image,或没配 Replicate token → 直接兜底
      } else {
        try {
          out = await cutoutReplicate(
            input.bytes,
            input.type,
            cfg.replicateToken,
            cfg.replicateModel
          );
        } catch (e) {
          console.error(
            "[cutout] Replicate failed, falling back:",
            e instanceof Error ? e.message : e
          );
          out = await fallback();
        }
      }
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    // 透明底必须是 PNG
    const id = `cut-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(
          new Uint8Array(out),
          "image/png",
          `cutouts/${id}.png`
        );
      } catch (e) {
        console.error(
          "[cutout] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供「本工具记录」原图 / 成品对比;失败不阻断主流程)。
    let srcUrl: string | null = null;
    if (storageEnabled) {
      try {
        const sext = input.type.includes("png")
          ? "png"
          : input.type.includes("webp")
            ? "webp"
            : "jpg";
        srcUrl = await uploadImage(
          new Uint8Array(input.bytes),
          input.type,
          `cutouts/src-${id}.${sext}`
        );
      } catch {
        /* 原图存档失败,忽略 */
      }
    }

    let user: Awaited<ReturnType<typeof getUser>> = null;
    if (useDb) {
      try {
        await addArtworks(
          input.email,
          [
            {
              id,
              title: input.title,
              category: input.category,
              prompt: "",
              status: "completed",
              image: url,
              gradient: "from-stone-100 to-slate-100",
              style: null,
              ratio: input.ratio || null,
              resolution: input.resolution || null,
              source: srcUrl,
              parentId: input.parentId || null,
              parentIds: [],
            },
          ],
          `cut-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[cutout] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0) {
        await addLedgerEntry(input.email, -cost, "抠图 · 发丝级").catch(
          () => {}
        );
      }
      user = await getUser(input.email).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      id,
      url,
      creditsUsed: useDb ? cost : 0,
      user,
    });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "抠图服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
