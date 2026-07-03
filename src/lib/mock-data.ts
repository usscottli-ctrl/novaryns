// All data here is MOCK. Swap for Supabase/Postgres + OpenAI Image API later.
import { IMAGES, img } from "@/lib/images";

export type Category =
  | "main"
  | "banner"
  | "scene"
  | "xiaohongshu"
  | "detail"
  | "cutout" // AI 抠图(透明底)产物,作品页单独筛选、不混进成片
  | "fusion" // AI 融图(多图合成)产物,作品页单独筛选、不混进成片
  | "variation" // AI 图裂变(单图出多变体)产物,作品页单独筛选
  | "upscale" // AI 变清晰(超分放大)产物,作品页单独筛选
  | "inpaint" // 局部改图(涂抹重绘)产物,作品页单独筛选
  | "print" // 印花提取(提取图案)产物,作品页单独筛选
  | "avatar" // 抠头像(头部大头贴)产物,作品页单独筛选
  | "style" // 风格转换产物,作品页单独筛选
  | "garment" // 服装提取(平铺产品图)产物,作品页单独筛选
  | "printfile" // 印刷图(高清印刷文件)产物,作品页单独筛选
  | "tryon" // 服装上身(虚拟试穿)产物,作品页单独筛选
  | "dress3d" // 3D 服装图(立体产品图)产物,作品页单独筛选
  | "dewrinkle" // 服装去皱产物,作品页单独筛选
  | "dewatermark"; // 去水印产物,作品页单独筛选

export const CATEGORY_LABELS: Record<Category, string> = {
  main: "电商主图",
  banner: "Banner 横幅",
  scene: "商品场景图",
  xiaohongshu: "小红书封面",
  detail: "详情页首屏",
  cutout: "抠图",
  fusion: "融图",
  variation: "图裂变",
  upscale: "变清晰",
  inpaint: "局部改图",
  print: "印花提取",
  avatar: "抠头像",
  style: "风格转换",
  garment: "服装提取",
  printfile: "印刷图",
  tryon: "服装上身",
  dress3d: "3D 服装图",
  dewrinkle: "服装去皱",
  dewatermark: "去水印",
};

export type PromptTemplate = {
  id: string;
  title: string;
  // 兼容 canghe 导入：可为我方 Category 中文标签，或其原始分类（如 摄影与写实）
  category: string;
  industry: string;
  description: string;
  prompt: string;
  tags: string[];
  image: string;
  gradient: string;
  popular?: boolean;
  // 管理员手动「上首页」开关:true=强制加入首页 hero/showcase 轮换池
  homepageFeatured?: boolean;
  // 白底原图:作品转模板时带进来的原作品上传图,做同款时载入产品图(库模板为空)
  sourceImage?: string;
};

export type Showcase = {
  id: string;
  industry: string;
  title: string;
  metric: string;
  image: string;
  gradient: string;
};

export const SHOWCASES: Showcase[] = [
  {
    id: "sc-skincare",
    industry: "护肤美妆",
    title: "精华液白底主图升级",
    metric: "点击率 +38%",
    image: img(IMAGES.skincare[1]),
    gradient: "from-rose-100 to-slate-100",
  },
  {
    id: "sc-fashion",
    industry: "女装服饰",
    title: "连衣裙街拍场景图",
    metric: "转化率 +27%",
    image: img(IMAGES.fashion[2]),
    gradient: "from-emerald-100 to-lime-100",
  },
  {
    id: "sc-food",
    industry: "食品生鲜",
    title: "零食诱人特写主图",
    metric: "加购率 +45%",
    image: img(IMAGES.food[2]),
    gradient: "from-amber-100 to-orange-100",
  },
  {
    id: "sc-home",
    industry: "家居家纺",
    title: "四件套北欧场景图",
    metric: "停留时长 +1.9x",
    image: img(IMAGES.home[2]),
    gradient: "from-stone-100 to-amber-100",
  },
  {
    id: "sc-digital",
    industry: "3C 数码",
    title: "耳机科技感主图",
    metric: "点击率 +52%",
    image: img(IMAGES.digital[1]),
    gradient: "from-sky-100 to-teal-100",
  },
];

export type PlanKey = "starter" | "pro" | "studio" | "team";

