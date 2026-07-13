"use client";
import { copyText } from "@/lib/clipboard";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Search,
  Star,
  Heart,
  Copy,
  Check,
  Loader2,
  X,
} from "lucide-react";
import type { PromptTemplate } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cdnUrl, cdnThumb } from "@/lib/cdn";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn, lockBodyScroll } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { browserSupabase } from "@/lib/supabase";
import { useAuthModal } from "@/lib/auth-modal-context";
// Pre-probed natural dimensions {id: [w, h]} for every bundled template image.
// Passing width/height to <img> lets the browser reserve the exact slot before
// the image bytes arrive → no layout shift in the masonry grid.
import templateDims from "@/lib/template-dims.json";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

// 显示时去掉模型品牌字样（GPT-Image2 / GPT Image 2 / gpt-image 等），
// 仅作用于展示，不改动底层模板数据（templates-data.ts 自动生成）。
function scrub(s: string): string {
  return s
    .replace(/GPT[\s-]?Image[\s-]?2?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([，。、）)！!])/g, "$1")
    .replace(/[\s+＋]+$/g, "")
    .trim();
}

type Filter = string;

// 历史 localStorage key,已迁移到 /api/favorites DB 存储;保留常量仅为引用记录
// const FAV_KEY = "novaryns:favTemplates"; (deprecated)
const PAGE_SIZE = 24;

// 追加下一页时按 id 去重:即便同一页因为竞态被请求/追加两次(滚动监听 + 加载更多按钮 +
// SWR 重置等),列表里也不会出现重复模板。
function mergeUnique(
  prev: PromptTemplate[],
  incoming: PromptTemplate[]
): PromptTemplate[] {
  const seen = new Set(prev.map((t) => t.id));
  return [...prev, ...incoming.filter((t) => t && !seen.has(t.id))];
}

// SWR-style 本地缓存:首次访问后,把每个 (filter+q+favsKey) 组合下的第一页结果
// 存起来。回访用户进入页面瞬时显示上次的卡片,后台拉新数据再 swap,避免每次都
// 出现"加载模板中..."的空白等待。1 小时 TTL。
const CACHE_KEY = "novaryns:templatesCacheV1";
const CACHE_TTL_MS = 60 * 60 * 1000;
type CacheEntry = { templates: PromptTemplate[]; total: number; ts: number };
function cacheKeyOf(filter: string, q: string, favsKey: string): string {
  return `${filter}|${q}|${favsKey}`;
}
function loadCache(key: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, CacheEntry>;
    const entry = all[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}
function saveCache(key: string, templates: PromptTemplate[], total: number) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
    all[key] = { templates, total, ts: Date.now() };
    // 限制条目数,避免 localStorage 爆容量:保留最近 20 个 key
    const entries = Object.entries(all);
    if (entries.length > 20) {
      entries.sort((a, b) => b[1].ts - a[1].ts);
      const pruned: Record<string, CacheEntry> = {};
      for (const [k, v] of entries.slice(0, 20)) pruned[k] = v;
      localStorage.setItem(CACHE_KEY, JSON.stringify(pruned));
    } else {
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    }
  } catch {
    /* quota exceeded — silently skip */
  }
}

// 骨架屏:12 个不同宽高比的灰色卡占位,跟真卡 masonry 布局一致,避免空白和闪动
const SKELETON_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [3, 4], [4, 3], [1, 1], [9, 16], [16, 9], [2, 3],
  [3, 4], [1, 1], [4, 3], [3, 5], [16, 9], [1, 1],
];

