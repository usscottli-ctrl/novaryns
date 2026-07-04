import { NextResponse } from "next/server";
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
import { getOpenAISettings, getCutoutSettings } from "@/lib/settings";
import { resolutionCost } from "@/lib/mock-data";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 印花提取专用端点。
//
// 从商品图里把表面的印花/图案"提取"出来:去掉产品本体、模特和背景,把图案
// 平铺、正面、无畸变地输出成透明底的独立素材(供设计/二次使用)。
// 走 gpt-image-1 的 images.edit(background:transparent)。落库 category="print"。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 200;

// 品类 → 英文提示(帮模型识别产品类型,提升提取质量)。
const CATEGORY_EN: Record<string, string> = {
  "T恤/服装": "T-shirt / apparel",
  抱枕: "cushion / pillow",
  桌布: "tablecloth",
  毛毯: "blanket",
  浴帘: "shower curtain",
  挂毯: "tapestry / wall hanging",
  帆布包: "canvas tote bag",
  地毯: "rug / carpet",
};

/** 比例 → gpt-image 输出尺寸。 */
function sizeForRatio(
  ratio: string
): "auto" | "1024x1024" | "1536x1024" | "1024x1536" {
  if (!ratio || ratio === "自动" || ratio === "auto") return "auto";
  const m = /^(\d+):(\d+)$/.exec(ratio);
  if (!m) return "auto";
  const r = Number(m[1]) / Number(m[2]);
  if (r > 1.1) return "1536x1024";
  if (r < 0.9) return "1024x1536";
  return "1024x1024";
}

/** 2K/4K:透明底图案按长边放大(保留 alpha)。 */
async function upscaleLong(buf: Buffer, target: number): Promise<Buffer> {
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    const meta = await sharp(buf).metadata();
    const long = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (!long || long >= target) return buf;
    const scale = target / long;
    return await sharp(buf)
      .resize(
        Math.round((meta.width ?? long) * scale),
        Math.round((meta.height ?? long) * scale),
        { kernel: "lanczos3" }
      )
      .png()
      .toBuffer();
  } catch {
    return buf;
  }
}

const BASE_PROMPT =
  "Extract ONLY the decorative print / graphic / logo / pattern printed on the product in this image. Remove the product itself, any model and the background completely. Lay the extracted artwork out flat, front-facing and undistorted as a single clean standalone graphic on a fully transparent background. Faithfully preserve the original colours, textures, typography and fine details of the print. No product, no mockup, no shadow, no border.";

type ExtractInput = {
  bytes: Buffer;
  type: string;
  email: string;
  prompt: string;
  title: string;
  bg: "transparent" | "white" | "black";
  complete: boolean; // 扩展补全:补全被褶皱/遮挡的图案
  advanced: boolean; // 高阶模式:针对褶皱严重/遮挡严重/低清的复杂场景
  category: string; // 品类(通用/抱枕/桌布…)
  ratio: string; // 比例(自动/1:1/…)
  resolution: "1K" | "2K" | "4K";
};

async function parseInput(request: Request): Promise<ExtractInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();

  const file = f.get("image");
  if (!(file instanceof File && file.size > 0)) return null;
  const bgRaw = s("bg");
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    type: file.type || "image/png",
    email: s("email").trim(),
    prompt: s("prompt").trim(),
    title: s("title").trim() || "印花提取",
    bg: bgRaw === "white" ? "white" : bgRaw === "black" ? "black" : "transparent",
    complete: s("complete") === "1",
    advanced: s("mode") === "advanced",
    category: s("category").trim(),
    ratio: s("ratio").trim() || "自动",
    resolution:
      s("resolution").trim().toUpperCase() === "4K"
        ? "4K"
        : s("resolution").trim().toUpperCase() === "2K"
          ? "2K"
          : "1K",
  };
}

