import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getOpenAISettings } from "@/lib/settings";
import {
  getAssistSystem,
  getOptimizeSystem,
  ASSIST_TOOL_HINTS,
} from "@/lib/prompt-config";
import { emailFromToken, bearer } from "@/lib/supabase-admin";
import { dbEnabled } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";
import { safeError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI 帮写:把用户的简短想法 +(可选)上传的产品图,扩写成完整的电商生图提示词。
// 多模态:有产品图时把图发给视觉模型(gpt-4o-mini),据图写出贴合该产品的提示词。
// 纯文本 LLM,免费(不扣积分),但需登录 + 按 IP 限流,防脚本刷我们的 key。
export async function POST(req: Request) {
  if (dbEnabled) {
    const tokenEmail = await emailFromToken(bearer(req));
    if (!tokenEmail) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`assist:${ip}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }

  // 兼容 multipart(带产品图)与 JSON(纯文字)两种请求
  let idea = "";
  let category = "";
  let mode = "write"; // write=AI帮写(扩写) | optimize=智能优化(润色已写好的)
  let tool = ""; // 功能页标识(suite/inpaint/…),据此附加分工具写法指令
  let imageDataUrl: string | null = null;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const f = await req.formData();
      idea = (f.get("idea") ?? "").toString().slice(0, 600).trim();
      category = (f.get("category") ?? "").toString().slice(0, 40);
      mode = (f.get("mode") ?? "write").toString();
      tool = (f.get("tool") ?? "").toString().slice(0, 40);
      const file = f.get("image");
      if (file instanceof File && file.size > 0 && file.size <= 12 * 1024 * 1024) {
        const raw = Buffer.from(await file.arrayBuffer());
        // 视觉模型理解图片内容不需高清:压到长边 1024 + JPEG,payload 从几 MB 降到
        // 几十 KB,vision 调用快几十倍,避免大图慢/超时(CF 100s)导致前端「网络错误」。
        try {
          const mod = (await import("sharp")) as unknown as {
            default?: typeof import("sharp");
          } & typeof import("sharp");
          const sharp = mod.default ?? mod;
          const small = await sharp(raw)
            .rotate()
            .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          imageDataUrl = `data:image/jpeg;base64,${small.toString("base64")}`;
        } catch {
          imageDataUrl = `data:${file.type || "image/png"};base64,${raw.toString("base64")}`;
        }
      }
    } else {
      const body = (await req.json()) as {
        idea?: string;
        category?: string;
        mode?: string;
        tool?: string;
      };
      idea = (body.idea ?? "").toString().slice(0, 600).trim();
      category = (body.category ?? "").toString().slice(0, 40);
      mode = (body.mode ?? "write").toString();
      tool = (body.tool ?? "").toString().slice(0, 40);
    }
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const optimize = mode === "optimize";
  if (optimize && !idea) {
    return NextResponse.json({ error: "请先写点提示词再优化" }, { status: 400 });
  }
  const hasImage = !!imageDataUrl;

  // 帮写用 gpt-4o-mini(看图写,需视觉能力),复用主 OpenAI Key。
  const { apiKey } = await getOpenAISettings();
  if (!apiKey) {
    const base = idea || "高级电商主图";
    return NextResponse.json({
      prompt: `${base}，纯净背景，柔和均匀打光，居中构图，高级质感，商业产品摄影，可直接上架`,
    });
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    // 分功能页写法指令(prompt-config.ts 可审计)。
    // 关键:帮写(write)时,若有功能页专用指令,**不叠加通用「写整图大片」系统**
    // ——否则那段又长又强势的通用系统会盖过功能页语义(印花提取被写成整图模特大片)。
    // 直接以功能页要求为唯一系统。优化(optimize)只是润色,不冲突,追加即可。
    const hint = ASSIST_TOOL_HINTS[tool];
    let sys: string;
    if (optimize) {
      const optBase = await getOptimizeSystem();
      sys = hint
        ? `${optBase}\n【当前功能页专用,优先级最高;与上文冲突时以本条为准】${hint}`
        : optBase;
    } else if (hint) {
      sys =
        "你是电商 AI 提示词助手。看懂用户上传的图片与补充想法后,严格只按下面这一条【功能页要求】来写。" +
        "只输出要求的内容本身:中文、精炼、不解释、不加引号/前缀/Markdown。\n" +
        `【功能页要求】${hint}`;
    } else {
      sys = await getAssistSystem();
    }
    const ctx: string[] = [];
    if (category) ctx.push(`分类:${category}`);
    if (hasImage) {
      ctx.push(hint ? "已提供图片(请看图后严格按功能页要求写)" : "已提供产品图(看图后据此写,做图生图/换背景)");
    } else {
      ctx.push(hint ? "未提供图片" : "无产品图(纯文字生成整图)");
    }
    const label = optimize ? "待优化的提示词" : "用户的想法";
    const emptyHint = hint
      ? "(空,请看图按功能页要求给内容)"
      : "(空,按产品/分类给通用电商主图提示词)";
    const text = `${ctx.join(";")}\n${label}:${idea || emptyHint}`;
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: hasImage
            ? [
                { type: "text", text },
                { type: "image_url", image_url: { url: imageDataUrl as string } },
              ]
            : text,
        },
      ],
      temperature: 0.8,
      max_tokens: 500,
    });
    const prompt = (resp.choices[0]?.message?.content ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "没生成出来,请重试" }, { status: 502 });
    }
    return NextResponse.json({ prompt });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "AI 帮写失败,请稍后重试") },
      { status: 502 }
    );
  }
}
