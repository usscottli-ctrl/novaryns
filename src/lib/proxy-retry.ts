// 跨境代跑请求的重试封装 —— 所有 *_PROXY_URL 通道共用。
//
// 为什么需要:国内站到美国机这条链路**本身不稳**(实测偶发 ECONNRESET;
// 2026-08-18 客户连着两次生图失败就是它)。一次连接被重置 = 整个任务失败,
// 而用户看到的只是"图片生成失败,请稍后重试"。
//
// 只对**连接层错误**重试:业务错误(参数不对、内容被拒)重试没意义,还多花一次钱。
// 上游若已扣费而连接被重置,重试会重复计费(每次几毛),但比让客户看到失败划算。

/** 连接层错误(不是业务错误)才值得重试。 */
export function isTransientNetError(e: unknown): boolean {
  const m = String((e as Error)?.message || e);
  const code = String((e as { cause?: { code?: string } })?.cause?.code || "");
  return (
    /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network/i.test(m) ||
    /ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code)
  );
}

/** 跑一个可能因跨境链路抖动而失败的操作,连接层错误自动重试。 */
export async function withProxyRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts || !isTransientNetError(e)) throw e;
      console.warn(
        `[${label}] 第 ${i} 次连接失败(${String((e as Error)?.message || e).slice(0, 60)}),重试`
      );
      await new Promise((r) => setTimeout(r, i * 1500));
    }
  }
  throw lastErr;
}
