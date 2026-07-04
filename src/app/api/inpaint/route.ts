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
import { getOpenAISettings } from "@/lib/settings";
import { resolutionCost, resolutionLongSide } from "@/lib/mock-data";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 局部改图(inpaint)专用端点。
//
// gpt-image images.edit 带 mask:mask 的透明区域 = 要重绘的区域,其余原样保留。
// 前端用画笔涂抹生成 mask(涂抹区透明),连同原图 + 描述发来,只改涂抹处。
// 同步返回(走后台 OpenAI 任务,relay 代理),完成后落库 category="inpaint"。
// 计费跟生图同档(resolutionCost:1K=6、2K=8)。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

type InpaintInput = {
  image: Buffer;
  imageType: string;
  mask: Buffer;
  prompt: string;
  email: string;
  resolution: string;
  ratio: string;
  title: string;
  parentId: string;
};

async function parseInput(request: Request): Promise<InpaintInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();

  const imgFile = f.get("image");
  const maskFile = f.get("mask");
  if (!(imgFile instanceof File && imgFile.size > 0)) return null;
  if (!(maskFile instanceof File && maskFile.size > 0)) return null;

  return {
    image: Buffer.from(await imgFile.arrayBuffer()),
    imageType: imgFile.type || "image/png",
    mask: Buffer.from(await maskFile.arrayBuffer()),
    prompt: s("prompt").trim(),
    email: s("email").trim(),
    resolution: s("resolution") === "2K" ? "2K" : "1K",
    ratio: s("ratio") || "auto",
    title: s("title").trim() || "局部改图",
    parentId: s("parentId").trim(),
  };
}

// 规整成干净 PNG,避免 OpenAI "Invalid image file"。
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

// 出图后按分辨率档放大长边(sharp Lanczos);1K 不放大。
async function upscaleTo(buf: Buffer, resolution: string): Promise<Buffer> {
  const target = resolutionLongSide(resolution);
  if (!target) return buf;
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
      .resize(Math.round((meta.width ?? 0) * scale), Math.round((meta.height ?? 0) * scale), {
        kernel: "lanczos3",
      })
      .png()
      .toBuffer();
  } catch {
    return buf;
  }
}

export async function POST(request: Request) {
  let input: InpaintInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json(
      { error: "缺少原图或涂抹区域" },
      { status: 400 }
    );
  }
  if (!input.prompt) {
    return NextResponse.json(
      { error: "请描述涂抹区域要改成什么" },
      { status: 400 }
    );
  }
  if (input.image.length > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`inpaint:${ip}`, 40, 600_000)) {
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
      const { apiKey, model: genModel } = await getOpenAISettings();
      if (!apiKey) throw new Error("未配置 OpenAI key");
      const client = new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: 280_000,
        maxRetries: 0,
      });
      const imgPng = await toPng(input.image);
      // OpenAI edit 要求 mask 与原图尺寸完全一致,否则报错;并按原图宽高比选输出尺寸
      // (gpt-image edit 不稳定接受 "auto",改用具体支持值,与图生图一致)。
      let maskPng: Buffer;
      let editSize: "1024x1024" | "1536x1024" | "1024x1536" = "1024x1024";
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(imgPng).metadata();
        const w = meta.width ?? 1024;
        const h = meta.height ?? 1024;
        maskPng = await sharp(input.mask)
          .resize(w, h, { fit: "fill" })
          .png()
          .toBuffer();
        const ratio = w / h;
        editSize =
          ratio > 1.2 ? "1536x1024" : ratio < 0.83 ? "1024x1536" : "1024x1024";
      } catch {
        maskPng = await toPng(input.mask);
      }
      // 带 mask 的局部重绘(透明区 = 编辑区),用后台配置的主力模型(gpt-image-2)。
      const r = await client.images.edit({
        model: genModel || "gpt-image-2",
        image: await toFile(imgPng, "image.png", { type: "image/png" }),
        mask: await toFile(maskPng, "mask.png", { type: "image/png" }),
        prompt: input.prompt,
        n: 1,
        size: editSize,
      });
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error("未返回图片");
      out = await upscaleTo(Buffer.from(b64, "base64"), input.resolution);
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const id = `inp-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(
          new Uint8Array(out),
          "image/png",
          `inpaints/${id}.png`
        );
      } catch (e) {
        console.error(
          "[inpaint] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供作品记录「原图 / 成品对比」;失败不阻断主流程)。
    let srcUrl: string | null = null;
    if (storageEnabled) {
      try {
        const sext = input.imageType.includes("png")
          ? "png"
          : input.imageType.includes("webp")
            ? "webp"
            : "jpg";
        srcUrl = await uploadImage(
          new Uint8Array(input.image),
          input.imageType,
          `inpaints/src-${id}.${sext}`
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
              category: "inpaint",
              prompt: input.prompt,
              status: "completed",
              image: url,
              gradient: "from-violet-100 to-slate-100",
              style: null,
              ratio: input.ratio || null,
              resolution: input.resolution || null,
              source: srcUrl,
              parentId: input.parentId || null,
              parentIds: [],
            },
          ],
          `inp-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[inpaint] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0) {
        await addLedgerEntry(input.email, -cost, "局部改图").catch(() => {});
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
    console.error(
      "[inpaint] failed:",
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: safeError(e, "局部改图服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
