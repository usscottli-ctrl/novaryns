import { NextResponse } from "next/server";
import { videoCost } from "@/lib/mock-data";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  createVideoJob,
  isBanned,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { resolveUserEmail } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { cdnUrl } from "@/lib/cdn";
import { safeError } from "@/lib/api-error";
import {
  videoEnabled,
  createVideoTask,
  type VideoResolution,
} from "@/lib/volcengine";
import { loadPriceOverrides } from "@/lib/price-overrides";

// ---------------------------------------------------------------------------
// 视频生成 —— 创建任务(火山引擎方舟 Seedance)。
//
// 只负责「预扣积分 + 把任务丢给方舟 + 登记 job」,拿到 task_id 就立刻返回。
// 出片要几十秒到数分钟,前端拿 taskId 去轮询 /api/video/status,别在这里等。
//
// 主力场景是图生视频:上传一张产品图 → 直接动起来。有图走图生视频(首帧),没图退回文生视频。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE = 12 * 1024 * 1024;

type VideoInput = {
  bytes: Buffer | null;
  type: string;
  email: string;
  title: string;
  prompt: string;
  duration: number;
  resolution: VideoResolution;
  ratio: string;
  parentId: string;
  sourceUrl: string; // 已有作品直接生视频时传(免重新上传)
};

async function parseInput(request: Request): Promise<VideoInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();

  let bytes: Buffer | null = null;
  let type = "image/png";
  const file = f.get("image");
  if (file instanceof File && file.size > 0) {
    bytes = Buffer.from(await file.arrayBuffer());
    type = file.type || "image/png";
  }

  // 实测 Seedance 2.5:3 秒不支持,4~12 可用。夹到 4~12 避免上游 400
  // (前端只给 5/8/10/12,这里是兜底 —— 直接打接口的调用方也不会踩坑)。
  const rawDur = Number.parseInt(s("duration"), 10);
  const duration = Number.isFinite(rawDur)
    ? Math.min(12, Math.max(4, rawDur))
    : 5;

  return {
    bytes,
    type,
    email: s("email").trim(),
    title: s("title").trim() || "AI 视频",
    prompt: s("prompt").trim(),
    duration,
    resolution: (["480p", "720p", "1080p"].includes(s("resolution"))
      ? s("resolution")
      : "720p") as VideoResolution,
    ratio: s("ratio").trim() || "16:9",
    parentId: s("parentId").trim(),
    sourceUrl: s("sourceUrl").trim(),
  };
}

export async function POST(request: Request) {
  let input: VideoInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input.prompt) {
    // H3 的 content 数组必须含一个非空 text,缺了直接 422,先在本地挡掉。
    return NextResponse.json({ error: "请填写视频描述" }, { status: 400 });
  }
  if (input.bytes && input.bytes.length > MAX_IMAGE) {
    return NextResponse.json({ error: "参考图过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`video:${ip}`, 20, 600_000)) {
      return NextResponse.json(
        { error: "请求过于频繁,请稍后再试" },
        { status: 429 }
      );
    }

    if (dbEnabled) {
      const tokenEmail = await resolveUserEmail(request);
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;

    if (dbEnabled && (await isBanned(input.email, ip))) {
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });
    }

    // 先看服务可用性再扣积分,免得配置缺失还扣了钱。
    if (!(await videoEnabled())) {
      return NextResponse.json(
        { error: "视频生成服务未配置" },
        { status: 503 }
      );
    }

    await loadPriceOverrides(); // 站长在后台改的板块价
    const cost = videoCost(input.duration, input.resolution);
    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok) {
        return NextResponse.json(
          { error: "积分不足,请充值后重试" },
          { status: 402 }
        );
      }
    }
    const refund = async () => {
      if (useDb && cost > 0)
        await refundCredits(input!.email, cost).catch(() => {});
    };

    try {
      // 参考图要给方舟服务器拉取,必须是公网可达的地址。
      // 优先用调用方传来的 sourceUrl(画布/作品页对已有图生视频);否则上传到 R2。
      // 本地存储驱动下 uploadImage 返回相对路径,外部拉不到 —— 退回 base64
      // 内联(官方允许,只是提醒大文件别用;我们上限 12MB,在 64MB 请求体内)。
      let frameUrl = "";
      let archivedSource: string | null = null;

      if (input.sourceUrl && /^https?:/.test(input.sourceUrl)) {
        frameUrl = cdnUrl(input.sourceUrl);
        archivedSource = input.sourceUrl;
      } else if (input.bytes) {
        const ext = input.type.includes("png")
          ? "png"
          : input.type.includes("webp")
            ? "webp"
            : "jpg";
        const key = `videos/src-${Date.now()}-${Math.floor(
          Math.random() * 1e4
        )}.${ext}`;
        if (storageEnabled) {
          try {
            const stored = await uploadImage(
              new Uint8Array(input.bytes),
              input.type,
              key
            );
            if (/^https?:/.test(stored)) {
              archivedSource = stored;
              frameUrl = cdnUrl(stored);
            }
          } catch (e) {
            console.error(
              "[video] source upload failed:",
              e instanceof Error ? e.message : e
            );
          }
        }
        if (!frameUrl) {
          frameUrl = `data:${input.type};base64,${input.bytes.toString("base64")}`;
        }
      }

      const isI2V = frameUrl.length > 0;
      const taskId = await createVideoTask({
        prompt: input.prompt,
        firstFrameUrl: isI2V ? frameUrl : undefined,
        resolution: input.resolution,
        duration: input.duration,
        // 图生视频的比例由输入图决定,只有文生视频要显式给。
        ratio: input.ratio,
        watermark: true, // 国内合规:生成内容打 AIGC 标识
      });

      if (useDb) {
        await createVideoJob({
          taskId,
          email: input.email,
          cost,
          title: input.title,
          prompt: input.prompt,
          resolution: input.resolution,
          duration: input.duration,
          sourceUrl: archivedSource,
          parentId: input.parentId || null,
        });
      }

      return NextResponse.json({
        ok: true,
        taskId,
        mode: isI2V ? "image-to-video" : "text-to-video",
        cost: useDb ? cost : 0,
        duration: input.duration,
        resolution: input.resolution,
      });
    } catch (e) {
      await refund();
      throw e;
    }
  } catch (e) {
    console.error(
      "[video] create failed:",
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: safeError(e, "视频生成服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
