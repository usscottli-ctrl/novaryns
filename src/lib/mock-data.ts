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
  | "dewatermark" // 去水印产物,作品页单独筛选
  | "video"; // AI 视频(方舟 Seedance)产物 —— 是 mp4 不是图,渲染要用 <video>

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
  video: "AI 视频",
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

// ── 视频生成积分单价(积分/秒)────────────────────────────────────────────
// 同上铁律:前端展示与后端实扣都从 videoCost() 取。
// 成本依据:方舟按**视频 token** 计费。2026-08-15 实测一条 480p/5s = 48,437 tokens,
// 按官方档位折算约 ¥0.7/条(≈¥0.14/s);720p 像素约 2.25×,估 ¥0.32/s。
// 充值基准 10 积分/¥,下表留 ~3× 毛利。**改价只改这一处**(前端展示与后端实扣都走 videoCost)。
export const VIDEO_COST_PER_SEC = {
  "480p": 5,
  "720p": 10,
  // 1080p 保留档位:部分账号有权益(实测本账号报 "not supported for this account
  // and model"),开通后前端加回选项即可,后端无需改。
  "1080p": 21,
} as const;
export type VideoResolution = keyof typeof VIDEO_COST_PER_SEC;

// 可选视频模型(后台下拉用)。放这里而不是 volcengine.ts:那个是 server-only,
// 后台是客户端组件用不了。
// ⚠️ 两种填法都支持:
//   · 基础模型名(如 doubao-seedance-2-5)—— 需要用**控制台创建的 API Key**;
//   · 推理接入点 ID(ep-xxxx)—— AK/SK 换来的临时 Key 只按接入点授权,**必须填 ep-**,
//     填模型名会 401(2026-08-15 实测)。
export const VIDEO_MODELS = [
  { id: "doubao-seedance-2-5", label: "Seedance 2.5(最新)" },
  { id: "doubao-seedance-2-0", label: "Seedance 2.0" },
  { id: "doubao-seedance-2-0-fast", label: "Seedance 2.0 Fast(快)" },
  { id: "doubao-seedance-1-0-pro", label: "Seedance 1.0 Pro" },
] as const;

export const DEFAULT_VIDEO_MODEL = VIDEO_MODELS[0].id;

/** 一次视频生成的积分成本。duration 单位秒(Seedance 支持 3~12)。 */
export function videoCost(duration: number, resolution: string): number {
  const rate =
    VIDEO_COST_PER_SEC[resolution as VideoResolution] ??
    VIDEO_COST_PER_SEC["720p"];
  return Math.round(duration * rate);
}

// Pro 商业授权直售价(分):¥1,999/年。官网直售自动发 Key(2026-07-03 起,替代爱发电主通道)。
export const RMB_PRO_LICENSE_FEN = 199900;

// 云端托管直售价(分):¥3,999/年。付款后自动开通 <子域>.starzeco.com 专属实例(含算力)。
export const RMB_CLOUD_FEN = 399900;

// 一键套图目标平台(前端选择器用;各平台风格提示词在 prompt-config 的 SUITE_PLATFORM_HINTS,后台可改)。
export const SUITE_PLATFORMS = [
  { id: "taobao", label: "淘宝 / 天猫" },
  { id: "douyin", label: "抖音 / 抖店" },
  { id: "pdd", label: "拼多多" },
  { id: "xhs", label: "小红书" },
  { id: "amazon", label: "亚马逊(跨境)" },
  { id: "global", label: "跨境独立站" },
] as const;
export type SuitePlatform = (typeof SUITE_PLATFORMS)[number]["id"];

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
  { id: "2:3", label: "详情 2:3", w: 2, h: 3 },
  { id: "3:2", label: "横幅 3:2", w: 3, h: 2 },
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

