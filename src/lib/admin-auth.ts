import "server-only";
import { timingSafeEqual, createHmac } from "crypto";
import { getSetting, setSetting } from "@/lib/db";
import { isAdminToken, emailFromToken, bearer } from "@/lib/supabase-admin";
import { supabaseEnabled } from "@/lib/auth-mode";
import { OPERATOR_EMAIL } from "@/lib/operator";
import { hashPassword, verifyPassword } from "@/lib/pw";

// 兼容旧引用:密码哈希/校验已抽到 @/lib/pw,这里再导出一份。
export { hashPassword, verifyPassword };

// ---------------------------------------------------------------------------
// 本地管理员登录(开源版 / 自托管无 Supabase 时的后台入口)。
//
// 背景:开源版默认 compose 只有 app + postgres,没有 Supabase 登录服务;而 mock
// 认证的"用户"是纯浏览器 localStorage 身份、可伪造,不能用来守后台。所以给自托管
// 实例一条**服务端口令**通道:向导设一个管理员密码(scrypt 哈希落库),登录校验通过
// 后签发 HMAC 签名的会话 cookie;后台鉴权 requireAdmin() 接受"本地会话"或"Supabase
// 管理员 token"任一。官方云仍走 Supabase + ADMIN_EMAIL,不受影响。
// ---------------------------------------------------------------------------

export const ADMIN_PW_HASH_SETTING = "admin_password_hash";
export const ADMIN_COOKIE = "nv_admin";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function secret(): string {
  // 复用落库加密用的服务端密钥(settings.ts 同源),用于给会话 cookie 签名。
  return process.env.SETTINGS_SECRET || "novaryns-insecure-default";
}

export async function setAdminPassword(pw: string): Promise<void> {
  await setSetting(ADMIN_PW_HASH_SETTING, hashPassword(pw));
}

/** 本实例是否已设本地管理员密码(前端据此决定显不显示密码登录框)。永不抛错。 */
export async function hasAdminPassword(): Promise<boolean> {
  try {
    return !!(await getSetting(ADMIN_PW_HASH_SETTING))?.trim();
  } catch {
    return false;
  }
}

export async function verifyAdminPassword(pw: string): Promise<boolean> {
  if (!pw) return false;
  try {
    const stored = (await getSetting(ADMIN_PW_HASH_SETTING))?.trim();
    if (!stored) return false;
    return verifyPassword(pw, stored);
  } catch {
    return false;
  }
}

// 签名会话令牌:"<exp>.<hmacHex>",hmac = HMAC-SHA256(secret, "admin:"+exp)。
// 无状态:不需要在 DB 存 session,靠签名 + 过期时间自证。
export function signSession(now: number): string {
  const exp = now + SESSION_TTL_MS;
  const mac = createHmac("sha256", secret()).update(`admin:${exp}`).digest("hex");
  return `${exp}.${mac}`;
}

export function verifySessionToken(value: string, now: number): boolean {
  try {
    const dot = value.lastIndexOf(".");
    if (dot < 0) return false;
    const exp = Number(value.slice(0, dot));
    const mac = value.slice(dot + 1);
    if (!Number.isFinite(exp) || exp < now) return false;
    const expected = createHmac("sha256", secret())
      .update(`admin:${exp}`)
      .digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(/; */)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/** 本地管理员会话是否有效(cookie 里的签名令牌未过期且签名正确)。 */
export function localAdminOk(request: Request): boolean {
  const tok = readCookie(request, ADMIN_COOKIE);
  if (!tok) return false;
  return verifySessionToken(tok, Date.now());
}

/**
 * 统一管理员校验:**本地会话 或 Supabase 管理员 token** 任一通过。
 * 所有 admin 接口用它替代裸 isAdminToken,兼容"官方云 Supabase"与"自托管本地口令"。
 */
export async function requireAdmin(request: Request): Promise<boolean> {
  if (localAdminOk(request)) return true;
  // 原生多用户:站长邮箱账号(app_users.role=admin)的会话也算管理员——
  // 站长与官方站一致地用邮箱+密码从普通登录框登录,即拥有后台权限。
  if (!supabaseEnabled) {
    try {
      const { nativeUserEmail } = await import("@/lib/native-auth");
      const nu = nativeUserEmail(request);
      if (nu) {
        const { getUserRole } = await import("@/lib/db");
        if ((await getUserRole(nu)) === "admin") return true;
      }
    } catch {
      /* 查失败按非管理员处理 */
    }
  }
  return isAdminToken(bearer(request));
}

/**
 * 解析当前请求的用户邮箱(功能路由鉴权用):
 *   1) Supabase token 校验通过 → 该用户邮箱(官方云 / 多用户)。
 *   2) 否则,开源版单用户(无 Supabase)且本地操作者已登录(admin cookie 有效)
 *      → 返回 OPERATOR_EMAIL,让生图 / 工具等对"登录后的站长"放行。
 *   3) 都不满足 → null(未登录,路由返回 401)。
 * 这样开源版单用户 = 站长用密码登录后即可正常使用所有功能;随便访问的人(无 cookie)仍被挡。
 */
export async function resolveUserEmail(
  request: Request
): Promise<string | null> {
  const tokenEmail = await emailFromToken(bearer(request));
  if (tokenEmail) return tokenEmail;
  if (!supabaseEnabled) {
    // 原生多用户:已登录用户的会话 cookie。
    const { nativeUserEmail } = await import("@/lib/native-auth");
    const nu = nativeUserEmail(request);
    if (nu) return nu;
    // 单用户:登录后的站长(admin cookie)。
    if (localAdminOk(request)) return OPERATOR_EMAIL;
  }
  return null;
}
