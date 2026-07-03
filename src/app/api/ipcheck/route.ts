import { NextResponse } from "next/server";
import { toVisionDataUrl } from "@/lib/vision-image";
import OpenAI from "openai";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  getUser,
  isBanned,
  addLedgerEntry,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { bearer, emailFromToken } from "@/lib/supabase-admin";
import { getOpenAISettings } from "@/lib/settings";
import { safeError } from "@/lib/api-error";

// 侵权检测:视觉模型筛查图片的版权/IP 风险(知名卡通形象、品牌 logo、商标、明星肖像、名画等),
// 给出 高/中/低 风险 + 风险点 + 商用建议。**非生图**,不落作品库。计费 1 积分。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COST = 1;

const SYS =
  "你是电商图片的版权/知识产权风险筛查助手。看图判断它用于商用是否有侵权风险,重点查:① 知名版权卡通/动漫/游戏形象(如迪士尼米奇、三丽鸥、宝可梦等);② 品牌 logo / 商标 / 注册图形;③ 明星/公众人物肖像;④ 知名画作/IP 设计;⑤ 仿冒大牌元素。" +
  '只输出 JSON:{"risk":"high|medium|low","riskLabel":"高风险|中风险|低风险","summary":"一句话总体结论","items":[{"name":"风险元素","reason":"为什么有风险"}],"advice":"商用建议(中文,1-2句)"}。无明显风险则 risk=low、items=[]。不要输出 JSON 以外的内容。';

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`ipcheck:${ip}`, 40, 600_000))
    return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });

  let email = "";
  let imageDataUrl: string | null = null;
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data"))
      return NextResponse.json({ error: "请上传图片" }, { status: 400 });
    const f = await req.formData();
    email = (f.get("email") ?? "").toString().trim();
    const file = f.get("image");
    if (!(file instanceof File && file.size > 0))
      return NextResponse.json({ error: "请上传图片" }, { status: 400 });
    if (file.size > 12 * 1024 * 1024)
      return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    imageDataUrl = await toVisionDataUrl(buf, file.type);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (dbEnabled) {
    const tokenEmail = await emailFromToken(bearer(req));
    if (!tokenEmail)
      return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
    email = tokenEmail;
  }
  const useDb = dbEnabled && email.length > 0;

  if (dbEnabled && (await isBanned(email, ip)))
    return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });

  if (useDb) {
    const ok = await reserveCredits(email, COST);
    if (!ok)
      return NextResponse.json({ error: "积分不足,请充值后重试" }, { status: 402 });
  }

  try {
    const { apiKey } = await getOpenAISettings();
    if (!apiKey) throw new Error("未配置 key");
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYS },
        {
          role: "user",
          content: [
            { type: "text", text: "检测这张图片的商用版权风险。" },
            { type: "image_url", image_url: { url: imageDataUrl as string } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { risk: "low", riskLabel: "低风险", summary: "未识别到明显风险", items: [], advice: "" };
    }
    if (useDb) {
      await addLedgerEntry(email, -COST, "侵权检测").catch(() => {});
    }
    const user = useDb ? await getUser(email).catch(() => null) : null;
    return NextResponse.json({ ok: true, result: data, creditsUsed: useDb ? COST : 0, user });
  } catch (e) {
    if (useDb) await refundCredits(email, COST).catch(() => {});
    return NextResponse.json(
      { error: safeError(e, "侵权检测服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
