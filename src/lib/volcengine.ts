import "server-only";
import { getVideoSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// 火山引擎方舟(Ark)视频生成客户端 —— Seedance 系列。
//
// 官方接口:POST /api/v3/contents/generations/tasks 创建任务
//          GET  /api/v3/contents/generations/tasks/{id} 查询
// 鉴权:Bearer <ARK_API_KEY>(方舟 API Key,不是 AK/SK —— 方舟这套 OpenAI 兼容
// 接口不吃 AK/SK 直签,见 [[project_teacup_ads_pipeline]] 踩过的坑)。
//
// 异步:一条视频几十秒到数分钟,**绝不能在 Next.js 路由里同步等**,所以这里只封
// 装「创建」「查一次」两个原子动作,排队交给 /api/video 与 /api/video/status。
//
// 参数走「文本指令」而非独立字段:分辨率/时长/比例/水印都以 --rs --dur --rt
// --wm 形式拼在 prompt 末尾,这是 Seedance 的约定,和 MiniMax 用 JSON 字段不同。
// ---------------------------------------------------------------------------

const DEFAULT_BASE = "https://ark.cn-beijing.volces.com";

// 模型清单与分辨率类型放在 mock-data(客户端也要用,本文件是 server-only)。
export { VIDEO_MODELS, DEFAULT_VIDEO_MODEL } from "@/lib/mock-data";
import { DEFAULT_VIDEO_MODEL } from "@/lib/mock-data";
export type { VideoResolution } from "@/lib/mock-data";
import type { VideoResolution } from "@/lib/mock-data";

/** 是否已配置视频服务(后台 Key 或 env)。未配置时视频功能整体 503。 */
export async function videoEnabled(): Promise<boolean> {
  const s = await getVideoSettings();
  return s.apiKey.length > 0;
}

export type CreateVideoParams = {
  prompt: string;
  /** 首帧图 URL(公网可达)或 data: base64。有则走图生视频。 */
  firstFrameUrl?: string;
  resolution: VideoResolution;
  duration: number; // 秒
  ratio: string; // 如 16:9;图生视频时由参考图决定,不下发
  watermark?: boolean;
};

export type ArkTask = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
  usage?: { completion_tokens?: number; total_tokens?: number };
};

/** 从方舟错误响应里挖可读信息(不同错误码结构不一致)。 */
function errText(status: number, body: unknown): string {
  const j = body as
    | { error?: { message?: string; code?: string } | string; message?: string }
    | undefined;
  const msg =
    (typeof j?.error === "string" ? j.error : j?.error?.message) || j?.message;
  return msg ? `Ark ${status}: ${msg}` : `Ark ${status}`;
}

/**
 * 创建视频生成任务,返回 task id。失败抛错(调用方负责退积分)。
 *
 * content 数组:第一个元素是带参数后缀的文本;有首帧图再追加一个 image_url。
 */
export async function createVideoTask(p: CreateVideoParams): Promise<string> {
  const s = await getVideoSettings();
  if (!s.apiKey) throw new Error("视频生成服务未配置");
  const base = (s.baseUrl || DEFAULT_BASE).replace(/\/$/, "");

  // Seedance 的参数以文本指令附在 prompt 后面。
  // 图生视频的画面比例由参考图决定,显式传 --rt 反而会冲突,所以只在文生时给。
  const flags = [
    `--rs ${p.resolution}`,
    `--dur ${Math.round(p.duration)}`,
    p.firstFrameUrl ? "" : `--rt ${p.ratio}`,
    p.watermark ? "--wm true" : "--wm false",
  ]
    .filter(Boolean)
    .join(" ");

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${p.prompt} ${flags}`.trim() },
  ];
  if (p.firstFrameUrl) {
    content.push({
      type: "image_url",
      image_url: { url: p.firstFrameUrl },
      role: "first_frame",
    });
  }

  const r = await fetch(`${base}/api/v3/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${s.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: s.model, content }),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  if (!r.ok) throw new Error(errText(r.status, j));
  if (!j.id) throw new Error(errText(r.status, j) || "Ark 未返回任务 ID");
  return j.id;
}

/**
 * 查询任务。成功时 content.video_url 是成片地址。
 * ⚠️ 该 URL **仅 24 小时有效**,拿到必须立刻转存 R2,不能落库当长期地址。
 */
export async function queryVideoTask(taskId: string): Promise<ArkTask> {
  const s = await getVideoSettings();
  if (!s.apiKey) throw new Error("视频生成服务未配置");
  const base = (s.baseUrl || DEFAULT_BASE).replace(/\/$/, "");

  const r = await fetch(
    `${base}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    {
      headers: { Authorization: `Bearer ${s.apiKey}` },
      cache: "no-store",
    }
  );
  const j = (await r.json().catch(() => ({}))) as ArkTask;
  if (!r.ok) throw new Error(errText(r.status, j));
  if (!j.id && !j.status) throw new Error("Ark 未返回任务信息");
  return j;
}
