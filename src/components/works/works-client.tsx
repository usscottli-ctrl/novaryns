"use client";

import { cdnUrl } from "@/lib/cdn";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  CheckSquare,
  Check,
  Heart,
  Download,
  Plus,
  Trash2,
} from "lucide-react";
import { Media } from "@/components/media";
import { downloadImage } from "@/lib/download";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { WorkLightbox, type LightboxWork } from "@/components/works/work-lightbox";

// ---------------------------------------------------------------------------
// 作品库(设计 screen==='works',星泽商图.dc.html 1247–1328)。
// 数据源与首页一致:GET /api/account?email=... → artworks[]。
// 收藏 / 选中 / 删除 / 下载 / 搜索 当前均为本地态或占位,待接后端。
// ---------------------------------------------------------------------------

type Artwork = {
  id: string;
  image: string;
  title?: string;
  status?: string;
  gradient?: string;
  createdAt?: string;
  tool?: string;
  prompt?: string;
  cost?: number;
  category?: string;
};

// 作品按「功能」分组:category → 分组(key + 中文名)。
// 生图各子类(main/banner/scene/detail/sub/...)与套图(main/detail)合并为「AI 生图」。
const GROUP_LABEL: Record<string, string> = {
  image: "AI 生图",
  tryon: "服装上身",
  garment: "服装电商",
  dress3d: "3D 服装",
  upscale: "AI 变清晰",
  cutout: "AI 抠图",
  fusion: "AI 融图",
  variation: "图裂变",
  inpaint: "局部改图",
  printfile: "印刷图",
  dewrinkle: "智能去皱",
  dewatermark: "去水印",
  style: "风格迁移",
  avatar: "AI 头像",
  print: "印花提取",
  titles: "标题生成",
};
// tab 顺序(只渲染作品里实际出现的分组)。
const GROUP_ORDER = [
  "image", "tryon", "garment", "dress3d", "upscale", "cutout",
  "fusion", "variation", "inpaint", "printfile", "dewrinkle", "dewatermark",
  "style", "avatar", "print", "titles",
];
// category → 分组 key。已知工具直接映射,其余(生图子类等)归 image。
function groupOf(cat?: string): string {
  return cat && GROUP_LABEL[cat] ? cat : "image";
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString()
  );
}

