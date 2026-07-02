import { dbEnabled, getOrder, fulfillOrder } from "@/lib/db";
import { getPaymentSettings } from "@/lib/settings";
import { verifyAlipayNotify } from "@/lib/pay/alipay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 支付宝「当面付」异步通知回调。application/x-www-form-urlencoded。
// 验签 → 校验金额 → trade_status 成功时幂等履约 → 返回纯文本 "success"。
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  if (!dbEnabled) {
    return new Response("failure", { status: 200 });
  }

  // 解析 x-www-form-urlencoded 表单。
  const params: Record<string, string> = {};
  try {
    const raw = await req.text();
    const sp = new URLSearchParams(raw);
    sp.forEach((v, k) => {
      params[k] = v;
    });
  } catch {
    return new Response("failure", { status: 200 });
  }

  const { alipayPublicKey } = await getPaymentSettings();
  // ① 验签
  if (!verifyAlipayNotify(params, alipayPublicKey)) {
    return new Response("failure", { status: 200 });
  }

  const outTradeNo = params.out_trade_no || "";
  const tradeStatus = params.trade_status || "";
  const tradeNo = params.trade_no || "";
  const totalAmount = params.total_amount || ""; // 元

  if (!outTradeNo) {
    return new Response("failure", { status: 200 });
  }

  // ② 金额校验:本地订单 amount(分)对比通知 total_amount(元)。
  const order = await getOrder(outTradeNo);
  if (!order) {
    return new Response("failure", { status: 200 });
  }
  const expectedFen = order.amount;
  const notifyFen = Math.round(parseFloat(totalAmount) * 100);
  if (!Number.isFinite(notifyFen) || notifyFen !== expectedFen) {
    return new Response("failure", { status: 200 });
  }

  // ③ 仅在交易成功状态履约(幂等,fulfillOrder 内部 FOR UPDATE + 已付即 no-op)。
  if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
    try {
      const r = await fulfillOrder(outTradeNo, "alipay", tradeNo);
      if (!r.ok) return new Response("failure", { status: 200 });
    } catch {
      return new Response("failure", { status: 200 });
    }
  }

  // 支付宝要求收到通知后返回纯文本 "success",否则会重试。
  return new Response("success", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
