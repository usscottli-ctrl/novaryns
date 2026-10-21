import { NextResponse } from "next/server";
import { toVisionDataUrl } from "@/lib/vision-image";
import OpenAI, { toFile } from "openai";
import { resolutionCost, resolutionLongSide } from "@/lib/mock-data";
import { sizeFor as nativeSizeFor } from "@/lib/image-size";
import { safeError } from "@/lib/api-error";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  addArtworks,
  getUser,
  isBanned,
  addLedgerEntry,
  addReservation,
  settleReservation,
  sweepStaleReservations,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { resolveUserEmail } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { generateBuffer, generateToR2 } from "@/lib/image-gen";
import { getOpenAISettings } from "@/lib/settings";
import { fetchRemoteImage } from "@/lib/remote-image";
import {
  getSuiteSystem,
  getSuitePlatformHint,
  getAplusHint,
  getSuiteDirectionsSystem,
  getStyleInspirations,
  getSuiteShotTexts,
  FALLBACK_SUITE_DIRECTIONS,
} from "@/lib/prompt-config";
import { getChatLLM, parseJsonLoose } from "@/lib/chat-llm";
import { corePromptsAvailable } from "@/lib/core-prompts";
import { loadPriceOverrides } from "@/lib/price-overrides";

// ---------------------------------------------------------------------------
// 一键电商套图：上传产品图(+可选文字) → 自动出 1 主图 + 4 副图 + 8 详情页图。
//
// 两层 pipeline：
//   前置(action=directions,免费)：识图模型看产品图给 4 个设计方向,用户选一个
//          —— 同一产品每次方向都不同,是"换批次不重样"的主要来源(参考竞品的两步式)。
//   第0层：识图模型(后台「识图/文案模型」,没配用主 Key + gpt-4o-mini)读产品图+文字+所选方向
//          → 输出整套统一视觉基调 style + 13 张图的定制中文提示词 JSON。
//          失败时回退写死的蓝图模板(仍带上方向与平台),并在结果里标 planFallback 让前端明说。
//   第1-13层：gpt-image 图生图,每张 = 产品图(参考,保一致) + 该张的定制提示词。
//          并发限流逐张生成,完成一张即落 R2 并更新进度。
// 异步 job + 逐张进度,复用生图的 jobId+轮询模式(CF 免费版 ~100s 硬超时,套图更长)。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

type ShotRole = "main" | "sub" | "detail" | "aplus";
type ShotSpec = {
  role: ShotRole;
  label: string;
  ratio: string; // "1:1" | "3:4" | "97:60"(亚马逊 A+ 模块)
  prompt: string; // 含中文营销文案的完整出图提示词(模型直出整图)
  text?: string; // 该张主标题(展示/归档用)
};
type ShotResult = ShotSpec & {
  id: string;
  status: "pending" | "done" | "error";
  url?: string;
  gradient: string;
};

// 并发出图数 = 张数:13 张同时出(2026-10-20 客户要求并发不排队;原来 3 张一批)。
// 规划是流式的,各张本来就错开十几秒陆续开工;单张失败有指数退避重试兜底,限频时会自己熬过去。
const CONCURRENCY = 13;
// 套图可选清晰度(与生图页同一套档位与价格表;按 GPT生图 计价)
const SUITE_RESOLUTIONS = ["1K", "2K", "4K"];
const SHOT_RETRIES = 3; // 每张失败后最多再重试 3 次(指数退避,扛住尾部限频)

// 一次生成的图位布局(2026-10-21 客户反馈亚马逊尺寸不符后拆开):
//   · 套图(国内平台/独立站):1 主图 + 4 副图 + 8 竖版详情 = 13 张;
//   · 套图(亚马逊):亚马逊没有竖版详情页,listing 只放图片 → 1 主图 + 8 副图 = 9 张(listing 上限);
//   · A+详情(独立功能):只出亚马逊 A+ 页面横版模块,交付**精确尺寸**(A+ 后台对非标尺寸自动缩放,图里的字会糊):
//       标准 A+ 5 张 970×600(标准版每页最多 5 个模块)/ 高级 A+ 7 张 1464×600(需亚马逊开通资格)。
type Layout = {
  mode: "suite" | "aplus";
  platform: string;
  count: number;
  aplusW: number;
  aplusH: number;
  aplusRatio: string;
};
const APLUS_TIERS = {
  standard: { count: 5, w: 970, h: 600, ratio: "97:60" },
  premium: { count: 7, w: 1464, h: 600, ratio: "61:25" },
} as const;

function layoutFor(mode: string, platform: string, tier: string): Layout {
  const t = tier === "premium" ? APLUS_TIERS.premium : APLUS_TIERS.standard;
  const base = { aplusW: t.w, aplusH: t.h, aplusRatio: t.ratio };
  if (mode === "aplus") return { mode: "aplus", platform: "amazon", count: t.count, ...base };
  return { mode: "suite", platform, count: platform === "amazon" ? 9 : 13, ...base };
}

function ratioOf(role: ShotRole, lay: Layout): string {
  return role === "aplus" ? lay.aplusRatio : role === "detail" ? "3:4" : "1:1";
}

