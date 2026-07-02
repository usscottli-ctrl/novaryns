import { NextResponse } from "next/server";
import { isWechatEnabled, newWxSession, createLoginQr } from "@/lib/wechat";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

// 开始一次微信扫码登录:建会话 → 生成带参数临时二维码(5 分钟)。
// 前端拿 { sid, qr } 展示二维码并轮询 /api/wechat/login/poll。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isWechatEnabled())) {
    return NextResponse.json({ error: "wechat login not configured" }, { status: 503 });
  }
  // 每个二维码都要调微信接口,限流防刷
  if (!rateLimit(`wxlogin:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }
  try {
    const sid = newWxSession();
    const qr = await createLoginQr(sid);
    return NextResponse.json({ sid, qr, expiresIn: 300 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "二维码生成失败" },
      { status: 502 }
    );
  }
}