// 透明底图案按选择的背景色合成(白/黑);透明则原样返回。
async function applyBg(
  buf: Buffer,
  bg: "transparent" | "white" | "black"
): Promise<{ buf: Buffer; contentType: string; ext: string }> {
  if (bg === "transparent")
    return { buf, contentType: "image/png", ext: "png" };
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    const out = await sharp(buf)
      .flatten({ background: bg === "white" ? "#ffffff" : "#000000" })
      .png()
      .toBuffer();
    return { buf: out, contentType: "image/png", ext: "png" };
  } catch {
    return { buf, contentType: "image/png", ext: "png" };
  }
}

async function toPng(buf: Buffer): Promise<Buffer> {
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

export async function POST(request: Request) {
  let input: ExtractInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json({ error: "缺少商品图片" }, { status: 400 });
  }
  if (input.bytes.length > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`extract:${ip}`, 40, 600_000)) {
      return NextResponse.json(
        { error: "请求过于频繁,请稍后再试" },
        { status: 429 }
      );
    }

    if (dbEnabled) {
      const tokenEmail = await resolveUserEmail(request);
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = resolutionCost(input.resolution);

    if (dbEnabled && (await isBanned(input.email, ip))) {
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });
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
      const { apiKey } = await getOpenAISettings();
      const { openaiModel } = await getCutoutSettings();
      if (!apiKey) throw new Error("未配置 OpenAI key");
      const client = new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: 200_000,
        maxRetries: 0,
      });
      const png = await toPng(input.bytes);
      // 一律先拿透明底(只 gpt-image-1 支持),再按所选背景色合成白/黑底。
      const modeHint = input.advanced
        ? " The product has heavy wrinkles, deep folds, severe occlusion or low clarity (e.g. cushion, tablecloth, blanket, curtain); carefully reconstruct the print despite these difficult conditions."
        : "";
      const completeHint = input.complete
        ? " Reconstruct and complete any folded, wrinkled, occluded or cropped portion so the output is the FULL continuous pattern as if laid perfectly flat."
        : "";
      const userHint = input.prompt
        ? ` The specific print to extract: ${input.prompt}.`
        : "";
      const categoryHint =
        input.category && CATEGORY_EN[input.category]
          ? ` The product is a ${CATEGORY_EN[input.category]}.`
          : "";
      const prompt =
        BASE_PROMPT + modeHint + completeHint + categoryHint + userHint;
      const r = await client.images.edit({
        // 透明底只 gpt-image-1 支持(gpt-image-2 实测报错),印花透明底必须用它。
        model: openaiModel || "gpt-image-1",
        image: await toFile(png, "image.png", { type: "image/png" }),
        prompt,
        n: 1,
        size: sizeForRatio(input.ratio) as "1024x1024",
        background: "transparent" as const,
      });
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error("未返回图案");
      out = Buffer.from(b64, "base64");
      // 2K/4K 按长边放大(保留透明底)。
      const longTarget =
        input.resolution === "4K" ? 4096 : input.resolution === "2K" ? 2048 : 0;
      if (longTarget) out = await upscaleLong(out, longTarget);
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const final = await applyBg(out, input.bg);
    const id = `prt-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:${final.contentType};base64,${final.buf.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(
          new Uint8Array(final.buf),
          final.contentType,
          `prints/${id}.${final.ext}`
        );
      } catch (e) {
        console.error(
          "[extract] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供作品记录「原图 / 成品对比」;失败不阻断主流程)。
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
          `prints/src-${id}.${sext}`
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
              category: "print",
              prompt: input.prompt,
              status: "completed",
              image: url,
              gradient: "from-amber-100 to-slate-100",
              style: null,
              ratio: input.ratio === "自动" ? "auto" : input.ratio,
              resolution: input.resolution,
              source: srcUrl,
              parentId: null,
              parentIds: [],
            },
          ],
          `prt-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[extract] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0) {
        await addLedgerEntry(input.email, -cost, "印花提取").catch(() => {});
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
      { error: safeError(e, "印花提取服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
