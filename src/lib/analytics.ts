// ---------------------------------------------------------------------------
// 自建轻量访问统计 —— 纯函数层(采集端点与后台面板共用,无 server-only 依赖)。
//
// 为什么不接第三方(GA / 百度统计 / Plausible 云):
//   ① 国内站访客被 GA 拦,海外站访客被百度统计拖慢,一套代码两站要接两家;
//   ② 白标买家/自托管租户跑的是同一个镜像,不能让他们的访客数据流到我们或第三方;
//   ③ 我们只要 PV/UV/国家/来源/页面这几个数,自己存一张表就够,零外部依赖。
//
// 隐私:**不落原始 IP、不落完整 UA**。IP+UA 经站点密钥加盐做不可逆哈希后只保留
// 前 32 个十六进制字符(visitor),仅用于「是不是同一个人」的去重。
// ---------------------------------------------------------------------------

/** 后台时间范围切换的档位(天)。today=当天。 */
export const ANALYTICS_RANGES = [1, 7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** 明细保留天数;超过的行由采集端点低概率触发清理(见 purgeOldPageViews)。 */
export const ANALYTICS_RETENTION_DAYS = 400;

/**
 * 统计口径的时区。PV/UV 的「一天」按这个时区切,否则服务器跑 UTC 时
 * 国内的「今天」会从早上 8 点才开始算。两站都按东八区看数据。
 */
export const ANALYTICS_TZ = process.env.ANALYTICS_TZ || "Asia/Shanghai";

/** 采集总开关。默认开;自托管买家想关掉设 ANALYTICS_DISABLED=1。 */
export function analyticsEnabled(): boolean {
  return (process.env.ANALYTICS_DISABLED ?? "").trim() !== "1";
}

// 爬虫/监控/预取:UA 命中就不计数。宁可漏记几个真人,也别让 PV 被爬虫灌水。
const BOT_RE =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|headless|phantomjs|puppeteer|playwright|curl|wget|python-requests|axios|go-http-client|java\/|okhttp|apachebench|lighthouse|pingdom|uptime|monitor|gtmetrix|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|yisouspider|sogou|360spider|baiduspider|yandex|applebot|amazonbot|gptbot|claudebot|ccbot|perplexity/i;

export function isBotUa(ua: string): boolean {
  if (!ua || ua.length < 12) return true; // 空/极短 UA 基本是脚本
  return BOT_RE.test(ua);
}

/** 粗粒度设备类型 —— 只分三类,够看「移动端占比」就行。 */
export function parseDevice(ua: string): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua))
    return "mobile";
  return "desktop";
}

/** 浏览器家族。顺序有讲究:Edge/Opera 的 UA 里也有 Chrome,必须先判。 */
export function parseBrowser(ua: string): string {
  if (/edg[ea]?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/micromessenger/i.test(ua)) return "微信";
  if (/qqbrowser/i.test(ua)) return "QQ浏览器";
  if (/ucbrowser|ubrowser/i.test(ua)) return "UC";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "其他";
}

/**
 * 来源域名。同站跳转(站内点链接)归为空串 = 「直接访问」,
 * 否则统计里最大的一条永远是自己,没有意义。
 */
