import {
  Sparkles,
  Layers,
  Copy,
  Scissors,
  Smile,
  Wand2,
  SquarePen,
  Palette,
  Blend,
  Shirt,
  Box,
  Wind,
  Type,
  Stamp,
  Printer,
  Eraser,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/* 工具数据单一事实源(对齐设计 toolMetaMap)。
   create-hub 抽屉 / 顶栏「创作」mega 下拉 / /tools 创作中心 / 通用 ToolWorkspace 全部读这里。
   新增工具只需往 TOOLS 加一项。 */

export type ToolCategory = "生成创作" | "图像处理" | "服装电商" | "营销工具";

export type ToolControl = { label: string; opts: string[] };

export type ToolMeta = {
  /** 中文数据键(与设计 toolMetaMap 对齐)。 */
  key: string;
  en: string;
  slug: string;
  href: string;
  category: ToolCategory;
  Icon: LucideIcon;
  desc: string;
  /** 主行动按钮文案。 */
  action: string;
  /** 单次消耗积分。 */
  cost: number;
  ctrls: ToolControl[];
  /** true = 独立全工作台(AI生图/套图/图裂变),不是通用 ToolWorkspace。 */
  workspace?: boolean;
  /** 已上线(有真实后端);false = 即将上线。 */
  live?: boolean;
  /** 是否进顶栏「创作」mega 下拉(设计 curated 子集:抠头像/风格转换不进)。 */
  inMenu?: boolean;
};

export const TOOL_CATEGORIES: {
  name: ToolCategory;
  en: string;
  dot: string;
  tintVar: string;
  accent: string;
}[] = [
  { name: "生成创作", en: "Generate", dot: "#4F46E5", tintVar: "var(--acc-tint)", accent: "var(--acc)" },
  { name: "图像处理", en: "Image tools", dot: "#2E7CF6", tintVar: "var(--c-tint-b)", accent: "#2E7CF6" },
  { name: "服装电商", en: "Apparel", dot: "#7C3AED", tintVar: "var(--c-tint-v)", accent: "#7C3AED" },
  { name: "营销工具", en: "Marketing", dot: "#C2882E", tintVar: "var(--c-tint-a)", accent: "#C2882E" },
];

export const TOOLS: ToolMeta[] = [
  // ── 生成创作(独立全工作台) ──
  {
    key: "AI 生图", en: "AI image", slug: "generate", href: "/generate", category: "生成创作",
    Icon: Sparkles, desc: "一句话直接出商品图,支持多比例多张并发",
    action: "立即生成", cost: 4, ctrls: [], workspace: true, live: true, inMenu: true,
  },
  {
    key: "一键套图", en: "Image suite", slug: "suite", href: "/suite", category: "生成创作",
    Icon: Layers, desc: "上传产品图,自动出主图+详情页全套电商图",
    action: "生成套图", cost: 20, ctrls: [], workspace: true, live: true, inMenu: true,
  },
  {
    key: "图裂变", en: "Variations", slug: "variations", href: "/variations", category: "生成创作",
    Icon: Copy, desc: "一张满意图批量裂变出多种风格/构图变体",
    action: "开始裂变", cost: 12, ctrls: [], workspace: true, live: true, inMenu: true,
  },

  // ── 图像处理(blue #2E7CF6) ──
  {
    key: "AI 抠图", en: "Cutout", slug: "cutout", href: "/cutout", category: "图像处理",
    Icon: Scissors, desc: "自动识别主体去背景,发丝级边缘精度",
    action: "开始抠图", cost: 4,
    ctrls: [{ label: "边缘羽化", opts: ["关", "弱", "强"] }, { label: "输出背景", opts: ["透明", "白底", "纯色"] }],
    live: true, inMenu: true,
  },
  {
    key: "抠头像", en: "Head cutout", slug: "avatar", href: "/avatar", category: "图像处理",
    Icon: Smile, desc: "人像、证件照精准抠取,自动补光",
    action: "开始抠图", cost: 4,
    ctrls: [{ label: "证件底色", opts: ["白", "蓝", "红"] }, { label: "尺寸规格", opts: ["一寸", "二寸", "自定义"] }],
    live: true, inMenu: false,
  },
  {
    key: "AI 变清晰", en: "Upscale", slug: "upscale", href: "/upscale", category: "图像处理",
    Icon: Wand2, desc: "模糊图、老照片一键高清修复放大",
    action: "高清修复", cost: 6,
    ctrls: [{ label: "放大倍数", opts: ["2x", "4x", "8x"] }, { label: "增强方向", opts: ["通用", "人像", "商品"] }],
    live: true, inMenu: true,
  },
  {
    key: "局部改图", en: "Inpaint", slug: "inpaint", href: "/inpaint", category: "图像处理",
    Icon: SquarePen, desc: "框选区域局部重绘,自然融合",
    action: "重绘选区", cost: 8,
    ctrls: [{ label: "模式", opts: ["涂抹重绘", "智能扩图"] }, { label: "重绘强度", opts: ["低", "中", "高"] }],
    live: true, inMenu: true,
  },
  {
    key: "风格转换", en: "Style transfer", slug: "style", href: "/style", category: "图像处理",
    Icon: Palette, desc: "一键切换画面整体风格",
    action: "转换风格", cost: 6,
    ctrls: [{ label: "目标风格", opts: ["写实", "插画", "3D", "赛博"] }, { label: "保留构图", opts: ["强", "中", "弱"] }],
    live: true, inMenu: false,
  },
  {
    key: "AI 融图", en: "Image fusion", slug: "fuse", href: "/fuse", category: "图像处理",
    Icon: Blend, desc: "多张图片自然融合拼接",
    action: "融合生成", cost: 8,
    ctrls: [{ label: "融合强度", opts: ["低", "中", "高"] }, { label: "图片数量", opts: ["2 图", "3 图", "4 图"] }],
    live: true, inMenu: true,
  },
  {
    key: "去水印", en: "Remove watermark", slug: "dewatermark", href: "/dewatermark", category: "图像处理",
    Icon: Eraser, desc: "智能擦除水印 / logo / 文字并补全底图",
    action: "一键去水印", cost: 6,
    ctrls: [{ label: "水印类型", opts: ["通用", "文字", "Logo"] }],
    live: true, inMenu: true,
  },

  // ── 服装电商(violet #7C3AED) ──
  {
    key: "服装上身", en: "Virtual try-on", slug: "tryon", href: "/tryon", category: "服装电商",
    Icon: Shirt, desc: "平铺服装图生成真人模特上身效果",
    action: "生成上身图", cost: 12,
    ctrls: [{ label: "模特", opts: ["女模", "男模", "童模"] }, { label: "场景", opts: ["棚拍", "街景", "室内"] }],
    live: true, inMenu: true,
  },
  {
    key: "服装提取", en: "Garment extract", slug: "garment", href: "/garment", category: "服装电商",
    Icon: Shirt, desc: "从模特图中提取平铺服装图",
    action: "提取平铺图", cost: 8,
    ctrls: [{ label: "保留细节", opts: ["标准", "精细"] }, { label: "输出形态", opts: ["平铺", "挂拍"] }],
    live: true, inMenu: true,
  },
  {
    key: "3D 服装图", en: "3D garment", slug: "garment3d", href: "/garment3d", category: "服装电商",
    Icon: Box, desc: "生成立体可旋转的服装展示图",
    action: "生成 3D 图", cost: 16,
    ctrls: [{ label: "视角", opts: ["正面", "45°", "360°"] }, { label: "材质", opts: ["真实", "光泽", "哑光"] }],
    live: true, inMenu: true,
  },
  {
    key: "服装去皱", en: "De-wrinkle", slug: "dewrinkle", href: "/dewrinkle", category: "服装电商",
    Icon: Wind, desc: "智能去除衣物褶皱与瑕疵",
    action: "一键去皱", cost: 6,
    ctrls: [{ label: "去皱强度", opts: ["轻", "中", "强"] }, { label: "保留纹理", opts: ["是", "否"] }],
    live: true, inMenu: true,
  },

  // ── 营销工具(amber #C2882E) ──
  {
    key: "标题生成", en: "Title gen", slug: "titles", href: "/titles", category: "营销工具",
    Icon: Type, desc: "AI 生成商品标题与卖点文案",
    action: "生成标题", cost: 2,
    ctrls: [{ label: "语气", opts: ["专业", "亲和", "促销"] }, { label: "平台", opts: ["通用", "淘宝", "抖音"] }],
    live: true, inMenu: true,
  },
  {
    key: "印花提取", en: "Print extract", slug: "printextract", href: "/extract", category: "营销工具",
    Icon: Stamp, desc: "从服装图中提取印花 / 图案为独立素材",
    action: "提取印花", cost: 6,
    ctrls: [{ label: "输出", opts: ["透明底", "白底"] }, { label: "精度", opts: ["标准", "高清"] }],
    live: true, inMenu: true,
  },
  {
    key: "侵权检测", en: "IP check", slug: "ipcheck", href: "/ipcheck", category: "营销工具",
    Icon: ShieldCheck, desc: "AI 筛查图片版权 / IP 侵权风险,规避商用纠纷",
    action: "开始检测", cost: 1,
    ctrls: [],
    live: true, inMenu: true,
  },
  {
    key: "印刷图", en: "Print file", slug: "printfile", href: "/printfile", category: "营销工具",
    Icon: Printer, desc: "按 DPI + 成品尺寸生成印刷级高清文件",
    action: "生成印刷图", cost: 0,
    ctrls: [{ label: "成品尺寸", opts: ["A4", "A3", "名片", "海报"] }, { label: "DPI", opts: ["150", "300", "600"] }],
    live: true, inMenu: true,
  },
];

/** 通用工具(非全工作台),供 /tools/[slug] 与 ToolWorkspace 用。 */
export const GENERIC_TOOLS = TOOLS.filter((t) => !t.workspace);

export function toolBySlug(slug: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

export function toolByKey(key: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.key === key);
}

export function toolsByCategory(cat: ToolCategory): ToolMeta[] {
  return TOOLS.filter((t) => t.category === cat);
}

/** 顶栏「创作」mega 下拉的 curated 分组(设计 _menuCats:3/4/4/5)。 */
export function menuCategories() {
  return TOOL_CATEGORIES.map((c) => ({
    ...c,
    tools: TOOLS.filter((t) => t.category === c.name && t.inMenu),
  }));
}

/** 工具总数文案(设计落地页/创作中心标「17 款工具」)。 */
export const TOOL_COUNT_LABEL = "18 款工具";
