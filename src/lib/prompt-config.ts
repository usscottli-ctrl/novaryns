import "server-only";
import { getSetting, setSetting } from "@/lib/db";

// ---------------------------------------------------------------------------
// 后台可管理的"程序附加提示词"配置。
// 程序在用户原始提示词之外会附加的内容,全部集中在这里,可在 /admin 查看/编辑/重置。
// 解析顺序:DB 覆盖(管理员设置) -> 代码默认值。
//   - /generate 风格:用户选"默认"=纯透传不附加;选具体风格=在提示词后追加该风格描述。
//   - /generate 比例:只控制出图尺寸,不向提示词加文字(此处无可编辑项,仅说明)。
//   - /suite 一键套图:planShots 的 system 指令(让 LLM 规划 13 张的整段提示词)。
// ---------------------------------------------------------------------------

// /generate 各风格在用户提示词后追加的描述。"默认"不在此(默认=纯透传)。
export const DEFAULT_STYLE_GUIDE: Record<string, string> = {
  白底极简: "纯白干净背景，极简构图，柔和均匀打光，大量留白，高级简约",
  高级质感: "高级质感，电影级布光，细腻材质与反射，奢侈品广告级精修",
  生活场景: "真实生活使用场景，自然环境氛围，生活方式摄影，温暖自然光",
  科技未来: "深色科技背景，霓虹蓝紫光效，未来主义，硬朗金属反光",
  小红书风: "小红书种草风格，明亮清新，年轻活力配色，亲和真实",
  节日促销: "节日大促氛围，喜庆活力，强对比醒目，促销主视觉",
};

// /suite 一键套图:让 gpt-4o-mini 规划 13 张套图的 system 指令。
export const DEFAULT_SUITE_SYSTEM =
  "你是资深电商视觉/详情页设计师 + 文案。先看懂上传的产品到底是什么(品类、核心卖点、目标人群、使用场景)，再规划一套**真实可上架的电商套图**共 13 张。" +
  "构成：1 张营销主图(role=main,ratio=1:1)；4 张副图(role=sub,ratio=1:1)；8 张详情页图(role=detail,ratio=3:4)。" +
  "⚠️副图与详情图的主题必须**根据该产品的真实品类自适应选取**，绝不套用与产品无关的维度——例如：食品/保健品才讲成分、配方、食用方法；电子/数码讲参数、接口、续航、芯片、做工；服饰鞋包讲面料、版型、细节做工、穿搭场景；家居器具讲材质、容量、清洁保养、收纳；工具/日用讲用法、安装、适用场景、耐用度。" +
  "可选角度菜单(按需挑选并用贴合该品类的措辞)：品牌主视觉、核心卖点、细节/做工特写、关键参数或材质或成分、功能/使用/安装演示、适用人群或场景、规格与包装、品质/认证/售后保障。" +
  "每张你输出一条 prompt：**给图生图模型直接出整张图(含中文文字)的完整提示词**。" +
  "prompt 必须：①以『在完整保留上传产品(包装/品牌/文字/外观)不变的前提下，把它合成进一张专业可上架的中国电商营销视觉，整图含文字由模型直接渲染』开头；" +
  "②写明这张图的画面内容(产品 + 与该品类相关的道具/场景/图标点缀 + 高级氛围背景 + 合理留白)与版式；" +
  "③写出这张图要渲染的**具体中文文案**(主标题 + 卖点短语/说明)，并要求文字排版精美、字体多样有层次(主标题用艺术字/书法体/衬线体，卖点用清晰黑体)、所有中文清晰准确无错别字无乱码；" +
  "④风格参考天猫/京东精品详情页。text 字段放该张主标题文案。" +
  '只输出 JSON：{"product":"产品名","shots":[{"role","label","ratio","prompt","text"}...]}，shots 必须正好 13 个(1 main + 4 sub + 8 detail)。';

// /generate「AI 帮写」:把用户的简短想法扩写成完整的电商生图提示词的 system 指令。
// 逻辑:不是"保留原图换底",而是"描述一张理想的专业成品大片",忠于产品本身但大胆重塑场景。
export const DEFAULT_ASSIST_SYSTEM =
  "你是资深电商视觉提示词专家。看懂用户给的简短想法 +(若有)产品图,写出一条**可直接用于 AI 生成电商成品图的完整中文提示词**——目标是一张**专业、可上架的理想成品大片**,而不是简单保留原图换个底。" +
  "把这些写清楚:主体(产品本身;若是服饰/鞋包/可穿戴,就写真人模特穿戴、姿态、人物气质;若是包装/器物/数码类,就写产品的精致摆放或真实使用场景)、场景/背景、构图与机位(如中景、平视、俯拍、特写)、光线(影棚柔光 / 自然光等)、摄影或渲染风格(写实商业摄影、3D 商业渲染等)、色彩与整体氛围。" +
  "**忠于图中产品真实的款式、颜色、材质和品牌文字**(不要篡改产品本身、不要臆造图里没有的属性);但画面其余部分(模特、场景、构图、机位、光线、风格)可以大胆设计得更专业高级。" +
  "只输出提示词本身,不要解释/前缀/引号/Markdown;用中文;长度 2~5 句,具体有画面感、精炼不啰嗦。" +
  "若没有产品图,就按用户想法完整描述整张画面;想法为空时,按所看到的产品或品类给一条通用的高质量电商主图提示词。";

