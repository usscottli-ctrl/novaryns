// 查询异步生成任务的进度(`/api/xxx?job=<id>`)—— 前端各生成页的轮询共用。
//
// 为什么要这一层(2026-10-19,pro1 客户反馈「图裂变再点生成提示 Failed to fetch」):
//   一次生成要几十秒,前端每 2.5 秒问一次进度,中间要发十几个请求。原来的写法里
//   **任何一次**请求没连上(Wi-Fi 切换、本机代理抖一下、服务刚重启返回 502 网页),
//   fetch / res.json() 就抛错,整个任务被判失败,还把浏览器原始报错 "Failed to fetch"
//   直接显示给用户 —— 而服务端其实照常跑完、图也存进了作品库。
//
// 现在:单次失败自动重试(连续最多 4 次,间隔递增),真正连不上才报一句人话。
// 业务错误(服务端返回 status:"error")不在这里处理,原样交给调用方。

const RETRIES = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各页面的任务状态结构不同,原来就是 res.json() 的 any
export async function fetchJobStatus<T = any>(
  url: string,
  init?: RequestInit
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const res = await fetch(url, { cache: "no-store", ...init });
      // 502/504 等网关错误返回的是 HTML,不是任务状态 —— 当作暂时连不上,重试
      if (res.status >= 502 && res.status <= 504) throw new Error(`gateway ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < RETRIES) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  console.warn("[poll-job] 连续获取进度失败:", lastErr);
  throw new Error("网络不稳定,暂时查不到生成进度。生成结果会自动保存到「作品库」,请稍后到作品库查看");
}
