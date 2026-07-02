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
import { bearer, emailFromToken } from "@/lib/supabase-admin";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { TOOL_COST } from "@/lib/mock-data";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 3D 服装图:把用户上传的服装照(穿在人身上/平铺均可)渲染成干净的「3D 幽灵模特」
// 电商产品图 —— 像被隐形模特穿着、有立体体积感与自然褶皱,去掉真人、干净背景。
// gpt-image-2 图生图(非透明)。落库 category="dress3d"。计费同 3D 档(16)。
//
// 异步任务模式:3D 生成常 >100s,而 image.novaryns.com 挂在 Cloudflare 免费版
// (100s 硬超时)后面,同步返回会被掐断成 HTML 524、前端 JSON.parse 崩在 "<"。
// 故 POST 立即返回 jobId(秒回,不撞超时),后台跑生成,前端轮询 GET ?job=<id>。
// 单 pm2 fork 实例、内存 JOBS,与 generate-image 同套路。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

const COST = TOOL_COST.garment3d;

const CATEGORIES: Record<string, string> = {
  通用: "garment",
  T恤: "t-shirt",
  卫衣: "hoodie / sweatshirt",
  连衣裙: "dress",
  长裤: "trousers / pants",
};

const BASE_PROMPT =
  "Render the uploaded clothing as a clean professional 3D ghost-mannequin e-commerce product image: present the garment as if worn by an invisible (hollow) mannequin, with realistic three-dimensional volume, natural structure, folds and drape, front-facing, neatly shaped. Remove any real person, model, hanger or messy background completely. Center the garment on a clean soft light-gray studio background with gentle product lighting and a soft shadow. Faithfully preserve the garment's exact design, colour, pattern, prints, text, fabric, buttons, collar and all details.";

type Input = {
  bytes: Buffer;
  type: string;
  email: string;
  prompt: string;
  category: string;
  ratio: string;
};

function sizeForRatio(ratio: string): "auto" | "1024x1024" | "1536x1024" | "1024x1536" {
  if (!ratio || ratio === "自动" || ratio === "auto") return "auto";
  const m = /^(\d+):(\d+)$/.exec(ratio);
  if (!m) return "auto";
  const r = Number(m[1]) / Number(m[2]);
  if (r > 1.1) return "1536x1024";
  if (r < 0.9) return "1024x1536";
  return "1024x1024";
}

async function parseInput(request: Request): Promise<Input | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();
  const file = f.get("image");
  if (!(file instanceof File && file.size > 0)) return null;
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    type: file.type || "image/png",
    email: s("email").trim(),
    prompt: s("prompt").trim(),
    category: s("category").trim(),
    ratio: s("ratio").trim(),
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

// --- 异步任务存储 ---------------------------------------------------------
type Job = {
  status: "pending" | "done" | "error";
  ts: number;
  id?: string;
  url?: string;
  creditsUsed?: number;
  user?: Awaited<ReturnType<typeof getUser>>;
  error?: string;
};
const JOBS = new Map<string, Job>();
function gcJobs() {
  const cutoff = Date.now() - 20 * 60 * 1000;
  JOBS.forEach((v, k) => {
    if (v.ts < cutoff) JOBS.delete(k);
  });
}

async function runJob(
  jobId: string,
  input: Input,
  cost: number,
  useDb: boolean
) {
  try {
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
      const png = await toPng(input.bytes);
      const cat = CATEGORIES[input.category];
      const hint = cat ? ` The item is a ${cat}.` : "";
      const userHint = input.prompt ? ` Extra requirement: ${input.prompt}.` : "";
      const prompt = BASE_PROMPT + hint + userHint;
      const r = await client.images.edit({
        model: genModel || "gpt-image-2",
        image: await toFile(png, "image.png", { type: "image/png" }),
        prompt,
        n: 1,
        size: sizeForRatio(input.ratio) as "1024x1024",
        quality: "high" as "high",
      });
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error("未返回 3D 图");
      out = Buffer.from(b64, "base64");
    } catch (e) {
      if (useDb && cost > 0) await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const id = `d3d-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(new Uint8Array(out), "image/png", `dress3d/${id}.png`);
      } catch (e) {
        console.error("[garment3d] R2 upload failed:", e instanceof Error ? e.message : e);
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
          `dress3d/src-${id}.${sext}`
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
              title: "3D 服装图",
              category: "dress3d",
              prompt: input.prompt,
              status: "completed",
              image: url,
              gradient: "from-indigo-100 to-slate-100",
              style: null,
              ratio: input.ratio || null,
              resolution: null,
              source: srcUrl,
              parentId: null,
              parentIds: [],
            },
          ],
          `d3d-${Date.now()}`
        );
      } catch (e) {
        console.error("[garment3d] addArtworks failed:", e instanceof Error ? e.message : e);
      }
      if (cost > 0) await addLedgerEntry(input.email, -cost, "3D 服装图").catch(() => {});
      user = await getUser(input.email).catch(() => null);
    }

    JOBS.set(jobId, {
      status: "done",
      ts: Date.now(),
      id,
      url,
      creditsUsed: useDb ? cost : 0,
      user,
    });
  } catch (e) {
    console.error("[garment3d] job failed:", e instanceof Error ? e.message : e);
    JOBS.set(jobId, {
      status: "error",
      ts: Date.now(),
      error: safeError(e, "3D 服装图服务暂时不可用,请稍后重试"),
    });
  }
}

export async function POST(request: Request) {
  let input: Input | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) return NextResponse.json({ error: "缺少服装图片" }, { status: 400 });
  if (input.bytes.length > 12 * 1024 * 1024)
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });

  try {
    const ip = clientIp(request);
    if (!rateLimit(`garment3d:${ip}`, 40, 600_000))
      return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });

    if (dbEnabled) {
      const tokenEmail = await emailFromToken(bearer(request));
      if (!tokenEmail)
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = COST;

    if (dbEnabled && (await isBanned(input.email, ip)))
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });

    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok)
        return NextResponse.json({ error: "积分不足,请充值后重试" }, { status: 402 });
    }

    // 立即建任务并秒回 jobId,生成在后台跑(避免 Cloudflare 100s 超时掐断)。
    gcJobs();
    const jobId = `d3dj-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    JOBS.set(jobId, { status: "pending", ts: Date.now() });
    void runJob(jobId, input, cost, useDb);
    return NextResponse.json({ jobId });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "3D 服装图服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "缺少 job" }, { status: 400 });
  const job = JOBS.get(jobId);
  if (!job) return NextResponse.json({ status: "error", error: "任务不存在或已过期" });
  if (job.status === "done")
    return NextResponse.json({
      status: "done",
      ok: true,
      id: job.id,
      url: job.url,
      creditsUsed: job.creditsUsed ?? 0,
      user: job.user ?? null,
    });
  if (job.status === "error")
    return NextResponse.json({ status: "error", error: job.error });
  return NextResponse.json({ status: "pending" });
}
