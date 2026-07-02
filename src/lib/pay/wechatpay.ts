import "server-only";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// 原生微信支付 Native v3(扫码支付)对接。全站统一走原生收款。
//
// 严格按微信支付 APIv3 规范(https://pay.weixin.qq.com/docs/merchant/apis):
//  - 请求签名:Authorization 头
//      WECHATPAY2-SHA256-RSA2048 mchid="..",nonce_str="..",timestamp="..",
//      serial_no="<商户证书序列号>",signature="<sign>"
//    签名串 = `METHOD\nURL\ntimestamp\nnonce\nbody\n`,用商户 API 私钥
//    (apiclient_key.pem)RSA-SHA256 签 base64。
//  - 回调:resource 用 APIv3 key 做 AES-256-GCM 解密;平台证书验签为「尽力而为」
//    (拉不到平台证书时降级为「解密成功 + 金额匹配」,见 verifyAndDecryptWxNotify)。
// ---------------------------------------------------------------------------

const WXPAY_API_BASE = "https://api.mch.weixin.qq.com";

/** 把商户 API 私钥(apiclient_key.pem)规范成 PEM(已是 PEM 则原样返回)。 */
function toPrivatePem(key: string): string {
  const k = key.trim();
  if (k.includes("-----BEGIN")) return k;
  const body = k.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? k;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

export type WxpayConfig = {
  mchid: string;
  apiV3Key: string; // APIv3 密钥(32 字节字符串),用于回调 AES-GCM 解密
  privateKey: string; // 商户 API 私钥 apiclient_key.pem(PEM 文本)
  certSerial: string; // 商户证书序列号
  appid: string; // Native 下单绑定的公众号/小程序 appid
};

/** 生成 APIv3 请求所需的 Authorization 头(对给定 method/url/body 签名)。 */
function buildAuthorization(
  cfg: WxpayConfig,
  method: string,
  urlPath: string,
  body: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  // 签名串:METHOD\nURL\ntimestamp\nnonce\nbody\n
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(message, "utf8")
    .sign(toPrivatePem(cfg.privateKey), "base64");
  return (
    `WECHATPAY2-SHA256-RSA2048 ` +
    `mchid="${cfg.mchid}",` +
    `nonce_str="${nonceStr}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${cfg.certSerial}",` +
    `signature="${signature}"`
  );
}

export type WxNativePrecreateInput = {
  outTradeNo: string;
  totalFen: number; // 分
  description: string;
  notifyUrl: string;
};

export type WxNativePrecreateResult = {
  ok: boolean;
  codeUrl?: string; // code_url,前端渲染成二维码(weixin:// 开头)
  error?: string;
};

/**
 * POST /v3/pay/transactions/native —— 下单拿 code_url。
 */
export async function wechatNativePrecreate(
  cfg: WxpayConfig,
  input: WxNativePrecreateInput
): Promise<WxNativePrecreateResult> {
  const urlPath = "/v3/pay/transactions/native";
  const payload = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: input.description,
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    amount: { total: input.totalFen, currency: "CNY" },
  };
  const body = JSON.stringify(payload);
  const auth = buildAuthorization(cfg, "POST", urlPath, body);

  const r = await fetch(`${WXPAY_API_BASE}${urlPath}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "novaryns-native-pay",
    },
    body,
    cache: "no-store",
  });
  const data = (await r.json().catch(() => null)) as
    | { code_url?: string; code?: string; message?: string }
    | null;
  if (r.status === 200 && data?.code_url) {
    return { ok: true, codeUrl: data.code_url };
  }
  return { ok: false, error: data?.message || "微信下单失败" };
}

/** AES-256-GCM 解密微信回调 resource。失败抛错。 */
function decryptResource(
  apiV3Key: string,
  resource: { ciphertext: string; nonce: string; associated_data?: string }
): string {
  const key = Buffer.from(apiV3Key, "utf8"); // APIv3 key 必须是 32 字节
  const cipherBuf = Buffer.from(resource.ciphertext, "base64");
  // GCM 认证标签是密文最后 16 字节。
  const authTag = cipherBuf.subarray(cipherBuf.length - 16);
  const data = cipherBuf.subarray(0, cipherBuf.length - 16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(resource.nonce, "utf8")
  );
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export type WxNotifyDecrypted = {
  ok: boolean;
  outTradeNo?: string;
  transactionId?: string;
  tradeState?: string;
  totalFen?: number; // amount.total
  error?: string;
};

/**
 * 验签 + 解密微信回调。
 *  ① 用 APIv3 key 对 resource 做 AES-256-GCM 解密,得明文 JSON。
 *  ② 平台证书验签为「尽力而为」:需调 /v3/certificates 拉平台证书并用 APIv3 key
 *     解密缓存,再用对应公钥验 Wechatpay-Signature。本实现暂未拉平台证书,故
 *     降级为「解密成功 + (上层)订单金额匹配」即视为可信。
 *
 *  TODO(生产环境必做):接入 /v3/certificates 拉取并缓存平台证书,在此对
 *  Wechatpay-Timestamp / Wechatpay-Nonce / body 组成的验签串用平台证书公钥
 *  做 RSA-SHA256 验签,开启完整验签后再放行履约。
 */
export function verifyAndDecryptWxNotify(
  apiV3Key: string,
  _headers: Headers,
  rawBody: string
): WxNotifyDecrypted {
  let parsed: {
    resource?: {
      ciphertext?: string;
      nonce?: string;
      associated_data?: string;
    };
  };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "回调体解析失败" };
  }
  const res = parsed.resource;
  if (!res?.ciphertext || !res.nonce) {
    return { ok: false, error: "回调缺少 resource" };
  }
  // TODO: 在此用平台证书对 _headers 里的 Wechatpay-Signature 做完整验签。
  let plain: string;
  try {
    plain = decryptResource(apiV3Key, {
      ciphertext: res.ciphertext,
      nonce: res.nonce,
      associated_data: res.associated_data,
    });
  } catch {
    return { ok: false, error: "回调解密失败" };
  }
  let obj: {
    out_trade_no?: string;
    transaction_id?: string;
    trade_state?: string;
    amount?: { total?: number };
  };
  try {
    obj = JSON.parse(plain);
  } catch {
    return { ok: false, error: "解密明文解析失败" };
  }
  return {
    ok: true,
    outTradeNo: obj.out_trade_no,
    transactionId: obj.transaction_id,
    tradeState: obj.trade_state,
    totalFen: obj.amount?.total,
  };
}
