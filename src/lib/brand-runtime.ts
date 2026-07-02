import "server-only";
import { getSetting, dbEnabled } from "@/lib/db";
import { SITE_NAME_SETTING } from "@/lib/setup";
import { BRAND, BRAND_LOGO, BRAND_LOGO_HAS_TEXT } from "@/lib/brand";

// ---------------------------------------------------------------------------
// 运行时品牌(白标)读取 —— 服务端。
//
// 背景:品牌(站点名 / Logo)历来靠 `@/lib/brand` 的 NEXT_PUBLIC_* 常量,是
//   **build 期内联** 的。公开 Docker 镜像是预构建的,Pro 买家改 env 不重新 build
//   就不生效 → 必须做「运行时 DB 覆盖」:后台改一次 → 落库 → 每次渲染实时读回。
//
// 安全铁律:**DB 里没有品牌覆盖项时,必须回退到 env 默认值,渲染结果与现状完全一致。**
//   我们线上两站靠 env NEXT_PUBLIC_BRAND_NAME=星泽商图 显示品牌,DB 无覆盖 →
//   name = BRAND(env)、logo = BRAND_LOGO(env),与现在一模一样。
//
// 存储 key:
//   - 站点名称复用首启向导已用的 `site_name`(见 setup.ts 的 SITE_NAME_SETTING),
//     这样向导填的站点名和后台品牌段是同一个值,一致。
//   - Logo 用新 key `brand_logo`。
//
// 永不抛错:DB 未启用 / 读失败一律当作「无覆盖」→ 回退 env,绝不打断渲染。
// ---------------------------------------------------------------------------

/** 后台自定义 Logo 图片 URL 的落库项。 */
export const BRAND_LOGO_SETTING = "brand_logo";

export type RuntimeBrand = {
  name: string;
  logo: string;
  logoHasText: boolean;
};

/**
 * 读运行时品牌:DB 覆盖优先,否则回退 `@/lib/brand` 的 env 默认。
 *
 * - name:  dbSiteName || BRAND
 * - logo:  dbLogo     || BRAND_LOGO
 * - logoHasText:自定义 Logo 无法判断是否含文字,保守 false → 名称照常显示在 Logo 旁;
 *              未设自定义 Logo 时沿用 env 的 BRAND_LOGO_HAS_TEXT。
 */
export async function getRuntimeBrand(): Promise<RuntimeBrand> {
  let dbName = "";
  let dbLogo = "";
  if (dbEnabled) {
    try {
      dbName = (await getSetting(SITE_NAME_SETTING))?.trim() || "";
    } catch {
      dbName = "";
    }
    try {
      dbLogo = (await getSetting(BRAND_LOGO_SETTING))?.trim() || "";
    } catch {
      dbLogo = "";
    }
  }
  return {
    name: dbName || BRAND,
    logo: dbLogo || BRAND_LOGO,
    logoHasText: dbLogo ? false : BRAND_LOGO_HAS_TEXT,
  };
}
