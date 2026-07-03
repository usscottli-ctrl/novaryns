import { NextResponse } from "next/server";
import { dbEnabled, createOrder } from "@/lib/db";
import { resolveItem } from "@/lib/payments";
import { getPaymentSettings, getPaymentStatus } from "@/lib/settings";
import { alipayPrecreate } from "@/lib/pay/alipay";
import { wechatNativePrecreate } from "@/lib/pay/wechatpay";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 从请求头推断站点 origin(给原生支付的 notify_url 用)。
function originOf(req: Request): string {
  const o = req.headers.get("origin");
  if (o) return o.replace(/\/$/, "");
  const host = req.headers.get("host") || "";
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

// Browser -> create a pending order. Price/credits are resolved server-side
// from the item id (never trusted from the client).
// 原生模式:据 method 调支付宝/微信 precreate,返回扫码二维码内容(qrContent)。
export async function POST(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  if (!(await getPaymentStatus()).enabled) {
    // 后台开关关 或 未配置收款信息 → 不开放充值(US 默认如此)。
    return NextResponse.json({ error: "充值暂未开放" }, { status: 503 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  let body: { email?: string; kind?: string; itemId?: string; method?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  // Pro 直售支持游客购买(填接收邮箱即可,Key 绑定该邮箱);只校验格式。
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "请填写有效的邮箱" }, { status: 400 });
  }
  const item = resolveItem(body.kind ?? "", body.itemId ?? "");
  if (!item) {
    return NextResponse.json({ error: "无效的商品" }, { status: 400 });
  }

  // ===========================================================================
  // 原生对接模式:据 method 调支付宝/微信 precreate。
  // ===========================================================================
  const method = body.method === "wechat" ? "wechat" : "alipay";
  const p = await getPaymentSettings();
  const origin = originOf(req);

  try {
    const order = await createOrder({
      email,
      kind: item.kind,
      itemId: item.itemId,
      title: item.title,
      credits: item.credits,
      amount: item.amount,
    });

    if (method === "alipay") {
      if (!p.alipayAppid || !p.alipayPrivateKey) {
        return NextResponse.json(
          { error: "支付宝收款未配置" },
          { status: 503 }
        );
      }
      const totalYuan = (item.amount / 100).toFixed(2);
      const r = await alipayPrecreate({
        appId: p.alipayAppid,
        privateKey: p.alipayPrivateKey,
        outTradeNo: order.id,
        totalYuan,
        subject: item.title || "积分充值",
        notifyUrl: `${origin}/api/payments/alipay/notify`,
      });
      if (!r.ok || !r.qrCode) {
        return NextResponse.json(
          { error: r.error || "支付宝下单失败" },
          { status: 502 }
        );
      }
      return NextResponse.json({
        ok: true,
        orderId: order.id,
        mode: "native",
        provider: "alipay",
        qrContent: r.qrCode,
        amount: item.amount,
        credits: item.credits,
        title: item.title,
      });
    }

    // method === "wechat"
    if (!p.wxpayMchid || !p.wxpayApiv3 || !p.wxpayCert || !p.wxpayCertSerial || !p.wxpayAppid) {
      return NextResponse.json(
        { error: "微信支付未配置" },
        { status: 503 }
      );
    }
    const r = await wechatNativePrecreate(
      {
        mchid: p.wxpayMchid,
        apiV3Key: p.wxpayApiv3,
        privateKey: p.wxpayCert,
        certSerial: p.wxpayCertSerial,
        appid: p.wxpayAppid,
      },
      {
        outTradeNo: order.id,
        totalFen: item.amount,
        description: item.title || "积分充值",
        notifyUrl: `${origin}/api/payments/wechat/notify`,
      }
    );
    if (!r.ok || !r.codeUrl) {
      return NextResponse.json(
        { error: r.error || "微信下单失败" },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      orderId: order.id,
      mode: "native",
      provider: "wechat",
      qrContent: r.codeUrl,
      amount: item.amount,
      credits: item.credits,
      title: item.title,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "下单失败" },
      { status: 500 }
    );
  }
}
