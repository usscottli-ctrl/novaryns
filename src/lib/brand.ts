// 站点品牌 — 海外站默认 Novaryns,国内站(ai.starzeco.com)的 .env.local 覆盖。
// NEXT_PUBLIC_* 是 build 期内联,改了要重新 build。
//
// 用法:
//   1) TSX 里 import BRAND / BRAND_LOGO
//   2) i18n 字典里写 "{brand}" 占位符,translate() 自动替换
export const BRAND: string =
  (process.env.NEXT_PUBLIC_BRAND_NAME ?? "").trim() || "Novaryns";

// Logo 图片路径(/public/ 下的文件)。国内站设 /logo-starzeco.png,海外默认 /logo.png。
// 同一个值被用于:导航栏 Logo 组件 + <link rel="icon"> 浏览器 tab icon。
export const BRAND_LOGO: string =
  (process.env.NEXT_PUBLIC_BRAND_LOGO ?? "").trim() || "/logo.png";

// 画布页面专属 logo(画布顶栏/项目页用)。
//  ① 显式 NEXT_PUBLIC_BRAND_CANVAS_LOGO 优先;
//  ② 否则国内站(星泽商图,BRAND_LOGO 含 "starzeco")自动用画布专属 wordmark;
//  ③ 其余站(海外 Novaryns 等)回退到各自 BRAND_LOGO,互不串味,无需改服务器 env。
export const BRAND_CANVAS_LOGO: string = (() => {
  const explicit = (process.env.NEXT_PUBLIC_BRAND_CANVAS_LOGO ?? "").trim();
  if (explicit) return explicit;
  const logo = (process.env.NEXT_PUBLIC_BRAND_LOGO ?? "").trim();
  if (logo.includes("starzeco")) return "/logo-canvas-starzeco.png";
  return logo || "/logo.png";
})();

// 当 logo 图本身已经包含品牌文字(wordmark)时设 true,导航栏就不再渲染外置文字。
// 海外用纯 icon 的 /logo.png,默认 false。国内 logo-starzeco.png 是 wordmark,设 true。
export const BRAND_LOGO_HAS_TEXT: boolean =
  (process.env.NEXT_PUBLIC_BRAND_LOGO_HAS_TEXT ?? "").trim() === "true";

// 浏览器 tab 图标(favicon)/导航栏方形小 logo。需要方形;若 BRAND_LOGO 是宽形 wordmark,
// 不能直接用。回退顺序:显式 env → 国内站(starzeco)用仓库自带方形 icon → BRAND_LOGO。
export const BRAND_FAVICON: string = (() => {
  const explicit = (process.env.NEXT_PUBLIC_BRAND_FAVICON ?? "").trim();
  if (explicit) return explicit;
  if (BRAND_LOGO.includes("starzeco")) return "/logo-starzeco-favicon.png";
  return BRAND_LOGO;
})();

// 导航栏左上方形小 logo(浅色 icon,坐在翠绿渐变方块上)。与 tab 图标(BRAND_FAVICON)
// 分开 —— 浅色 icon 在白底浏览器标签上会看不见,只用于深色/渐变底的导航方块。
export const BRAND_SQUARE_LOGO: string = (() => {
  const explicit = (process.env.NEXT_PUBLIC_BRAND_SQUARE_LOGO ?? "").trim();
  if (explicit) return explicit;
  if (BRAND_LOGO.includes("starzeco")) return "/logo-starzeco-square.png";
  return BRAND_FAVICON;
})();

// 对外联系邮箱(contact / privacy / terms 页用)。
// 海外默认 business@novaryns.com,国内 .env.local 设 sale@starzeco.com 覆盖。
export const BRAND_EMAIL: string =
  (process.env.NEXT_PUBLIC_BRAND_EMAIL ?? "").trim() || "business@novaryns.com";

// 母站(parent corporate site)的入口 — 国内站设 https://starzeco.com 后,
// header 和 footer 会显示「↗ 星泽官网」链接。海外站不设,显示为空(no-op)。
export const BRAND_PARENT_URL: string =
  (process.env.NEXT_PUBLIC_BRAND_PARENT_URL ?? "").trim();
export const BRAND_PARENT_LABEL: string =
  (process.env.NEXT_PUBLIC_BRAND_PARENT_LABEL ?? "").trim() || "返回主站";
