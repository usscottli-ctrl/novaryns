// 微信公众号(认证订阅号)「扫码关注即登录」服务端工具。
// 流程:前端要二维码(带参数临时码,参数=登录会话 sid)→ 用户扫码关注/已关注扫码
// → 微信把事件推到 /api/wechat/callback → 这里记下 sid→openid → 前端轮询命中
// → 按手机号登录同款方式(合成邮箱 + magiclink token_hash)建立会话。
// 仅配置了 WECHAT_MP_*(CN 站)或后台填了凭证才启用;未配置时端点回 503,前端回退「即将开放」。
// 配置来源:后台 DB 优先 → env 兜底(见 settings.ts:getWechatSettings)。
import { createHash, randomBytes } from "crypto";
import { getWechatSettings } from "@/lib/settings";

/** 是否已启用微信登录(DB 优先 → env 兜底,三件套齐全才算)。 */
export async function isWechatEnabled(): Promise<boolean> {
  return (await getWechatSettings()).enabled;
}

// ---- access_token 缓存(微信侧 7200s,提前 5 分钟刷新;单 pm2 实例,内存即可) ----
let tokCache: { token: string; exp: number } | null = null;

export async function wxAccessToken(): Promise<string> {
  if (tokCache && Date.now() < tokCache.exp) return tokCache.token;
  const c = await getWechatSettings();
  const r = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${c.appid}&secret=${c.secret}`,
    { cache: "no-store" }
  );
  const j = (await r.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!j.access_token) {
    throw new Error(`微信 token 获取失败: ${j.errcode} ${j.errmsg ?? ""}`);
  }
  tokCache = {
    token: j.access_token,
    exp: Date.now() + ((j.expires_in ?? 7200) - 300) * 1000,
  };
  return j.access_token;
}

// ---- 带参数临时二维码(5 分钟),scene_str = 登录会话 sid ----
export async function createLoginQr(
  scene: string,
  retried = false
): Promise<string> {
  const tok = await wxAccessToken();
  const r = await fetch(
    `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(tok)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expire_seconds: 300,
        action_name: "QR_STR_SCENE",
        action_info: { scene: { scene_str: scene } },
      }),
    }
  );
  const j = (await r.json()) as {
    ticket?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!j.ticket) {
    // token 被微信侧作废(40001/42001)→ 清缓存重试一次
    if (!retried && (j.errcode === 40001 || j.errcode === 42001)) {
      tokCache = null;
      return createLoginQr(scene, true);
    }
    throw new Error(`二维码生成失败: ${j.errcode} ${j.errmsg ?? ""}`);
  }
  return `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(j.ticket)}`;
}

// ---- 回调验签(明文模式):sha1(sort(token, timestamp, nonce)) ----
export async function verifyWxSignature(sp: URLSearchParams): Promise<boolean> {
  const { token } = await getWechatSettings();
  if (!token) return false;
  const signature = sp.get("signature") ?? "";
  const timestamp = sp.get("timestamp") ?? "";
  const nonce = sp.get("nonce") ?? "";
  if (!signature || !timestamp || !nonce) return false;
  const s = [token, timestamp, nonce].sort().join("");
  return createHash("sha1").update(s).digest("hex") === signature;
}

// ---- 极简 XML 字段提取(微信推送的事件 XML 结构固定且扁平,够用) ----
export function xmlField(xml: string, tag: string): string {
  const m = xml.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  );
  return (m?.[1] ?? "").trim();
}

// ---- 登录会话(sid → openid)。单实例内存表,10 分钟 GC ----
type WxSession = { openid?: string; createdAt: number };
const SESSIONS = new Map<string, WxSession>();
const SESSION_TTL = 10 * 60 * 1000;

function gcSessions() {
  const now = Date.now();
  SESSIONS.forEach((v, k) => {
    if (now - v.createdAt > SESSION_TTL) SESSIONS.delete(k);
  });
}

export function newWxSession(): string {
  gcSessions();
  const sid = `wxl${randomBytes(16).toString("hex")}`; // 35 字符 < scene_str 上限 64
  SESSIONS.set(sid, { createdAt: Date.now() });
  return sid;
}

export function markWxScan(sid: string, openid: string): boolean {
  const s = SESSIONS.get(sid);
  if (!s) return false;
  if (!s.openid) s.openid = openid;
  return true;
}

/** 轮询:命中(已扫码)则取走并删除会话;未扫码返回 pending;不存在/超时返回 expired。 */
export function pollWxSession(
  sid: string
): { status: "expired" } | { status: "pending" } | { status: "done"; openid: string } {
  const s = SESSIONS.get(sid);
  if (!s || Date.now() - s.createdAt > SESSION_TTL) return { status: "expired" };
  if (!s.openid) return { status: "pending" };
  SESSIONS.delete(sid);
  return { status: "done", openid: s.openid };
}

// ---- 微信账号身份:openid → 合成邮箱(对齐手机号登录的 {phone}@phone.starzeco.com) ----
// 邮箱大小写不敏感而 openid 大小写敏感 → 小写化后追加原值短哈希消除碰撞。
export async function wxSyntheticEmail(openid: string): Promise<string> {
  const { emailDomain } = await getWechatSettings();
  const domain = emailDomain || "wx.starzeco.com";
  const h = createHash("sha1").update(openid).digest("hex").slice(0, 6);
  return `${openid.toLowerCase()}-${h}@${domain}`;
}
