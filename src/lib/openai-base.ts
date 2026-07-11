import "server-only";
import { dbEnabled } from "@/lib/db";
import { readOpenAIBaseUrlPlain } from "@/lib/settings";

// AI 模型接口地址(OpenAI 兼容 baseURL)。DB(加密存储)优先 → env 兜底。
// 大陆服务器直连不了模型时,站长在后台「接口与模型」填一个接口地址即可,
// 运行时立即生效,无需改 compose 或重启。空 = 直连(海外默认)。
// 落库为密文(readOpenAIBaseUrlPlain 解密 + 兼容历史明文),保护海外域名/凭证。
export async function getOpenAIBaseUrl(): Promise<string> {
  const env = (process.env.OPENAI_BASE_URL || "").trim();
  if (dbEnabled) {
    try {
      const db = (await readOpenAIBaseUrlPlain()).trim();
      if (db) return db;
    } catch {
      /* 读/解密失败回退 env */
    }
  }
  return env;
}