// ⚠️ 2026-08-15 重定价:gpt-image-2 **原生直出**任意尺寸(宽高被 16 整除即可),
// 2K/4K 不再是 sharp 插值放大,而是真的烧 token。旧价(2K=8、4K=12)是"放大不要钱"
// 时代定的,直出后会亏,故按**实测 token** 重定:
//   1024x1024 medium = 1756 tokens(基准 1.00x,77 秒)
//   2048x2048 medium = 3568 tokens(2.03x,157 秒)
//   3840 长边  medium ≈ 6690 tokens(3.81x,外推)
// 注意 token **近似随长边线性增长,不是随面积**(2K 是 4 倍像素却只 2 倍 token),
// 所以别按面积定价,会贵得离谱。
// longSide 现在同时是 **v2 的实际请求尺寸**(见 route.ts 的 nativeSize)。
export const GENERATION_RESOLUTIONS: ResolutionTier[] = [
  // 1K 保持 longSide=0 → 走模型默认(auto / 1024x1536 三档)。**别改成 1024**:
  // 那样 3:4 会被算成 768x1024,比现在的 1024x1536 还小,等于降级。
  { id: "1K", label: "1K 标准", cost: POINTS_PER_IMAGE, longSide: 0 },
  { id: "2K", label: "2K 高清", cost: 12, longSide: 2048 },
  // ⚠️ **最长边上限 3840**(实测 4096 直接 400:"The longest edge must be less
  // than or equal to 3840")。所以"4K"= 3840 长边(4K UHD),别写 4096。
  { id: "4K", label: "4K 超清", cost: 23, longSide: 3840 },
];

// ── 可选生图模型(前台下拉,用户自选)────────────────────────────────────────
// 不同模型调性差别很大,专业客户要按项目挑(客户原话:「不同风格调性 用不同平台的优势去做」)。
// provider 决定走哪套 SDK:openai=方舟/OpenAI 兼容接口,gemini=Google(Nano Banana)。
// maxLongSide=该模型原生能出的最大长边,前台据此过滤分辨率档,避免选了出不来。
export const IMAGE_MODELS = [
  {
    id: "gpt-image-2",
    label: "GPT生图",
    hint: "综合最强，人像/质感稳",
    provider: "openai" as const,
    res: ["1K", "2K", "4K"],
    quality: true, // 支持 low/medium/high 三档
  },
  // ⚠️ **顺序即前台按钮顺序**(生图页从左到右)。香蕉2 排在香蕉PRO 前面是**有意的**:
  // 它三档全支持、更快、更便宜,是香蕉系里该被优先选的那个;PRO 只剩 1K 可用。
  // 别为了"PRO 听起来更高级"把它调回前面。IMAGE_MODELS[0] 同时是默认模型,别动第一位。
  {
    id: "gemini-3.1-flash-image",
    label: "香蕉2",
    hint: "快，三档都能出，4K 只要 26 秒",
    provider: "gemini" as const,
    // 三档实测全通(1K 10s / 2K 60s / 4K 26s)。曾有一次 4K 拿到 503
    // 「high demand」,复测正常 —— 那是 Google 侧偶发容量,**不是能力缺失,别据此砍档**。
    res: ["1K", "2K", "4K"],
    quality: false,
  },
  // FLUX.2 [pro] —— 客户点名要的模型。走 Replicate(比 BFL 官方便宜,详见 flux-image.ts)。
  // 成本 1K ¥0.218 / 2K ¥0.553 / 4K ¥0.989 —— **1K 与 2K 是三个模型里最便宜的**,
  // 4K 让给 GPT(¥0.726)。官方支持最多 8 张参考图,多件服装场景不用自己拼画布。
  {
    id: "black-forest-labs/flux-2-pro",
    label: "F2PRO",
    hint: "1K/2K 最省，参考图最多 8 张",
    provider: "replicate" as const,
    // ⚠️ **没有 4K**:官方 resolution 枚举只有 0.5/1/2/4 MP,且最大边长 2048
    // (schema 原文 "The maximum image size is 2048x2048")。列出 4K 只会让用户
    // 花 23 积分拿到一张 2048 的图 —— 那不是 4K。真要 4K 用 GPT生图(它才是原生直出)。
    res: ["1K", "2K"],
    quality: false, // FLUX 没有 low/medium/high 参数
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "香蕉Lite",
    hint: "12 秒出图，试稿用",
    provider: "gemini" as const,
    res: ["1K"], // 实测 2K/4K 直接报 "not supported for this model"
    quality: false,
  },
] as const;
export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

