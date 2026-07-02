import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { CATEGORY_IMAGES, img } from "@/lib/images";
import {
  resolutionCost,
  resolutionLongSide,
} from "@/lib/mock-data";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  addArtworks,
  ensureTemplateRoot,
  getUser,
  isBanned,
  addLedgerEntry,
  addReservation,
  settleReservation,
  sweepStaleReservations,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { bearer, emailFromToken } from "@/lib/supabase-admin";
import { safeError } from "@/lib/api-error";
import {
  storageEnabled,
  uploadImage,
  dataUrlToBytes,
} from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { getStyleGuide } from "@/lib/prompt-config";

// ---------------------------------------------------------------------------
// Image generation / editing endpoint.
//
// - No uploaded image -> text-to-image (images.generate).
// - Uploaded product image -> image-to-image (images.edit), so the user's
//   real product is preserved and re-composed per the prompt/style.
// - Style + ratio are baked into the prompt AND the request size so the
//   selected options actually change the output.
// - OPENAI key / DATABASE_URL / R2_* each upgrade behaviour; missing config
//   degrades to mock.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

export type GeneratedImage = {
  id: string;
  url: string;
  gradient: string;
  prompt: string;
  ratio: string;
  createdAt: string;
};

type GenImage = { buf: Buffer; type: string };
type GenParams = {
  prompt: string;
  // 落库用的「用户原始提示词」:仅用户自己输入的内容(图裂变/融图客户端拼了系统词进 prompt,
  // 这里单独传原始词),用于 addArtworks 落库,避免系统提示词被同行抄袭。模型调用仍用完整 prompt。
  userPrompt: string;
  category: string;
  ratio: string;
  resolution: string;
  style: string;
  quality: string; // 出图模式:low(基础)/medium(标准)/high(高阶);空=用 env 默认
  count: number;
  transparent: boolean; // 透明底(抠图):gpt-image background:transparent PNG
  ratiogen: boolean; // 改比例(ChatGPT 式重生成):用节点自身提示词+原图参考,按目标比例重画再裁切,无需额外提示词
  email: string;
  images: GenImage[];
  parentId: string; // 血缘:本次生成所基于的作品 id(图生图底图来源),无则空串
  parentIds: string[]; // 多输入:额外父节点 id(合并多张参考图时,除 primary 之外的)
  // 来自模板库「做同款」:模板 id/图/提示词,用于在血缘里建"模板原图"根节点
  templateId: string;
  templateImage: string;
  templatePrompt: string;
  origin: string; // "canvas"=在画布里产出(永远留画布);空=生图页/工具等普通产出
};

const MAX_IMAGES = 6;

// gpt-image 出图质量:不设=默认 auto≈最高=最慢(实测 1K 要 50~150 秒)。
// 默认 medium:速度快很多、质量仍够电商商用。可用 env OPENAI_IMAGE_QUALITY 调(low/medium/high/auto)。
const IMG_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || "medium") as
  | "low"
  | "medium"
  | "high"
  | "auto";

const GRADIENTS = [
  "from-rose-100 to-slate-100",
  "from-lime-100 to-emerald-100",
  "from-amber-100 to-orange-100",
  "from-sky-100 to-teal-100",
  "from-emerald-100 to-teal-100",
  "from-stone-100 to-amber-100",
];

// Concrete descriptors so the picked style visibly changes the result.
function sizeFor(ratio: string, model: string): string {
  // OpenAI gpt-image-1 接受 size: "auto",让模型自选最合适的输出尺寸。
  // DALL·E 3 不支持 auto,退化成方图。
  if (ratio === "auto") return model === "dall-e-3" ? "1024x1024" : "auto";
  // 通用方向判断:任意 "w:h" 比例都能映射到 gpt-image 支持的三种尺寸(横/竖/方)。
  const [rw, rh] = ratio.split(":").map(Number);
  const k = rw > 0 && rh > 0 ? rw / rh : 1;
  const portrait = k < 0.95;
  const landscape = k > 1.05;
  if (model === "dall-e-3") {
    if (landscape) return "1792x1024";
    if (portrait) return "1024x1792";
    return "1024x1024";
  }
  if (landscape) return "1536x1024";
  if (portrait) return "1024x1536";
  return "1024x1024";
}