export function TemplatesClient({
  gridClass,
}: {
  // 在窄容器(如画布弹窗)里渲染时,传入更少列的栅格类,避免太挤
  gridClass?: string;
} = {}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [colCount, setColCount] = useState(4);
  // gridClass 里声明的最大列数作为列数上限(画布弹窗等窄容器会传更少的列)
  const maxCols = useMemo(() => {
    const m = (gridClass ?? "").match(/columns-(\d)/g);
    return m ? Math.max(...m.map((s) => parseInt(s.slice(8), 10))) : 6;
  }, [gridClass]);
  const { t: tr, te } = useI18n();
  const { user, ready } = useAuth();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const catLabel = (c: string) => te(`tplCat.${c}`, c);
  // 未登录点 ♥ 时显示的「请登录」提示
  const [loginPrompt, setLoginPrompt] = useState(false);
  // 服务端分页:templates 是累积渲染列表(每次 next page 追加);total 是当前
  // 过滤条件下的全量计数;page 是已加载到第几页。
  // 初次 mount 时尝试用「全部 / 空查询 / 空 fav」这个最常见组合的缓存命中,
  // 命中则 templates 直接有值、loading=false → 瞬时显示上次内容,后续 fetch
  // 在后台 swap;未命中则正常走骨架屏 loading 路径。
  const initialCache =
    typeof window !== "undefined" ? loadCache(cacheKeyOf("all", "", "")) : null;
  const [templates, setTemplates] = useState<PromptTemplate[]>(
    initialCache?.templates ?? []
  );
  const [categories, setCategories] = useState<{ name: string; count: number }[]>(
    []
  );
  const [total, setTotal] = useState(initialCache?.total ?? 0);
  // 全库总数(大字横幅用):只在「全部 + 无搜索」的结果里更新,不随筛选缩水。
  // initialCache 恰好就是「全部+空查询」的缓存,可直接当种子。
  const [libTotal, setLibTotal] = useState(initialCache?.total ?? 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [debQuery, setDebQuery] = useState(""); // 300ms 防抖
  const [favs, setFavs] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 点图打开的预览弹窗。null = 关闭。
  const [preview, setPreview] = useState<PromptTemplate | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 拉一次分类(带计数,给 sidebar 用)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates/categories")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.categories)) setCategories(d.categories);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 登录后拉服务端收藏;未登录直接清空(不再读 localStorage——历史数据废弃)
  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setFavs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = browserSupabase();
        const { data } = await sb.auth.getSession();
        const tok = data.session?.access_token;
        if (!tok) return;
        const res = await fetch("/api/favorites", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const j = (await res.json()) as { favs: string[] };
          if (Array.isArray(j.favs)) setFavs(j.favs);
        }
      } catch {
        /* 网络问题忽略,下次刷新再试 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  // 输入框 → debQuery 300ms 防抖,避免每个字符都打服务端
  useEffect(() => {
    const tm = setTimeout(() => setDebQuery(query), 300);
    return () => clearTimeout(tm);
  }, [query]);

  // 预览弹窗打开时 Esc 关闭 + 锁住 body 滚动
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    const unlock = lockBodyScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [preview]);

  function buildParams(p: number, currentFilter: Filter, currentQ: string, currentFavs: string[]): URLSearchParams {
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", String(PAGE_SIZE));
    if (currentFilter === "fav") {
      params.set("ids", currentFavs.join(","));
    } else if (currentFilter !== "all") {
      params.set("category", currentFilter);
    }
    if (currentQ) params.set("q", currentQ);
    return params;
  }

  // 过滤/搜索/收藏变了:重置 + 拉第 1 页(SWR pattern)
  // - 有缓存:立即 set 缓存内容、loading=false、再后台 fetch fresh 覆盖
  // - 无缓存:正常显示骨架屏直到接口返回
  // favs 只在「我的收藏」filter 下影响接口结果;其它 filter 下点心心不重跑。
  const favsKey = filter === "fav" ? favs.slice().sort().join(",") : "";
  useEffect(() => {
    let cancelled = false;
    setPage(1);

    if (filter === "fav" && favs.length === 0) {
      setTemplates([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    // 缓存命中:瞬时显示,跳过骨架屏
    const ck = cacheKeyOf(filter, debQuery, favsKey);
    const cached = loadCache(ck);
    if (cached) {
      setTemplates(cached.templates);
      setTotal(cached.total);
      if (filter === "all" && !debQuery) setLibTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const params = buildParams(1, filter, debQuery, favs);
    fetch(`/api/templates?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const tpls = Array.isArray(d.templates) ? d.templates : [];
        const tot = Number(d.total ?? 0);
        setTemplates(tpls);
        setTotal(tot);
        if (filter === "all" && !debQuery && tot > 0) setLibTotal(tot);
        saveCache(ck, tpls, tot);
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setTemplates([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debQuery, favsKey]);

  // 无限滚动:接近底部时拉下一页追加
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (loading || loadingMore) return;
    if (templates.length >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setLoadingMore(true);
        const next = page + 1;
        const params = buildParams(next, filter, debQuery, favs);
        fetch(`/api/templates?${params.toString()}`)
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d.templates)) {
              setTemplates((prev) => mergeUnique(prev, d.templates as PromptTemplate[]));
              setPage(next);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: "320px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // 同上,只在「我的收藏」filter 下 favs 才影响下一页 ids 参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length, total, loading, loadingMore, page, filter, debQuery, favsKey]);

  // 渲染兜底:整列表按 id 去重(无论何种竞态把同一模板混进数组多次,画面上也只出现一次)。
  const shownTemplates = useMemo(() => {
    const seen = new Set<string>();
    return templates.filter((t) => {
      if (!t || !t.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [templates]);

  // 按屏幕宽度(Tailwind 断点)算列数,复刻原来的 sm2/md3/lg4/xl5/2xl6 行为;
  // 上限取 gridClass 声明的最大列数(画布弹窗等窄容器会传更少的列)。
  useEffect(() => {
    const measure = () => {
      const w = window.innerWidth;
      const full =
        w >= 1536 ? 6 : w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 768 ? 3 : 2;
      const n = Math.min(maxCols, full);
      setColCount((c) => (c === n ? c : n));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [maxCols]);

  // JS 列桶瀑布流:按估算高度把卡片顺序贪心分到当前最矮的列。
  // 顺序处理 → 加载新一页只往各列尾部追加,已渲染的卡片不会重排/挪位。
  const columns = useMemo(() => {
    const n = Math.max(1, colCount);
    const buckets: PromptTemplate[][] = Array.from({ length: n }, () => []);
    const heights = new Array(n).fill(0);
    for (const t of shownTemplates) {
      const wh = (templateDims as Record<string, number[]>)[t.id];
      const ratio = wh && wh[0] ? wh[1] / wh[0] : 1.25; // 图片相对高度(每单位列宽)
      const est = ratio + 0.6; // 加上标题/标签文字块的大致固定高度
      let m = 0;
      for (let i = 1; i < n; i++) if (heights[i] < heights[m]) m = i;
      buckets[m].push(t);
      heights[m] += est;
    }
    return buckets;
  }, [shownTemplates, colCount]);

  // 打开预览:列表接口为省 egress 不再带 prompt 全文,这里按 id 补取。
  // 先用列表对象立即显示图/标题/描述(无白屏),prompt 异步补上。
  async function openPreview(t: PromptTemplate) {
    setPreview(t);
    if (t.prompt) return; // 已有(如来自旧缓存)直接用
    try {
      const res = await fetch(
        `/api/templates?ids=${encodeURIComponent(t.id)}&pageSize=1`,
        { cache: "no-store" }
      );
      const data = await res.json();
      const full = ((data.templates ?? []) as PromptTemplate[]).find(
        (x) => x.id === t.id
      );
      if (full?.prompt) {
        setPreview((cur) => (cur && cur.id === t.id ? full : cur));
      }
    } catch {
      /* 取详情失败:预览仍显示图/标题,prompt 区给占位 */
    }
  }

  async function copyPrompt(id: string, text: string) {
    if (!text) return;
    try {
      if (!(await copyText(text))) throw new Error();
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch {
      /* clipboard unavailable (insecure context) — no-op */
    }
  }

  async function toggleFav(id: string) {
    // 未登录:弹「请登录」提示,3 秒后自动消失
    if (!user) {
      setLoginPrompt(true);
      return;
    }
    // 乐观更新 + 后台 API
    const wasFaved = favs.includes(id);
    setFavs((prev) =>
      wasFaved ? prev.filter((x) => x !== id) : [...prev, id]
    );
    try {
      const sb = browserSupabase();
      const { data } = await sb.auth.getSession();
      const tok = data.session?.access_token;
      if (!tok) return;
      if (wasFaved) {
        await fetch(`/api/favorites?templateId=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tok}` },
        });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ templateId: id }),
        });
      }
    } catch {
      // 失败时回滚乐观更新
      setFavs((prev) =>
        wasFaved ? [...prev, id] : prev.filter((x) => x !== id)
      );
    }
  }

  // 过滤芯片:从 categories API 拿(带计数)
  const FILTERS: { key: Filter; label: string }[] = useMemo(
    () => [
      { key: "all", label: "全部" },
      { key: "fav", label: "我的收藏" },
      ...categories.map((c) => ({ key: c.name, label: c.name })),
    ],
    [categories]
  );

  // 当前累积列表里的位置 → 序号:序号 = total - 当前列表中的索引。
  const no2 = (id: string) => {
    const i = templates.findIndex((t) => t.id === id);
    return String(Math.max(0, total - i)).padStart(3, "0");
  };

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-2">
        {/* 大字横幅标题:实时库存数量(方案 A,2026-06-12 用户选定)。
            total 未到位时回退 16300,避免闪「0」。 */}
        <h1 className="text-[24px] font-black leading-snug tracking-tight sm:text-3xl">
          {tr("tpl.stats1a")}
          <span className="text-primary">
            {`${(Math.floor((libTotal || 16300) / 100) * 100).toLocaleString("en-US")}+`}
          </span>
          {tr("tpl.stats1b")}
        </h1>
        <p className="text-muted-foreground">{tr("tpl.statsSub")}</p>
      </div>

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                filter === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {f.key === "fav" && (
                <Heart
                  className={cn(
                    "h-3.5 w-3.5",
                    filter === "fav" && "fill-primary"
                  )}
                />
              )}
              {f.key === "all"
                ? tr("tpl.all")
                : f.key === "fav"
                  ? tr("tpl.favorites")
                  : catLabel(f.label)}
              {f.key === "fav" && favs.length > 0 && (
                <span className="text-xs">({favs.length})</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("tpl.searchPlaceholder")}
            className="bg-card pl-9"
          />
        </div>
      </div>

      {loading ? (
        /* 骨架屏:12 张灰色鬼影,masonry 排版直接铺满视口,不再是孤零零的 spinner */
        <div ref={gridRef} className="flex items-start gap-4">
          {Array.from({ length: colCount }, (_, ci) => (
            <div key={ci} className="flex min-w-0 flex-1 flex-col gap-4">
              {SKELETON_RATIOS.filter((_, i) => i % colCount === ci).map(([w, h], i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
                >
              <div
                className="w-full animate-pulse bg-secondary/60"
                style={{ aspectRatio: `${w} / ${h}` }}
              />
              <div className="space-y-3 p-5">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-12 animate-pulse rounded bg-secondary" />
                  <div className="h-5 w-16 animate-pulse rounded bg-secondary" />
                  <div className="h-3 flex-1 animate-pulse rounded bg-secondary/70" />
                </div>
                <div className="h-5 w-3/4 animate-pulse rounded bg-secondary" />
                <div className="h-3 w-full animate-pulse rounded bg-secondary/70" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-secondary/70" />
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {[12, 16, 14].map((wd, j) => (
                      <div
                        key={j}
                        className="h-5 animate-pulse rounded bg-secondary"
                        style={{ width: `${wd * 4}px` }}
                      />
                    ))}
                  </div>
                  <div className="h-8 w-20 shrink-0 animate-pulse rounded-full bg-secondary" />
                </div>
              </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-20 text-center text-sm text-muted-foreground card-shadow">
          {filter === "fav" ? tr("tpl.emptyFav") : tr("tpl.emptySearch")}
        </div>
      ) : (
        <>
          <div ref={gridRef} className="flex items-start gap-4">
            {columns.map((col, ci) => (
              <div key={ci} className="flex min-w-0 flex-1 flex-col gap-4">
                {col.map((t) => (
                  <div
                    key={t.id}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-1 hover:card-shadow"
                  >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => void openPreview(t)}
                      className="group/img relative block w-full text-left"
                      title={tr("tpl.useTitle")}
                    >
                      {(() => {
                        const wh = (templateDims as Record<string, number[]>)[t.id];
                        return (
                          <div
                            className={cn(
                              "relative w-full bg-gradient-to-br",
                              t.gradient
                            )}
                            style={
                              wh
                                ? { aspectRatio: `${wh[0]} / ${wh[1]}` }
                                : undefined
                            }
                          >
                            {/* 自然宽高比;预存尺寸 → 浏览器加载前就锁住位,无抖动 */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={cdnThumb(t.image, 640)}
                              alt={t.title}
                              loading="lazy"
                              width={wh ? wh[0] : undefined}
                              height={wh ? wh[1] : undefined}
                              className="block h-auto w-full"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-sm font-medium text-transparent transition-all group-hover/img:bg-slate-900/35 group-hover/img:text-white">
                              {tr("tpl.hoverUse")}
                            </span>
                          </div>
                        );
                      })()}
                    </button>
                    {t.popular && (
                      <Badge
                        variant="accent"
                        className="absolute left-3 top-3 gap-1"
                      >
                        <Star className="h-3 w-3" />
                        {tr("tpl.popular")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col space-y-3 p-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-xs font-semibold text-primary">
                        No.{no2(t.id)}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {catLabel(t.category)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {scrub(t.industry)}
                      </span>
                    </div>
                    <h3 className="font-semibold">{scrub(t.title)}</h3>
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {scrub(t.description)}
                    </p>
                    {/* 标签 + 做同款按钮同一行:标签 flex-1 可换行,按钮 shrink-0 钉右端 */}
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            #{te(`tplTag.${tag}`, tag)}
                          </span>
                        ))}
                      </div>
                      <Button
                        asChild
                        variant="gradient"
                        size="sm"
                        className="h-8 shrink-0 rounded-full px-4 text-xs font-medium"
                      >
                        <Link
                          href={`/generate?template=${t.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {tr("tpl.makeSimilar")}
                        </Link>
                      </Button>
                    </div>
                  </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {fmt(tr("tpl.shown"), {
                n: templates.length,
                m: total,
              })}
            </p>
            {templates.length < total && (
              <>
                <Button
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => {
                    if (loadingMore) return;
                    setLoadingMore(true);
                    const next = page + 1;
                    const params = buildParams(next, filter, debQuery, favs);
                    fetch(`/api/templates?${params.toString()}`)
                      .then((r) => r.json())
                      .then((d) => {
                        if (Array.isArray(d.templates)) {
                          setTemplates((prev) =>
                            mergeUnique(prev, d.templates as PromptTemplate[])
                          );
                          setPage(next);
                        }
                      })
                      .catch(() => {})
                      .finally(() => setLoadingMore(false));
                  }}
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {tr("tpl.loadMore")}
                </Button>
                <div ref={sentinelRef} aria-hidden className="h-1 w-1" />
              </>
            )}
          </div>
        </>
      )}

      {/* 预览弹窗 — 点图触发。固定高度(92vh),内部 prompt 区域单独滚动。 */}
      {preview && (() => {
        const pWh = (templateDims as Record<string, number[]>)[preview.id];
        return (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative flex h-[85vh] max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-card card-shadow sm:rounded-3xl md:h-[480px] md:max-h-[92vh] md:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 右上角:收藏 ♥ + 关闭 X 两个胶囊按钮一起 */}
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
              {(() => {
                const faved = favs.includes(preview.id);
                return (
                  <button
                    type="button"
                    onClick={() => toggleFav(preview.id)}
                    aria-label={faved ? tr("tpl.favRemove") : tr("tpl.favAdd")}
                    title={faved ? tr("tpl.favRemove") : tr("tpl.favAdd")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow transition-colors hover:bg-card"
                  >
                    <Heart
                      className={cn(
                        "h-4 w-4 transition-colors",
                        faved
                          ? "fill-rose-500 text-rose-500"
                          : "text-muted-foreground"
                      )}
                    />
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label={tr("tpl.previewClose")}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow transition-colors hover:bg-card hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 左:缩略图栏。固定填满列(object-cover 中心裁剪),手机端用 h-40 占顶部。
                modal 是 flex-row 时此列会被 stretch 到 480px 全高;image cover 自适应。 */}
            <div className="relative shrink-0 border-b border-border bg-secondary/40 md:w-72 md:border-b-0 md:border-r lg:w-80">
              <div
                className={cn(
                  "relative h-40 w-full bg-gradient-to-br md:h-full",
                  preview.gradient
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cdnUrl(preview.image)}
                  alt={preview.title}
                  className="block h-full w-full object-cover"
                />
              </div>
            </div>

            {/* 右:标题/作者/tag(固定顶) + 完整提示词(单独滚) + 操作按钮(固定底) */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="space-y-3 border-b border-border px-6 pb-4 pt-6 sm:px-8">
                <h2 className="pr-10 text-xl font-semibold leading-snug">
                  {scrub(preview.title)}
                </h2>
                {preview.industry && (
                  <p className="text-sm text-muted-foreground">
                    {tr("tpl.previewBy")} · {scrub(preview.industry)}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="shrink-0">
                    {catLabel(preview.category)}
                  </Badge>
                  {preview.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      #{te(`tplTag.${tag}`, tag)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {tr("tpl.previewPrompt")}
                </p>
                {/* 原文显示:保留换行/缩进/引号;只这块滚动,modal 整体不变高 */}
                <pre className="whitespace-pre-wrap break-words rounded-xl bg-secondary/60 p-4 font-sans text-sm leading-relaxed text-foreground">
                  {preview.prompt || tr("tpl.loading")}
                </pre>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/30 px-6 py-4 sm:flex-row sm:justify-end sm:px-8">
                <Button variant="outline" onClick={() => setPreview(null)}>
                  {tr("tpl.previewClose")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => copyPrompt(preview.id, preview.prompt)}
                >
                  {copiedId === preview.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      {tr("tpl.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      {tr("tpl.copy")}
                    </>
                  )}
                </Button>
                <Button asChild variant="gradient">
                  <Link
                    href={`/generate?template=${preview.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreview(null)}
                  >
                    {tr("tpl.makeSimilar")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 未登录点收藏时的轻量提示窗口 — z-[60] 比预览弹窗(z-50)更高 */}
      {loginPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={() => setLoginPrompt(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 card-shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
              <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
            </div>
            <h3 className="mt-4 text-center text-base font-semibold">
              登录后才能收藏模板
            </h3>
            <p className="mt-1.5 text-center text-sm text-muted-foreground">
              收藏会跟随你的账号在所有设备上同步。
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setLoginPrompt(false)}
              >
                取消
              </Button>
              <Button
                variant="gradient"
                className="flex-1"
                onClick={() => {
                  setLoginPrompt(false);
                  openAuth("sign-in");
                }}
              >
                去登录
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
