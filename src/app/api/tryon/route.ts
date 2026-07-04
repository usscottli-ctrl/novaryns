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
import { TOOL_COST } from "@/lib/mock-data";
import { getTryonLibrary } from "@/lib/tryon-store";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 服装上身(虚拟试穿)端点。
//
// gpt-image 多图合成:衣服图(必填) + 模特图(库选,可选) + 场景图(库选,可选)
// → 一张真实电商试穿成片。保留服装设计/颜色/版型,保留模特身份,置于场景中。
// 落库 category="tryon"。计费同生图(6)。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 240;

const TRYON_COST = TOOL_COST.tryon;

type TryonInput = {
  top: Buffer | null; // 上装(可选)
  bottom: Buffer | null; // 下装(可选)
  modelId: string;
  modelUrl: string; // 自定义人物图 url(「以此图再试穿」用,不在库里时直接给 url)
  sceneId: string;
  prompt: string;
  email: string;
};

async function parseInput(request: Request): Promise<TryonInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();
  const grab = async (k: string) => {
    const file = f.get(k);
    return file instanceof File && file.size > 0
      ? Buffer.from(await file.arrayBuffer())
      : null;
  };
  // 兼容旧字段 garment(当作上装)
  const top = (await grab("top")) ?? (await grab("garment"));
  const bottom = await grab("bottom");
  if (!top && !bottom) return null; // 至少传一个
  return {
    top,
    bottom,
    modelId: s("modelId").trim(),
    modelUrl: s("modelUrl").trim(),
    sceneId: s("sceneId").trim(),
    prompt: s("prompt").trim(),
    email: s("email").trim(),
  };
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

