// ---------------------------------------------------------------------------
// 错误净化:把上游(OpenAI/Replicate 等)或内部异常,统一转成**不泄露厂商/模型**
// 的友好中文提示。原则:catch 兜底绝不把原始 e.message 回传给前端 —— 那可能含
// "openai""gpt""quota""platform.openai.com" 等字样,会暴露我们用的模型。
//
// 用法:catch (e) { return NextResponse.json({ error: safeError(e, "生成失败,请稍后重试") }, ...) }
// ---------------------------------------------------------------------------

import { editionName } from "@/lib/edition";

export function safeError(e: unknown, fallback = "服务繁忙,请稍后重试"): string {
  const raw =
    e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const low = (raw || "").toLowerCase();

  // 配额 / 账单 / 限流 / 过载
  if (
    /quota|billing|insufficient|exceeded|rate.?limit|\b429\b|too many|capacity|overload|hard limit|spend|credit balance/.test(
      low
    )
  )
    return "生成服务繁忙,请稍后再试";

  // 内容安全 / 审核
  if (
    /safety|content.?polic|moderation|flagged|rejected by the safety|violat|nsfw|sensitive|not allowed/.test(
      low
    )
  )
    return "图片或描述未通过内容审核,请调整后重试";

  // 超时 / 网络 / 连不上
  if (
    /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|network|socket|fetch failed|aborted|gateway|502|503|504/.test(
      low
    )
  ) {
    // 自部署实例(非官方云):连不上模型服务,几乎都是大陆没配中转/反代所致 → 明确指路。
    if (editionName !== "cloud") {
      return "无法连接到 AI 服务。大陆服务器通常需要配置「中转地址」才能访问 —— 请在后台「接口与模型」查看配置说明,或联系作者微信 xingze063 协助部署。";
    }
    return "网络繁忙,请稍后重试";
  }

  // 其他:统一兜底,绝不回传原始 message(可能含厂商/模型信息)
  return fallback;
}