/** 把规划/兜底给的 role 落到这次布局实际有的图位上。 */
function layoutRole(role: string, lay: Layout): ShotRole {
  if (lay.mode === "aplus") return "aplus";
  if (role === "main" || role === "sub") return role;
  return lay.platform === "amazon" ? "sub" : "detail";
}

// 亚马逊主图硬规则,放在该张提示词**最末尾**并且不拼整套风格段:
// 实测(2026-10-21)规划写了纯白底,但程序给每张拼上的「大理石台面/厨房」统一风格
// 加上参考图自带的背景,把主图画成了厨房场景 —— 主图违规会被亚马逊下架。
const AMAZON_MAIN_TAIL =
  "【亚马逊主图硬性规则 · 最高优先级,覆盖上文一切场景与风格描述】背景必须是纯白(RGB 255,255,255)," +
  "不要任何桌面、墙面、厨房、窗户、植物、道具,也不要沿用参考图里的背景;画面中不得出现任何文字、logo、水印、边框、图标;" +
  "只有产品本身,居中,约占画面 85%,可有极轻的自然落地阴影。";

/** 规划失败时的兜底模板,按布局改图位(调用方再按张数截断)。 */
function fallbackFor(lay: Layout, extra: string, direction: string): ShotSpec[] {
  if (lay.mode === "aplus") return fallbackAplus(lay, extra, direction);
  const list = fallbackBlueprint(extra, direction, lay.platform);
  if (lay.platform !== "amazon") return list;
  // 亚马逊套图:主图换成纯白合规图,详情全部改成方形副图
  return list.map((sp) => {
    if (sp.role === "main") {
      return { ...sp, text: "", prompt: `Keep the uploaded product exactly as it is.\n${AMAZON_MAIN_TAIL}` };
    }
    if (sp.role !== "detail") return sp;
    return { ...sp, role: "sub", ratio: "1:1" };
  });
}

/** A+ 兜底模块(英文,横版)。 */
function fallbackAplus(lay: Layout, extra: string, direction: string): ShotSpec[] {
  const base =
    "Keep the uploaded product exactly unchanged (shape, colours, printed text, details). " +
    `Design a wide horizontal Amazon A+ content module banner (${lay.aplusW}x${lay.aplusH}), premium minimal brand look, ` +
    "product on one side and short crisp English copy in the open space on the other side, no Chinese text." +
    (direction ? ` Overall design direction: ${direction}.` : "") +
    (extra ? ` Product facts provided by the seller: ${extra}.` : "");
  const mods = [
    ["Brand banner", "hero brand banner, product large, an elegant English brand tagline"],
    ["Key benefits", "three icon + short phrase feature callouts next to the product"],
    ["Lifestyle", "the product in a real, aspirational use scene"],
    ["Details", "a close-up of the product's real details with short labels"],
    ["Use cases", "two or three small scenes showing where and how it is used"],
    ["Why choose us", "clean grid of quality / care / gifting reasons with icons"],
    ["Brand story", "warm closing banner with a short brand promise line"],
  ];
  return mods.map(([label, desc]) => ({
    role: "aplus" as const,
    label,
    ratio: lay.aplusRatio,
    text: "",
    prompt: `${base} This module: ${desc}.`,
  }));
}

const GRADIENTS = [
  "from-rose-100 to-slate-100",
  "from-lime-100 to-emerald-100",
  "from-amber-100 to-orange-100",
  "from-sky-100 to-teal-100",
  "from-emerald-100 to-teal-100",
  "from-stone-100 to-amber-100",
];

// 写死蓝图(LLM 失败时回退)。13 张:1 主图 + 4 副图 + 8 详情。
// 模型直出整图:每张 prompt 直接要求渲染中文营销文案(字体多样精美),不再做代码叠字。
// 兜底模板按平台补一句风格/语言(规划模型的平台覆盖段是写给 LLM 的,不适合直接拼进出图提示词)
const FALLBACK_PLATFORM_STYLE: Record<string, string> = {
  douyin: "整体走抖音种草风：视觉冲击强、色彩饱满、大字报式主标题。",
  pdd: "整体走实惠促销风：红黄促销色系、高对比、主标题突出性价比。",
  xhs: "整体走小红书清新种草风：柔和色调、大量留白、真实生活感，弱化促销感。",
  amazon: "所有画面文字一律改为简洁英文(不出现中文)，整体极简专业。",
  global: "所有画面文字一律改为简洁英文(不出现中文)，整体现代简约品牌风。",
};