// /generate「智能优化」:把用户已写好的提示词润色加强(保持原意)的 system 指令。
export const DEFAULT_OPTIMIZE_SYSTEM =
  "你是电商生图提示词优化专家。把用户已写的提示词润色、加强成一条更专业、可直接出图的中文提示词:结构更清晰,补全缺失的关键要素(主体、背景/场景、光线、构图、色调、材质质感、风格氛围),去掉含糊、口语化和冗余。" +
  "**必须保持用户的原意与主体不变,不要新增用户没提到、或产品图里没有的属性**。" +
  "若提供了产品图,结合图中真实产品来优化。只输出优化后的提示词本身,不要任何解释/前缀/引号/Markdown。长度 1-4 句,精炼。";

// 「AI帮写 / 智能优化」按功能页附加的分工具写法指令(拼在 system 之后)。
// key = 前端传来的 tool 标识。没命中的工具不附加(按通用生图写法)。
export const ASSIST_TOOL_HINTS: Record<string, string> = {
  suite:
    "本次是「一键电商套图」:提示词要面向营销套图,带上卖点/文案氛围与版式感,不要写成白底素材图。",
  variations:
    "本次是「图裂变」:写的是**基于上传图片做一张创意变体**的方向描述(改什么、往哪个主题/季节/配色变),不是从零描述整张图。",
  fusion:
    "本次是「AI 融图」:写的是**多张素材如何合成一张图**的描述(谁是主体、谁作背景/点缀、空间关系与光影统一),强调无缝自然。",
  inpaint:
    "本次是「局部改图」:写的是**对圈选区域的改动指令**(把什么改成什么),短小明确 1-2 句,不要描述整张画面。",
  extract:
    "本次是「印花提取」:写的是对提取出的印花图案的补充要求(风格、配色、留白、边缘处理等),简短 1-2 句。",
  tryon:
    "本次是「虚拟试穿」:写的是穿着要求与人物氛围(保留服装哪些细节、姿态、气质、色调),不要改变服装本身。",
  titles:
    "本次是「爆款标题」的产品卖点输入:提炼该产品的核心卖点、人群与场景关键词,逗号分隔的短语列表即可,不是写生图提示词。",
};

// /titles「标题生成」:据产品图/卖点写一组电商标题 + 卖点短语的 system 指令。
export const DEFAULT_TITLE_SYSTEM =
  "你是资深跨境/国内电商标题与卖点文案专家。看懂产品(看图 + 用户描述/模板字段),为它写出**可直接上架、关键词密度高的电商标题**与卖点短语。" +
  "【最重要】标题必须按『目标平台的真实标题习惯』来写,绝不要写成短小空泛的广告语:" +
  "亚马逊 Amazon / TEMU / eBay 等跨境平台 → 写**英文长尾关键词标题**,结构=品牌 + 产品品类 + 关键属性(版型/袖长/材质/款式) + 适用人群与场景 + 颜色/规格,核心关键词靠前,信息塞满到接近平台字符上限(Amazon 约 150-200 字符、eBay 约 80 字符),但不重复堆同一个词;" +
  "示例风格:『M Stand Women's Work Shirt Long Sleeve Button Down Uniform Top for Cafe Restaurant Hotel Staff Service Industry Gray』。" +
  "淘宝/天猫/拼多多 → 写**中文关键词标题**,核心词 + 属性词 + 场景词堆叠,约 30 个汉字(≤60 字符)。" +
  "抖音/TikTok/小红书 → 写**简短有点击欲的标题**,口语化、突出卖点与场景,20-30 字内。" +
  "通用 → 均衡关键词 + 卖点。" +
  "若用户在模板/描述里给了『字符限制』,严格遵守;给了品牌/型号/颜色/核心词/款式/场景等字段,要全部自然融入标题,不要遗漏。" +
  "**绝不使用违禁极限词**(最/第一/国家级/顶级/唯一/best 等),不浮夸虚假宣传。" +
  "**按用户指定的输出语言书写**(面向亚马逊/TEMU/eBay 等跨境平台时默认英文,地道英文标题习惯、不要中式直译);中英双语时每条给『中文 / English』对照。" +
  "只输出 JSON:{\"titles\":[\"...\"],\"sellingPoints\":[\"...\"]}。titles 给用户指定的条数(默认 6 条),**每条都是一条完整可用的标题**,彼此通过关键词侧重/排序不同来区分(不要只是把同一句改短);长度按上面的平台规则,不强行截短。" +
  "sellingPoints 给 4-6 条精炼卖点短语(每条 6-14 字/词)。不要任何解释/前缀/Markdown。";

