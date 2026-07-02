import "server-only";
import { getSetting, setSetting, dbEnabled } from "@/lib/db";
import { getOpenAISettings, saveOpenAIKey } from "@/lib/settings";
import { editionName } from "@/lib/edition";

// ---------------------------------------------------------------------------
// 首启配置向导(/setup)的服务端逻辑。
//
// 面向自托管买家(可能非技术、不想碰 .env):docker run 起来后打开站点,
// 未配置的实例自动进入 /setup,填几项(OpenAI Key、可选 License、可选站点名)即可用。
//
// 安全前提(核心):**只对「未配置」的实例生效;已配置的实例(线上站)绝不受影响**。
//   「已配置」= getOpenAISettings().apiKey 有值  或  edition === "cloud"(官方云)。
//   满足其一即视为已配置:
//     - 访问 /setup → redirect("/");
//     - POST /api/setup → 403(自锁,配置完成后不能再被调用,防滥用)。
//   我们两站 env 有 NOVARYNS_EDITION=cloud → editionName === "cloud" → 永远「已配置」
//   → 向导永不出现、接口永远 403。
// ---------------------------------------------------------------------------

/** 向导填写的 License Key 落库项(env PRO_LICENSE_KEY 缺失时由 edition.ts 回退读取)。 */
export const PRO_LICENSE_KEY_SETTING = "pro_license_key";
/** 站点名称(为后续白标铺路,先存着)。 */
export const SITE_NAME_SETTING = "site_name";

/**
 * 本实例是否「已配置」。判定(满足其一即已配置):
 *   1) 官方云:editionName === "cloud"(我们的线上站,env 直接标记)。
 *   2) 已填 OpenAI Key:getOpenAISettings().apiKey 有值(DB 或 env 任一)。
 *
 * 永不抛错:DB 抖动时按「已配置」兜底,绝不误把线上站/正常实例引到向导。
 */
export async function isConfigured(): Promise<boolean> {
  if (editionName === "cloud") return true; // 官方云永远已配置
  try {
    const s = await getOpenAISettings();
    return !!s.apiKey;
  } catch {
    // 读设置失败 → 保守当作「已配置」,宁可不显示向导也不打扰正常实例。
    return true;
  }
}

/** 读向导填写的 License Key(DB);无则空串。edition.ts 的 proEnabled() 会回退读它。 */
export async function getProLicenseKeyFromDb(): Promise<string> {
  if (!dbEnabled) return "";
  try {
    return (await getSetting(PRO_LICENSE_KEY_SETTING))?.trim() || "";
  } catch {
    return "";
  }
}

/** 读向导填写的站点名称(DB);无则空串。 */
export async function getSiteName(): Promise<string> {
  if (!dbEnabled) return "";
  try {
    return (await getSetting(SITE_NAME_SETTING))?.trim() || "";
  } catch {
    return "";
  }
}

export type SetupInput = {
  /** 必填:OpenAI API Key(明文,经 TLS 传输;落库走 settings.ts 的 AES 加密)。 */
  apiKey: string;
  /** 选填:Pro 授权 License Key(落库 pro_license_key,可激活 Pro)。 */
  licenseKey?: string;
  /** 选填:站点名称(白标铺路)。 */
  siteName?: string;
};

export type SetupResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * 落库首启配置。**仅「未配置」时可写,写完即锁**(已配置 → 返回 403,自锁)。
 * 首启还没管理员,本函数供无需登录的 /api/setup 调用,靠 isConfigured() 自锁防滥用。
 */
export async function applySetup(input: SetupInput): Promise<SetupResult> {
  if (!dbEnabled) {
    return { ok: false, status: 503, error: "未配置数据库,无法保存设置" };
  }
  // 自锁:已配置的实例(含官方云)一律拒绝,防配置完成后被再次调用覆盖。
  if (await isConfigured()) {
    return { ok: false, status: 403, error: "本实例已完成配置" };
  }

  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey || apiKey.length < 8) {
    return { ok: false, status: 400, error: "请填写有效的 OpenAI API Key" };
  }

  // 1) OpenAI Key —— 和后台设置同一个 key,AES 加密落库(复用 settings.ts)。
  await saveOpenAIKey(apiKey);

  // 2) License Key(选填)—— 落库,edition.ts 会在 env 缺失时回退读取以激活 Pro。
  const licenseKey = (input.licenseKey ?? "").trim();
  if (licenseKey) {
    await setSetting(PRO_LICENSE_KEY_SETTING, licenseKey);
  }

  // 3) 站点名称(选填)—— 落库,为白标铺路。
  const siteName = (input.siteName ?? "").trim();
  if (siteName) {
    await setSetting(SITE_NAME_SETTING, siteName.slice(0, 80));
  }

  return { ok: true };
}
