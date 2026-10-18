import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { storageEnabled } from "@/lib/storage";
import { authMode } from "@/lib/auth-mode";
import { multiUserEnabled } from "@/lib/native-auth";
import { smtpConfigured } from "@/lib/mailer";
import { provisionerConfigured } from "@/lib/provisioner";
import { videoEnabled } from "@/lib/volcengine";
import { fluxConfigured } from "@/lib/flux-image";
import { relayTokenIdFromBaseUrl } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets the client know which integrations are live so it can choose between
// server persistence and the localStorage mock.
export async function GET() {
  const multiUser = await multiUserEnabled();
  return NextResponse.json({
    db: dbEnabled,
    storage: storageEnabled,
    authMode,
    // 原生多用户模式(运行时开关)。开则前端启用注册/登录(邮箱+密码)+ 会话 hydrate。
    multiUser,
    // 注册是否需要邮箱验证码(= 多用户 且 站长已配 SMTP);前端据此显示验证码栏。
    emailCode: multiUser && (await smtpConfigured()),
    openai: (process.env.OPENAI_API_KEY ?? "").length > 0,
    // 本实例是否启用「云端托管开通」编排(= 配了 provisioner)。只有官方购买站为真;
    // 据此在后台显示/隐藏「云端租户」面板,避免向普通自托管 Pro 买家暴露不属于他们的功能。
    cloudAdmin: provisionerConfigured(),
    // 视频生成(火山引擎方舟 Seedance)是否可用 = 后台或 env 配了 Key。
    // 前端据此显示/隐藏「视频」入口 —— 没配还显示的话,点进去只会拿到 503。
    videoEnabled: await videoEnabled(),
    // 香蕉(Nano Banana / Gemini)是否可用 = 直连 Key 或境外代跑通道二选一。
    // 2026-08-17 事故:模型选择器把四个模型全列出来,但云端租户 env 里一个 GEMINI_* 都没有
    // (租户的 OpenAI 走 relay 注入,香蕉没有对应通道) —— 客户选了香蕉、传完图、等完进度条,
    // 最后拿到「Nano Banana 未配置」。**没配就别列出来**,同 videoEnabled 的处理。
    // FLUX 是否可用 = 有 Replicate token 或配了境外代跑通道。
    // 同 geminiEnabled:没配就别在前台列出来,免得用户选了才失败。
    fluxEnabled: fluxConfigured(),
    geminiEnabled:
      (process.env.GEMINI_API_KEY ?? "").length > 0 ||
      ((process.env.GEMINI_PROXY_URL ?? "").length > 0 &&
        (process.env.INTERNAL_API_SECRET ?? "").length > 0),
    // 本实例是否为**云端托管租户**(= OPENAI_BASE_URL 指向 relay 的 nvr- 通道)。
    // 用途:租户后台要**隐藏「部署与授权」**——那一屏是 Novaryns 自己的售卖页
    // (开源版 GitHub + git clone 一键安装 + Pro ¥1,999 + 云端 ¥3,999/年),
    // 给已付费的托管客户看等于:①告诉他其实可以免费自部署 ②暴露标准价,
    // 与按项目谈的定制报价冲突。官方购买站与 Pro 自托管买家不受影响(仍要看 License 激活)。
    cloudTenant: relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "") !== null,
  });
}