function fallbackBlueprint(extra: string, direction: string, platform: string): ShotSpec[] {
  const base =
    (extra ? `产品/品牌补充信息：${extra}。` : "") +
    (direction ? `整套统一设计方向：${direction}。` : "") +
    (FALLBACK_PLATFORM_STYLE[platform] ?? "");
  const lead =
    "在完整保留上传产品(包装、品牌、文字、外观)不变的前提下，把它合成进一张专业、可直接上架的中国电商营销视觉，整图(含文字)由你直接渲染：";
  const tail =
    "硬性要求：①画面带中文营销大标题与卖点短语，文字排版精美、富有设计感，字体多样有层次——主标题用有质感的艺术字/书法体/衬线体，卖点/说明用清晰黑体；②搭配与该产品品类相关的道具/配件/场景元素与图标点缀，高级氛围背景，层次分明、留白得当，超清商业细节；③文案要贴合产品本身、不要套用与产品无关的维度；④所有中文必须清晰、准确、无错别字、无乱码。风格参考天猫/京东精品详情页。" +
    base;
  const mk = (
    role: ShotRole,
    label: string,
    ratio: string,
    desc: string,
    title: string,
    points: string
  ): ShotSpec => ({
    role,
    label,
    ratio,
    text: title,
    prompt: `${lead}${desc}。主标题文案『${title}』，配套卖点文案『${points}』。${tail}`,
  });
  // 通用兜底(品类无关)。仅在 AI 规划失败时启用;角度与文案保持中性,适配任意产品。
  return [
    mk("main", "营销主图", "1:1", "产品作为画面主体居中，四周搭配与该品类相关的道具/配件点缀，高级渐变氛围背景，顶部放主标题、四周放卖点", "匠心之选", "品质保障·值得信赖"),
    mk("sub", "核心卖点", "1:1", "产品居中，突出该产品最核心的卖点/功能优势，商业海报式背景，配卖点排版", "核心卖点", "实力优势·品质之选"),
    mk("sub", "细节做工", "1:1", "产品关键细节/做工/质感特写，干净高级背景，配细节标注", "细节品质", "做工精良·细节用心"),
    mk("sub", "场景使用", "1:1", "产品放进真实使用场景，自然生活氛围，体现使用方式", "真实场景", "贴合日常·好用"),
    mk("sub", "信任背书", "1:1", "产品 + 资质/规格/售后等信任元素的视觉表达，专业可信背景", "品质保障", "正品·安心"),
    mk("detail", "品牌主视觉", "3:4", "竖版详情首屏，产品大图 + 品牌氛围背景，顶部主标题大字", "品质之作", "用心之选·品质生活"),
    mk("detail", "核心卖点", "3:4", "竖版详情图，聚焦该产品最核心的卖点，大标题与说明排版", "核心优势", "实力·品质"),
    mk("detail", "细节特写", "3:4", "竖版详情图，关键细节/做工/质感的高清特写，配细节说明", "细节之处", "精工·讲究"),
    mk("detail", "材质工艺", "3:4", "竖版详情图，体现产品材质/工艺/品质把控的高级质感画面，配说明", "品质工艺", "用料·考究"),
    mk("detail", "功能演示", "3:4", "竖版详情图，展示该产品的功能/使用/安装方式的图示画面，配步骤文字", "使用方式", "简单·上手"),
    mk("detail", "适用人群", "3:4", "竖版详情图，适用人群/使用场景的生活化画面，配场景文案", "适用人群", "广泛·贴心"),
    mk("detail", "规格包装", "3:4", "竖版详情图，规格参数与包装的简洁展示画面，配参数标注", "规格参数", "标准·规范"),
    mk("detail", "信任售后", "3:4", "竖版详情图，品牌信任/资质/售后的视觉，配背书文案", "正品保障", "认证·售后"),
  ];
}

// 每张出图的固定开头、「严格不编造参数」约束、允许补参数的覆盖段、产品事实红线
// 都是核心提示词,由授权服务器下发(lib/prompt-config.ts getSuiteShotTexts),不在源码里。

