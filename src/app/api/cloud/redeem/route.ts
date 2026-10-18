import { NextResponse } from "next/server";
import { dbEnabled, inspectCloudCode, claimCloudCode } from "@/lib/db";
import { findCloudPlan } from "@/lib/cloud";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 开通码核销(买家侧,无需登录 —— 码本身就是凭据)。
//   action=check → 校验码并回显套餐,不消耗
//   action=claim → 核销并触发开通,返回订单号供轮询 /api/cloud/tenant
// 限流:码是可枚举的凭据(NVCL-4×3,去歧义字符集),必须挡住暴力猜码。
function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });

  let body: { action?: string; code?: string; email?: string; subdomain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "请填写开通码" }, { status: 400 });

  const ip = clientIp(req);
  // 查码比核销宽松些,但都足够挡住枚举(码空间 31^12,配 20 次/10 分钟不可能撞出来)。
  const limit = body.action === "claim" ? 5 : 20;
  if (!rateLimit(`cloudcode:${ip}`, limit, 10 * 60_000)) {
    return NextResponse.json({ error: "操作过于频繁,请稍后再试" }, { status: 429 });
  }

  if (body.action === "claim") {
    try {
      const { orderId } = await claimCloudCode(
        code,
        String(body.email ?? ""),
        String(body.subdomain ?? "")
      );
      return NextResponse.json({ ok: true, orderId });
    } catch (e) {
      // claimCloudCode 抛的都是给买家看的中文原因(不含内部细节)。
      const msg = e instanceof Error ? e.message : "开通失败,请联系客服";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const r = await inspectCloudCode(code);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const plan = findCloudPlan(r.planId);
  return NextResponse.json({
    ok: true,
    plan: plan ? { id: plan.id, label: plan.label, days: plan.days, credits: plan.credits } : null,
    // 上次开通失败 → 前端提示「换个名字重试」,不算废码。
    retryable: r.retryable,
  });
}
