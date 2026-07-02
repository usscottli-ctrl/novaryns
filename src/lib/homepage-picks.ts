// 首页轮换池服务端选图。每 24h ISR revalidate 时跑一遍,自动吃 DB 里新加的模板。
// 规则:
//   1) 分类必须在白名单 5 类(电商主图/商品场景图/Banner 横幅/品牌与标志/UI 界面)
//   2) 宽高比 0.65 ~ 1.4 (按 template-dims.json 查)
//   3) tag 不命中黑名单(肖像/动漫/插画...)
//      curated 池(tpl-c*, tpl-canghe-*)直接通过;leader 池还得命中白名单 tag
//   4) deterministic shuffle 按当天日期作种,同一天所有访客看一致,跨天换批

import {
  dbEnabled,
  listHomepageFeaturedTemplates,
  listTemplatesInCategories,
} from "@/lib/db";
import { TEMPLATES as SEED } from "@/lib/templates-data";
import templateDimsJson from "@/lib/template-dims.json";
import type { PromptTemplate } from "@/lib/mock-data";

const CAT_WHITELIST = [
  "电商主图",
  "商品场景图",
  "Banner 横幅",
  "品牌与标志",
  "UI 界面",
];
const TAG_WHITE = [
  "电商","主图","海报","商品","场景","白底","包装","品牌","banner","促销","详情页",
];
const TAG_BLACK = [
  "肖像","人物","街拍","动漫","风景","二次元","卡通","角色","插画",
  "女性","男性","少女","少年","头像","脸","脸部",
];

const RATIO_MIN = 0.65;
const RATIO_MAX = 1.4;
const PORTRAIT = [0.65, 0.95] as const;
const SQUARE = [0.95, 1.05] as const;

const dims = templateDimsJson as Record<string, number[]>;

export type PickedTemplate = PromptTemplate & { ratio: number };

export type HomepagePicks = {
  /** 4 个 hero 槽位,每个槽位 3 张图轮换 (≥1 总有,≤3 折叠到 1) */
  heroSlots: PickedTemplate[][];
  /** 6 张 showcase */
  showcase: PickedTemplate[];
};

function isCurated(id: string): boolean {
  return (
    id.startsWith("tpl-canghe-") ||
    (id.startsWith("tpl-c") && !id.startsWith("tpl-canghe-"))
  );
}

function passTagFilter(t: PromptTemplate): boolean {
  const tags = (t.tags || []).map((s) => s.toLowerCase());
  const title = (t.title || "").toLowerCase();
  const hit = (list: string[]) =>
    list.some((w) => {
      const lw = w.toLowerCase();
      return tags.some((tag) => tag.includes(lw)) || title.includes(lw);
    });
  if (hit(TAG_BLACK)) return false;
  if (isCurated(t.id)) return true;
  return hit(TAG_WHITE);
}

// 简易确定性 PRNG (mulberry32), seed 相同 → 顺序相同
function detShuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchCandidates(): Promise<PromptTemplate[]> {
  if (!dbEnabled) {
    return (SEED as PromptTemplate[]).filter((t) =>
      CAT_WHITELIST.includes(t.category)
    );
  }
  try {
    return (await listTemplatesInCategories(CAT_WHITELIST)) as PromptTemplate[];
  } catch {
    return (SEED as PromptTemplate[]).filter((t) =>
      CAT_WHITELIST.includes(t.category)
    );
  }
}

// 管理员手动「上首页」的模板:不受 dim/category/tag filter 约束,默认按方形显示
// (admin 加的图通常没 dim 数据,放在方形槽稳妥)。
async function fetchFeatured(): Promise<PickedTemplate[]> {
  if (!dbEnabled) return [];
  try {
    const rows = await listHomepageFeaturedTemplates();
    return rows.map((t) => {
      const wh = dims[t.id];
      const ratio = wh ? wh[0] / wh[1] : 1.0; // 没 dim 默认按方形处理
      return { ...t, ratio: +ratio.toFixed(3) };
    });
  } catch {
    return [];
  }
}

export async function pickHomepageImages(): Promise<HomepagePicks> {
  // 两个池:管理员手动开关的 + 算法自动筛的
  const [featured, candidates] = await Promise.all([
    fetchFeatured(),
    fetchCandidates(),
  ]);

  const autoPool: PickedTemplate[] = [];
  for (const t of candidates) {
    if (!CAT_WHITELIST.includes(t.category)) continue;
    const wh = dims[t.id];
    if (!wh) continue;
    const ratio = wh[0] / wh[1];
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue;
    if (!passTagFilter(t)) continue;
    autoPool.push({ ...t, ratio: +ratio.toFixed(3) });
  }

  // 24h 滚动:同一天所有访客拿到同一批,跨天换
  const seed = Math.floor(Date.now() / (24 * 60 * 60 * 1000));

  // featured 也按宽高比分桶 + 优先权高于 autoPool (排在前面)
  function bucketFor(p: PickedTemplate): "portrait" | "square" | "landscape" {
    if (p.ratio >= PORTRAIT[0] && p.ratio < PORTRAIT[1]) return "portrait";
    if (p.ratio >= SQUARE[0] && p.ratio <= SQUARE[1]) return "square";
    return "landscape";
  }
  const featuredPortraits = detShuffle(
    featured.filter((p) => bucketFor(p) === "portrait"),
    seed
  );
  const featuredSquares = detShuffle(
    featured.filter((p) => bucketFor(p) === "square"),
    seed + 1
  );
  const autoPortraits = detShuffle(
    autoPool.filter((p) => bucketFor(p) === "portrait"),
    seed + 11
  );
  const autoSquares = detShuffle(
    autoPool.filter((p) => bucketFor(p) === "square"),
    seed + 17
  );

  // featured 排在前面,合并后去重 (用 Set on id)
  const seen = new Set<string>();
  const dedup = (arr: PickedTemplate[]) =>
    arr.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const portraitPool = dedup([...featuredPortraits, ...autoPortraits]);
  const squarePool = dedup([...featuredSquares, ...autoSquares]);

  // hero: 2 portrait + 2 square,每槽 3 张图轮播
  const heroSlots: PickedTemplate[][] = [
    portraitPool.slice(0, 3),
    squarePool.slice(0, 3),
    squarePool.slice(3, 6),
    portraitPool.slice(3, 6),
  ].map((s) => (s.length > 0 ? s : []));

  // showcase: 6 张(竖图优先,不足用未用过的方形补满,避免右侧空槽),不跟 hero 重复
  const usedIds = new Set(heroSlots.flat().map((p) => p.id));
  const showcase = portraitPool.filter((p) => !usedIds.has(p.id)).slice(0, 6);
  if (showcase.length < 6) {
    const showcaseIds = new Set(showcase.map((p) => p.id));
    for (const p of squarePool) {
      if (showcase.length >= 6) break;
      if (!usedIds.has(p.id) && !showcaseIds.has(p.id)) {
        showcase.push(p);
        showcaseIds.add(p.id);
      }
    }
  }

  return { heroSlots, showcase };
}
