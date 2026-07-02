import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getAssistModelSettings } from "@/lib/settings";
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
      if (file instanceof File && file.size > 0 && file.size <= 8 * 1024 * 1024) {
        const buf = Buffer.from(await file.arrayBuffer());
        imageDataUrl = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;
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

  // 帮写模型三件套(后台「接口与模型」可配):模型/BaseURL/独立 Key(留空复用主 Key)
  const { apiKey, model, baseURL } = await getAssistModelSettings();
  if (!apiKey) {
    const base = idea || "高级电商主图";
    return NextResponse.json({
      prompt: `${base}，纯净背景，柔和均匀打光，居中构图，高级质感，商业产品摄影，可直接上架`,
    });
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: baseURL || undefined,
    });
    const base = optimize ? await getOptimizeSystem() : await getAssistSystem();
    // 分功能页写法指令(prompt-config.ts 可审计)。必须声明最高优先级,
    // 否则通用 system 的「写整图成品大片」会盖过功能页语义(如印花提取)。
    const hint = ASSIST_TOOL_HINTS[tool];
    const sys = hint
      ? `${base}\n【当前功能页专用写法,优先级最高;与上文通用要求冲突时,一律以本条为准】${hint}`
      : base;
    const ctx: string[] = [];
    if (category) ctx.push(`分类:${category}`);
    ctx.push(hasImage ? "已提供产品图(看图后据此写,做图生图/换背景)" : "无产品图(纯文字生成整图)");
    const label = optimize ? "待优化的提示词" : "用户的想法";
    const text = `${ctx.join(";")}\n${label}:${idea || "(空,按产品/分类给通用电商主图提示词)"}`;
    const resp = await client.chat.completions.create({
      model,
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
