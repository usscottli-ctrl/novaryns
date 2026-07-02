import { dbEnabled, getOrder, fulfillOrder } from "@/lib/db";
import { getPaymentSettings } from "@/lib/settings";
import { verifyAndDecryptWxNotify } from "@/lib/pay/wechatpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 微信支付 Native v3 异步通知回调。application/json。
// 解密 → 校验金额 → trade_state==="SUCCESS" 时幂等履约。
// 成功返回 {code:"SUCCESS"}(200);失败返回 {code:"FAIL",...}(非 200,微信会重试)。
// ---------------------------------------------------------------------------
function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ code: "FAIL", message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  if (!dbEnabled) {
    return fail("数据库未配置", 400);
  }

  const { wxpayApiv3 } = await getPaymentSettings();
  if (!wxpayApiv3) {
    return fail("微信支付未配置", 500);
  }

  const rawBody = await req.text();
  // ① 解密(平台证书验签为尽力而为,见库内 TODO)
  const decrypted = verifyAndDecryptWxNotify(wxpayApiv3, req.headers, rawBody);
  if (!decrypted.ok || !decrypted.outTradeNo) {
    return fail(decrypted.error || "回调验签/解密失败", 400);
  }

  // ② 金额校验:本地订单 amount(分)对比解密出的 amount.total(分)。
  const order = await getOrder(decrypted.outTradeNo);
  if (!order) {
    return fail("订单不存在", 400);
  }
  if (
    typeof decrypted.totalFen === "number" &&
    decrypted.totalFen !== order.amount
  ) {
    return fail("金额不匹配", 400);
  }

  // ③ 成功状态才履约(幂等)。
  if (decrypted.tradeState === "SUCCESS") {
    try {
      const r = await fulfillOrder(
        decrypted.outTradeNo,
        "wechat",
        decrypted.transactionId || null
      );
      if (!r.ok) return fail(r.error || "履约失败", 400);
    } catch {
      return fail("履约异常", 500);
    }
  }

  return new Response(JSON.stringify({ code: "SUCCESS" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
