// 云端托管:子域名校验 + 常量。前后端共享(纯逻辑,无 server-only),
// check-name 接口、resolveItem('cloud')、CloudModal 都用它,规则单一真源。
// 与 ops/cloud/provision-cn.sh 的校验保持一致(名称正则 + 保留字)。

export const CLOUD_BASE_DOMAIN = "starzeco.com"; // 大陆区(已 ICP 备案),海外区 novaryns.com 待接入

// ── 云端托管套餐(2026-07-19 起支持月付)───────────────────────────────────────
// 统一口径:**月度算力配额 1000 积分/月**(≈167 张)。年付 = 一次性发满 12 个月的量,
// 均摊 ¥333/月比月付便宜 17% —— 年付卖「更便宜」,不卖「更多积分」,杜绝套利。
// 赠送量刻意只够「做样图 + 跑通前十几单」:真做起来必须买算力包,保住复购线。
export const CLOUD_MONTHLY_CREDITS = 1000;

export type CloudPlan = {
  id: "monthly" | "yearly";
  label: string;
  days: number;
  credits: number;
  fen: number;
  /** 是否对外售卖。下架的套餐仍保留定义,只为兼容历史订单/开通码的解析。 */
  onSale: boolean;
};

// ⚠️ 2026-09-15 起**只卖年付 ¥3,999**(回到 07-19 加月付之前的原价)。
// 用户判断:真有托管需求的客户不在乎 ¥399 还是 ¥3,999,月付只会拉低客单价。
// 月付定义保留(onSale:false):下单接口与后台开通码都会拒绝它,但老数据仍能解析。
// 下架时核对过:CN 库云端订单 0 笔、开通码 0 张,没有存量月付用户受影响。
export const CLOUD_PLANS: CloudPlan[] = [
  { id: "monthly", label: "月付", days: 30, credits: CLOUD_MONTHLY_CREDITS, fen: 39_900, onSale: false },
  { id: "yearly", label: "年付", days: 365, credits: CLOUD_MONTHLY_CREDITS * 12, fen: 399_900, onSale: true },
];

/** 对外售卖中的套餐(开通弹窗、后台发码都只列这些)。 */
export const SALE_CLOUD_PLANS: CloudPlan[] = CLOUD_PLANS.filter((p) => p.onSale);

export function findCloudPlan(id: string): CloudPlan | null {
  return CLOUD_PLANS.find((p) => p.id === id) ?? null;
}

/** 默认套餐(未指定时按年付,兼容历史 itemId=纯子域名的订单)。 */
export const DEFAULT_CLOUD_PLAN: CloudPlan = CLOUD_PLANS[1];

/** 云端 itemId 编码:"<子域名>" (历史/年付) 或 "<子域名>@<套餐id>"。 */
export function parseCloudItemId(itemId: string): { sub: string; plan: CloudPlan } {
  const [subRaw, planRaw] = String(itemId || "").split("@");
  return {
    sub: normalizeSubdomain(subRaw),
    plan: findCloudPlan(planRaw || "") ?? DEFAULT_CLOUD_PLAN,
  };
}

/** @deprecated 用 plan.days;保留是因为续费/开通老代码还在引用。 */
export const CLOUD_TERM_DAYS = 365;

// ── 云端托管算力(2026-07-14 起积分化)─────────────────────────────────────────
// 租户算力以「积分」计量(与站内一致:1 张图 = 6 积分),经中转扣减,租户碰不到 Key。
// 首购 ¥3,999 含赠送积分;之后租户在自己后台看余额、到购买站买算力包充值。
// 定价 = 我们的实际成本 + 20%(按标准档公开价估算;实际账单变了在这里调,一处生效)。
// 租户转售给他的终端用户按 10积分=¥1(¥0.6/张),仍有 50%+ 毛利,卖得动。
/** @deprecated 改由 CLOUD_PLANS[].credits 驱动(月付1000/年付12000)。保留避免老引用报错。 */
export const CLOUD_GIFT_CREDITS = CLOUD_MONTHLY_CREDITS * 12;
export const CLOUD_BUY_ORIGIN = "https://ai.starzeco.com"; // 算力/云端的购买站