// 第0层:识图模型读产品图 + 所选方向 → 流式输出统一视觉基调 + 13 张定制提示词。
// **边规划边出图**:每解析出一张就回调 onShot,调用方立刻开始出这张;
// 规划整段要 70~110 秒,流式后第一张 10~20 秒就能开始画(2026-10-20 客户嫌慢)。
// 返回模型实际规划出的张数(<13 说明中途失败/不合格,剩下的由调用方用兜底模板补齐)。
async function planShotsStream(
  images: { buf: Buffer; type: string }[],
  extra: string,
  lay: Layout,
  direction: string,
  strict: boolean,
  onShot: (spec: ShotSpec) => void
): Promise<number> {
  const platform = lay.platform;
  const llm = await getChatLLM({ timeout: 180_000 });
  if (!llm) return 0;
  let emitted = 0;
  try {
    // 全部产品图都给识图模型看(原来只看第 1 张:客户传了正面+内页+局部,
    // 模型只凭一个角度理解产品,写进提示词的外观描述就跑偏 —— 2026-10-21 客户反馈)
    const dataUrls = await Promise.all(images.slice(0, 4).map((im) => toVisionDataUrl(im.buf, im.type)));
    const texts = await getSuiteShotTexts(); // 核心提示词(授权服务器下发)
    const base = await getSuiteSystem(); // 后台可编辑的套图规划 system 指令
    // 平台风格覆盖段(后台可编辑);A+详情用授权服务器下发的 A+ 专用段
    const platHint =
      lay.mode === "aplus"
        ? await getAplusHint(lay.count, lay.aplusW, lay.aplusH)
        : await getSuitePlatformHint(platform);
    if (lay.mode === "aplus" && !platHint) return 0; // 授权服务器还没有 A+ 指令 → 走兜底模板
    const sys0 = platHint ? `${base}

${platHint}` : base;
    const sys = strict ? sys0 : `${sys0}\n\n${texts.looseClaimsOverride}`;
    const user =
      (extra ? `补充信息：${extra}\n` : "") +
      `本套设计方向：${direction}\n` +
      (dataUrls.length > 1 ? `下面 ${dataUrls.length} 张图是同一个产品的不同角度/局部。\n` : "") +
      (lay.mode === "aplus"
        ? `请按这个方向规划这个产品的亚马逊 A+ 页面模块,正好 ${lay.count} 张。`
        : `请按这个方向规划这套产品的电商套图,共 ${lay.count} 张。`) +
      // 产品事实红线(严格模式;放在最后,模型对最后看到的约束最重视)
      (strict ? `\n${texts.redLine(extra)}` : "");
    const scan = shotScanner((raw, style, look) => {
      if (emitted >= lay.count) return;
      const sp = raw as Partial<ShotSpec>;
      if (!sp || !sp.prompt || !sp.role) return;
      const role = layoutRole(String(sp.role), lay);
      const amazonMain = platform === "amazon" && role === "main";
      emitted++;
      // 严格模式下硬过滤用户没提供的参数;用户选择允许补充时原样保留
      const scrub = (t: string) => (strict ? scrubClaims(t, extra) : t);
      const prompt = scrub(String(sp.prompt));
      onShot({
        role,
        label: String(sp.label ?? "").slice(0, 40) || "套图",
        ratio: ratioOf(role, lay),
        text: sp.text ? scrub(String(sp.text)) : undefined,
        // 统一视觉基调拼进每张,保证整套像一个设计师做的;
        // 产品外观锁定放在**最末尾**(模型最看重最后的约束),防止场景描述把产品带跑
        prompt:
          `${texts.shotLead}${strict ? texts.shotLeadStrict : "："}${prompt}` +
          (style && !amazonMain ? `\n【整套统一视觉基调】${scrub(style)}` : "") +
          (look ? `\n${texts.productLock(look)}` : "") +
          // 亚马逊/A+ 允许换机位、被人手持(国内套图保持原规则,2026-10-21 用户定)
          (look && platform === "amazon" && texts.productAngleNote ? texts.productAngleNote : "") +
          (amazonMain ? `\n${AMAZON_MAIN_TAIL}` : ""),
      });
    });
    await streamChatJson(llm, sys, user, dataUrls, 0.9, 6000, scan);
    if (emitted < lay.count) console.warn("[suite] 规划只给出", emitted, "张,其余用模板补齐");
  } catch (e) {
    console.warn("[suite] 规划失败(已出", emitted, "张),其余用模板补齐:", e instanceof Error ? e.message : e);
  }
  return emitted;
}

// 规划结果的「编造参数」硬过滤(2026-10-20):提示词里已经三令五申不许编数字,
// 千问仍会写出「92%用户说」「3.2kg」「USB-C 供电」「通过电气安全测试」——出图模型照着画,
// 客户店铺就有虚假宣传风险。这里用规则把**用户卖点里没出现过**的数字参数/认证类说法直接删掉,
// 并给出图模型补一句不许画数字。用户自己填了的(如「20Bar」)原样保留。
const CLAIM_RE = new RegExp(
  [
    // 数字 + 单位(含 24×20×28cm 这类尺寸串)
    "(?:[<>≤≥≈~约仅只]\\s*)?\\d+(?:\\.\\d+)?\\s*(?:[×xX*]\\s*\\d+(?:\\.\\d+)?\\s*)*(?:%|％|kg|KG|公斤|千克|克|cm|CM|厘米|mm|毫米|W|瓦|[Bb]ar|BAR|ml|ML|毫升|升|L|℃|°C|分钟|秒钟?|小时|个月|年|万\\+?|人|倍|档|级)",
    "USB-?C|Type-?C",
    "(?:SUS\\s?)?\\d{3}\\s*(?=不锈钢)", // 304/316 不锈钢等材质牌号
    "通过[^，。,;；、]{0,8}(?:认证|测试|检测)",
    "[A-Z]{2,5}认证",
    "(?:CCC|CE|FDA|ISO\\s?\\d*)(?:认证|标志)?",
  ].join("|"),
  "g"
);

function scrubClaims(text: string, extra: string): string {
  let hit = false;
  const out = text.replace(CLAIM_RE, (m) => {
    if (extra && extra.includes(m.replace(/\s+/g, ""))) return m; // 用户自己给的事实保留
    hit = true;
    return "";
  });
  return hit ? `${out}（画面中不要出现任何具体数字参数、百分比或认证标志）` : out;
}

