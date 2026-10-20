import "server-only";
import OpenAI from "openai";
import { getChatLLMSettings, getOpenAISettings } from "@/lib/settings";
import { getOpenAIBaseUrl } from "@/lib/openai-base";

// 「看图 + 写字」用的对话模型客户端(套图规划 / AI帮写 / 标题生成共用)。
// 后台配了「识图/文案模型」就用它;没配退回主 OpenAI Key + gpt-4o-mini(原行为)。
// 都没有返回 null,调用方走各自的无 Key 兜底。
export async function getChatLLM(
  opts: { timeout?: number } = {}
): Promise<{ client: OpenAI; model: string } | null> {
  const c = await getChatLLMSettings();
  if (c.apiKey) {
    return {
      client: new OpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl, timeout: opts.timeout, maxRetries: 1 }),
      model: c.model,
    };
  }
  const { apiKey } = await getOpenAISettings();
  if (!apiKey) return null;
  return {
    client: new OpenAI({
      apiKey,
      baseURL: (await getOpenAIBaseUrl()) || undefined,
      timeout: opts.timeout,
      maxRetries: 1,
    }),
    model: "gpt-4o-mini",
  };
}

// 模型回的 JSON 可能被 ```json 包着或前后带话(部分国产模型不支持 json_object 模式),
// 取第一个 { 到最后一个 } 之间解析。
export function parseJsonLoose<T>(raw: string): T | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(raw.slice(s, e + 1)) as T;
  } catch {
    return null;
  }
}
