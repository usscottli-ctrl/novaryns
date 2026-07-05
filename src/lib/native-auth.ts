import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getSetting } from "@/lib/db";
import { supabaseEnabled } from "@/lib/auth-mode";

// ---------------------------------------------------------------------------
// 原生多用户账号系统(Pro 多用户模式)。
// 不依赖 Supabase/GoTrue:用户邮箱+密码存应用自带 Postgres(app_users.password_hash),
// 登录后签发 HMAC 签名的会话 cookie(nv_user,内含邮箱)。让 Pro 自托管的预构建镜像
// 直接就能开"访客注册→买积分→生图"的多用户付费站,和官方站体验一致。
// 仅在「无 Supabase + 已激活 Pro + 站长后台打开多用户开关」时启用。
// ---------------------------------------------------------------------------

export const USER_COOKIE = "nv_user";
export const USER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
export const MULTI_USER_SETTING = "multi_user_enabled";

function secret(): string {
  return process.env.SETTINGS_SECRET || "novaryns-insecure-default";
}

// 会话令牌:"<emailB64url>.<exp>.<hmacHex>"。无状态:签名 + 过期时间自证。
export function signUserSession(email: string, now: number): string {
  const exp = now + USER_TTL_MS;
  const eb = Buffer.from(email).toString("base64url");
  const mac = createHmac("sha256", secret())
    .update(`user:${eb}.${exp}`)
    .digest("hex");
  return `${eb}.${exp}.${mac}`;
}

export function verifyUserSession(value: string, now: number): string | null {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [eb, expStr, mac] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < now) return null;
    const expected = createHmac("sha256", secret())
      .update(`user:${eb}.${expStr}`)
      .digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return Buffer.from(eb, "base64url").toString();
  } catch {
    return null;
  }
}

// 密码重置令牌:"<emailB64url>.<exp>.<hmacHex>",30 分钟有效。用邮件发给用户点开重设密码。
export const RESET_TTL_MS = 30 * 60 * 1000;

export function signResetToken(email: string, now: number): string {
  const exp = now + RESET_TTL_MS;
  const eb = Buffer.from(email).toString("base64url");
  const mac = createHmac("sha256", secret())
    .update(`reset:${eb}.${exp}`)
    .digest("hex");
  return `${eb}.${exp}.${mac}`;
}

export function verifyResetToken(value: string, now: number): string | null {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [eb, expStr, mac] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < now) return null;
    const expected = createHmac("sha256", secret())
      .update(`reset:${eb}.${expStr}`)
      .digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return Buffer.from(eb, "base64url").toString();
  } catch {
    return null;
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

/** 从请求 cookie 解析已登录的原生用户邮箱;会话有效则返回,否则 null。 */
export function nativeUserEmail(request: Request): string | null {
  const tok = readCookie(request, USER_COOKIE);
  if (!tok) return null;
  return verifyUserSession(tok, Date.now());
}

/** 是否启用「原生多用户」模式:无 Supabase + 已激活 Pro + 站长后台开了开关。永不抛错。 */
export async function multiUserEnabled(): Promise<boolean> {
  if (supabaseEnabled) return false; // Supabase 模式另有多用户实现
  try {
    const { proEnabled } = await import("@/lib/edition");
    if (!(await proEnabled())) return false; // 多用户是 Pro 能力
    // env 开关(compose 里设 NOVARYNS_MULTI_USER=1 即开,适合技术站长)或后台开关。
    if ((process.env.NOVARYNS_MULTI_USER ?? "").trim() === "1") return true;
    const flag = (await getSetting(MULTI_USER_SETTING))?.trim();
    return flag === "1" || flag === "true";
  } catch {
    return false;
  }
}
