import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getOpenAISettings } from "@/lib/settings";
import { emailFromToken, bearer } from "@/lib/supabase-admin";
import { dbEnabled } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/ip";
import { MODEL_GROUP_LABELS } from "@/lib/tryon-library";
import { getTryonLibrary } from "@/lib/tryon-store";
import { safeError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 服装上身专属 AI 帮写:读上传的服装图 +(可选)已选场景/模特,**按当前输入自适应**
// 写出一段电商试穿描述(中文)。免费、需登录、按 IP 限流。
const SYS =
  "你是电商服装试穿(虚拟上身)提示词助手。根据用户上传的服装图和已选的模特/场景,写一段【中文】描述,指导 AI 把这件衣服自然穿到模特身上、置于场景中,呈现真实电商上身效果。要点:1) 看图准确描述这件服装的品类/颜色/版型/关键细节(领型、门襟、袖口、下摆、印花文字等),并强调【完整保留】这些细节;2) 若给了模特,提到选用该类型模特(性别/气质);3) 若给了场景,带上场景环境、光线、姿态;4) 强调衣身贴合人体、自然褶皱与柔和阴影、真实电商视觉。只输出这段描述本身,不要解释、不要分点、不超过140字。";

export async function POST(req: Request) {
  if (dbEnabled) {
    const tokenEmail = await emailFromToken(bearer(req));
    if (!tokenEmail)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const ip = clientIp(req) || "0.0.0.0";
  if (!rateLimit(`tryon-assist:${ip}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }

  let imageDataUrl: string | null = null;
  let modelId = "";
  let sceneId = "";
  let idea = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data"))
      return NextResponse.json({ error: "请上传服装图" }, { status: 400 });
    const f = await req.formData();
    modelId = (f.get("modelId") ?? "").toString().trim();
    sceneId = (f.get("sceneId") ?? "").toString().trim();
    idea = (f.get("idea") ?? "").toString().slice(0, 300).trim();
    const file = f.get("garment");
    if (file instanceof File && file.size > 0 && file.size <= 10 * 1024 * 1024) {
      const buf = Buffer.from(await file.arrayBuffer());
      imageDataUrl = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;
    }
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!imageDataUrl)
    return NextResponse.json({ error: "请先上传服装图" }, { status: 400 });

  const lib = await getTryonLibrary();
  const model = modelId ? lib.models.find((x) => x.id === modelId) : undefined;
  const scene = sceneId ? lib.scenes.find((x) => x.id === sceneId) : undefined;

  const { apiKey } = await getOpenAISettings();
  if (!apiKey) {
    // 无 key 兜底:给通用试穿描述
    return NextResponse.json({
      prompt:
        "将图中的服装由模特自然试穿展示,完整保留服装的颜色、版型与领口/袖口/下摆等细节,衣身贴合人体、带真实褶皱与柔和阴影,背景干净简洁,呈现真实电商上身效果。",
    });
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const ctx: string[] = [];
    if (model)
      ctx.push(
        `已选模特:${model.name}(${MODEL_GROUP_LABELS[model.group].zh}${model.gender === "f" ? "·女" : "·男"})`
      );
    else ctx.push("未选模特(请泛指合适模特)");
    if (scene) ctx.push(`已选场景:${scene.name}(${scene.env})`);
    else ctx.push("未选场景(背景从简)");
    if (idea) ctx.push(`用户补充:${idea}`);

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYS },
        {
          role: "user",
          content: [
            { type: "text", text: ctx.join(";") },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.8,
      max_tokens: 400,
    });
    const prompt = (resp.choices[0]?.message?.content ?? "").trim();
    if (!prompt)
      return NextResponse.json({ error: "没生成出来,请重试" }, { status: 502 });
    return NextResponse.json({ prompt });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "AI 帮写失败,请稍后重试") },
      { status: 502 }
    );
  }
}