export function WorksClient() {
  const { user, ready } = useAuth();
  const { toast } = useToast();

  const [works, setWorks] = useState<Artwork[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState(""); // TODO: 搜索暂不接逻辑,仅占位
  const [selecting, setSelecting] = useState(false);
  // MOCK: 收藏 / 选中均为本地 useState,待接后端持久化。
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<LightboxWork | null>(null);

  // 拉作品(与首页同源)。
  useEffect(() => {
    if (!user?.email) {
      setWorks(ready ? [] : null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        if (!r.ok || cancelled) {
          if (!cancelled) setWorks([]);
          return;
        }
        const d = await r.json();
        const arts = (d.artworks ?? []) as Artwork[];
        if (cancelled) return;
        setWorks(arts.filter((a) => a.image && a.status !== "failed"));
      } catch {
        if (!cancelled) setWorks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, ready]);

  // 加载收藏(持久化,跨设备/刷新保留):复用 /api/favorites,artwork id 当收藏 id 存。
  useEffect(() => {
    if (!user?.email) {
      setFavs(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/favorites", { headers: await authHeader() });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled && Array.isArray(d.favs)) setFavs(new Set(d.favs));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  // 按功能分组筛选 + 搜索(标题/提示词)。
  const filtered = useMemo(() => {
    if (!works) return [];
    let list = works;
    if (filter === "fav") list = list.filter((w) => favs.has(w.id));
    else if (filter !== "all")
      list = list.filter((w) => groupOf(w.category) === filter);
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((w) =>
        `${w.title ?? ""} ${w.prompt ?? ""}`.toLowerCase().includes(q)
      );
    return list;
  }, [works, filter, favs, query]);

  // 功能 tab:全部 + 已收藏 + 作品里实际出现的功能分组(按预定义顺序)。
  const tabs = useMemo(() => {
    const present = new Set((works ?? []).map((w) => groupOf(w.category)));
    return [
      { key: "all", label: "全部" },
      { key: "fav", label: "已收藏" },
      ...GROUP_ORDER.filter((k) => present.has(k)).map((k) => ({
        key: k,
        label: GROUP_LABEL[k],
      })),
    ];
  }, [works]);

  // 从功能页「在作品库查看全部 →」带来的 ?cat= 自动选中对应功能 tab。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = new URLSearchParams(window.location.search).get("cat");
    if (cat) setFilter(groupOf(cat));
  }, []);

  const todayWorks = useMemo(
    () => filtered.filter((w) => isToday(w.createdAt)),
    [filtered]
  );
  const earlierWorks = useMemo(
    () => filtered.filter((w) => !isToday(w.createdAt)),
    [filtered]
  );

  const toggleSelecting = () => {
    setSelecting((s) => !s);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFav = async (id: string) => {
    const isFav = favs.has(id);
    // 乐观更新,失败回滚。
    setFavs((s) => {
      const next = new Set(s);
      if (isFav) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      const h = await authHeader();
      if (isFav) {
        await fetch(`/api/favorites?templateId=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: h,
        });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: id }),
        });
      }
    } catch {
      setFavs((s) => {
        const next = new Set(s);
        if (isFav) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  };

  // 加入画布:把作品复制成画布节点(/api/artworks/add 的 src 分支,canvas-add 独立节点)。
  const addToCanvas = async (w: Artwork) => {
    if (!user?.email) return;
    try {
      const res = await fetch("/api/artworks/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          src: {
            image: w.image,
            title: w.title,
            prompt: w.prompt,
            category: w.category,
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast("已加入画布", "success");
    } catch {
      toast("加入画布失败,请重试", "error");
    }
  };

  // 删除单张(软删除,进回收站可恢复)。
  const deleteOne = async (id: string) => {
    if (!user?.email) return;
    try {
      const res = await fetch("/api/artworks/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, ids: [id] }),
      });
      if (!res.ok) throw new Error();
      setWorks((w) => (w ? w.filter((x) => x.id !== id) : w));
      setActive(null);
      toast("已删除", "success");
    } catch {
      toast("删除失败,请重试", "error");
    }
  };

  const selectAll = () => setSelected(new Set(filtered.map((w) => w.id)));

  const openWork = (w: Artwork) =>
    setActive({
      id: w.id,
      image: w.image,
      title: w.title,
      gradient: w.gradient,
      tool: w.tool,
      prompt: w.prompt,
      createdAt: w.createdAt,
      cost: w.cost,
    });

  const count = works?.length ?? 0;
  const loading = !ready || (!!user && works === null);
  const empty = ready && works !== null && filtered.length === 0;

  return (
    <div className="flex w-full flex-col gap-5 px-5 py-7 pb-24 sm:px-6 lg:px-8">
      {/* 头部 */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-c-text">
            作品库
          </h1>
          <p className="mt-1 text-[13.5px] text-c-text3">
            {count} 张作品 · 生成结果自动保留 180 天
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {/* 搜索框(占位,暂不接逻辑) */}
          <div className="flex h-9 items-center gap-1.5 rounded-field border border-c-border2 bg-c-card px-3">
            <Search size={14} className="text-c-text4" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)} // TODO: 搜索暂不接逻辑
              placeholder="搜索作品"
              className="w-[120px] bg-transparent text-[12.5px] text-c-text placeholder:text-c-text4 focus:outline-none"
            />
          </div>
          {/* 多选 toggle */}
          <button
            type="button"
            onClick={toggleSelecting}
            className="flex h-9 items-center gap-1.5 rounded-field border border-c-border2 bg-c-card px-3 text-[12.5px] text-c-text2 transition-colors hover:bg-c-subtle"
          >
            <CheckSquare size={14} strokeWidth={1.8} />
            {selecting ? "完成" : "多选"}
          </button>
        </div>
      </div>

      {/* 功能筛选 tab(active = accent 实心) */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-[10px] border px-4 py-2 text-[13px] font-medium transition-colors",
                on
                  ? "border-acc bg-acc text-white shadow-btn"
                  : "border-c-border2 bg-c-card text-c-text2 hover:bg-c-subtle"
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 加载骨架 */}
      {loading && (
        <div className="grid grid-cols-5 gap-3.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-[13px]" />
          ))}
        </div>
      )}

      {/* 空态 */}
      {empty && (
        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-c-text3">还没有作品,去创作第一张吧</p>
          <Link
            href="/generate"
            className="rounded-[11px] px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-btn [background:var(--grad-acc)] transition-all hover:brightness-95"
          >
            开始创作
          </Link>
        </div>
      )}

      {/* 分组网格 */}
      {!loading && !empty && (
        <>
          {todayWorks.length > 0 && (
            <WorkGroup
              title="今天"
              works={todayWorks}
              selecting={selecting}
              favs={favs}
              selected={selected}
              onOpen={openWork}
              onToggleSelect={toggleSelect}
              onToggleFav={toggleFav}
              onToast={toast}
              onAddCanvas={addToCanvas}
            />
          )}
          {earlierWorks.length > 0 && (
            <WorkGroup
              title="本周更早"
              works={earlierWorks}
              selecting={selecting}
              favs={favs}
              selected={selected}
              onOpen={openWork}
              onToggleSelect={toggleSelect}
              onToggleFav={toggleFav}
              onToast={toast}
              onAddCanvas={addToCanvas}
            />
          )}
        </>
      )}

      {/* 浮动批量操作条 */}
      {selecting && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-1.5 rounded-[14px] border border-c-border bg-c-card py-2 pl-4 pr-2.5 shadow-pop">
          <span className="whitespace-nowrap text-[13px] font-semibold text-c-text">
            已选 {selected.size} 项
          </span>
          <button
            type="button"
            onClick={selectAll}
            className="whitespace-nowrap rounded-[8px] bg-acc-tint px-2.5 py-[7px] text-[12.5px] font-semibold text-acc"
          >
            全选
          </button>
          <span className="mx-0.5 h-[22px] w-px bg-c-line" />
          <button
            type="button"
            onClick={async () => {
              const items = filtered
                .filter((w) => selected.has(w.id))
                .map((w, i) => ({ url: w.image, name: w.title || `作品-${i + 1}` }));
              if (!items.length) return;
              try {
                const res = await fetch("/api/suite/download", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ items }),
                });
                if (!res.ok) throw new Error("zip failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `星泽商图-作品-${Date.now()}.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch {
                // 打包失败 → 退化为逐张下载
                items.forEach((it, i) =>
                  setTimeout(() => downloadImage(it.url, it.name), i * 350)
                );
              }
            }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 py-[7px] text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle"
          >
            <Download size={15} strokeWidth={1.8} />
            下载
          </button>
          <button
            type="button"
            onClick={async () => {
              const ids = Array.from(selected);
              const h = await authHeader();
              setFavs((s) => {
                const next = new Set(s);
                ids.forEach((id) => next.add(id));
                return next;
              });
              await Promise.all(
                ids.map((id) =>
                  fetch("/api/favorites", {
                    method: "POST",
                    headers: { ...h, "Content-Type": "application/json" },
                    body: JSON.stringify({ templateId: id }),
                  }).catch(() => {})
                )
              );
              toast(`已收藏 ${ids.length} 张`, "success");
            }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 py-[7px] text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle"
          >
            <Heart size={15} strokeWidth={1.8} />
            收藏
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!user?.email) return;
              const ids = Array.from(selected);
              try {
                const res = await fetch("/api/artworks/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: user.email, ids }),
                });
                if (!res.ok) throw new Error("delete failed");
                setWorks((w) => (w ? w.filter((x) => !selected.has(x.id)) : w));
                setSelected(new Set());
                toast(`已删除 ${ids.length} 张`, "success");
              } catch {
                toast("删除失败,请重试", "error");
              }
            }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 py-[7px] text-[12.5px] font-medium text-c-danger transition-colors hover:bg-c-tint-r"
          >
            <Trash2 size={15} strokeWidth={1.8} />
            删除
          </button>
          <span className="mx-0.5 h-[22px] w-px bg-c-line" />
          <button
            type="button"
            onClick={toggleSelecting}
            className="whitespace-nowrap rounded-[8px] px-2.5 py-[7px] text-[12.5px] font-medium text-c-text3 transition-colors hover:bg-c-subtle"
          >
            取消
          </button>
        </div>
      )}

      {/* 详情灯箱 */}
      <WorkLightbox
        work={active}
        fav={active ? favs.has(active.id) : false}
        onToggleFav={toggleFav}
        onDelete={deleteOne}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

// ── 分组 ──────────────────────────────────────────────────────────────────
function WorkGroup({
  title,
  works,
  selecting,
  favs,
  selected,
  onOpen,
  onToggleSelect,
  onToggleFav,
  onToast,
  onAddCanvas,
}: {
  title: string;
  works: Artwork[];
  selecting: boolean;
  favs: Set<string>;
  selected: Set<string>;
  onOpen: (w: Artwork) => void;
  onToggleSelect: (id: string) => void;
  onToggleFav: (id: string) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  onAddCanvas: (w: Artwork) => void;
}) {
  return (
    <div>
      <div className="mb-3 text-[12.5px] font-semibold text-c-text3">{title}</div>
      <div className="grid grid-cols-5 gap-3.5">
        {works.map((w) => (
          <WorkTile
            key={w.id}
            work={w}
            selecting={selecting}
            fav={favs.has(w.id)}
            sel={selected.has(w.id)}
            onOpen={onOpen}
            onToggleSelect={onToggleSelect}
            onToggleFav={onToggleFav}
            onToast={onToast}
            onAddCanvas={onAddCanvas}
          />
        ))}
      </div>
    </div>
  );
}

// ── 单张作品 tile ───────────────────────────────────────────────────────────
function WorkTile({
  work,
  selecting,
  fav,
  sel,
  onOpen,
  onToggleSelect,
  onToggleFav,
  onToast,
  onAddCanvas,
}: {
  work: Artwork;
  selecting: boolean;
  fav: boolean;
  sel: boolean;
  onOpen: (w: Artwork) => void;
  onToggleSelect: (id: string) => void;
  onToggleFav: (id: string) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  onAddCanvas: (w: Artwork) => void;
}) {
  const tool = work.tool || GROUP_LABEL[groupOf(work.category)] || "AI 生图";
  const time = relTime(work.createdAt);

  const onClick = () => {
    if (selecting) onToggleSelect(work.id);
    else onOpen(work);
  };

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group relative aspect-square cursor-pointer overflow-hidden rounded-[13px] outline-none",
        sel && "ring-2 ring-acc ring-offset-2 ring-offset-c-bg"
      )}
    >
      <Media
        src={cdnUrl(work.image)}
        alt={work.title || tool}
        gradient={work.gradient}
        thumbWidth={480}
        ratio="aspect-square"
        className="h-full w-full rounded-none border-0"
        overlay={false}
      />

      {/* 多选模式左上 check 圈 */}
      {selecting && (
        <span
          className={cn(
            "absolute left-2 top-2 z-[6] grid h-[22px] w-[22px] place-items-center rounded-full border-2 shadow-[0_2px_6px_-1px_rgba(16,18,23,.25)]",
            sel
              ? "border-acc bg-acc"
              : "border-white bg-[rgba(255,255,255,.6)]"
          )}
        >
          {sel && <Check size={12} strokeWidth={3} className="text-white" />}
        </span>
      )}

      {/* 收藏 heart 角标(非多选时显示) */}
      {fav && !selecting && (
        <span className="absolute right-2 top-2 z-[5] grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(255,255,255,.85)] shadow-[0_2px_6px_-1px_rgba(16,18,23,.2)] backdrop-blur-[4px]">
          <Heart size={12} className="fill-c-danger text-c-danger" strokeWidth={1.5} />
        </span>
      )}

      {/* 底部渐变 caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[rgba(22,24,29,.5)] to-transparent px-2.5 py-2">
        <span className="text-[10px] font-semibold text-white">{tool}</span>
        {time && (
          <span className="text-[10px] text-[rgba(255,255,255,.8)]">{time}</span>
        )}
      </div>

      {/* hover overlay(下载 / 收藏 / 加入) */}
      {!selecting && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[rgba(22,24,29,.34)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            aria-label="下载"
            onClick={(e) => {
              e.stopPropagation();
              downloadImage(work.image, work.title || tool);
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(255,255,255,.9)] text-c-text transition-transform hover:scale-105"
          >
            <Download size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="收藏"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFav(work.id);
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(255,255,255,.9)] text-c-text transition-transform hover:scale-105"
          >
            <Heart
              size={15}
              strokeWidth={1.8}
              className={fav ? "fill-c-danger text-c-danger" : ""}
            />
          </button>
          <button
            type="button"
            aria-label="加入画布"
            onClick={(e) => {
              e.stopPropagation();
              onAddCanvas(work);
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(255,255,255,.9)] text-c-text transition-transform hover:scale-105"
          >
            <Plus size={15} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
}
