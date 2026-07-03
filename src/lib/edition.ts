import "server-only";

// ---------------------------------------------------------------------------
// Pro 门控(open-core)。fail-closed —— 默认开源精简版,显式标记/授权才解锁:
//   - NOVARYNS_EDITION=cloud → 官方云,全功能(我们的站;不做任何网络/DB 调用)。
//   - NOVARYNS_EDITION=pro   → 自托管 Pro,需 PRO_LICENSE_KEY 且经 license 服务器
//                              (/api/license/activate)校验 + 绑定本机 host 通过。
//   - 其它 / 未设            → 开源精简版;但若拿到有效 License Key(env 或首启向导
//                              落库的 pro_license_key),校验通过一样解锁 Pro。
// ---------------------------------------------------------------------------

const EDITION = (process.env.NOVARYNS_EDITION || "").trim().toLowerCase();

export const editionName: "cloud" | "pro" | "oss" =
  EDITION === "cloud" ? "cloud" : EDITION === "pro" ? "pro" : "oss";

// 首启向导落库的 License Key 设置项(与 setup.ts 的 PRO_LICENSE_KEY_SETTING 同值)。
// 这里内联字面量而非 import,避免 setup.ts ↔ edition.ts 循环依赖。
const PRO_LICENSE_KEY_SETTING = "pro_license_key";

/** 从 DB 读首启向导填写的 License Key;DB 未启用/读失败返回空串。永不抛错。 */
async function proLicenseKeyFromDb(): Promise<string> {
  try {
    // 动态 import:避免模块加载期与 db.ts/其它 server-only 模块的循环。
    const { getSetting, dbEnabled } = await import("@/lib/db");
    if (!dbEnabled) return "";
    return (await getSetting(PRO_LICENSE_KEY_SETTING))?.trim() || "";
  } catch {
    return "";
  }
}

let cache: { pro: boolean; at: number } | null = null;
const TTL = 6 * 60 * 60 * 1000; // 6h,减少对 license 服务器的调用

// 自托管 Pro 实例向 license 服务器(默认官方站)校验 License Key 并绑定本机 host。
async function validateProLicense(key: string): Promise<boolean> {
  const server = (
    process.env.LICENSE_SERVER_URL || "https://ai.starzeco.com"
  ).replace(/\/$/, "");
  const host = (process.env.LICENSE_HOST || process.env.PRO_HOST || "self-host")
    .toString()
    .trim();
  try {
    const res = await fetch(`${server}/api/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, host }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const d = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return !!(res.ok && d?.ok);
  } catch {
    return false;
  }
}

/** 本实例是否解锁 Pro 能力(白标 / 收银 / 多用户 / 后台高阶)。永不抛错。 */
export async function proEnabled(): Promise<boolean> {
  if (EDITION === "cloud") return true; // 官方云,永远全功能(短路,不读 DB/网络)
  // License Key 解析:env PRO_LICENSE_KEY 优先,缺失时回退首启向导落库的 pro_license_key。
  // 这样非技术买家在 /setup 填的 Key 也能激活 Pro,无需改 env。
  let key = (process.env.PRO_LICENSE_KEY || "").trim();
  if (!key) {
    key = await proLicenseKeyFromDb();
  }
  if (!key) return false; // 无任何 License Key → 开源版默认锁
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.pro;
  const ok = await validateProLicense(key);
  if (ok) {
    cache = { pro: true, at: now };
    return true;
  }
  // 校验失败但此前有效 → 宽限(license 服务器抖动不误锁),TTL 到后再验。
  if (cache?.pro) return true;
  cache = { pro: false, at: now };
  return false;
}

// ---------------------------------------------------------------------------
// 许可证「签发站」判定。
// 买家自托管实例激活时,默认向 LICENSE_SERVER_URL(默认官方站 ai.starzeco.com)
// 的 /api/license/activate 校验;而各站数据库彼此独立,后台生成的 Key 只落本站库。
// → 只有「签发站」(= 买家默认校验的那个站)生成的 Key 才查得到、能激活;其它站
//   (如海外站)后台生成的是「死 Key」,买家永远激活不了。
// 因此后台「生成 License」只允许在签发站进行。
//
// 判定优先级:显式 env LICENSE_ISSUER(1/true 强制是,0/false 强制否)> 比对本次
// 请求 Host 与 license 服务器 Host。正常按域名访问的官方国内站即自动识别为签发站。
// ---------------------------------------------------------------------------
export function isLicenseIssuer(request?: Request): boolean {
  const flag = (process.env.LICENSE_ISSUER || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  let serverHost = "ai.starzeco.com";
  try {
    serverHost = new URL(
      process.env.LICENSE_SERVER_URL || "https://ai.starzeco.com"
    ).host.toLowerCase();
  } catch {
    /* 用默认 */
  }
  const reqHost = (request?.headers.get("host") || "").toLowerCase().trim();
  if (!reqHost) return false;
  return reqHost === serverHost;
}