async function fetchPng(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return await toPng(Buffer.from(ab));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 异步任务(单 pm2 fork 内存)。POST 立即返回 jobId,后台跑 ~50s 生成,GET 轮询结果。
// 避免代理/CDN 对长同步请求超时返回空体(客户端报 "Unexpected end of JSON input")。
// 与 /api/generate-image 同款。
// ---------------------------------------------------------------------------
type TryonUser = Awaited<ReturnType<typeof getUser>>;
type Job =
  | { status: "pending"; createdAt: number }
  | {
      status: "done";
      createdAt: number;
      id: string;
      url: string;
      creditsUsed: number;
      user: TryonUser;
    }
  | { status: "error"; createdAt: number; error: string };

const JOBS = new Map<string, Job>();
function sweepJobs(): void {
  const now = Date.now();
  JOBS.forEach((v, k) => {
    if (now - v.createdAt > 15 * 60_000) JOBS.delete(k);
  });
}

async function runTryonJob(
  jobId: string,
  input: TryonInput,
  useDb: boolean,
  cost: number
): Promise<void> {
  try {
    let out: Buffer;
    // 输入原图存档:优先「人物/模特图」。模特图来自库(已有 R2/托管 URL)→ 直接复用,不重传;
    // 未选模特时退回用户上传的上装(top)作为原图。两者都在内层 try 里赋值,供落库 source 用。
    let modelUrl: string | null = null; // 模特库图现成 URL(可直接当 source)
    let personBytes: Buffer | null = null; // 模特图字节(库图取回时填,作备用)
    try {
      const { apiKey, model: genModel } = await getOpenAISettings();
      if (!apiKey) throw new Error("未配置 OpenAI key");
      const client = new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: 230_000,
        maxRetries: 0,
      });

      const lib = await getTryonLibrary();
      // 人物/模特图:优先库选(modelId);否则「以此图再试穿」传来的自定义 url(仅允许 http/https)。
      const customPersonUrl =
        input.modelUrl && /^https?:\/\//i.test(input.modelUrl)
          ? input.modelUrl
          : "";
      const model = input.modelId
        ? lib.models.find((x) => x.id === input.modelId)
        : customPersonUrl
          ? { url: customPersonUrl }
          : undefined;
      const scene = input.sceneId
        ? lib.scenes.find((x) => x.id === input.sceneId)
        : undefined;

      // 组装参考图序列:上装/下装 → 模特 → 场景。并据此拼角色说明。
      const files: Awaited<ReturnType<typeof toFile>>[] = [];
      const roles: string[] = [];
      let idx = 1;
      if (input.top) {
        files.push(await toFile(await toPng(input.top), "top.png", { type: "image/png" }));
        roles.push(`Image ${idx} is the TOP garment (upper-body clothing) to put on the model.`);
        idx++;
      }
      if (input.bottom) {
        files.push(await toFile(await toPng(input.bottom), "bottom.png", { type: "image/png" }));
        roles.push(`Image ${idx} is the BOTTOM garment (lower-body clothing) to put on the model.`);
        idx++;
      }

      if (model) {
        modelUrl = model.url || null; // 库图已托管,落库 source 直接复用
        const mp = await fetchPng(model.url);
        if (mp) {
          personBytes = mp;
          files.push(await toFile(mp, "model.png", { type: "image/png" }));
          roles.push(
            `Image ${idx} is the human model — keep this exact person's face, identity, body type and skin tone.`
          );
          idx++;
        }
      }
      if (scene) {
        const sp = await fetchPng(scene.url);
        if (sp) {
          files.push(await toFile(sp, "scene.png", { type: "image/png" }));
          roles.push(
            `Image ${idx} is the scene / background & styling reference — place the model in this environment, pose and lighting mood.`
          );
          idx++;
        }
      }

      const prompt =
        `Create ONE single photorealistic full-body e-commerce fashion photo of a model naturally wearing the provided garment(s). ` +
        roles.join(" ") +
        ` Faithfully preserve each provided garment's exact design, colour, pattern, prints, text, fabric and cut — the clothing must look identical to its reference, fitting the body with realistic drape, wrinkles and shadows. ` +
        (input.top && !input.bottom
          ? `Pair the top with simple, neutral, well-matched bottoms. `
          : !input.top && input.bottom
            ? `Pair the bottom with a simple, neutral, well-matched top. `
            : ``) +
        (model
          ? `Preserve the model's real face and identity. `
          : `Use a suitable good-looking model. `) +
        (scene
          ? `Compose the model into the reference scene with matching background and lighting. `
          : `Use a clean, flattering studio or lifestyle background. `) +
        `Natural pose, realistic proportions, high quality, sharp, no text, no watermark, no border.` +
        (input.prompt ? ` Extra requirements: ${input.prompt}` : "");

      const r = await client.images.edit({
        model: genModel || "gpt-image-2",
        image: files,
        prompt,
        n: 1,
        size: "1024x1536" as "1024x1536",
        quality: "high" as "high",
      });
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error("未返回试穿图");
      out = Buffer.from(b64, "base64");
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const id = `try-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(new Uint8Array(out), "image/png", `tryons/${id}.png`);
      } catch (e) {
        console.error(
          "[tryon] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供作品记录「原图 / 成品对比」;失败不阻断主流程)。
    // 优先用人物/模特图:库图已有现成 URL → 直接复用;否则退回上传的上装(top)。
    let srcUrl: string | null = modelUrl;
    if (storageEnabled && !srcUrl) {
      const srcBytes = personBytes ?? input.top;
      if (srcBytes) {
        try {
          srcUrl = await uploadImage(
            new Uint8Array(srcBytes),
            "image/png",
            `tryons/src-${id}.png`
          );
        } catch {
          /* 原图存档失败,忽略 */
        }
      }
    }

    let user: TryonUser = null;
    if (useDb) {
      try {
        await addArtworks(
          input.email,
          [
            {
              id,
              title: "服装上身",
              category: "tryon",
              prompt: input.prompt || "服装上身",
              status: "completed",
              image: url,
              gradient: "from-violet-100 to-slate-100",
              style: null,
              ratio: "2:3",
              resolution: "1024×1536",
              source: srcUrl,
              parentId: null,
              parentIds: [],
            },
          ],
          `try-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[tryon] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0)
        await addLedgerEntry(input.email, -cost, "服装上身").catch(() => {});
      user = await getUser(input.email).catch(() => null);
    }

    JOBS.set(jobId, {
      status: "done",
      createdAt: Date.now(),
      id,
      url,
      creditsUsed: useDb ? cost : 0,
      user,
    });
  } catch (e) {
    JOBS.set(jobId, {
      status: "error",
      createdAt: Date.now(),
      error: safeError(e, "服装上身服务暂时不可用,请稍后重试"),
    });
  }
}

export async function POST(request: Request) {
  let input: TryonInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) return NextResponse.json({ error: "缺少服装图片" }, { status: 400 });
  if (
    (input.top?.length ?? 0) > 12 * 1024 * 1024 ||
    (input.bottom?.length ?? 0) > 12 * 1024 * 1024
  ) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`tryon:${ip}`, 30, 600_000)) {
      return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
    }

    if (dbEnabled) {
      const tokenEmail = await resolveUserEmail(request);
      if (!tokenEmail)
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = TRYON_COST;

    if (dbEnabled && (await isBanned(input.email, ip)))
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });

    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok)
        return NextResponse.json(
          { error: "积分不足,请充值后重试" },
          { status: 402 }
        );
    }

    sweepJobs();
    const jobId = `tryjob-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    JOBS.set(jobId, { status: "pending", createdAt: Date.now() });
    // 后台跑(不 await):POST 立即返回 → 代理不会因长请求被切断。
    void runTryonJob(jobId, input, useDb, cost);
    return NextResponse.json({ jobId });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "服装上身服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}

// 轮询任务结果。
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId) return NextResponse.json({ status: "ok" });
  const job = JOBS.get(jobId);
  if (!job)
    return NextResponse.json({ status: "error", error: "任务不存在或已过期" });
  if (job.status === "done")
    return NextResponse.json({
      status: "done",
      ok: true,
      id: job.id,
      url: job.url,
      creditsUsed: job.creditsUsed,
      user: job.user,
    });
  if (job.status === "error")
    return NextResponse.json({ status: "error", error: job.error });
  return NextResponse.json({ status: "pending" });
}