export type ComputePack = { id: string; credits: number; fen: number };
// ── 站长充值算力的价格(唯一真源)────────────────────────────────────────────
// 这张表同时决定**三件事**:充值页展示的价格、下单实收金额、支付成功后到账的积分
// (compute-client.tsx 展示 / payments.ts 下单 / db.ts 到账都从这里取,别在别处写死)。
//
// ⚠️ 2026-08-18 复核后**维持原价**。过程记下来,避免重蹈:
// 曾一度上调到 ¥390/760/2190/7000,依据是"全线亏损"——**那个结论是错的**。
// 错因:4K 档的 token 数用了**外推值**(6,690),而实测只有 **3,336**,高估一倍;
// 于是把高毛利的 4K 误判成亏损。教训:**外推值不能当实测用**。
//
// 真实成本(2026-08-17/18 逐档实测 token × 真实账单反推的 ¥217.6/百万 token):
//   1K 基础 196tok=¥0.043 · 1K 标准 1,756tok=¥0.382 · 1K 高阶 7,024tok=¥1.529
//   2K 基础 397tok=¥0.086 · 2K 标准 3,568tok=¥0.777
//   4K 基础 371tok=¥0.081 · 4K 标准 3,336tok=¥0.726 · 4K 高阶 13,342tok=¥2.904
//
// 原价下的真实毛利(按客户实际用量:5张4K标准+2张1K标准)= **+59%~85%**,健康。
// 只有 1K/2K 标准档贴着成本(0%~-15%),但它们不是主要用量,不足以推翻整体。
// **改价前必须先有长期成本核算**(用户 2026-08-18 明确要求),不要再凭单次实测调价。
export const COMPUTE_PACKS: ComputePack[] = [
  { id: "cp-5000", credits: 5_000, fen: 32_000 },     // ¥320(¥0.0640/积分)
  { id: "cp-10000", credits: 10_000, fen: 62_000 },   // ¥620(¥0.0620/积分)
  { id: "cp-30000", credits: 30_000, fen: 175_000 },  // ¥1,750(¥0.0583/积分)
  { id: "cp-100000", credits: 100_000, fen: 550_000 },// ¥5,500(¥0.0550/积分)
];
export function findComputePack(id: string): ComputePack | null {
  return COMPUTE_PACKS.find((p) => p.id === id) ?? null;
}

// 从租户实例的 OPENAI_BASE_URL(https://relay.../nvr-<16hex>/v1)提取中转 token id。
export function relayTokenIdFromBaseUrl(baseUrl: string): string | null {
  const m = /\/nvr-([0-9a-f]{16})\/v1\/?$/.exec((baseUrl || "").trim());
  return m ? m[1] : null;
}

// 保留子域名:与 provision-cn.sh 的保留字表一致 + 已占用的系统子域。
export const CLOUD_RESERVED = new Set([
  "www", "ai", "cdn", "pay", "wx", "auth", "agent", "mail", "smtp", "ftp",
  "admin", "api", "app", "image", "relay", "cn-origin", "test", "demo",
  "static", "assets", "blog", "docs", "status", "shop", "store",
]);

export function normalizeSubdomain(s: string): string {
  return String(s || "").trim().toLowerCase();
}

// 返回错误文案(可展示),或 null 表示格式合法(是否被占用另查库)。
export function subdomainError(input: string): string | null {
  const sub = normalizeSubdomain(input);
  if (!sub) return "请填写子域名";
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(sub)) {
    return "3-30 位,仅小写字母/数字/短横线,且以字母或数字开头";
  }
  if (sub.endsWith("-")) return "不能以短横线结尾";
  if (sub.includes("--")) return "不能包含连续短横线";
  if (CLOUD_RESERVED.has(sub)) return "该名称被系统保留,请换一个";
  return null;
}

export function cloudDomainFor(sub: string): string {
  return `${normalizeSubdomain(sub)}.${CLOUD_BASE_DOMAIN}`;
}
