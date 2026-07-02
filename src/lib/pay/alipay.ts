import "server-only";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// 原生支付宝「当面付」(扫码支付)对接。全站统一走原生收款。
//
// 严格按支付宝开放平台 RSA2 签名规范:
//  - 对所有「非空」公共参数 + biz_content 按 key 字典序拼成 `k=v&...`(不做
//    url-encode,这是「待签名串」),用应用私钥 createSign("RSA-SHA256") 签 base64。
//  - 异步通知验签:取出 sign / sign_type,其余参数按字典序拼串,用支付宝公钥
//    createVerify("RSA-SHA256").verify 校验。
// ---------------------------------------------------------------------------

const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";

/** 把「纯 base64 私钥」或已是 PEM 的私钥统一包成 PKCS8 PEM。 */
function toPrivatePem(key: string): string {
  const k = key.trim();
  if (k.includes("-----BEGIN")) return k;
  // 纯 base64 → 包成 PKCS8 PEM(支付宝控制台导出的应用私钥默认是 PKCS8)。
  const body = k.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? k;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

/** 把「纯 base64 公钥」或已是 PEM 的公钥统一包成 SPKI PEM。 */
function toPublicPem(key: string): string {
  const k = key.trim();
  if (k.includes("-----BEGIN")) return k;
  const body = k.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? k;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

/** 支付宝时间戳格式:yyyy-MM-dd HH:mm:ss(本地时区)。 */
function alipayTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 对参数表按 key 字典序拼 `k=v&...`(跳过空值、sign、sign_type),用于签名/验签。 */
function buildSignContent(
  params: Record<string, string>,
  opts: { skipSign?: boolean } = {}
): string {
  return Object.keys(params)
    .filter((k) => {
      if (opts.skipSign && (k === "sign" || k === "sign_type")) return false;
      const v = params[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export type AlipayPrecreateInput = {
  appId: string;
  privateKey: string; // 应用私钥(PKCS8 PEM 或纯 base64)
  outTradeNo: string;
  totalYuan: string; // 元,字符串,保留两位小数,如 "9.90"
  subject: string;
  notifyUrl: string;
};

export type AlipayPrecreateResult = {
  ok: boolean;
  qrCode?: string; // alipay_trade_precreate_response.qr_code,前端渲染成二维码
  error?: string;
};

/**
 * alipay.trade.precreate —— 生成「当面付」收款二维码。
 * 返回的 qrCode 是一串 URL(形如 https://qr.alipay.com/...),前端用 qrcode 库渲染。
 */
export async function alipayPrecreate(
  input: AlipayPrecreateInput
): Promise<AlipayPrecreateResult> {
  const bizContent = JSON.stringify({
    out_trade_no: input.outTradeNo,
    total_amount: input.totalYuan,
    subject: input.subject,
  });
  const params: Record<string, string> = {
    app_id: input.appId,
    method: "alipay.trade.precreate",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    notify_url: input.notifyUrl,
    biz_content: bizContent,
  };

  // 待签名串 = 非空参数按字典序拼 k=v&...(不 url-encode)。
  // ⚠️ 支付宝「请求签名」必须包含 sign_type(只排除 sign,而此处 params 尚无 sign);
  //    而「异步通知验签」才同时排除 sign + sign_type。两套规则不同,请求这边不能 skipSign。
  const signContent = buildSignContent(params);
  const sign = crypto
    .createSign("RSA-SHA256")
    .update(signContent, "utf8")
    .sign(toPrivatePem(input.privateKey), "base64");

  // 发请求时各参数值要 url-encode(签名用的是未编码原文)。
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, v);
  form.set("sign", sign);

  const r = await fetch(ALIPAY_GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: form.toString(),
    cache: "no-store",
  });
  const data = (await r.json().catch(() => null)) as
    | {
        alipay_trade_precreate_response?: {
          code?: string;
          msg?: string;
          sub_msg?: string;
          qr_code?: string;
        };
      }
    | null;
  const resp = data?.alipay_trade_precreate_response;
  if (resp?.code === "10000" && resp.qr_code) {
    return { ok: true, qrCode: resp.qr_code };
  }
  return {
    ok: false,
    error: resp?.sub_msg || resp?.msg || "支付宝下单失败",
  };
}

/**
 * 支付宝异步通知验签。params = 通知表单的全部字段(已 url-decode)。
 * 取出 sign / sign_type,其余按字典序拼串,用支付宝公钥 RSA-SHA256 验签。
 */
export function verifyAlipayNotify(
  params: Record<string, string>,
  publicKey: string
): boolean {
  const sign = params.sign;
  if (!sign || !publicKey) return false;
  const content = buildSignContent(params, { skipSign: true });
  try {
    return crypto
      .createVerify("RSA-SHA256")
      .update(content, "utf8")
      .verify(toPublicPem(publicKey), sign, "base64");
  } catch {
    return false;
  }
}