// ⚠️ **初代香蕉 gemini-2.5-flash-image 已排除,别加回来**:它不报错但**无视
// imageSize 参数** —— 请求 4K 照样只出 1024x1024(实测 7 秒 1.11MB)。
// 用户以为拿到 4K 实际是 1K,比直接报错更糟。

/** 某模型支持的分辨率档(前端据此灰掉不可选项)。 */
export function modelResolutions(id: string): readonly string[] {
  return IMAGE_MODELS.find((m) => m.id === id)?.res ?? ["1K", "2K", "4K"];
}

/** 该模型是否有质量档。**只有 OpenAI 有** —— Gemini 没这个参数,
 *  传了也不生效,所以计价时必须按标准档算,否则用户白付 4 倍钱。 */
export function modelHasQuality(id: string): boolean {
  return IMAGE_MODELS.find((m) => m.id === id)?.quality ?? false;
}

export function modelProvider(id: string): "openai" | "gemini" | "replicate" {
  return IMAGE_MODELS.find((m) => m.id === id)?.provider ?? "openai";
}

// ── 出图质量档 ──────────────────────────────────────────────────────────────
// gpt-image 的 quality 参数(low/medium/high)。**高阶档贵得多但质感差距明显**,
// 专业客户(视觉/设计公司)会一眼看出来 —— 别再像以前那样锁死 medium 省成本。
// 倍率是相对标准档的**价格倍数**,乘在分辨率单价上。
export const GENERATION_QUALITIES = [
  { id: "low", label: "基础", hint: "快、省,试稿用", mult: 0.4 },
  { id: "medium", label: "标准", hint: "日常电商出图", mult: 1 },
  // 实测 1024 高阶 = 7024 tokens vs 标准 1756 = **正好 4 倍**(耗时也翻倍:161s vs 77s)
  { id: "high", label: "高阶", hint: "质感最好,交付用", mult: 4 },
] as const;
export type QualityTier = (typeof GENERATION_QUALITIES)[number]["id"];

export function qualityMult(id: string): number {
  return GENERATION_QUALITIES.find((q) => q.id === id)?.mult ?? 1;
}

/**
 * 预计出图耗时(秒)。**给用户一个明确预期** —— 4K/高阶是分钟级操作,
 * 不告诉用户的话他会以为卡死(客户实测时就问过"是不是卡了")。
 *
 * ⚠️ **基准必须用"美国机直测"的数字**,别用国内机测的 —— 后者含跨境开销会虚高一倍。
 * 2026-08-15 实测(美国机直连 / 国内站经境外代跑,两者接近):
 *   1024² medium ≈ 46s · 2480×3296(4K竖版) medium ≈ 45~50s · 1024² high ≈ 90s
 * 出人意料的是**尺寸对耗时影响很小**(4K 和 1K 差不多),质量档才是主因。
 * 所以模型改成:基准 45s + 尺寸轻微加成 + 质量档倍率。
 */
const QUALITY_TIME_MULT: Record<string, number> = {
  low: 0.6,
  medium: 1,
  high: 2,
};

export function estimateGenSeconds(
  resolution: string,
  quality: string,
  count = 1
): number {
  const long = resolutionLongSide(resolution) || 1024;
  // 尺寸影响很小:长边翻倍只多约 15%(实测 4K≈1K)。别再按长边线性放大。
  const base = 45 * (1 + 0.15 * Math.log2(Math.max(1, long / 1024)));
  const qm = QUALITY_TIME_MULT[quality] ?? 1;
  return Math.round(base * qm * Math.max(1, count)); // 多张串行,乘张数
}

/** 把秒数说成人话:"约 1 分 20 秒"。 */
export function humanSeconds(s: number): string {
  if (s < 60) return `预计约 ${s} 秒`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `预计约 ${m} 分 ${r} 秒` : `预计约 ${m} 分钟`;
}