export type PricingPlan = {
  id: PlanKey;
  name: string;
  price: string;
  priceValue: number;
  period: string;
  tagline: string;
  credits: string;
  monthlyCredits: number;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

// 积分体系：1 张图 = POINTS_PER_IMAGE 积分。
export const POINTS_PER_IMAGE = 6;
// 高阶出图模式(high quality)单张积分:成本远高于 medium(~$0.17),固定 18 积分/张。
// 需累计充值 ≥999 元解锁(见 db.ts HIGH_QUALITY_MIN_PAID_CENTS / SessionUser.canHigh)。
export const HIGH_QUALITY_COST = 18;

// ── 各工具单次积分「唯一价格表」──────────────────────────────────────────
// 铁律:前端展示的 cost 与后端 route 实扣**都从这里取**,永不各写各的(历史上抠图
// 显示4实扣1、头像显示4实扣6 就是两边硬编码飘了)。改价只改这一处。
// 定价依据:抠图/变清晰走 Replicate 成本极低=1;gpt-image 编辑一次≈一张生图=6;
// 3D 生成成本最高=16;局改/印花提取按分辨率走 resolutionCost,不在此表。
export const TOOL_COST = {
  cutout: 1, // Replicate BiRefNet
  upscale: 1, // Replicate Real-ESRGAN
  garment: 6, // gpt-image 编辑(服装提取)
  avatar: 6, // gpt-image 编辑(头像/模特)
  dewrinkle: 6, // gpt-image 编辑(去皱)
  dewatermark: 6, // gpt-image 编辑(去水印)
  style: 6, // gpt-image 编辑(风格化)
  tryon: 6, // gpt-image 编辑(试穿)
  ipcheck: 1, // 侵权检测(纯查询)
  printfile: 0, // 印刷文件导出(免费)
} as const;
export type ToolKey = keyof typeof TOOL_COST;

// Pro 商业授权直售价(分):¥1,999/年。官网直售自动发 Key(2026-07-03 起,替代爱发电主通道)。
export const RMB_PRO_LICENSE_FEN = 199900;

// [已弃用] 旧的 build 期充值开关。前端门控已改成 SSR 注入的 PaymentProvider
// (见 @/lib/payment-context + getPaymentStatus),后台 DB 开关 + env 兜底实时生效,
// 两站一套代码。此常量保留仅为兼容,任何组件都不应再用它做门控。
export const RECHARGE_ENABLED =
  (process.env.NEXT_PUBLIC_RECHARGE_ENABLED ?? "").trim() === "true";

// 人民币定价（单位：分）。这是「显示价 = 实际扣款价」的唯一真源：
// 页面展示价、下单金额、发票金额都从这里派生，杜绝「显示美元、扣款人民币」
// 这种汇率换算不一致的问题。调价只改这里即可。
export const RMB_PLAN_FEN: Record<PlanKey, number> = {
  starter: 0,
  pro: 6800,
  studio: 13800,
  team: 34800,
};
// 积分充值包(月度会员已下线,改纯积分充值)。基准 10 积分/¥,加赠随档位递增。
// 充值积分统一 2 年有效。价格(分)是「显示价 = 扣款价」唯一真源。
export const RMB_PACK_FEN: Record<string, number> = {
  "c-990": 9900,
  "c-6240": 49900,
  "c-13320": 99900,
  "c-28560": 199900,
  "c-76910": 499900,
  "c-183320": 1099900,
};

// 分 → ¥ 显示字符串（整数不带小数，含角分则保留两位）。
export function fenToYuan(fen: number): string {
  const yuan = fen / 100;
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(2)}`;
}

export const PRICING: PricingPlan[] = [
  {
    id: "starter",
    name: "免费用户",
    price: fenToYuan(RMB_PLAN_FEN.starter),
    priceValue: RMB_PLAN_FEN.starter / 100,
    period: "/ 永久免费",
    tagline: "适合个人卖家试用",
    credits: "注册即送积分",
    monthlyCredits: 20,
    features: ["全部基础模板", "标准生成队列", "1024px 导出", "社区支持"],
    cta: "免费开始",
  },
  {
    id: "pro",
    name: "入门会员",
    price: fenToYuan(RMB_PLAN_FEN.pro),
    priceValue: RMB_PLAN_FEN.pro / 100,
    period: "/ 月",
    tagline: "适合轻量测试提示词和日常生图实验。",
    credits: "每月 700 积分",
    monthlyCredits: 700,
    features: ["全部高级模板", "标准生成队列", "1024px 导出", "邮件支持"],
    cta: "开通会员",
  },
  {
    id: "studio",
    name: "创作者会员",
    price: fenToYuan(RMB_PLAN_FEN.studio),
    priceValue: RMB_PLAN_FEN.studio / 100,
    period: "/ 月",
    tagline: "适合高频复用案例、内容生产和提示词测试。",
    credits: "每月 1,800 积分",
    monthlyCredits: 1800,
    features: [
      "全部高级模板",
      "优先生成队列",
      "2048px 高清导出",
      "批量生成（最多 20 张）",
      "去除水印",
    ],
    cta: "开通会员",
    highlighted: true,
  },
  {
    id: "team",
    name: "工作室会员",
    price: fenToYuan(RMB_PLAN_FEN.team),
    priceValue: RMB_PLAN_FEN.team / 100,
    period: "/ 月",
    tagline: "适合高频出图工作流和小团队使用。",
    credits: "每月 5,200 积分",
    monthlyCredits: 5200,
    features: [
      "全部创作者功能",
      "4K 超清导出",
      "团队协作席位 ×5",
      "专属模板定制",
      "API 接入",
    ],
    cta: "开通会员",
  },
];

export function getPlan(id: PlanKey): PricingPlan {
  return PRICING.find((p) => p.id === id) ?? PRICING[0];
}

// 会员等级高低排序：免费 < 入门 < 创作者 < 工作室。
// 用于判断升级/降级（如：有效期内禁止购买更低等级）。
export const PLAN_ORDER: Record<PlanKey, number> = {
  starter: 0,
  pro: 1,
  studio: 2,
  team: 3,
};

export type CreditPack = {
  id: string;
  credits: number; // 到账总积分(基础 + 加赠)
  base: number; // 基础积分(= 价格 ×10)
  bonus: number; // 加赠积分
  price: string; // ¥ 显示
  priceValue: number; // 元
  fen: number; // 分
  discount?: string; // 约 X 折(仅有加赠的档显示)
};

// 千分位:990 → "990",6240 → "6,240"
export function fmtCredits(n: number): string {
  return n.toLocaleString("en-US");
}

const PACK_DEFS: { id: string; base: number; bonus: number; discount?: string }[] = [
  { id: "c-990", base: 990, bonus: 0 },
  { id: "c-6240", base: 4990, bonus: 1250, discount: "约 8 折" },
  { id: "c-13320", base: 9990, bonus: 3330, discount: "约 7.5 折" },
  { id: "c-28560", base: 19990, bonus: 8570, discount: "约 7 折" },
  { id: "c-76910", base: 49990, bonus: 26920, discount: "约 6.5 折" },
  { id: "c-183320", base: 109990, bonus: 73330, discount: "约 6 折" },
];

export const CREDIT_PACKS: CreditPack[] = PACK_DEFS.map((p) => {
  const fen = RMB_PACK_FEN[p.id];
  return {
    id: p.id,
    credits: p.base + p.bonus,
    base: p.base,
    bonus: p.bonus,
    price: fenToYuan(fen),
    priceValue: fen / 100,
    fen,
    discount: p.discount,
  };
});

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export type Artwork = {
  id: string;
  title: string;
  category: Category;
  prompt: string;
  createdAt: string;
  status: "completed" | "processing" | "failed";
  image: string;
  gradient: string;
  style?: string;
  ratio?: string;
  resolution?: string;
  source?: string;
  batchId?: string | null; // 一键套图同批次共用一个 batchId,作品页按它分组
  parentId?: string | null; // 血缘:这张图基于哪张作品生成(图生图底图),根图为 null
  parentIds?: string[] | null; // 多输入:额外父节点(合并多张参考图)
  templateId?: string | null; // 模板原图根节点代表的模板 id
  canvasX?: number | null; // 画布手动拖拽记住的坐标
  canvasY?: number | null;
  groupId?: string | null; // 稳定项目分组:同项目所有节点共享,删节点也不变
  origin?: string | null; // "canvas"=在画布里产出(永远留画布);空=普通产出
};

export const ARTWORKS: Artwork[] = [
  {
    id: "art-001",
    title: "玻尿酸精华·白底主图",
    category: "main",
    prompt: "高端护肤品瓶身，纯白背景，柔和顶光，极简构图",
    createdAt: "2026-05-15T09:24:00Z",
    status: "completed",
    image: img(IMAGES.skincare[4]),
    gradient: "from-rose-100 to-slate-100",
  },
  {
    id: "art-002",
    title: "夏季连衣裙·街拍场景",
    category: "scene",
    prompt: "时尚女装街拍，城市街道虚化背景，自然日光",
    createdAt: "2026-05-15T08:02:00Z",
    status: "completed",
    image: img(IMAGES.fashion[3]),
    gradient: "from-emerald-100 to-lime-100",
  },
  {
    id: "art-003",
    title: "618 大促·首页 Banner",
    category: "banner",
    prompt: "电商大促横版 banner，左侧留文案区，渐变背景",
    createdAt: "2026-05-14T16:48:00Z",
    status: "completed",
    image: img(IMAGES.ecommerce[2]),
    gradient: "from-orange-100 to-pink-100",
  },
  {
    id: "art-004",
    title: "无线耳机·科技感主图",
    category: "main",
    prompt: "数码产品悬浮于深色科技背景，蓝紫光效",
    createdAt: "2026-05-14T11:15:00Z",
    status: "processing",
    image: img(IMAGES.digital[3]),
    gradient: "from-sky-100 to-teal-100",
  },
  {
    id: "art-005",
    title: "坚果零食·小红书封面",
    category: "xiaohongshu",
    prompt: "小红书竖版封面，零食种草，明亮活力配色",
    createdAt: "2026-05-13T20:30:00Z",
    status: "completed",
    image: img(IMAGES.food[3]),
    gradient: "from-amber-100 to-orange-100",
  },
  {
    id: "art-006",
    title: "纯棉四件套·详情首屏",
    category: "detail",
    prompt: "家居详情页首屏，居中产品大图，留卖点区",
    createdAt: "2026-05-13T10:05:00Z",
    status: "failed",
    image: img(IMAGES.home[3]),
    gradient: "from-slate-100 to-zinc-100",
  },
];

export const GENERATION_RATIOS = [
  { id: "auto", label: "默认", w: 0, h: 0 },
  { id: "1:1", label: "主图 1:1", w: 1, h: 1 },
  { id: "3:4", label: "竖版 3:4", w: 3, h: 4 },
  { id: "4:3", label: "横版 4:3", w: 4, h: 3 },
  { id: "16:9", label: "Banner 16:9", w: 16, h: 9 },
  { id: "9:16", label: "长图 9:16", w: 9, h: 16 },
];

export const GENERATION_STYLES = [
  "默认",
  "白底极简",
  "高级质感",
  "生活场景",
  "科技未来",
  "小红书风",
  "节日促销",
];

// 分辨率档位：每张消耗的积分按分辨率递增。1K = 基础积分（POINTS_PER_IMAGE）。
// 2K / 4K 在生成后由服务端放大到对应长边像素（见 generate-image route）。
export type ResolutionTier = {
  id: string;
  label: string;
  cost: number;
  /** 放大目标长边像素；0 表示不放大（沿用模型原生尺寸）。 */
  longSide: number;
};

export const GENERATION_RESOLUTIONS: ResolutionTier[] = [
  { id: "1K", label: "1K 标准", cost: POINTS_PER_IMAGE, longSide: 0 },
  { id: "2K", label: "2K 高清", cost: 8, longSide: 2048 },
  { id: "4K", label: "4K 超清", cost: 12, longSide: 4096 },
];

export function resolutionCost(id: string): number {
  return (
    GENERATION_RESOLUTIONS.find((r) => r.id === id)?.cost ?? POINTS_PER_IMAGE
  );
}

export function resolutionLongSide(id: string): number {
  return GENERATION_RESOLUTIONS.find((r) => r.id === id)?.longSide ?? 0;
}

// 3D 服装图专属分辨率计价(成本高于平面图):1K/2K=9、4K=18。
// 放大长边复用 resolutionLongSide(2K=2048 / 4K=4096;1K 不放大)。
export const GARMENT3D_COST: Record<string, number> = {
  "1K": 9,
  "2K": 9,
  "4K": 18,
};
export function garment3dCost(id: string): number {
  return GARMENT3D_COST[id] ?? GARMENT3D_COST["1K"];
}