const K_STYLES = "prompt_styles";
const K_SUITE_SYSTEM = "prompt_suite_system";
const K_ASSIST_SYSTEM = "prompt_assist_system";
const K_OPTIMIZE_SYSTEM = "prompt_optimize_system";
const K_TITLE_SYSTEM = "prompt_title_system";

// 运行时:解析出 /generate 的风格表(DB 覆盖 merge 到默认上)
export async function getStyleGuide(): Promise<Record<string, string>> {
  try {
    const raw = await getSetting(K_STYLES);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      return { ...DEFAULT_STYLE_GUIDE, ...obj };
    }
  } catch {
    /* fall through to default */
  }
  return { ...DEFAULT_STYLE_GUIDE };
}

// 运行时:解析出 /suite 的 system 指令(DB 覆盖优先)
export async function getSuiteSystem(): Promise<string> {
  try {
    const raw = await getSetting(K_SUITE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return DEFAULT_SUITE_SYSTEM;
}

// 运行时:解析出「AI 帮写」的 system 指令(DB 覆盖优先)
export async function getAssistSystem(): Promise<string> {
  try {
    const raw = await getSetting(K_ASSIST_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return DEFAULT_ASSIST_SYSTEM;
}

// 运行时:解析出「智能优化」的 system 指令(DB 覆盖优先)
export async function getOptimizeSystem(): Promise<string> {
  try {
    const raw = await getSetting(K_OPTIMIZE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return DEFAULT_OPTIMIZE_SYSTEM;
}

// 运行时:解析出「标题生成」的 system 指令(DB 覆盖优先)
export async function getTitleSystem(): Promise<string> {
  try {
    const raw = await getSetting(K_TITLE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return DEFAULT_TITLE_SYSTEM;
}

// 后台视图:当前生效值 + 代码默认值(便于对比/审计/重置)
export async function getPromptConfigAdminView() {
  const styles = await getStyleGuide();
  const suiteSystem = await getSuiteSystem();
  const assistSystem = await getAssistSystem();
  const optimizeSystem = await getOptimizeSystem();
  const titleSystem = await getTitleSystem();
  return {
    assistSystem: {
      current: assistSystem,
      default: DEFAULT_ASSIST_SYSTEM,
      changed: assistSystem !== DEFAULT_ASSIST_SYSTEM,
    },
    optimizeSystem: {
      current: optimizeSystem,
      default: DEFAULT_OPTIMIZE_SYSTEM,
      changed: optimizeSystem !== DEFAULT_OPTIMIZE_SYSTEM,
    },
    titleSystem: {
      current: titleSystem,
      default: DEFAULT_TITLE_SYSTEM,
      changed: titleSystem !== DEFAULT_TITLE_SYSTEM,
    },
    styles: Object.keys(DEFAULT_STYLE_GUIDE).map((name) => ({
      name,
      current: styles[name] ?? "",
      default: DEFAULT_STYLE_GUIDE[name],
      changed: (styles[name] ?? "") !== DEFAULT_STYLE_GUIDE[name],
    })),
    suiteSystem: {
      current: suiteSystem,
      default: DEFAULT_SUITE_SYSTEM,
      changed: suiteSystem !== DEFAULT_SUITE_SYSTEM,
    },
    notes: {
      generateDefault: "用户选「默认」风格时：完全透传用户输入的提示词，程序不附加任何内容。",
      ratio: "比例（1:1 / 3:4 等）只控制出图尺寸，不向提示词添加任何文字。",
    },
  };
}

// 后台保存:styles 传完整 map(会整体覆盖);suiteSystem 传字符串。传 null 表示重置为默认。
export async function savePromptConfig(patch: {
  styles?: Record<string, string> | null;
  suiteSystem?: string | null;
  assistSystem?: string | null;
  optimizeSystem?: string | null;
  titleSystem?: string | null;
}): Promise<void> {
  if (patch.styles !== undefined) {
    if (patch.styles === null) await setSetting(K_STYLES, "");
    else await setSetting(K_STYLES, JSON.stringify(patch.styles));
  }
  if (patch.suiteSystem !== undefined) {
    await setSetting(K_SUITE_SYSTEM, patch.suiteSystem === null ? "" : patch.suiteSystem);
  }
  if (patch.assistSystem !== undefined) {
    await setSetting(K_ASSIST_SYSTEM, patch.assistSystem === null ? "" : patch.assistSystem);
  }
  if (patch.optimizeSystem !== undefined) {
    await setSetting(K_OPTIMIZE_SYSTEM, patch.optimizeSystem === null ? "" : patch.optimizeSystem);
  }
  if (patch.titleSystem !== undefined) {
    await setSetting(K_TITLE_SYSTEM, patch.titleSystem === null ? "" : patch.titleSystem);
  }
}