// ── 分模型计价 ──────────────────────────────────────────────────────────────
// **各模型成本差好几倍,不能共用一张表**(2026-08-17 用真实账单 + 实测 token 核出来的)。
// 此前全站按 1K=6/2K=12/4K=23 一口价,结果:香蕉PRO 每张成本 ¥1.04 却只收 6 分(¥0.33),
// 亏 68%;GPT 标准档在最大充值档也亏 14%。
//
// 成本来源(¥,汇率 7.1):
//   · GPT gpt-image-2  —— OpenAI 真实账单反推 ¥217.6/百万 token × 实测 token:
//       1K 1,756tok=¥0.382 · 2K 3,568tok=¥0.777 · 4K 6,690tok=¥1.456
//   · 香蕉2  gemini-3.1-flash-image  —— 官方 $0.067/1K,$59.82/百万 token × 实测:
//       1K 1,500tok=¥0.637 · 2K 2,069tok=¥0.879 · 4K 2,654tok=¥1.127
//   · (香蕉PRO gemini-3-pro-image 已于 2026-08-17 下架:只能出 1K、成本 ¥1.035 比香蕉2
//      贵 62%、出图慢一倍,2K/4K 一律 300 秒超时。质感确有优势但客户要的是 4K 交付,
//      而它给不了。**别加回来**——当初是我们自己多加的,客户只要 GPT + 香蕉2。)
//   · 香蕉Lite gemini-3.1-flash-lite-image —— 官方 $0.034/1K,$30.36/百万 × 实测 1,481tok=¥0.319
//
// 下表 = 上述成本 × 1.2 ÷ ¥0.055(**最大充值档单价**,即最坏情况仍保 ~20% 毛利)。
// ⚠️ 改价请连同上面的成本一起更新,别只动数字 —— 否则下次没人知道这些数是怎么来的。
// 注意一个反直觉的结论:**香蕉2 出 4K 比 GPT 出 4K 还便宜**(¥1.127 vs ¥1.456)且快得多。
const MODEL_CREDITS: Record<string, Record<string, number>> = {
  // **三个模型统一 6/12/23**(用户 2026-08-18 决定)。理由:
  //   ① 香蕉的成本我只能用"官方价目 × 实测 token"推算,**没有 Google 账单验证**,
  //      两种计费口径差 34%(¥0.476 vs ¥0.637/张),不足以支撑差异化定价;
  //   ② 产品逻辑上,**能力更弱的模型却更贵不合常理**,客户第一眼就会质疑;
  //   ③ 定价当天已反复改错数次,在有长期成本核算之前不应再凭估算调价。
  // 已知代价:香蕉2 出 1K 在这个价位大概率是亏的(成本 ¥0.476~0.637 > 站长最高付 ¥0.384),
  // 这是**知情后接受的**,不是疏漏。等积累到真实账单再回来校准。
  "gpt-image-2": { "1K": 6, "2K": 12, "4K": 23 },
  "gemini-3.1-flash-image": { "1K": 6, "2K": 12, "4K": 23 },
  "gemini-3.1-flash-lite-image": { "1K": 6 },
  // FLUX 走 Replicate 的成本比 GPT 还低(1K ¥0.218 / 2K ¥0.553 / 4K ¥0.989),
  // 沿用统一档位三档毛利分别 +51% / +19% / +28%,无需单独定价。
  "black-forest-labs/flux-2-pro": { "1K": 6, "2K": 12 },
};/** 没登记的模型(老数据/自托管改过配置)回落到 GPT 那档,不至于免费出图。 */
const FALLBACK_MODEL = "gpt-image-2";

/**
 * 一张图的积分单价 = 该模型该分辨率的基准 × 质量档倍率。
 * quality 只对 OpenAI 系生效(香蕉没有质量参数,传了也不计价,见 modelHasQuality)。
 * ⚠️ 用 round 不用 ceil:ceil 会把「基础档」从 3 顶到 4(+33%),把最便宜的试稿档做贵,
 * 而它恰恰是客户改稿时用得最多的一档。
 */
export function resolutionCost(
  id: string,
  quality = "medium",
  model = FALLBACK_MODEL
): number {
  const table = MODEL_CREDITS[model] ?? MODEL_CREDITS[FALLBACK_MODEL];
  // 该模型不支持这一档(如香蕉PRO 只有 1K)→ 按它支持的最高档计,不会算出 0。
  const base =
    table[id] ??
    table[Object.keys(table)[Object.keys(table).length - 1]] ??
    POINTS_PER_IMAGE;
  const mult = modelHasQuality(model) ? qualityMult(quality) : 1;
  return Math.max(1, Math.round(base * mult));
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
