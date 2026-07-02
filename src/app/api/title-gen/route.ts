import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getOpenAISettings } from "@/lib/settings";
import { getTitleSystem } from "@/lib/prompt-config";
import { emailFromToken, bearer } from "@/lib/supabase-admin";
import { dbEnabled, addArtworks } from "@/lib/db";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";
import { safeError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 标题生成:据产品图(可选)+ 用户卖点/描述,生成一组电商标题 + 卖点短语。
// 纯文本 LLM(gpt-4o-mini),免费(不扣积分),需登录 + 按 IP 限流,防脚本刷 key。
export async function POST(req: Request) {
  let email = "";
  if (dbEnabled) {
    const tokenEmail = await emailFromToken(bearer(req));
    if (!tokenEmail) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    email = tokenEmail;
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`title:${ip}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }

  // 兼容 multipart(带产品图)与 JSON(纯文字)
  let idea = "";
  let platform = "";
  let style = "";
  let lang = "";
  let count = 6;
  let imageDataUrl: string | null = null;
  let imageBuf: Buffer | null = null;
  let imageType = "image/png";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const f = await req.formData();
      idea = (f.get("idea") ?? "").toString().slice(0, 800).trim();
      platform = (f.get("platform") ?? "").toString().slice(0, 40);
      style = (f.get("style") ?? "").toString().slice(0, 40);
      lang = (f.get("lang") ?? "").toString().slice(0, 20);
      count = Math.min(Math.max(Number(f.get("count")) || 1, 1), 12);
      const file = f.get("image");
      if (file instanceof File && file.size > 0 && file.size <= 8 * 1024 * 1024) {
        const buf = Buffer.from(await file.arrayBuffer());
        imageBuf = buf;
        imageType = file.type || "image/png";
        imageDataUrl = `data:${imageType};base64,${buf.toString("base64")}`;
      }
    } else {
      const body = (await req.json()) as {
        idea?: string;
        platform?: string;
        style?: string;
        lang?: string;
        count?: number;
      };
      idea = (body.idea ?? "").toString().slice(0, 800).trim();
      platform = (body.platform ?? "").toString().slice(0, 40);
      style = (body.style ?? "").toString().slice(0, 40);
      lang = (body.lang ?? "").toString().slice(0, 20);
      count = Math.min(Math.max(Number(body.count) || 1, 1), 12);
    }
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const hasImage = !!imageDataUrl;
  // 既没图也没文字 → 不让模型凭空编
  if (!hasImage && !idea) {
    return NextResponse.json(
      { error: "请先上传产品图,或写点产品描述/卖点再生成" },
      { status: 400 }
    );
  }

  const { apiKey } = await getOpenAISettings();
  if (!apiKey) {
    const base = idea || "热销好物";
    return NextResponse.json({
      titles: Array.from({ length: count }, (_, i) =>
        `${base} 精选优选 高品质 多场景适用（示例标题 ${i + 1}）`
      ),
      sellingPoints: ["品质优选", "热销爆款", "多场景适用", "高性价比"],
    });
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const sys = await getTitleSystem();
    const ctx: string[] = [`需要 ${count} 条标题`];
    if (platform) ctx.push(`平台:${platform}`);
    if (style) ctx.push(`风格:${style}`);
    if (lang) ctx.push(`输出语言:${lang}`);
    ctx.push(hasImage ? "已提供产品图(看图后据此写)" : "无产品图(据描述写)");
    const text = `${ctx.join(";")}\n产品描述/卖点:${idea || "(空,看图自行判断)"}`;
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
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
      temperature: 0.85,
      max_tokens: 1300,
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    let parsed: { titles?: unknown; sellingPoints?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "没生成出来,请重试" }, { status: 502 });
    }
    const titles = Array.isArray(parsed.titles)
      ? parsed.titles.filter((x) => typeof x === "string" && x.trim()).slice(0, 12)
      : [];
    const sellingPoints = Array.isArray(parsed.sellingPoints)
      ? parsed.sellingPoints
          .filter((x) => typeof x === "string" && x.trim())
          .slice(0, 8)
      : [];
    if (titles.length === 0) {
      return NextResponse.json({ error: "没生成出来,请重试" }, { status: 502 });
    }
    // 落库为「本工具记录」(仅有原图时):存原图 + 第一条标题。免费,不扣分,失败不影响返回。
    if (dbEnabled && email && imageBuf && storageEnabled) {
      try {
        const id = `title-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
        const ext = imageType.includes("png")
          ? "png"
          : imageType.includes("webp")
            ? "webp"
            : "jpg";
        const url = await uploadImage(
          new Uint8Array(imageBuf),
          imageType,
          `titles/src-${id}.${ext}`
        );
        await addArtworks(email, [
          {
            id,
            title: (titles[0] || "标题生成").slice(0, 80),
            category: "titles",
            // prompt 存「生成的标题」,这样右列点记录时能把标题带出来给用户看
            prompt: titles[0] || "",
            status: "completed",
            image: url,
            gradient: "from-amber-100 to-orange-100",
            source: url,
          },
        ]);
      } catch {
        /* 落库失败不影响返回标题 */
      }
    }
    return NextResponse.json({ titles, sellingPoints });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "标题生成失败,请稍后重试") },
      { status: 502 }
    );
  }
}
