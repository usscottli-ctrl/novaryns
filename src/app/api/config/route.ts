import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { storageEnabled } from "@/lib/storage";
import { authMode } from "@/lib/auth-mode";
import { multiUserEnabled } from "@/lib/native-auth";
import { smtpConfigured } from "@/lib/mailer";

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
  });
}
