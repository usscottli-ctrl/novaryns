import { NextResponse } from "next/server";
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
import { bearer, emailFromToken } from "@/lib/supabase-admin";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// AI 变清晰(超分放大)专用端点。
//
// 走 Replicate 的 Real-ESRGAN(nightmareai/real-esrgan,BSD 许可可商用,9000万+次运行):
// 真正修复细节、去噪、放大,而不是 sharp 插值拉大(那只变大不变清晰)。
// 同步返回(轮询冷启动),完成后落库 category="upscale",扣固定小额积分。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120; // Replicate 冷启动可能 1-2 分钟

const UPSCALE_COST = 1; // 统一 1 积分/张(2x/4x 同价,Real-ESRGAN 成本极低)
const MODEL = process.env.REPLICATE_UPSCALE_MODEL || "nightmareai/real-esrgan";

type UpscaleInput = {
  bytes: Buffer;
  type: string;
  email: string;
  title: string;
  scale: number; // 2 | 4
  faceEnhance: boolean; // GFPGAN 人脸修复
  parentId: string;
};

async function parseInput(request: Request): Promise<UpscaleInput | null> {
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
    // 也支持传 sourceUrl(画布/作品页对已有图放大,不必先下载)
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

  return {
    bytes,
    type,
    email: s("email").trim(),
    title: s("title").trim() || "高清放大",
    scale: s("scale") === "4" ? 4 : 2,
    faceEnhance: s("faceEnhance") === "1",
    parentId: s("parentId").trim(),
  };
}

// 解析社区模型最新版本哈希(进程内缓存,pm2 重启即刷新)。
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

// 调 Real-ESRGAN:输入 image + scale + face_enhance,输出超分后的图 URL。
async function upscaleReplicate(
  bytes: Buffer,
  type: string,
  token: string,
  scale: number,
  faceEnhance: boolean
): Promise<{ buf: Buffer; contentType: string }> {
  // real-esrgan 的 GPU 显存上限约 209 万像素(2096704)。输入超限会直接被模型拒绝
  // (报 "greater than the max size that fits in GPU memory")。这里先等比缩小到上限
  // 以内再放大——放大倍数照常,成品依然高清。
  let inBytes = bytes;
  let inType = type || "image/png";
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const MAX_PIXELS = 2_000_000; // 留余量(硬件上限 2096704)
    if (w > 0 && h > 0 && w * h > MAX_PIXELS) {
      const f = Math.sqrt(MAX_PIXELS / (w * h));
      inBytes = await sharp(bytes)
        .resize(Math.floor(w * f), Math.floor(h * f), { fit: "inside" })
        .toBuffer();
      inType = "image/png";
    }
  } catch {
    // sharp 解析失败 → 退回原图(可能仍因过大失败,但不影响小图正常工作)。
  }
  const dataUri = `data:${inType};base64,${inBytes.toString("base64")}`;
  const version = await resolveReplicateVersion(MODEL, token);
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version,
      input: { image: dataUri, scale, face_enhance: faceEnhance },
    }),
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
  if (!dl.ok) throw new Error("下载放大结果失败");
  const buf = Buffer.from(await dl.arrayBuffer());
  const contentType = dl.headers.get("content-type") || "image/png";
  return { buf, contentType };
}

export async function POST(request: Request) {
  let input: UpscaleInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json({ error: "缺少待放大的图片" }, { status: 400 });
  }
  if (input.bytes.length > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`upscale:${ip}`, 60, 600_000)) {
      return NextResponse.json(
        { error: "请求过于频繁,请稍后再试" },
        { status: 429 }
      );
    }

    if (dbEnabled) {
      const tokenEmail = await emailFromToken(bearer(request));
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = UPSCALE_COST;

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

    const token = process.env.REPLICATE_API_TOKEN || "";
    if (!token) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      return NextResponse.json(
        { error: "变清晰服务未配置(缺 Replicate token)" },
        { status: 503 }
      );
    }

    let out: { buf: Buffer; contentType: string };
    try {
      out = await upscaleReplicate(
        input.bytes,
        input.type,
        token,
        input.scale,
        input.faceEnhance
      );
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const ext = out.contentType.includes("jpeg") ? "jpg" : "png";
    const id = `up-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:${out.contentType};base64,${out.buf.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(
          new Uint8Array(out.buf),
          out.contentType,
          `upscales/${id}.${ext}`
        );
      } catch (e) {
        console.error(
          "[upscale] R2 upload failed, returning inline:",
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
          `upscales/src-${id}.${sext}`
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
              category: "upscale",
              prompt: "",
              status: "completed",
              image: url,
              gradient: "from-sky-100 to-slate-100",
              style: null,
              ratio: null,
              resolution: `${input.scale}x`,
              source: srcUrl,
              parentId: input.parentId || null,
              parentIds: [],
            },
          ],
          `up-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[upscale] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0) {
        await addLedgerEntry(input.email, -cost, "AI 变清晰").catch(() => {});
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
      "[upscale] failed:",
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: safeError(e, "变清晰服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