function buildPrompt(p: GenParams, styleGuide: Record<string, string>): string {
  // 默认风格:完全透传用户提示词,不附加任何内容——输出由用户提示词完全决定。
  const styleDesc =
    p.style && p.style !== "默认" ? styleGuide[p.style] || p.style : "";
  if (!styleDesc) return p.prompt;
  // 选了具体风格:仅在用户提示词后追加该风格描述(风格表后台可改)。
  return `${p.prompt}，${styleDesc}`;
}

function mockImages(p: GenParams): GeneratedImage[] {
  const pool = CATEGORY_IMAGES[p.category] ?? CATEGORY_IMAGES.main;
  return Array.from({ length: p.count }).map((_, i) => ({
    id: `gen-${Date.now()}-${i}`,
    url: img(pool[i % pool.length], 1000),
    gradient: GRADIENTS[(Date.now() + i) % GRADIENTS.length],
    prompt: p.prompt,
    ratio: p.ratio,
    createdAt: new Date().toISOString(),
  }));
}

// 某些模型(非 gpt-image-1 的代理/三方模型)不支持 background:transparent,
// 会返回 400 "Transparent background is not supported for this model"。
// 命中该错误时去掉透明底参数重试,保证抠图动作至少能正常出图。
function transparentUnsupported(e: unknown): boolean {
  const msg =
    (e as { message?: string })?.message ??
    String((e as { error?: { message?: string } })?.error?.message ?? "");
  return /transparent background is not supported/i.test(msg);
}

// 改比例(ChatGPT 式重生成)固定指令:不需要用户额外提示词。
// 仿 ChatGPT「用不同宽高比生成此图片」:拿节点自身提示词 + 原图当参考,
// 在目标比例下重画一张(同主体/风格/配色,自然重构图),而不是补四周。
const RATIO_HINT =
  "Re-render this image at the new target aspect ratio. Keep the same subject, style, colours, lighting and overall look as the reference image; naturally re-frame and recompose to fill the new proportions — do not stretch, squash, distort, letterbox or crop the subject out. Photorealistic, cohesive, high quality, no borders, no frames, no added text.";

// 改比例时送给模型的提示词:有节点自身提示词就带上(更贴近原意图),没有就只用重构图指令。
function ratioPrompt(p: GenParams): string {
  const base = (p.prompt || "").trim();
  return base ? `${base}. ${RATIO_HINT}` : RATIO_HINT;
}

// 把图按精确目标比例居中裁切(gpt-image 只出方/横/竖三种原生尺寸,
// 9:16、4:3 这类精确比例靠出最近原生尺寸后再裁切得到 —— 即 ChatGPT 同款做法)。
async function cropToRatio(buf: Buffer, ratio: string): Promise<Buffer> {
  const [rw, rh] = ratio.split(":").map(Number);
  if (!(rw > 0 && rh > 0)) return buf;
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (!W || !H) return buf;
    const target = rw / rh;
    const cur = W / H;
    let cw = W;
    let ch = H;
    if (cur > target + 0.01) cw = Math.round(H * target); // 太宽 → 裁掉左右
    else if (cur < target - 0.01) ch = Math.round(W / target); // 太高 → 裁掉上下
    else return buf; // 已是目标比例
    cw = Math.min(cw, W);
    ch = Math.min(ch, H);
    const left = Math.max(0, Math.floor((W - cw) / 2));
    const top = Math.max(0, Math.floor((H - ch) / 2));
    return await sharp(buf)
      .extract({ left, top, width: cw, height: ch })
      .png()
      .toBuffer();
  } catch {
    return buf; // sharp 不可用 → 退回未裁切(仍是最近原生比例)
  }
}

