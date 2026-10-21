import "server-only";
import { getSetting, setSetting } from "@/lib/db";
import { getCorePrompts } from "@/lib/core-prompts";

// ---------------------------------------------------------------------------
// 后台可管理的"程序附加提示词"配置。
// 程序在用户原始提示词之外会附加的内容,全部集中在这里,可在 /admin 查看/编辑/重置。
// 解析顺序:DB 覆盖(管理员设置) -> 代码默认值。
// ⚠️ 2026-10-20 起核心提示词(套图规划/设计方向/平台风格/AI帮写/智能优化/标题)**不在源码里**,
//    由授权服务器下发(见 lib/core-prompts.ts),后台也不显示官方原文。站长仍可写覆盖,
//    但**必须先有授权**(没授权时下面的 getter 直接抛 CorePromptsUnavailable,防止自写提示词绕过授权)。
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

// 识图模型不可用时的兜底方向池(按平台挑),保证"不看图"也能每次换个方向出图。
export const FALLBACK_SUITE_DIRECTIONS: { name: string; desc: string }[] = [
  { name: "温暖生活风", desc: "原木与暖阳的居家场景，柔光暖调，突出日常使用的惬意感" },
  { name: "极简棚拍风", desc: "纯色背景与柔和棚灯，干净留白，突出产品造型与质感" },
  { name: "科技质感风", desc: "深色冷调与金属光泽，强对比光影，突出性能与做工" },
  { name: "自然清新风", desc: "绿植与自然光，清新浅色调，突出健康安心与轻松感" },
  { name: "高级奢感风", desc: "大理石与金属点缀，低饱和高级灰，突出品质与格调" },
  { name: "活力撞色风", desc: "明快撞色与几何色块，饱和度高，突出年轻潮流与卖点冲击" },
  { name: "复古怀旧风", desc: "胶片色调与复古道具，暖黄光线，突出经典与情怀" },
  { name: "国潮雅致风", desc: "东方纹样与朱红墨色，雅致留白，突出国风调性" },
];

// 有平台风格覆盖段的平台(淘宝/天猫=默认,无覆盖)
export const SUITE_PLATFORM_HINT_IDS = ["douyin", "pdd", "xhs", "amazon", "global"] as const;

const K_STYLES = "prompt_styles";
const K_SUITE_SYSTEM = "prompt_suite_system";
const K_ASSIST_SYSTEM = "prompt_assist_system";
const K_OPTIMIZE_SYSTEM = "prompt_optimize_system";
const K_TITLE_SYSTEM = "prompt_title_system";
const K_SUITE_PLATFORM_PREFIX = "prompt_suite_platform_";

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
  const core = await getCorePrompts(); // 没授权直接抛错,覆盖也不生效
  try {
    const raw = await getSetting(K_SUITE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return core.suiteSystem;
}

// 运行时:套图平台风格覆盖段(DB 覆盖优先)。taobao/空/未知 = 无覆盖(走默认)。
export async function getSuitePlatformHint(platform: string): Promise<string> {
  const core = await getCorePrompts();
  const key = (platform || "").trim();
  if (!key || key === "taobao" || !(SUITE_PLATFORM_HINT_IDS as readonly string[]).includes(key)) return "";
  try {
    const raw = await getSetting(K_SUITE_PLATFORM_PREFIX + key);
    if (raw && raw.trim()) return raw.trim();
  } catch {
    /* default */
  }
  return core.suitePlatformHints[key] || "";
}

// 套图「设计方向」指令 / 风格灵感库 / 每张出图的固定开头与防编造约束 / 帮写分工具指令:
// 只来自授权服务器,后台不可改(改动要在授权服务器上改)。
export async function getSuiteDirectionsSystem(): Promise<string> {
  return (await getCorePrompts()).suiteDirectionsSystem;
}
export async function getStyleInspirations(): Promise<string[]> {
  return (await getCorePrompts()).styleInspirations;
}
export async function getSuiteShotTexts() {
  const c = await getCorePrompts();
  return {
    shotLead: c.shotLead,
    shotLeadStrict: c.shotLeadStrict,
    looseClaimsOverride: c.looseClaimsOverride,
    redLine: (extra: string) => c.redLine.split("{extra}").join(extra || "无"),
    productLock: (look: string) =>
      look && c.productLockTail ? c.productLockTail.split("{look}").join(look) : "",
  };
}
export async function getAssistToolHint(tool: string): Promise<string> {
  return (await getCorePrompts()).assistToolHints[tool] || "";
}

// 运行时:解析出「AI 帮写」的 system 指令(DB 覆盖优先)
export async function getAssistSystem(): Promise<string> {
  const core = await getCorePrompts(); // 没授权直接抛错,覆盖也不生效
  try {
    const raw = await getSetting(K_ASSIST_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return core.assistSystem;
}

// 运行时:解析出「智能优化」的 system 指令(DB 覆盖优先)
export async function getOptimizeSystem(): Promise<string> {
  const core = await getCorePrompts(); // 没授权直接抛错,覆盖也不生效
  try {
    const raw = await getSetting(K_OPTIMIZE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return core.optimizeSystem;
}

// 运行时:解析出「标题生成」的 system 指令(DB 覆盖优先)
export async function getTitleSystem(): Promise<string> {
  const core = await getCorePrompts(); // 没授权直接抛错,覆盖也不生效
  try {
    const raw = await getSetting(K_TITLE_SYSTEM);
    if (raw && raw.trim()) return raw;
  } catch {
    /* default */
  }
  return core.titleSystem;
}

// 后台视图:风格词表照旧显示默认值;核心提示词**不显示官方原文**,
// current = 站长自己的覆盖内容(空 = 使用授权服务器下发的官方版),default 恒为空串。
export async function getPromptConfigAdminView() {
  const styles = await getStyleGuide();
  const own = async (k: string) => {
    try {
      return ((await getSetting(k)) ?? "").trim();
    } catch {
      return "";
    }
  };
  const row = (cur: string) => ({ current: cur, default: "", changed: !!cur });
  return {
    assistSystem: row(await own(K_ASSIST_SYSTEM)),
    optimizeSystem: row(await own(K_OPTIMIZE_SYSTEM)),
    titleSystem: row(await own(K_TITLE_SYSTEM)),
    styles: Object.keys(DEFAULT_STYLE_GUIDE).map((name) => ({
      name,
      current: styles[name] ?? "",
      default: DEFAULT_STYLE_GUIDE[name],
      changed: (styles[name] ?? "") !== DEFAULT_STYLE_GUIDE[name],
    })),
    suiteSystem: row(await own(K_SUITE_SYSTEM)),
    suitePlatforms: await Promise.all(
      SUITE_PLATFORM_HINT_IDS.map(async (id) => ({ id, ...row(await own(K_SUITE_PLATFORM_PREFIX + id)) }))
    ),
    officialHidden: true,
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
  suitePlatforms?: Record<string, string> | null;
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
  if (patch.suitePlatforms) {
    for (const [id, val] of Object.entries(patch.suitePlatforms)) {
      if ((SUITE_PLATFORM_HINT_IDS as readonly string[]).includes(id))
        await setSetting(K_SUITE_PLATFORM_PREFIX + id, (val ?? "").trim());
    }
  }
}
