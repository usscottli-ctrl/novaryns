import "server-only";
import crypto from "crypto";
import { dbEnabled, getSetting, setSetting, getSignupBonus } from "@/lib/db";

// ---------------------------------------------------------------------------
// Runtime-mutable OpenAI settings, editable from the admin page.
//
// Security model:
//  - The API key is RSA-OAEP encrypted IN THE BROWSER (with a server public
//    key) before it's sent, so it never travels as plaintext (not even in
//    devtools/proxy logs), on top of TLS.
//  - At rest it's stored AES-256-GCM encrypted in Postgres (key derived from
//    SETTINGS_SECRET), so a DB dump doesn't leak it.
//  - It's never sent back to the browser — the admin UI only sees a mask.
//
// Resolution order for the running app: DB (admin-set) -> env -> none.
// ---------------------------------------------------------------------------

const RSA_PUB = "rsa_public_pem";
const RSA_PRIV = "rsa_private_pem";
const OAI_KEY_ENC = "openai_api_key_enc";
const OAI_MODEL = "openai_image_model";
// 抠图/透明底专用模型:透明底(background:transparent)只有部分模型支持,默认 gpt-image-1。
// 注:这是「OpenAI 兜底抠图」用的模型;主路径是下面的 Replicate BiRefNet。
const OAI_CUTOUT_MODEL = "openai_cutout_model";
// 抠图后端:"replicate" = Replicate BiRefNet(主,发丝级、按次付费),失败退兜底;
//           "openai" = 强制走 gpt-image 透明底兜底(会重绘主体、慢、烧 token)。
// (自托管 rembg "self" 已于 2026-06-21 下线,旧值一律按 replicate 处理。)
const CUTOUT_BACKEND = "cutout_backend";
// Replicate BiRefNet(第三方抠图):API Token(AES 加密存储、不回显)+ 模型 slug,后台可改。
const REPLICATE_TOKEN_ENC = "replicate_token_enc";
const REPLICATE_MODEL = "replicate_cutout_model";

// ---- 微信公众号「扫码关注即登录」配置(后台可配,env 兜底)。 ----
// AppID/Token/邮箱域名为非敏感明文;AppSecret 走 AES 加密存储,绝不回显。
const WECHAT_APPID = "wechat_appid";
const WECHAT_SECRET_ENC = "wechat_secret_enc";
const WECHAT_TOKEN = "wechat_token";
const WECHAT_EMAIL_DOMAIN = "wechat_email_domain";

// ---- 支付收款配置(原生对接支付宝/微信,env 兜底)。 ----
// 商户私钥/证书等敏感字段走 AES 加密存储,绝不回显。
const ALIPAY_APPID = "alipay_appid";
const ALIPAY_PRIVATE_KEY_ENC = "alipay_private_key_enc";
const ALIPAY_PUBLIC_KEY = "alipay_public_key";
const WXPAY_MCHID = "wxpay_mchid";
const WXPAY_APIV3_ENC = "wxpay_apiv3_enc";
const WXPAY_CERT_ENC = "wxpay_cert_enc"; // 语义=商户 API 私钥 apiclient_key.pem(PEM 文本)
const WXPAY_CERT_SERIAL = "wxpay_cert_serial"; // 商户证书序列号(明文,APIv3 请求签名头要用)

// ---- 品牌与白标(Pro,后台可配,env 兜底)。均为非敏感明文,直接存/回显。 ----
// 站点名称复用首启向导已用的 key `site_name`(见 setup.ts 的 SITE_NAME_SETTING),
// 保持字面量一致;这里不 import 以免与 setup.ts 形成循环依赖。
const SITE_NAME_SETTING = "site_name";
const BRAND_LOGO_SETTING = "brand_logo";
// 站长可自定义的站点页面(关于我们 / 联系我们 / 定价),纯文本明文落库。
const PAGE_ABOUT_SETTING = "page_about";
const PAGE_CONTACT_SETTING = "page_contact";
const PAGE_PLANS_SETTING = "page_plans";
const WXPAY_APPID = "wxpay_appid"; // Native 下单要绑定的公众号/小程序 appid(明文)
const PAY_ENABLED = "pay_enabled";

function aesKey(): Buffer {
  const secret = process.env.SETTINGS_SECRET || "novaryns-insecure-default";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptAtRest(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct]
    .map((b) => b.toString("base64"))
    .join(".");
}