export function refererHost(referrer: string, selfHost: string): string {
  const r = (referrer || "").trim();
  if (!r) return "";
  try {
    const h = new URL(r).hostname.toLowerCase().replace(/^www\./, "");
    if (!h || h === selfHost.toLowerCase().replace(/^www\./, "")) return "";
    return h.slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * 规整上报路径:去掉 query/hash(可能带 token、订单号等敏感参数),
 * 把明显的 id 段折叠成 :id,避免「热门页面」被一堆一次性详情页刷屏。
 */
export function cleanPath(raw: string): string {
  let p = (raw || "/").split("#")[0].split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  // 形如 /works/art-1779435172860-0 或 32 位 hash 的段 → :id
  p = p
    .split("/")
    .map((seg) =>
      /^[0-9]{4,}$/.test(seg) ||
      /^[0-9a-f]{16,}$/i.test(seg) ||
      /^[a-z]+-\d{9,}/i.test(seg)
        ? ":id"
        : seg
    )
    .join("/");
  return p.slice(0, 180) || "/";
}

/** 这些路径不计入统计:站长自己的后台、首启向导、以及任何非页面请求。 */
export function isTrackablePath(p: string): boolean {
  return !/^\/(admin|setup|api|_next)(\/|$)/.test(p);
}

// ---------------------------------------------------------------------------
// 展示层
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-2 → 中文国家/地区名。查不到就直接显示原始代码。 */
const COUNTRY_ZH: Record<string, string> = {
  CN: "中国大陆", HK: "中国香港", MO: "中国澳门", TW: "中国台湾",
  US: "美国", CA: "加拿大", MX: "墨西哥", BR: "巴西", AR: "阿根廷", CL: "智利",
  GB: "英国", IE: "爱尔兰", FR: "法国", DE: "德国", NL: "荷兰", BE: "比利时",
  ES: "西班牙", PT: "葡萄牙", IT: "意大利", CH: "瑞士", AT: "奥地利",
  SE: "瑞典", NO: "挪威", DK: "丹麦", FI: "芬兰", IS: "冰岛",
  PL: "波兰", CZ: "捷克", SK: "斯洛伐克", HU: "匈牙利", RO: "罗马尼亚",
  GR: "希腊", BG: "保加利亚", HR: "克罗地亚", RS: "塞尔维亚", UA: "乌克兰",
  RU: "俄罗斯", BY: "白俄罗斯", TR: "土耳其", IL: "以色列", AE: "阿联酋",
  SA: "沙特", QA: "卡塔尔", KW: "科威特", EG: "埃及", ZA: "南非",
  NG: "尼日利亚", KE: "肯尼亚", MA: "摩洛哥",
  JP: "日本", KR: "韩国", SG: "新加坡", MY: "马来西亚", TH: "泰国",
  VN: "越南", PH: "菲律宾", ID: "印尼", IN: "印度", PK: "巴基斯坦",
  BD: "孟加拉", LK: "斯里兰卡", KH: "柬埔寨", MM: "缅甸", LA: "老挝",
  AU: "澳大利亚", NZ: "新西兰", FJ: "斐济",
  KZ: "哈萨克斯坦", UZ: "乌兹别克斯坦", MN: "蒙古", NP: "尼泊尔",
  PE: "秘鲁", CO: "哥伦比亚", VE: "委内瑞拉", EC: "厄瓜多尔", UY: "乌拉圭",
};

export function countryName(code: string | null | undefined): string {
  const c = (code || "").toUpperCase();
  if (!c) return "未知";
  return COUNTRY_ZH[c] || c;
}

const DEVICE_ZH: Record<string, string> = {
  desktop: "桌面端",
  mobile: "移动端",
  tablet: "平板",
};
export function deviceName(d: string): string {
  return DEVICE_ZH[d] || d || "未知";
}

// ---------------------------------------------------------------------------
// 接口返回类型(后台面板与 /api/admin/analytics 共用)
// ---------------------------------------------------------------------------

export type CountRow = { key: string; pv: number; uv: number };
export type DailyRow = { day: string; pv: number; uv: number };

export type AnalyticsOverview = {
  /** 本次查询的天数窗口。 */
  days: number;
  /** 地理库是否可用(false 时前端提示「国家未解析」而不是显示一片未知)。 */
  geoReady: boolean;
  totals: { pv: number; uv: number; sessions: number };
  /** 上一个等长周期,用于同比涨跌。 */
  prev: { pv: number; uv: number };
  /** 最近 30 分钟活跃访客数。 */
  online: number;
  daily: DailyRow[];
  countries: CountRow[];
  paths: CountRow[];
  referrers: CountRow[];
  devices: CountRow[];
  browsers: CountRow[];
};