async function openaiImages(
  p: GenParams,
  apiKey: string,
  modelIn: string,
  cutoutModel: string
): Promise<GeneratedImage[]> {
  // 透明底只 gpt-image-1 支持(gpt-image-2 实测不支持 background:transparent),走抠图模型;
  // 其余生图走默认模型(gpt-image-2)。普通生图的兜底已统一 v2,不再落 v1。
  const model = p.transparent ? cutoutModel || "gpt-image-1" : modelIn;
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    // Generation runs as a background job (no CDN constraint), so allow a
    // long single attempt. No retry — a retry after timeout would double the
    // wait and blow past the client's poll deadline.
    timeout: 280_000,
    maxRetries: 0,
  });
  const prompt = p.ratiogen ? ratioPrompt(p) : buildPrompt(p, await getStyleGuide());
  const size = sizeFor(p.ratio, model);
  const canEdit = p.images.length > 0 && model.startsWith("gpt-image");
  // 出图模式:优先用本次请求选的(基础/标准/高阶 = low/medium/high),否则回退 env 默认。
  const q = (["low", "medium", "high", "auto"].includes(p.quality)
    ? p.quality
    : IMG_QUALITY) as "low" | "medium" | "high" | "auto";

  let data: { b64_json?: string; url?: string }[] = [];

  // 改比例(ChatGPT 式重生成):拿节点自身提示词 + 原图当参考,按目标比例重画一张,
  // 出图后裁切到精确比例。同主体/风格/配色,自然重构图 —— 无接缝、无羽化、不限于 3 种形状。
  // 不需要用户额外提示词(ratioPrompt 已带固定重构图指令),只生成 1 张。
  if (p.ratiogen && p.images[0] && model.startsWith("gpt-image")) {
    const ref = await normalizeForEdit(Buffer.from(p.images[0].buf));
    const r = await client.images.edit({
      model,
      image: await toFile(ref, "ref.png", { type: "image/png" }),
      prompt,
      n: 1,
      size: size as "1024x1024" | "1536x1024" | "1024x1536",
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI 未返回图片");
    const cropped = await cropToRatio(Buffer.from(b64, "base64"), p.ratio);
    return [
      {
        id: `gen-${Date.now()}-0`,
        url: `data:image/png;base64,${cropped.toString("base64")}`,
        gradient: GRADIENTS[0],
        prompt: p.prompt,
        ratio: p.ratio,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  if (canEdit) {
    // Image-to-image: keep the user's product(s), recompose per prompt/style.
    // gpt-image accepts multiple reference images (up to MAX_IMAGES).
    const files = await Promise.all(
      p.images.map(async (im, i) => {
        const png = await normalizeForEdit(Buffer.from(im.buf));
        return toFile(png, `product-${i}.png`, { type: "image/png" });
      })
    );
    const editParams = {
      model,
      image: files,
      prompt,
      n: p.count,
      size: size as "1024x1024" | "1536x1024" | "1024x1536",
      quality: q,
    };
    let r;
    try {
      r = await client.images.edit({
        ...editParams,
        ...(p.transparent ? { background: "transparent" as const } : {}),
      });
    } catch (e) {
      if (p.transparent && transparentUnsupported(e)) {
        r = await client.images.edit(editParams); // 退回不透明底重试
      } else throw e;
    }
    data = r.data ?? [];
  } else if (model === "dall-e-3") {
    // dall-e-3: n=1 only, no edit -> fan out parallel text-to-image.
    const batches = await Promise.all(
      Array.from({ length: p.count }).map(() =>
        client.images.generate({ model, prompt, n: 1, size })
      )
    );
    data = batches.flatMap((b) => b.data ?? []);
  } else {
    const genParams = { model, prompt, n: p.count, size, quality: q };
    let r;
    try {
      r = await client.images.generate({
        ...genParams,
        ...(p.transparent ? { background: "transparent" as const } : {}),
      });
    } catch (e) {
      if (p.transparent && transparentUnsupported(e)) {
        r = await client.images.generate(genParams); // 退回不透明底重试
      } else throw e;
    }
    data = r.data ?? [];
  }

  const images = data.map((d, i) => ({
    id: `gen-${Date.now()}-${i}`,
    url: d.b64_json
      ? `data:image/png;base64,${d.b64_json}`
      : (d.url ?? ""),
    gradient: GRADIENTS[i % GRADIENTS.length],
    prompt: p.prompt,
    ratio: p.ratio,
    createdAt: new Date().toISOString(),
  }));
  if (images.length === 0) throw new Error("OpenAI 未返回图片");
  return images;
}

// 把图生图的输入图统一重编码成干净的 PNG(sRGB/8bit),修复:
//  · 真实格式是 JPEG/WEBP 却按 .png 上传 → OpenAI "Invalid image file"
//  · CMYK / 16bit / 带怪异色彩配置 → "or mode" 报错
//  · 手机照片 EXIF 旋转
// sharp 不可用时退回原图(不让生成中断)。
async function normalizeForEdit(buf: Buffer): Promise<Buffer> {
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    return await sharp(buf).rotate().png().toBuffer();
  } catch {
    return buf;
  }
}

// Upscale generated images to the chosen resolution tier's long side.
// gpt-image only outputs ~1024-1536px natively, so 2K/4K are produced by
// resizing server-side with sharp (high-quality Lanczos). If sharp is missing
// or anything fails, we keep the original image so generation never breaks.
async function upscaleImages(
  images: GeneratedImage[],
  resolution: string
): Promise<GeneratedImage[]> {
  const target = resolutionLongSide(resolution);
  if (!target) return images; // 1K / unknown -> native size
  let sharp: typeof import("sharp");
  try {
    // sharp is a CJS `export =` module; under Node ESM the callable lands on
    // `.default`, but the static type has no `default` — cast to read it.
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    sharp = mod.default ?? mod;
  } catch {
    return images; // dependency unavailable -> degrade gracefully
  }
  return Promise.all(
    images.map(async (image) => {
      const decoded = dataUrlToBytes(image.url);
      if (!decoded) return image; // url-based result -> can't resize here
      try {
        const input = Buffer.from(decoded.bytes);
        const meta = await sharp(input).metadata();
        const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
        if (!longSide || longSide >= target) return image;
        const scale = target / longSide;
        const out = await sharp(input)
          .resize({
            width: Math.round((meta.width ?? 0) * scale),
            height: Math.round((meta.height ?? 0) * scale),
            kernel: "lanczos3",
            fit: "fill",
          })
          .png()
          .toBuffer();
        return {
          ...image,
          url: `data:image/png;base64,${out.toString("base64")}`,
        };
      } catch (e) {
        console.error(
          "[upscale] failed, keeping original:",
          e instanceof Error ? e.message : e
        );
        return image;
      }
    })
  );
}

async function persistToStorage(
  images: GeneratedImage[]
): Promise<GeneratedImage[]> {
  if (!storageEnabled) return images;
  return Promise.all(
    images.map(async (image) => {
      const decoded = dataUrlToBytes(image.url);
      if (!decoded) return image;
      try {
        const ext = decoded.contentType.split("/")[1] ?? "png";
        const url = await uploadImage(
          decoded.bytes,
          decoded.contentType,
          `generations/${image.id}.${ext}`
        );
        return { ...image, url };
      } catch (e) {
        console.error(
          "[R2] upload failed, keeping inline image:",
          e instanceof Error ? e.message : e
        );
        return image;
      }
    })
  );
}

// 解析 parentIds(表单里以 JSON 字符串传)
function parseIds(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function parseParams(request: Request): Promise<GenParams | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const f = await request.formData();
    const s = (k: string) => (f.get(k) ?? "").toString();
    const images: GenImage[] = [];
    for (const file of f.getAll("image")) {
      if (file instanceof File && file.size > 0) {
        images.push({
          buf: Buffer.from(await file.arrayBuffer()),
          type: file.type || "image/png",
        });
      }
      if (images.length >= MAX_IMAGES) break;
    }
    return {
      prompt: s("prompt").trim(),
      userPrompt: s("userPrompt").trim(),
      category: s("category") || "main",
      ratio: s("ratio") || "1:1",
      resolution: s("resolution") || "1K",
      style: s("style"),
      quality: s("quality").trim(),
      count: Math.min(Math.max(Number(s("count")) || 4, 1), 8),
      transparent: s("transparent") === "1",
      ratiogen: s("ratiogen") === "1",
      email: s("email").trim(),
      images,
      parentId: s("parentId").trim(),
      parentIds: parseIds(s("parentIds")),
      templateId: s("templateId").trim(),
      templateImage: s("templateImage").trim(),
      templatePrompt: s("templatePrompt").trim(),
      origin: s("origin").trim(),
    };
  }
  const j = (await request.json()) as Partial<GenParams>;
  return {
    prompt: (j.prompt ?? "").trim(),
    userPrompt: (j.userPrompt ?? "").trim(),
    category: j.category || "main",
    ratio: j.ratio || "1:1",
    resolution: j.resolution || "1K",
    style: j.style ?? "",
    quality: j.quality ?? "",
    count: Math.min(Math.max(Number(j.count) || 4, 1), 8),
    transparent: !!j.transparent,
    ratiogen: !!j.ratiogen,
    email: (j.email ?? "").trim(),
    images: [],
    parentId: (j.parentId ?? "").trim(),
    parentIds: Array.isArray(j.parentIds) ? j.parentIds : [],
    templateId: (j.templateId ?? "").trim(),
    templateImage: (j.templateImage ?? "").trim(),
    templatePrompt: (j.templatePrompt ?? "").trim(),
    origin: (j.origin ?? "").trim(),
  };
}

// --- Async job store ------------------------------------------------------
// In-memory (single pm2 fork instance). POST returns a jobId immediately and
// generation continues in the background, so a slow gpt-image job never holds
// the HTTP connection open past Cloudflare's ~100s proxy timeout. The client
// polls GET ?job=<id>. Jobs are GC'd after 20 minutes.
type Job = {
  status: "pending" | "done" | "error";
  images?: GeneratedImage[];
  user?: Awaited<ReturnType<typeof getUser>>;
  creditsUsed?: number;
  mock?: boolean;
  mode?: string;
  persisted?: boolean;
  error?: string;
  createdAt: number;
};
const JOBS = new Map<string, Job>();
function gcJobs() {
  const now = Date.now();
  JOBS.forEach((v, k) => {
    if (now - v.createdAt > 20 * 60 * 1000) JOBS.delete(k);
  });
}

// 生成并发闸:同时最多 GEN_MAX_CONCURRENT 个请求真正打 OpenAI,超出的排队等待。
// 防止瞬时高并发一次性打爆 OpenAI 速率限额(429)。单 fork 实例,模块级状态即可。
// gpt-image ~30-40s/张,默认 4 并发 ≈ 7 张/分钟,留足余量;可用 env 调大。
const GEN_MAX_CONCURRENT = Math.max(1, Number(process.env.GEN_MAX_CONCURRENT) || 4);
let genActive = 0;
const genWaiters: Array<() => void> = [];
function acquireGenSlot(): Promise<void> {
  if (genActive < GEN_MAX_CONCURRENT) {
    genActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => genWaiters.push(resolve));
}
function releaseGenSlot(): void {
  const next = genWaiters.shift();
  if (next) next(); // 槽位直接转交给下一个排队者(genActive 不变)
  else genActive = Math.max(0, genActive - 1);
}

async function runJob(
  jobId: string,
  p: GenParams,
  apiKey: string,
  model: string,
  cutoutModel: string,
  useDb: boolean,
  cost: number
) {
  // 排队等一个并发槽(排队期间 job 仍是 pending,前端轮询正常显示"生成中")
  await acquireGenSlot();
  try {
    // —— 临时埋点:量出每段耗时,定位生图慢在哪(OpenAI出图 / 放大 / 传R2 / 图大小)——
    const _t0 = Date.now();
    let images = apiKey
      ? await openaiImages(p, apiKey, model, cutoutModel)
      : mockImages(p);
    const _tOpenai = Date.now() - _t0;
    const _t1 = Date.now();
    images = await upscaleImages(images, p.resolution);
    const _tUpscale = Date.now() - _t1;
    const _u0 = images[0]?.url || "";
    const _approxBytes = _u0.startsWith("data:")
      ? Math.round((_u0.length - _u0.indexOf(",") - 1) * 0.75)
      : 0;
    const _t2 = Date.now();
    images = await persistToStorage(images);
    const _tPersist = Date.now() - _t2;
    console.log(
      `[gen-timing] job=${jobId} n=${p.count} res=${p.resolution} edit=${
        p.images.length > 0
      } openai=${_tOpenai}ms upscale=${_tUpscale}ms persistR2=${_tPersist}ms firstImg=${Math.round(
        _approxBytes / 1024
      )}KB total=${Date.now() - _t0}ms`
    );

    // Persist the first uploaded source image so "再次生成" can restore it.
    let sourceUrl: string | null = null;
    if (p.images[0] && storageEnabled) {
      try {
        const first = p.images[0];
        const ext = (first.type || "image/png").split("/")[1] || "png";
        sourceUrl = await uploadImage(
          first.buf,
          first.type || "image/png",
          `sources/src-${Date.now()}.${ext}`
        );
      } catch {
        /* non-fatal */
      }
    }

    let user: Awaited<ReturnType<typeof getUser>> = null;
    if (useDb) {
      const title =
        p.prompt.length > 16 ? `${p.prompt.slice(0, 16)}…` : p.prompt;
      const batchId = `b-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      // 血缘父节点:优先用显式 parentId;否则若来自模板「做同款」,在用户名下
      // 找/建该模板的"模板原图"根节点,本次生成挂它下面。
      let parent: string | null = p.parentId || null;
      if (!parent && p.templateId && p.templateImage) {
        parent = await ensureTemplateRoot(p.email, {
          templateId: p.templateId,
          image: p.templateImage,
          prompt: p.templatePrompt || p.prompt,
          title: p.templatePrompt || p.prompt,
        }).catch(() => null);
      }
      try {
        await addArtworks(
          p.email,
          images.map((im) => ({
            id: im.id,
            title,
            category: p.category,
            // 落库只存用户原始提示词(有就用,空则退回完整 prompt),保护系统提示词不外泄。
            prompt: p.userPrompt || p.prompt,
            status: "completed",
            image: im.url,
            gradient: im.gradient,
            style: p.style || null,
            ratio: p.ratio || null,
            resolution: p.resolution || null,
            source: sourceUrl,
            parentId: parent,
            parentIds: p.parentIds.filter((x) => x && x !== parent),
            origin: p.origin || null,
          })),
          batchId
        );
      } catch {
        /* non-fatal */
      }
      await addLedgerEntry(p.email, -cost, `生成 ${p.count} 张图`).catch(
        () => {}
      );
      user = await getUser(p.email).catch(() => null);
    }

    if (useDb) await settleReservation(jobId).catch(() => {});
    JOBS.set(jobId, {
      status: "done",
      images,
      user,
      creditsUsed: cost,
      mock: !apiKey,
      mode: p.images.length > 0 ? "edit" : "generate",
      persisted: useDb,
      createdAt: Date.now(),
    });
  } catch (e) {
    if (useDb) {
      await refundCredits(p.email, cost).catch(() => {});
      await settleReservation(jobId).catch(() => {});
    }
    // 原始上游 message 可能含 openai/gpt/quota 等字样,经 safeError 净化后再落库,
    // 避免随 GET 轮询回传给用户暴露所用模型。详细原因只打服务端日志。
    console.error(
      "[generate-image] job failed:",
      e instanceof Error ? e.message : e
    );
    JOBS.set(jobId, {
      status: "error",
      error: safeError(e, "图片生成失败,请稍后重试"),
      createdAt: Date.now(),
    });
  } finally {
    releaseGenSlot();
  }
}

export async function POST(request: Request) {
  let p: GenParams | null;
  try {
    p = await parseParams(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!p) {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  // 改比例(ratiogen)用固定重构图指令,可以没有用户提示词;其余路径仍要求 prompt。
  if (!p.prompt && !p.ratiogen) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }
  if (p.images.some((im) => im.buf.length > 12 * 1024 * 1024)) {
    return NextResponse.json(
      { error: "单张上传图片过大（请 < 12MB）" },
      { status: 400 }
    );
  }

  try {
  const { apiKey, model, cutoutModel } = await getOpenAISettings();
  const ip = clientIp(request);

  // 按 IP 限流:防脚本化刷接口烧 token。生图较重,30 次/10 分钟足够真实用户。
  if (!rateLimit(`gen:${ip}`, 30, 600_000)) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429 }
    );
  }

  // 生产环境(接了库)必须凭有效登录态:用 token 里的 email 作准,不信任请求体
  // 传来的 email——既堵住「空 email 免费烧 key」,也防「冒用他人邮箱花其积分」。
  if (dbEnabled) {
    const tokenEmail = await emailFromToken(bearer(request));
    if (!tokenEmail) {
      return NextResponse.json(
        { error: "请先登录后再生成" },
        { status: 401 }
      );
    }
    p.email = tokenEmail;
  }
  const useDb = dbEnabled && p.email.length > 0;
  // 改比例只出 1 张,固定按 1 张计费(防止 count 被改大而超扣)。
  if (p.ratiogen) p.count = 1;
  // 全站固定标准档 medium(前端已无质量选择器),计费纯按分辨率(1K/2K=9、4K=18)。
  const cost = p.count * resolutionCost(p.resolution);

  if (dbEnabled && (await isBanned(p.email, ip))) {
    return NextResponse.json(
      { error: "账号或 IP 已被封禁，请联系管理员" },
      { status: 403 }
    );
  }

  if (useDb) {
    const ok = await reserveCredits(p.email, cost);
    if (!ok) {
      return NextResponse.json(
        { error: "积分不足，请升级方案后重试" },
        { status: 402 }
      );
    }
  }

  gcJobs();
  const jobId = `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  JOBS.set(jobId, { status: "pending", createdAt: Date.now() });
  // Record the credit reservation so it can be auto-refunded if the process
  // dies mid-job; opportunistically sweep older orphans on each new request.
  if (useDb) await addReservation(jobId, p.email, cost);
  void sweepStaleReservations().catch(() => {});
  // Fire-and-forget: continues in the persistent Node server after we respond.
  void runJob(jobId, p, apiKey, model, cutoutModel, useDb, cost);

  return NextResponse.json({ jobId });
  } catch (e) {
    // 兜底:任何未预期异常都回 JSON,避免前端拿到纯文本 500("Internal Server Error")
    return NextResponse.json(
      { error: safeError(e, "生成服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (jobId) {
    const job = JOBS.get(jobId);
    if (!job) {
      return NextResponse.json({
        status: "error",
        error: "任务不存在或已过期，请重试",
      });
    }
    if (job.status === "done") {
      return NextResponse.json({
        status: "done",
        ok: true,
        images: job.images,
        user: job.user,
        creditsUsed: job.creditsUsed,
        mock: job.mock,
        persisted: job.persisted,
      });
    }
    if (job.status === "error") {
      return NextResponse.json({ status: "error", error: job.error });
    }
    return NextResponse.json({ status: "pending" });
  }

  // 健康检查:绝不暴露模型名/上游供应商/密钥来源(铁律:绝不泄露所用模型)。
  const { apiKey } = await getOpenAISettings();
  return NextResponse.json({
    status: "ok",
    ready: !!apiKey,
    db: dbEnabled,
    storage: storageEnabled,
  });
}