// 从流式到来的 JSON 文本里增量取出 style 和 shots 数组里每个完整的对象。
// 只认我们约定的结构 {"style":"…","shots":[{…},{…}]};字符串里的括号/转义会正确跳过。
function shotScanner(onObj: (obj: unknown, style: string, look: string) => void) {
  let buf = "";
  let style = "";
  let look = "";
  let pos = -1; // shots 数组里下一个待扫描的位置;-1 = 还没看到 "shots":[
  return (delta: string) => {
    buf += delta;
    if (!style) {
      const m = buf.match(/"style"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try {
          style = (JSON.parse(`"${m[1]}"`) as string).trim().slice(0, 300);
        } catch {
          /* 等更多文本 */
        }
      }
    }
    if (!look) {
      const m = buf.match(/"productLook"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try {
          look = (JSON.parse(`"${m[1]}"`) as string).trim().slice(0, 400);
        } catch {
          /* 等更多文本 */
        }
      }
    }
    if (pos < 0) {
      const m = /"shots"\s*:\s*\[/.exec(buf);
      if (!m) return;
      pos = m.index + m[0].length;
    }
    for (;;) {
      const open = buf.indexOf("{", pos);
      if (open < 0) return;
      let depth = 0;
      let inStr = false;
      let close = -1;
      for (let i = open; i < buf.length; i++) {
        const c = buf[i];
        if (inStr) {
          if (c === "\\") i++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close < 0) return; // 这个对象还没收全
      pos = close + 1;
      try {
        onObj(JSON.parse(buf.slice(open, close + 1)), style, look);
      } catch {
        /* 坏对象跳过 */
      }
    }
  };
}

// 流式版 chatJson:每来一段文本就交给 onDelta。接口不支持 json_object(400)时去掉再试。
async function streamChatJson(
  llm: { client: OpenAI; model: string },
  sys: string,
  user: string,
  dataUrls: string[],
  temperature: number,
  maxTokens: number,
  onDelta: (t: string) => void
): Promise<void> {
  const body = {
    model: llm.model,
    stream: true as const,
    messages: [
      { role: "system" as const, content: sys },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: user },
          ...dataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  let stream;
  try {
    stream = await llm.client.chat.completions.create({
      ...body,
      response_format: { type: "json_object" },
    });
  } catch (e) {
    if ((e as { status?: number }).status !== 400) throw e;
    stream = await llm.client.chat.completions.create(body);
  }
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) onDelta(t);
  }
}

// 看图 + 要 JSON。先带 json_object 模式请求;接口不支持该参数(400)时去掉再试一次。
async function chatJson(
  llm: { client: OpenAI; model: string },
  sys: string,
  user: string,
  dataUrl: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  const body = {
    model: llm.model,
    messages: [
      { role: "system" as const, content: sys },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: user },
          { type: "image_url" as const, image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  try {
    const r = await llm.client.chat.completions.create({
      ...body,
      response_format: { type: "json_object" },
    });
    return r.choices[0]?.message?.content ?? "";
  } catch (e) {
    if ((e as { status?: number }).status !== 400) throw e;
    const r = await llm.client.chat.completions.create(body);
    return r.choices[0]?.message?.content ?? "";
  }
}

type Direction = { name: string; desc: string };

function randomDirections(n: number): Direction[] {
  return [...FALLBACK_SUITE_DIRECTIONS].sort(() => Math.random() - 0.5).slice(0, n);
}

const SUITE_PLATFORM_NAMES: Record<string, string> = {
  taobao: "淘宝/天猫",
  douyin: "抖音电商",
  pdd: "拼多多",
  xhs: "小红书",
  amazon: "亚马逊(跨境,英文)",
  global: "跨境独立站(英文)",
};

// 前置:看图给 4 个设计方向。失败/没配识图模型 → 随机方向池(fallback=true)。
async function suggestDirections(
  image: { buf: Buffer; type: string },
  extra: string,
  platform: string,
  exclude: string[]
): Promise<{ directions: Direction[]; fallback: boolean }> {
  const llm = await getChatLLM({ timeout: 60_000 });
  if (!llm) return { directions: randomDirections(4), fallback: true };
  try {
    const dataUrl = await toVisionDataUrl(image.buf, image.type);
    const plat = SUITE_PLATFORM_NAMES[platform] ?? "淘宝/天猫";
    const user =
      `目标平台：${plat}\n` +
      (extra ? `补充信息：${extra}\n` : "") +
      // 每次随机几个灵感词 + 排除已经给过的,保证"换一批"真的换
      `本次风格灵感(可借用/混搭/不用)：${[...(await getStyleInspirations())].sort(() => Math.random() - 0.5).slice(0, 6).join("、")}\n` +
      (exclude.length ? `这些方向已经给过了，不要再给相同或相近的：${exclude.join("、")}\n` : "") +
      "请给出 4 个设计方向。";
    // 温度拉高:同一产品每次给的方向都不一样
    const raw = await chatJson(llm, await getSuiteDirectionsSystem(), user, dataUrl, 1.0, 800);
    const parsed = parseJsonLoose<{ directions?: Direction[] }>(raw);
    const list = (parsed?.directions ?? [])
      .filter((d) => d && typeof d.name === "string" && d.name.trim())
      .map((d) => ({
        name: d.name.trim().slice(0, 16),
        desc: String(d.desc ?? "").trim().slice(0, 60),
      }))
      .slice(0, 4);
    if (list.length >= 2) return { directions: list, fallback: false };
    return { directions: randomDirections(4), fallback: true };
  } catch (e) {
    console.warn("[suite] 设计方向生成失败:", e instanceof Error ? e.message : e);
    return { directions: randomDirections(4), fallback: true };
  }
}

function sizeFor(ratio: string): "1024x1024" | "1024x1536" {
  return ratio === "3:4" || ratio === "9:16" ? "1024x1536" : "1024x1024";
}

// 生成一张,返回 PNG buffer。模型直接出整图(含中文文案)。
async function genOneShot(
  client: OpenAI,
  model: string,
  spec: ShotSpec,
  productFiles: Awaited<ReturnType<typeof toFile>>[]
): Promise<Buffer> {
  const r = await client.images.edit({
    model,
    image: productFiles,
    prompt: spec.prompt,
    n: 1,
    size: sizeFor(spec.ratio),
    // 出图质量档(默认 medium):套图 13 张,质量档对总耗时影响很大。env OPENAI_IMAGE_QUALITY 可调。
    quality: (process.env.OPENAI_IMAGE_QUALITY || "medium") as
      | "low"
      | "medium"
      | "high"
      | "auto",
  });
  const d = r.data?.[0];
  if (!d) throw new Error("空返回");
  if (d.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d.url) return fetchRemoteImage(d.url); // 可经 IMAGE_FETCH_PROXY 加速
  throw new Error("空返回");
}

async function persistOne(buf: Buffer, id: string): Promise<string> {
  if (!storageEnabled) {
    // 无存储时退化成 data url(本地 mock)
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  try {
    return await uploadImage(new Uint8Array(buf), "image/png", `suite/${id}.png`);
  } catch {
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
}

// --- Async job store (与生图同款,内存,单 pm2 fork) -------------------------
type Job = {
  status: "pending" | "done" | "error";
  shots: ShotResult[];
  done: number;
  total: number;
  user?: Awaited<ReturnType<typeof getUser>>;
  creditsUsed?: number;
  mock?: boolean;
  error?: string;
  /** 规划没走成识图模型、用了兜底模板(前端要明确提示) */
  planFallback?: boolean;
  createdAt: number;
};
const JOBS = new Map<string, Job>();
function gcJobs() {
  const now = Date.now();
  JOBS.forEach((v, k) => {
    if (now - v.createdAt > 30 * 60 * 1000) JOBS.delete(k);
  });
}

async function runSuite(
  jobId: string,
  productImages: { buf: Buffer; type: string }[],
  extra: string,
  lay: Layout,
  direction: string,
  resolution: string,
  strict: boolean,
  email: string,
  apiKey: string,
  model: string,
  useDb: boolean,
  cost: number
) {
  const platform = lay.platform;
  const set = (patch: Partial<Job>) => {
    const cur = JOBS.get(jobId);
    if (cur) JOBS.set(jobId, { ...cur, ...patch });
  };
  try {
    // 规划(流式)与出图同时进行:规划每吐出一张就进队列,出图 worker 立刻领走。
    const shots: ShotResult[] = [];
    let planning = true;
    let waiters: (() => void)[] = [];
    const wakeAll = () => {
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    };
    const addShot = (spec: ShotSpec) => {
      if (shots.length >= lay.count) return;
      const i = shots.length;
      shots.push({
        ...spec,
        id: `suite-${Date.now()}-${i}`,
        status: "pending",
        gradient: GRADIENTS[i % GRADIENTS.length],
      });
      set({ shots: [...shots] });
      wakeAll();
    };
    const planDone = planShotsStream(productImages, extra, lay, direction, strict, addShot)
      .then((n) => {
        // 规划张数不足(失败/不合格):按序用兜底模板补齐,并告诉前端
        if (shots.length < lay.count) {
          fallbackFor(lay, extra, direction).slice(shots.length).forEach(addShot);
        }
        if (n < lay.count) set({ planFallback: true });
      })
      .finally(() => {
        planning = false;
        wakeAll();
      });

    const size = (ratio: string) => nativeSizeFor(ratio, model, resolutionLongSide(resolution));
    let cursor = 0;
    let doneCount = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (cursor >= shots.length) {
          if (!planning) return;
          await new Promise<void>((r) => waiters.push(r));
          continue;
        }
        const idx = cursor++;
        const shot = shots[idx];
        let ok = false;
        for (let attempt = 0; attempt <= SHOT_RETRIES && !ok; attempt++) {
          try {
            // 走统一层:国内站自动切「境外代跑」(美国机出图+直传 R2,只回 URL),
            // 海外站/自部署仍是本地直调。**图片字节不再跨境**(套图 13 张,这里省最多)。
            const params = {
              prompt: shot.prompt,
              images: productImages.map((im) => ({ buf: im.buf, type: im.type })),
              model,
              size: size(shot.ratio),
              quality: (process.env.OPENAI_IMAGE_QUALITY || "medium") as
                | "low"
                | "medium"
                | "high"
                | "auto",
            };
            let url: string;
            if (shot.role === "aplus") {
              // 亚马逊 A+ 模块要精确尺寸(970×600 / 1464×600):同比例出图后裁缩
              const sharp = (await import("sharp")).default;
              const raw = await generateBuffer(params);
              const fitted = await sharp(raw).resize(lay.aplusW, lay.aplusH, { fit: "cover" }).png().toBuffer();
              url = await persistOne(fitted, shot.id);
            } else if (platform === "amazon" && shot.role === "main") {
              // 亚马逊主图要求背景正好 RGB 255:模型出的「白」常是 252~254,接近白的像素统一拉到 255
              const sharp = (await import("sharp")).default;
              const { data, info } = await sharp(await generateBuffer(params))
                .removeAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
              for (let p = 0; p < data.length; p += 3) {
                if (data[p] >= 248 && data[p + 1] >= 248 && data[p + 2] >= 248) {
                  data[p] = data[p + 1] = data[p + 2] = 255;
                }
              }
              const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
                .png()
                .toBuffer();
              url = await persistOne(png, shot.id);
            } else {
              url = await generateToR2(params, `suite/${shot.id}.png`);
            }
            shots[idx] = { ...shot, status: "done", url };
            ok = true;
          } catch (e) {
            console.warn(
              `[suite] 第${idx + 1}张第${attempt + 1}次失败:`,
              e instanceof Error ? e.message.slice(0, 200) : e
            );
            // 频率限制/超时等:指数退避 + 抖动后重试,熬过限频窗口(2.5s→5s→10s,封顶18s)
            if (attempt < SHOT_RETRIES) {
              const wait =
                Math.min(18000, 2500 * 2 ** attempt) +
                Math.floor(Math.random() * 1500);
              await new Promise((r) => setTimeout(r, wait));
            }
          }
        }
        if (!ok) shots[idx] = { ...shot, status: "error" };
        doneCount++;
        set({ shots: [...shots], done: doneCount });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await planDone;

    const okShots = shots.filter((s) => s.status === "done" && s.url);

    // 归档作品库(一个套图 = 一个 batch)
    let user: Awaited<ReturnType<typeof getUser>> = null;
    if (useDb && okShots.length > 0) {
      // A+ 批次带 aplus 前缀:仍以 suite- 开头(画布/作品页按套图批次处理),A+ 页面据此只显示自己的记录
      const batchId = `suite-${lay.mode === "aplus" ? "aplus-" : ""}${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      try {
        await addArtworks(
          email,
          okShots.map((s) => ({
            id: s.id,
            title: `${lay.mode === "aplus" ? "A+详情" : "套图"}·${s.label}`,
            category: s.role === "detail" || s.role === "aplus" ? "detail" : "main",
            prompt: "",
            status: "completed",
            image: s.url!,
            gradient: s.gradient,
            style: null,
            ratio: s.ratio,
            resolution,
            // 把 role(main/sub/detail/aplus)存进 source(原本为 null;非 URL 不会被
            // regenHref 当作源图带走),作品页据此排序/标注主图/副图/详情。
            source: s.role,
          })),
          batchId
        );
      } catch {
        /* non-fatal */
      }
      // 失败的张数按比例退积分
      const failed = shots.length - okShots.length;
      if (failed > 0) {
        const refund = Math.round((cost / shots.length) * failed);
        await refundCredits(email, refund).catch(() => {});
      }
      await addLedgerEntry(
        email,
        -(cost - Math.round((cost / shots.length) * (shots.length - okShots.length))),
        `${lay.mode === "aplus" ? "A+详情" : "一键套图"} ${okShots.length} 张`
      ).catch(() => {});
      user = await getUser(email).catch(() => null);
    }

    if (useDb) await settleReservation(jobId).catch(() => {});
    set({
      status: "done",
      shots: [...shots],
      done: shots.length,
      user,
      creditsUsed: cost,
      mock: !apiKey,
    });
  } catch (e) {
    if (useDb) {
      await refundCredits(email, cost).catch(() => {});
      await settleReservation(jobId).catch(() => {});
    }
    console.error("[suite] job failed:", e instanceof Error ? e.message : e);
    set({ status: "error", error: safeError(e, "套图生成失败,请稍后重试") });
  }
}

async function parseInput(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const images: { buf: Buffer; type: string }[] = [];
  for (const file of f.getAll("image")) {
    if (file instanceof File && file.size > 0) {
      images.push({
        buf: Buffer.from(await file.arrayBuffer()),
        type: file.type || "image/png",
      });
    }
    if (images.length >= 5) break; // 硬上限 5;按档位再收(见下)
  }
  return {
    images,
    extra: (f.get("text") ?? "").toString().trim().slice(0, 600),
    platform: (f.get("platform") ?? "taobao").toString().trim().slice(0, 20),
    // 用户选的设计方向(「风格名：描述」);空 = 随机挑一个
    direction: (f.get("direction") ?? "").toString().trim().slice(0, 120),
    // 「换一批」时前端带上已经给过的方向名,让模型避开
    exclude: (f.get("exclude") ?? "")
      .toString()
      .split("|")
      .map((x) => x.trim().slice(0, 16))
      .filter(Boolean)
      .slice(0, 16),
    resolution: (f.get("resolution") ?? "2K").toString().trim(),
    // 「严格不编造参数」开关:默认关(用户定),前端传 "1" 才开
    strict: (f.get("strict") ?? "0").toString() === "1",
    action: (f.get("action") ?? "").toString().trim(),
    email: (f.get("email") ?? "").toString().trim(),
    // 「A+详情」功能复用本接口:mode=aplus,档位 standard(5×970×600)/ premium(7×1464×600)
    mode: (f.get("mode") ?? "").toString() === "aplus" ? "aplus" : "suite",
    aplusTier: (f.get("aplusTier") ?? "").toString() === "premium" ? "premium" : "standard",
  };
}

export async function POST(request: Request) {
  const input = await parseInput(request).catch(() => null);
  if (!input || input.images.length === 0) {
    return NextResponse.json({ error: "请上传至少一张产品图" }, { status: 400 });
  }
  if (input.images.some((im) => im.buf.length > 12 * 1024 * 1024)) {
    return NextResponse.json(
      { error: "单张上传图片过大（请 < 12MB）" },
      { status: 400 }
    );
  }

  const { apiKey, model } = await getOpenAISettings();
  const ip = clientIp(request);

  // 按 IP 限流:套图一次 13 张更重,8 次/10 分钟。
  if (!rateLimit(`suite:${ip}`, 8, 600_000)) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429 }
    );
  }

  // 生产环境必须凭有效登录态:用 token 里的 email 作准,不信任请求体 email。
  if (dbEnabled) {
    const tokenEmail = await resolveUserEmail(request);
    if (!tokenEmail) {
      return NextResponse.json(
        { error: "请先登录后再生成" },
        { status: 401 }
      );
    }
    input.email = tokenEmail;
  }
  if (!(await corePromptsAvailable())) {
    return NextResponse.json(
      { error: "一键套图需要商业授权，或暂时无法连接授权服务，请联系站长" },
      { status: 403 }
    );
  }
  if (input.action === "directions") {
    // 免费,单独限流(防脚本刷识图模型)
    if (!rateLimit(`suite-dir:${ip}`, 30, 600_000)) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
    }
    const dirPlatform = input.mode === "aplus" ? "amazon" : input.platform;
    return NextResponse.json(await suggestDirections(input.images[0], input.extra, dirPlatform, input.exclude));
  }
  const lay = layoutFor(input.mode, input.platform, input.aplusTier);
  // A+ 出图档位跟着模块尺寸走:970 宽 1K 够用,1464 宽要 2K 才不是放大糊图
  if (lay.mode === "aplus") input.resolution = lay.aplusW > 1024 ? "2K" : "1K";
  if (!input.direction) {
    const d = randomDirections(1)[0];
    input.direction = `${d.name}：${d.desc}`;
  }
  const useDb = dbEnabled && input.email.length > 0;
  // 产品图上限统一 5 张(月度会员已下线)。超出部分静默截断(防绕过前端多传图)。
  if (input.images.length > 5) input.images = input.images.slice(0, 5);
  if (!SUITE_RESOLUTIONS.includes(input.resolution)) input.resolution = "2K";
  // 按 GPT生图 的价格表 × 张数(套图 13 / 亚马逊套图 9 / A+ 5 或 7)
  await loadPriceOverrides(); // 站长在后台改的板块价
  const cost = lay.count * resolutionCost(input.resolution, "medium", "gpt-image-2", "suite");

  if (dbEnabled && (await isBanned(input.email, ip))) {
    return NextResponse.json(
      { error: "账号或 IP 已被封禁，请联系管理员" },
      { status: 403 }
    );
  }
  if (useDb) {
    const ok = await reserveCredits(input.email, cost);
    if (!ok) {
      return NextResponse.json(
        { error: "积分不足，请充值后重试" },
        { status: 402 }
      );
    }
  }

  gcJobs();
  const jobId = `suite-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  JOBS.set(jobId, {
    status: "pending",
    shots: [],
    done: 0,
    total: lay.count,
    createdAt: Date.now(),
  });
  if (useDb) await addReservation(jobId, input.email, cost);
  void sweepStaleReservations().catch(() => {});
  void runSuite(
    jobId,
    input.images,
    input.extra,
    lay,
    input.direction,
    input.resolution,
    input.strict,
    input.email,
    apiKey,
    model,
    useDb,
    cost
  );

  return NextResponse.json({ jobId, total: lay.count, cost });
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId) {
    // 健康检查:绝不暴露模型名/上游供应商(铁律:绝不泄露所用模型)。
    const { apiKey } = await getOpenAISettings();
    return NextResponse.json({
      status: "ok",
      ready: !!apiKey,
      db: dbEnabled,
      storage: storageEnabled,
    });
  }
  const job = JOBS.get(jobId);
  if (!job) {
    return NextResponse.json({
      status: "error",
      error: "任务不存在或已过期，请重试",
    });
  }
  // 公开字段:不回 prompt 全文(太长),只给前端要的展示数据
  const shots = job.shots.map((s) => ({
    id: s.id,
    role: s.role,
    label: s.label,
    ratio: s.ratio,
    status: s.status,
    url: s.url ?? null,
    gradient: s.gradient,
  }));
  return NextResponse.json({
    status: job.status,
    done: job.done,
    total: job.total,
    shots,
    user: job.status === "done" ? job.user : undefined,
    creditsUsed: job.status === "done" ? job.creditsUsed : undefined,
    mock: job.mock,
    error: job.error,
    planFallback: job.planFallback,
  });
}