export function decryptAtRest(blob: string): string | null {
  try {
    const [iv, tag, ct] = blob
      .split(".")
      .map((s) => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function ensureKeypair(): Promise<{ publicPem: string; privatePem: string }> {
  let pub = await getSetting(RSA_PUB);
  let priv = await getSetting(RSA_PRIV);
  if (!pub || !priv) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 4096,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    pub = publicKey;
    priv = privateKey;
    await setSetting(RSA_PUB, pub);
    await setSetting(RSA_PRIV, priv);
  }
  return { publicPem: pub, privatePem: priv };
}

export async function getPublicKeyPem(): Promise<string> {
  return (await ensureKeypair()).publicPem;
}

/**
 * Decrypts a base64 RSA-OAEP(SHA-256) ciphertext produced by the browser.
 * 长字段(支付宝/微信应用私钥·证书)超过 RSA-OAEP 单块上限,浏览器分块加密后用 "|" 拼接;
 * 短字段无 "|",按单块解密,向后兼容。
 */
export async function decryptFromClient(b64: string): Promise<string> {
  const { privatePem } = await ensureKeypair();
  const parts = b64.includes("|") ? b64.split("|") : [b64];
  const bufs = parts.map((p) =>
    crypto.privateDecrypt(
      {
        key: privatePem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(p, "base64")
    )
  );
  return Buffer.concat(bufs).toString("utf8");
}


export function maskKey(k: string): string {
  if (!k) return "";
  return k.length <= 10 ? "••••" : `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

export type OpenAISettings = {
  apiKey: string;
  model: string;
  cutoutModel: string;
  source: "db" | "env" | "none";
};

export async function getOpenAISettings(): Promise<OpenAISettings> {
  const envKey = process.env.OPENAI_API_KEY || "";
  const envModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  // 抠图/透明底:实测 gpt-image-2 不支持 background:transparent,只能 v1。
  const envCutout = process.env.OPENAI_CUTOUT_MODEL || "gpt-image-1";
  if (dbEnabled) {
    const enc = await getSetting(OAI_KEY_ENC);
    const m = await getSetting(OAI_MODEL);
    const cm = await getSetting(OAI_CUTOUT_MODEL);
    const dbKey = enc ? decryptAtRest(enc) : null;
    if (dbKey || m || cm) {
      return {
        apiKey: dbKey || envKey,
        model: m || envModel,
        cutoutModel: cm || envCutout,
        source: dbKey ? "db" : envKey ? "env" : "none",
      };
    }
  }
  return {
    apiKey: envKey,
    model: envModel,
    cutoutModel: envCutout,
    source: envKey ? "env" : "none",
  };
}

export async function saveOpenAIKey(plain: string): Promise<void> {
  await setSetting(OAI_KEY_ENC, encryptAtRest(plain.trim()));
}

export async function saveOpenAIModel(model: string): Promise<void> {
  await setSetting(OAI_MODEL, model.trim());
}

export async function saveCutoutModel(model: string): Promise<void> {
  await setSetting(OAI_CUTOUT_MODEL, model.trim());
}

// ---------------------------------------------------------------------------
// 抠图后端配置。首选自托管 rembg 服务(localhost:8090),不可用时兜底走 gpt-image。
// 自托管服务真正加载的模型在服务端 start.sh 里设(CUTOUT_MODEL),这里只读不写——
// 后台展示的「当前模型」实时从服务 /health 拉,保证显示的就是线上真在跑的那个。
// ---------------------------------------------------------------------------
export type CutoutBackend = "openai" | "replicate";
export type CutoutSettings = {
  /** 主用后端:replicate=BiRefNet(主) / openai=gpt-image 直出(强制兜底)。 */
  backend: CutoutBackend;
  /** OpenAI 兜底抠图模型。 */
  openaiModel: string;
  /** Replicate API token(后台 AES 加密存储优先 → env 兜底;绝不回显)。 */
  replicateToken: string;
  /** Replicate 上的 BiRefNet 模型 slug。 */
  replicateModel: string;
};

export async function getCutoutSettings(): Promise<CutoutSettings> {
  const envModel = process.env.OPENAI_CUTOUT_MODEL || "gpt-image-1";
  const envReplicateToken = process.env.REPLICATE_API_TOKEN || "";
  const envReplicateModel =
    process.env.REPLICATE_CUTOUT_MODEL || "men1scus/birefnet";
  let backend: CutoutBackend = "replicate"; // 默认主用 Replicate BiRefNet
  let openaiModel = envModel;
  let replicateToken = envReplicateToken;
  let replicateModel = envReplicateModel;
  if (dbEnabled) {
    const b = await getSetting(CUTOUT_BACKEND);
    const m = await getSetting(OAI_CUTOUT_MODEL);
    const rt = await getSetting(REPLICATE_TOKEN_ENC);
    const rm = await getSetting(REPLICATE_MODEL);
    // 旧值 "self"(自托管已下线)一律按 replicate 处理
    backend = b === "openai" ? "openai" : "replicate";
    if (m) openaiModel = m;
    const dbToken = rt ? decryptAtRest(rt) : null;
    if (dbToken) replicateToken = dbToken;
    if (rm) replicateModel = rm;
  }
  return { backend, openaiModel, replicateToken, replicateModel };
}

export async function saveCutoutBackend(backend: string): Promise<void> {
  const b: CutoutBackend = backend.trim() === "openai" ? "openai" : "replicate";
  await setSetting(CUTOUT_BACKEND, b);
}

/** 保存 Replicate API Token(浏览器 RSA 解密后的明文 → AES 加密存储)。 */
export async function saveReplicateToken(plain: string): Promise<void> {
  await setSetting(REPLICATE_TOKEN_ENC, encryptAtRest(plain.trim()));
}

/** 保存 Replicate 抠图模型 slug。 */
export async function saveReplicateModel(model: string): Promise<void> {
  await setSetting(REPLICATE_MODEL, model.trim());
}

// ---------------------------------------------------------------------------
// 微信登录配置:DB 优先 → env 兜底。
//  - AppID/Token/邮箱域名:非敏感明文。
//  - AppSecret:AES 加密存储(wechat_secret_enc),解出后用;绝不回显。
//  - enabled = AppID && AppSecret && Token 三者齐全。
// ---------------------------------------------------------------------------
export type WechatSettings = {
  appid: string;
  secret: string;
  token: string;
  emailDomain: string;
  enabled: boolean;
};

export async function getWechatSettings(): Promise<WechatSettings> {
  const envAppid = process.env.WECHAT_MP_APPID ?? "";
  const envSecret = process.env.WECHAT_MP_SECRET ?? "";
  const envToken = process.env.WECHAT_MP_TOKEN ?? "";
  const envDomain = process.env.WECHAT_EMAIL_DOMAIN ?? "wx.starzeco.com";
  let appid = envAppid;
  let secret = envSecret;
  let token = envToken;
  let emailDomain = envDomain;
  if (dbEnabled) {
    const dbAppid = await getSetting(WECHAT_APPID);
    const enc = await getSetting(WECHAT_SECRET_ENC);
    const dbToken = await getSetting(WECHAT_TOKEN);
    const dbDomain = await getSetting(WECHAT_EMAIL_DOMAIN);
    const dbSecret = enc ? decryptAtRest(enc) : null;
    if (dbAppid) appid = dbAppid;
    if (dbSecret) secret = dbSecret;
    if (dbToken) token = dbToken;
    if (dbDomain) emailDomain = dbDomain;
  }
  return {
    appid,
    secret,
    token,
    emailDomain,
    enabled: !!(appid && secret && token),
  };
}

/** 保存微信登录明文字段(AppID / Token / 邮箱域名)。空串跳过,不覆盖已有值。 */
export async function saveWechatLogin(opts: {
  appid?: string;
  token?: string;
  emailDomain?: string;
}): Promise<void> {
  if (typeof opts.appid === "string" && opts.appid.trim()) {
    await setSetting(WECHAT_APPID, opts.appid.trim());
  }
  if (typeof opts.token === "string" && opts.token.trim()) {
    await setSetting(WECHAT_TOKEN, opts.token.trim());
  }
  if (typeof opts.emailDomain === "string" && opts.emailDomain.trim()) {
    await setSetting(WECHAT_EMAIL_DOMAIN, opts.emailDomain.trim());
  }
}

/** 保存微信 AppSecret(浏览器 RSA 解密后的明文 → AES 加密存储)。 */
export async function saveWechatSecret(plain: string): Promise<void> {
  await setSetting(WECHAT_SECRET_ENC, encryptAtRest(plain.trim()));
}

/**
 * 保存品牌与白标(Pro):站点名称(site_name)、Logo URL(brand_logo)。
 * 均为非敏感明文,明文落库。**空串 = 清除覆盖 → 前台回退 env 默认**(getRuntimeBrand
 * 按 `db || env` 兜底),所以这里对「传了字符串」的字段一律写入,包括空串,不做 trim 跳过。
 */
export async function saveBrand(opts: {
  name?: string;
  logo?: string;
}): Promise<void> {
  if (typeof opts.name === "string") {
    await setSetting(SITE_NAME_SETTING, opts.name.trim().slice(0, 80));
  }
  if (typeof opts.logo === "string") {
    await setSetting(BRAND_LOGO_SETTING, opts.logo.trim().slice(0, 500));
  }
}

/**
 * 保存站长自定义页面(关于我们 / 联系我们 / 定价),纯文本。空串 = 清空(前台回退默认)。
 * 传了字符串就写(含空串);未传(undefined)则跳过。
 */
export async function saveSitePages(opts: {
  about?: string;
  contact?: string;
  plans?: string;
}): Promise<void> {
  if (typeof opts.about === "string")
    await setSetting(PAGE_ABOUT_SETTING, opts.about.slice(0, 8000));
  if (typeof opts.contact === "string")
    await setSetting(PAGE_CONTACT_SETTING, opts.contact.slice(0, 8000));
  if (typeof opts.plans === "string")
    await setSetting(PAGE_PLANS_SETTING, opts.plans.slice(0, 8000));
}

/** 读某个自定义页面的内容(供 /about /contact /plans 页面渲染);无则空串。 */
export async function getSitePage(
  which: "about" | "contact" | "plans"
): Promise<string> {
  const key =
    which === "about"
      ? PAGE_ABOUT_SETTING
      : which === "contact"
        ? PAGE_CONTACT_SETTING
        : PAGE_PLANS_SETTING;
  try {
    return (await getSetting(key)) ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 支付收款配置:DB 优先 → env 兜底。
//  - 支付宝 / 微信支付商户:原生对接,直接调网关 precreate 出二维码;
//    私钥 / APIv3 / 证书走 AES 加密存储,绝不回显。
//  - payEnabled:后台收款总开关,DB 显式 1/0 优先,否则按 NEXT_PUBLIC_RECHARGE_ENABLED 默认;
//    与「是否已配置收款信息」一起决定前端门控(见 getPaymentStatus)。
// ---------------------------------------------------------------------------
export type PaymentSettings = {
  payEnabled: boolean;
  alipayAppid: string;
  alipayPrivateKey: string;
  alipayPublicKey: string;
  wxpayMchid: string;
  wxpayApiv3: string;
  wxpayCert: string; // = 商户 API 私钥 apiclient_key.pem(PEM 文本)
  wxpayCertSerial: string; // 商户证书序列号(明文)
  wxpayAppid: string; // Native 下单要绑定的公众号/小程序 appid
};

export async function getPaymentSettings(): Promise<PaymentSettings> {
  // 收款开关默认值对齐前端开关 NEXT_PUBLIC_RECHARGE_ENABLED(CN=true、US 未设=false);
  // DB 显式 1/0 可覆盖。
  let payEnabled =
    (process.env.NEXT_PUBLIC_RECHARGE_ENABLED ?? "").trim() === "true";
  let alipayAppid = "";
  let alipayPrivateKey = "";
  let alipayPublicKey = "";
  let wxpayMchid = "";
  let wxpayApiv3 = "";
  let wxpayCert = "";
  // 序列号 / appid:DB → env 兜底(明文)。
  let wxpayCertSerial = (process.env.WXPAY_CERT_SERIAL ?? "").trim();
  let wxpayAppid = (process.env.WXPAY_APPID ?? "").trim();
  if (dbEnabled) {
    const pe = await getSetting(PAY_ENABLED);
    const aAppid = await getSetting(ALIPAY_APPID);
    const aPrivEnc = await getSetting(ALIPAY_PRIVATE_KEY_ENC);
    const aPub = await getSetting(ALIPAY_PUBLIC_KEY);
    const wMch = await getSetting(WXPAY_MCHID);
    const wApiEnc = await getSetting(WXPAY_APIV3_ENC);
    const wCertEnc = await getSetting(WXPAY_CERT_ENC);
    const wSerial = await getSetting(WXPAY_CERT_SERIAL);
    const wAppid = await getSetting(WXPAY_APPID);
    // pay_enabled:DB 显式存了 "1"/"0" 时以 DB 为准,否则按默认兜底。
    if (pe === "1") payEnabled = true;
    else if (pe === "0") payEnabled = false;
    if (aAppid) alipayAppid = aAppid;
    const aPriv = aPrivEnc ? decryptAtRest(aPrivEnc) : null;
    if (aPriv) alipayPrivateKey = aPriv;
    if (aPub) alipayPublicKey = aPub;
    if (wMch) wxpayMchid = wMch;
    const wApi = wApiEnc ? decryptAtRest(wApiEnc) : null;
    if (wApi) wxpayApiv3 = wApi;
    const wCert = wCertEnc ? decryptAtRest(wCertEnc) : null;
    if (wCert) wxpayCert = wCert;
    if (wSerial) wxpayCertSerial = wSerial;
    if (wAppid) wxpayAppid = wAppid;
  }
  return {
    payEnabled,
    alipayAppid,
    alipayPrivateKey,
    alipayPublicKey,
    wxpayMchid,
    wxpayApiv3,
    wxpayCert,
    wxpayCertSerial,
    wxpayAppid,
  };
}

/** 保存收款开关。 */
export async function savePayEnabled(enabled: boolean): Promise<void> {
  await setSetting(PAY_ENABLED, enabled ? "1" : "0");
}

// ---------------------------------------------------------------------------
// 收款是否「真实生效」状态(前端门控 + 后端路由共用)。
//  - configured = 填了收款信息:支付宝(appid+私钥)齐,或 微信支付(商户号+APIv3)齐。
//  - enabled = payEnabled(后台开关,DB 显式 1/0 优先,否则按 NEXT_PUBLIC_RECHARGE_ENABLED)
//    且 configured。即:填了收款信息 + 开关开 → 前端显示在线充值;没填或关 → 改显示兑换码。
// ---------------------------------------------------------------------------
export async function getPaymentStatus(): Promise<{
  enabled: boolean;
  configured: boolean;
}> {
  try {
    const p = await getPaymentSettings();
    const configured =
      (!!p.alipayAppid && !!p.alipayPrivateKey) ||
      (!!p.wxpayMchid && !!p.wxpayApiv3);
    return { enabled: p.payEnabled && configured, configured };
  } catch {
    // DB 抖动兜底:layout 每页都调本函数,绝不能因 DB 异常让全站 500。
    // 按旧前端开关判定(CN=true、US=false),与正常路径默认值一致。
    const ok = (process.env.NEXT_PUBLIC_RECHARGE_ENABLED ?? "").trim() === "true";
    return { enabled: ok, configured: ok };
  }
}

/** 保存支付宝商户明文字段(AppID / 支付宝公钥)。空串跳过。 */
export async function saveAlipay(opts: {
  appid?: string;
  publicKey?: string;
}): Promise<void> {
  if (typeof opts.appid === "string" && opts.appid.trim()) {
    await setSetting(ALIPAY_APPID, opts.appid.trim());
  }
  if (typeof opts.publicKey === "string" && opts.publicKey.trim()) {
    await setSetting(ALIPAY_PUBLIC_KEY, opts.publicKey.trim());
  }
}

/** 保存支付宝应用私钥(明文 → AES 加密存储)。 */
export async function saveAlipayPrivateKey(plain: string): Promise<void> {
  await setSetting(ALIPAY_PRIVATE_KEY_ENC, encryptAtRest(plain.trim()));
}

/** 保存微信支付商户明文字段(商户号)。空串跳过。 */
export async function saveWxpay(opts: { mchid?: string }): Promise<void> {
  if (typeof opts.mchid === "string" && opts.mchid.trim()) {
    await setSetting(WXPAY_MCHID, opts.mchid.trim());
  }
}

/** 保存微信支付 APIv3 Key(明文 → AES 加密存储)。 */
export async function saveWxpayApiv3(plain: string): Promise<void> {
  await setSetting(WXPAY_APIV3_ENC, encryptAtRest(plain.trim()));
}

/** 保存微信支付「商户 API 私钥 apiclient_key.pem」(PEM 文本 → AES 加密存储)。 */
export async function saveWxpayCert(plain: string): Promise<void> {
  await setSetting(WXPAY_CERT_ENC, encryptAtRest(plain.trim()));
}

/** 保存微信支付商户证书序列号(明文)。 */
export async function saveWxpayCertSerial(serial: string): Promise<void> {
  await setSetting(WXPAY_CERT_SERIAL, serial.trim());
}

/** 保存微信支付 Native 下单绑定的 appid(明文)。 */
export async function saveWxpayAppid(appid: string): Promise<void> {
  await setSetting(WXPAY_APPID, appid.trim());
}

/**
 * 从「应用私钥」反推出对应的「应用公钥」(SPKI DER → base64,与支付宝平台
 * 「应用公钥」同格式)。排错用:这串必须和你上传到支付宝平台的应用公钥一字不差,
 * 否则就是「验签出错」的根因(私钥与上传的公钥不是一对)。失败/未配返回空串。
 */
function deriveAlipayPublicKey(privateKey: string): string {
  const k = (privateKey ?? "").trim();
  if (!k) return "";
  try {
    const pem = k.includes("-----BEGIN")
      ? k
      : `-----BEGIN PRIVATE KEY-----\n${
          k.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? k
        }\n-----END PRIVATE KEY-----`;
    return crypto
      .createPublicKey(pem)
      .export({ type: "spki", format: "der" })
      .toString("base64");
  } catch {
    return "";
  }
}

/** Safe-to-display view (never includes the raw key). */
export async function getAdminView() {
  const s = await getOpenAISettings();
  const c = await getCutoutSettings();
  const w = await getWechatSettings();
  const p = await getPaymentSettings();
  return {
    model: s.model,
    cutoutModel: s.cutoutModel,
    keyMasked: maskKey(s.apiKey),
    hasKey: !!s.apiKey,
    source: s.source,
    // 新用户注册赠送积分(后台可配)
    signupBonus: await getSignupBonus(),
    // 抠图后端:replicate(主) / openai(兜底)
    cutoutBackend: c.backend,
    // Replicate BiRefNet(第三方,后台可改 token + 模型):token 绝不回显,只给是否已配 + 掩码
    cutoutReplicateReady: !!c.replicateToken,
    cutoutReplicateModel: c.replicateModel,
    cutoutReplicateTokenMasked: maskKey(c.replicateToken),
    // 微信登录:非敏感明文回显;AppSecret 只回掩码 + 是否就绪
    wechatAppid: w.appid,
    wechatToken: w.token,
    wechatEmailDomain: w.emailDomain,
    wechatSecretMasked: maskKey(w.secret),
    wechatReady: w.enabled,
    // 支付:可回显的明文 + 敏感字段掩码 + 各自是否已配
    payEnabled: p.payEnabled,
    // 前端当前是否在显示「在线充值」(= 开关开 且 已配置收款信息)。
    rechargeLive: (await getPaymentStatus()).enabled,
    alipayAppid: p.alipayAppid,
    alipayPublicKey: p.alipayPublicKey,
    alipayPrivateKeyMasked: maskKey(p.alipayPrivateKey),
    alipayPrivateKeyReady: !!p.alipayPrivateKey,
    // 从已存私钥反推的应用公钥(排错:须与支付宝平台上传的应用公钥一致)
    alipayDerivedPublicKey: deriveAlipayPublicKey(p.alipayPrivateKey),
    wxpayMchid: p.wxpayMchid,
    wxpayApiv3Masked: maskKey(p.wxpayApiv3),
    wxpayApiv3Ready: !!p.wxpayApiv3,
    wxpayCertMasked: maskKey(p.wxpayCert),
    wxpayCertReady: !!p.wxpayCert,
    wxpayCertSerial: p.wxpayCertSerial, // 序列号是明文,可直接回显
    wxpayAppid: p.wxpayAppid,
    // 品牌与白标(Pro):站点名复用向导 key `site_name`;Logo 用 `brand_logo`。
    // 均为非敏感明文,直接回显;留空 = 未覆盖 → 前台回退 env 默认。
    brandName: (await getSetting(SITE_NAME_SETTING)) ?? "",
    brandLogo: (await getSetting(BRAND_LOGO_SETTING)) ?? "",
    // 站长自定义页面(关于/联系/定价)
    pageAbout: (await getSetting(PAGE_ABOUT_SETTING)) ?? "",
    pageContact: (await getSetting(PAGE_CONTACT_SETTING)) ?? "",
    pagePlans: (await getSetting(PAGE_PLANS_SETTING)) ?? "",
  };
}
