import "server-only";
import { getSetting, dbEnabled } from "@/lib/db";

// AI 服务「中转地址」(OpenAI 兼容 baseURL)。DB 优先 → env 兜底。
// 大陆服务器直连不了模型时,站长在后台「接口与模型」填一个中转/反代地址即可,
// 运行时立即生效,无需改 compose 或重启。空 = 直连(海外默认)。
export async function getOpenAIBaseUrl(): Promise<string> {
  const env = (process.env.OPENAI_BASE_URL || "").trim();
  if (dbEnabled) {
    try {
      const db = (await getSetting("openai_base_url"))?.trim();
      if (db) return db;
    } catch {
      /* 读失败回退 env */
    }
  }
  return env;
}
