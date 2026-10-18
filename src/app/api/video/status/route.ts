import { NextResponse } from "next/server";
import {
  dbEnabled,
  refundCredits,
  addArtworks,
  addLedgerEntry,
  getUser,
  getVideoJob,
  settleVideoJob,
} from "@/lib/db";
import { resolveUserEmail } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { safeError } from "@/lib/api-error";
import { videoEnabled, queryVideoTask } from "@/lib/volcengine";

// ---------------------------------------------------------------------------
// 视频生成 —— 轮询任务状态。前端每 5 秒打一次,直到 done / failed。
//
// 这里是**结算点**:
//   succeeded → 把成片从上游转存到 R2(上游 URL 只有 24h 有效,不能直接落库)
//               → 落一条 category="video" 的作品 → 记账
//   failed    → 退回预扣的积分
// 结算靠 settleVideoJob 的原子 UPDATE 保证只发生一次;并发轮询里的其他请求拿
// 不到"结算权",会走 already-settled 分支读库返回,不会重复退款或重复落作品。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  try {
    if (!(await videoEnabled())) {
      return NextResponse.json({ error: "视频生成服务未配置" }, { status: 503 });
    }

    let email = "";
    if (dbEnabled) {
      const tokenEmail = await resolveUserEmail(request);
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      email = tokenEmail;
    }
    const useDb = dbEnabled && email.length > 0;

    // 归属校验:传别人的 taskId 会拿到 null,避免越权看到他人任务。
    const job = useDb ? await getVideoJob(taskId, email) : null;
    if (useDb && !job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    // 已结算过的任务直接读库返回,不再打上游。
    if (job && job.status !== "pending") {
      return NextResponse.json({
        ok: true,
        status: job.status === "succeeded" ? "done" : "failed",
        url: job.videoUrl,
        id: job.artworkId,
        // job.error 是上游原文,只留在库里给后台排查,不回给前端。
        error: job.status === "failed" ? "视频生成失败,积分已退回" : null,
      });
    }

    const task = await queryVideoTask(taskId);

    if (task.status === "queued" || task.status === "running") {
      return NextResponse.json({
        ok: true,
        status: task.status === "queued" ? "queued" : "processing",
      });
    }

    if (task.status === "failed" || task.status === "cancelled") {
      if (useDb && job) {
        const claimed = await settleVideoJob(taskId, {
          status: "failed",
          error: `上游任务 ${task.status}`,
        });
        // 只有拿到结算权的那次才退积分。
        if (claimed && claimed.cost > 0) {
          await refundCredits(claimed.email, claimed.cost).catch(() => {});
        }
      }
      return NextResponse.json({
        ok: true,
        status: "failed",
        error: "视频生成失败,积分已退回",
      });
    }

    // ---- succeeded:转存成片 ------------------------------------------------
    const upstream = task.content?.video_url ?? "";
    if (!upstream) throw new Error("上游未返回视频地址");

    const dl = await fetch(upstream, { cache: "no-store" });
    if (!dl.ok) throw new Error(`下载成片失败 ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const contentType = dl.headers.get("content-type") || "video/mp4";

    const id = `vid-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = upstream; // R2 未配置时退回上游地址(24h 内可用)
    if (storageEnabled) {
      url = await uploadImage(new Uint8Array(buf), contentType, `videos/${id}.mp4`);
    }

    if (!useDb || !job) {
      return NextResponse.json({ ok: true, status: "done", id, url });
    }

    const claimed = await settleVideoJob(taskId, {
      status: "succeeded",
      videoUrl: url,
      artworkId: id,
    });
    if (!claimed) {
      // 另一个并发轮询已经结算完了 —— 读库返回它落的那条,别重复落作品。
      const fresh = await getVideoJob(taskId, email);
      return NextResponse.json({
        ok: true,
        status: "done",
        id: fresh?.artworkId ?? id,
        url: fresh?.videoUrl ?? url,
      });
    }

    try {
      await addArtworks(
        claimed.email,
        [
          {
            id,
            title: claimed.title,
            category: "video",
            prompt: claimed.prompt,
            status: "completed",
            image: url,
            gradient: "from-slate-800 to-slate-900",
            style: null,
            // 方舟不回显比例(它由参数/参考图决定),作品记录里留空。
            ratio: null,
            resolution: claimed.resolution,
            source: claimed.sourceUrl,
            parentId: claimed.parentId,
            parentIds: [],
          },
        ],
        `vid-${Date.now()}`
      );
    } catch (e) {
      console.error(
        "[video] addArtworks failed:",
        e instanceof Error ? e.message : e
      );
    }
    if (claimed.cost > 0) {
      await addLedgerEntry(claimed.email, -claimed.cost, "AI 视频生成").catch(
        () => {}
      );
    }
    const user = await getUser(claimed.email).catch(() => null);

    return NextResponse.json({
      ok: true,
      status: "done",
      id,
      url,
      creditsUsed: claimed.cost,
      user,
    });
  } catch (e) {
    console.error(
      "[video] status failed:",
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: safeError(e, "查询视频状态失败,请稍后重试") },
      { status: 500 }
    );
  }
}
