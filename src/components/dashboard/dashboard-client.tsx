"use client";

import { cdnUrl } from "@/lib/cdn";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthModal } from "@/lib/auth-modal-context";
import {
  Download,
  Plus,
  Sparkles,
  ImageIcon,
  LibraryBig,
  CheckCircle2,
  X,
  Loader2,
  ChevronDown,
  Scissors,
  Blend,
  Copy,
  ImageUp,
  SquarePen,
  Stamp,
  Smile,
  Palette,
  Shirt,
  Printer,
  PersonStanding,
  Box,
  Wind,
} from "lucide-react";
import {
  ARTWORKS,
  CATEGORY_LABELS,
  type Artwork,
} from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { authHeader } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Media } from "@/components/media";
import { downloadImage } from "@/lib/download";
import { useI18n } from "@/lib/i18n/locale-context";
import { formatDate, cn } from "@/lib/utils";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

// Carry the artwork's prompt + category + result image into /generate so the
// user can iterate (edit prompt, regenerate on top of the previous image).
function regenHref(a: Artwork): string {
  const q = new URLSearchParams();
  q.set("prompt", a.prompt);
  q.set("category", a.category);
  if (a.style) q.set("style", a.style);
  if (a.ratio) q.set("ratio", a.ratio);
  if (a.resolution) q.set("resolution", a.resolution);
  if (a.source && /^https?:\/\//.test(a.source)) q.set("src", a.source);
  if (a.status === "completed" && /^https?:\/\//.test(a.image)) {
    q.set("gen", a.image);
  }
  // 血缘:把这张作品的 id 作为父节点带过去,新生成的图会记 parent_id=它
  q.set("from", a.id);
  return `/generate?${q.toString()}`;
}

// 抠图(透明底)是工具型产物,不混进成片列表。category="cutout" 是新数据的标记;
// prompt 兜底是为了把改造前已存的老抠图也一并归到「抠图」分类。
const isCutout = (a: Artwork) =>
  a.category === "cutout" || a.prompt === "抠图 / 透明底";
// 融图(多图合成)产物,同样单独成板块。
const isFusion = (a: Artwork) => a.category === "fusion";
// 图裂变(单图出多变体)产物,同样单独成板块。
const isVariation = (a: Artwork) => a.category === "variation";
// AI 变清晰(超分)产物,同样单独成板块。
const isUpscale = (a: Artwork) => a.category === "upscale";
// 局部改图(涂抹重绘)产物,同样单独成板块。
const isInpaint = (a: Artwork) => a.category === "inpaint";
// 印花提取产物,同样单独成板块。
const isPrint = (a: Artwork) => a.category === "print";
// 抠头像产物,同样单独成板块。
const isAvatar = (a: Artwork) => a.category === "avatar";
// 风格转换产物,同样单独成板块。
const isStyle = (a: Artwork) => a.category === "style";
// 服装提取产物,同样单独成板块。
const isGarment = (a: Artwork) => a.category === "garment";
// 印刷图产物,同样单独成板块。
const isPrintfile = (a: Artwork) => a.category === "printfile";
// 服装上身产物,同样单独成板块。
const isTryon = (a: Artwork) => a.category === "tryon";
// 3D 服装图产物,同样单独成板块。
const isDress3d = (a: Artwork) => a.category === "dress3d";
// 服装去皱产物,同样单独成板块。
const isDewrinkle = (a: Artwork) => a.category === "dewrinkle";

// 点作品进对应功能板块,而不是一律进生图页:抠图→/cutout、融图→/fuse、图裂变→/variations、变清晰→/upscale、其余→生图(可迭代)。
// 工具页带 ?view=<图> 进去,直接展示这张作品的结果(否则只是个空工具页)。
function isCanvasOrigin(a: Artwork): boolean {
  return (
    a.origin === "canvas" ||
    (!!a.source && ["canvas-add", "derived", "upload"].includes(a.source))
  );
}

function workHref(a: Artwork): string {
  const view =
    a.image && /^https?:\/\//.test(a.image)
      ? `?view=${encodeURIComponent(a.image)}`
      : "";
  // 画布里产出的作品 → 在画布打开(option A:画布只管画布、生图只管生图)
  if (isCanvasOrigin(a)) return `/canvas?node=${encodeURIComponent(a.id)}`;
  if (isCutout(a)) return `/cutout${view}`;
  if (isFusion(a)) return `/fuse${view}`;
  if (isVariation(a)) return `/variations${view}`;
  if (isUpscale(a)) return `/upscale`;
  if (isInpaint(a)) return `/inpaint`;
  if (isPrint(a)) return `/extract`;
  if (isAvatar(a)) return `/avatar`;
  if (isStyle(a)) return `/style`;
  if (isGarment(a)) return `/garment`;
  if (isPrintfile(a)) return `/printfile`;
  if (isTryon(a)) return `/tryon`;
  if (isDress3d(a)) return `/garment3d`;
  if (isDewrinkle(a)) return `/dewrinkle`;
  return regenHref(a);
}

const STATUS_CLS: Record<Artwork["status"], string> = {
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  processing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
};
const STATUS_KEY: Record<Artwork["status"], string> = {
  completed: "dash.statusCompleted",
  processing: "dash.statusProcessing",
  failed: "dash.statusFailed",
};

type SuiteRole = "main" | "sub" | "detail";
const ROLE_ORDER: Record<SuiteRole, number> = { main: 0, sub: 1, detail: 2 };

// 末尾序号:套图每张 id = `suite-<ts>-<i>`,i 是该张在规划里的次序(主图0,副图1-4,详情5-12)。
function tailIndex(id: string): number {
  return Number(id.match(/-(\d+)$/)?.[1] ?? -1);
}

// 判定套图某张是主图/副图/详情:优先用归档时存进 source 的 role;
// 老数据兜底——category 已标 detail,其余按 id 末尾序号,再不行看标题。
function suiteRole(a: Artwork): SuiteRole {
  const r = a.source;
  if (r === "main" || r === "sub" || r === "detail") return r;
  if (a.category === "detail") return "detail";
  const idx = tailIndex(a.id);
  if (idx === 0) return "main";
  if (idx >= 1 && idx <= 4) return "sub";
  if (idx >= 5) return "detail";
  return a.title.includes("主图") ? "main" : "sub";
}

// 真实电商套图的标准叙事顺序(按标题关键词归类)。副图/详情各张排序优先按这个,
// 命中不了的(LLM 自定义标签)排到已知项之后,再按生成次序兜底。
const SUITE_ORDER: Record<SuiteRole, string[][]> = {
  main: [],
  sub: [["成分"], ["卖点", "功能"], ["场景", "使用"], ["信任", "背书"]],
  detail: [
    ["品牌", "主视觉", "首屏"],
    ["核心", "卖点"],
    ["成分", "溯源"],
    ["工艺", "品质"],
    ["食用", "冲泡", "用法", "方法"],
    ["适用", "人群"],
    ["规格", "包装", "参数"],
    ["信任", "售后", "保障"],
  ],
};
function standardRank(a: Artwork, role: SuiteRole): number {
  const groups = SUITE_ORDER[role];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].some((k) => a.title.includes(k))) return i;
  }
  return 99;
}

type WorkGroup =
  | { kind: "single"; art: Artwork }
  | { kind: "batch"; batchId: string; items: Artwork[] };

export function DashboardClient() {
  const { user, ready, remaining, persistMode } = useAuth();
  const { t, te } = useI18n();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const [filter, setFilter] = useState<
    | "all"
    | Artwork["status"]
    | "cutout"
    | "fusion"
    | "variation"
    | "upscale"
    | "inpaint"
    | "print"
    | "avatar"
    | "style"
    | "garment"
    | "printfile"
    | "tryon"
    | "dress3d"
    | "dewrinkle"
  >("all");
  const [remoteWorks, setRemoteWorks] = useState<Artwork[] | null>(null);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    if (ready && !user) openAuth("sign-in");
  }, [ready, user, router]);

  // 各工具页「我的作品」按钮带 ?cat=cutout / ?cat=fusion 跳来时,直接打开对应筛选标签。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = new URLSearchParams(window.location.search).get("cat");
    if (
      cat === "cutout" ||
      cat === "fusion" ||
      cat === "variation" ||
      cat === "upscale" ||
      cat === "inpaint" ||
      cat === "print" ||
      cat === "avatar" ||
      cat === "style" ||
      cat === "garment" ||
      cat === "printfile" ||
      cat === "tryon" ||
      cat === "dress3d" ||
      cat === "dewrinkle"
    )
      setFilter(cat);
  }, []);

  // One-time post-registration toast. AuthPanel sets this flag right before
  // redirecting here after a successful sign-up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("novaryns_welcome") !== "1") return;
    sessionStorage.removeItem("novaryns_welcome");
    setWelcome(true);
    const id = setTimeout(() => setWelcome(false), 5000);
    return () => clearTimeout(id);
  }, []);

  // In server mode, load this user's real generation history from the DB.
  useEffect(() => {
    if (!ready || !user || persistMode !== "server") return;
    let cancelled = false;
    (async () =>
      fetch(`/api/account?email=${encodeURIComponent(user.email)}`, {
        headers: await authHeader(),
      }))()
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.persisted) return;
        setRemoteWorks((d.artworks ?? []) as Artwork[]);
      })
      .catch(() => {
        /* keep mock samples on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user, persistMode]);

  // After auth is ready, persistMode is final. In server mode show a skeleton
  // until the real list arrives (no mock flash); only fall back to ARTWORKS
  // in pure mock/local mode.
  const loadingWorks = persistMode === "server" && remoteWorks === null;
  const source =
    persistMode === "server" ? (remoteWorks ?? []) : ARTWORKS;

  const works = useMemo(() => {
    if (filter === "cutout") return source.filter(isCutout);
    if (filter === "fusion") return source.filter(isFusion);
    if (filter === "variation") return source.filter(isVariation);
    if (filter === "upscale") return source.filter(isUpscale);
    if (filter === "inpaint") return source.filter(isInpaint);
    if (filter === "print") return source.filter(isPrint);
    if (filter === "avatar") return source.filter(isAvatar);
    if (filter === "style") return source.filter(isStyle);
    if (filter === "garment") return source.filter(isGarment);
    if (filter === "printfile") return source.filter(isPrintfile);
    if (filter === "tryon") return source.filter(isTryon);
    if (filter === "dress3d") return source.filter(isDress3d);
    if (filter === "dewrinkle") return source.filter(isDewrinkle);
    // 全部 = 所有类型(生图/套图/抠图/融图)都显示;状态标签按状态筛。
    // 抠图/融图各有独立标签做窄筛,但在「全部」里也能看到(靠卡片角标区分类型)。
    return source.filter((a) => filter === "all" || a.status === filter);
  }, [source, filter]);

  // 把同一次一键套图(共用 batchId)的多张聚成一个批次卡;其余作品各自单卡。
  // works 已按 createdAt DESC 排序,同批次连续,用 Map 保持首次出现顺序。
  const groups = useMemo<WorkGroup[]>(() => {
    const out: WorkGroup[] = [];
    const at = new Map<string, number>();
    for (const a of works) {
      if (a.batchId) {
        const i = at.get(a.batchId);
        if (i === undefined) {
          at.set(a.batchId, out.length);
          out.push({ kind: "batch", batchId: a.batchId, items: [a] });
        } else {
          (out[i] as Extract<WorkGroup, { kind: "batch" }>).items.push(a);
        }
      } else {
        out.push({ kind: "single", art: a });
      }
    }
    return out;
  }, [works]);

  if (!ready || !user) {
    return (
      <div className="container py-20 text-sm text-muted-foreground">
        {t("dash.loading")}
      </div>
    );
  }


  const stats = [
    {
      icon: Sparkles,
      label: t("dash.statUsed"),
      value: user.creditsUsed,
    },
    {
      icon: ImageIcon,
      label: t("dash.statRemaining"),
      value: remaining,
    },
    {
      icon: LibraryBig,
      label: t("dash.statWorks"),
      value: loadingWorks ? "—" : source.length,
    },
  ];

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:h-dvh lg:overflow-y-auto lg:px-8 lg:py-6">
      {welcome && (
        <div className="fixed inset-x-0 top-20 z-50 flex justify-center px-4">
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-card px-4 py-3 card-shadow"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <span className="text-sm font-medium text-foreground">
              {t("dash.welcome")}
            </span>
            <button
              type="button"
              onClick={() => setWelcome(false)}
              aria-label="关闭"
              className="ml-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">{t("dash.title")}</h1>
          <p className="flex items-center text-muted-foreground">{user.name}</p>
        </div>
        <Button asChild variant="gradient">
          <Link href="/generate">
            <Plus className="h-4 w-4" />
            {t("dash.newGen")}
          </Link>
        </Button>
      </div>

      {/* Stats + credits */}
      <div className="mb-8 grid gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-border bg-card p-5 card-shadow"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/12 to-accent/12 text-primary">
              <s.icon className="h-4 w-4" />
            </span>
            <p className="mt-3 text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
        <Link
          href="/account?tab=credits"
          className="flex flex-col rounded-2xl border border-border bg-card p-5 card-shadow transition-colors hover:border-primary/40"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/12 to-accent/12 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <p className="mt-3 text-sm font-semibold">{t("credits.title")}</p>
          <p className="text-xs text-muted-foreground">{t("acct.tabDetail")} →</p>
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(["all", "completed", "processing", "failed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              filter === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            {s === "all" ? t("dash.all") : t(STATUS_KEY[s])}
          </button>
        ))}
        {/* 工具型产物(抠图 / 融图)各自独立板块,与状态筛选分开 */}
        <span className="mx-0.5 self-stretch w-px bg-border" />
        <button
          onClick={() => setFilter("cutout")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "cutout"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.cutout", CATEGORY_LABELS.cutout)}
        </button>
        <button
          onClick={() => setFilter("fusion")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "fusion"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.fusion", CATEGORY_LABELS.fusion)}
        </button>
        <button
          onClick={() => setFilter("variation")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "variation"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.variation", CATEGORY_LABELS.variation)}
        </button>
        <button
          onClick={() => setFilter("upscale")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "upscale"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.upscale", CATEGORY_LABELS.upscale)}
        </button>
        <button
          onClick={() => setFilter("inpaint")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "inpaint"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.inpaint", CATEGORY_LABELS.inpaint)}
        </button>
        <button
          onClick={() => setFilter("print")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "print"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.print", CATEGORY_LABELS.print)}
        </button>
        <button
          onClick={() => setFilter("avatar")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "avatar"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.avatar", CATEGORY_LABELS.avatar)}
        </button>
        <button
          onClick={() => setFilter("style")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "style"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.style", CATEGORY_LABELS.style)}
        </button>
        <button
          onClick={() => setFilter("garment")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "garment"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.garment", CATEGORY_LABELS.garment)}
        </button>
        <button
          onClick={() => setFilter("printfile")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "printfile"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.printfile", CATEGORY_LABELS.printfile)}
        </button>
        <button
          onClick={() => setFilter("tryon")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "tryon"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.tryon", CATEGORY_LABELS.tryon)}
        </button>
        <button
          onClick={() => setFilter("dress3d")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "dress3d"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.dress3d", CATEGORY_LABELS.dress3d)}
        </button>
        <button
          onClick={() => setFilter("dewrinkle")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            filter === "dewrinkle"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
        >
          {te("genCat.dewrinkle", CATEGORY_LABELS.dewrinkle)}
        </button>
      </div>

      {loadingWorks ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="aspect-[4/3] animate-pulse bg-secondary" />
              <div className="space-y-2 p-5">
                <div className="h-4 w-20 animate-pulse rounded bg-secondary" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : works.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-20 text-center card-shadow">
          <p className="text-sm text-muted-foreground">{t("dash.emptyWorks")}</p>
          <Button asChild variant="gradient" className="mt-4">
            <Link href="/generate">{t("dash.goGenerate")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {groups.map((g) =>
            g.kind === "batch" && g.items.length > 1 ? (
              <SuiteBatchCard key={g.batchId} items={g.items} />
            ) : (
              <SingleCard
                key={g.kind === "batch" ? g.items[0].id : g.art.id}
                a={g.kind === "batch" ? g.items[0] : g.art}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// 普通单张作品卡(原来的卡片,抽成组件供分组渲染复用)。
function SingleCard({ a }: { a: Artwork }) {
  const { t, te, locale } = useI18n();
  // 点作品进对应功能板块:抠图/融图各自的工具页,其余进生图迭代。
  const href = workHref(a);
  const isTool =
    isCanvasOrigin(a) ||
    isCutout(a) ||
    isFusion(a) ||
    isVariation(a) ||
    isUpscale(a) ||
    isInpaint(a) ||
    isPrint(a) ||
    isAvatar(a) ||
    isStyle(a) ||
    isGarment(a) ||
    isPrintfile(a) ||
    isTryon(a) ||
    isDress3d(a) ||
    isDewrinkle(a);
  const openLabel = isCanvasOrigin(a)
    ? locale === "en"
      ? "Open in canvas"
      : "在画布打开"
    : isCutout(a)
    ? locale === "en"
      ? "Open cutout"
      : "去抠图"
    : isFusion(a)
      ? locale === "en"
        ? "Open fusion"
        : "去融图"
      : isVariation(a)
        ? locale === "en"
          ? "Open variations"
          : "去裂变"
        : isUpscale(a)
          ? locale === "en"
            ? "Open upscale"
            : "去变清晰"
          : isInpaint(a)
            ? locale === "en"
              ? "Open inpaint"
              : "去改图"
            : isPrint(a)
              ? locale === "en"
                ? "Open extract"
                : "去提取"
              : isAvatar(a)
                ? locale === "en"
                  ? "Open avatar"
                  : "去抠头像"
                : isStyle(a)
                  ? locale === "en"
                    ? "Open style"
                    : "去转换"
                  : isGarment(a)
                    ? locale === "en"
                      ? "Open garment"
                      : "去提取"
                    : isPrintfile(a)
                      ? locale === "en"
                        ? "Open print"
                        : "去生成"
                      : isTryon(a)
                        ? locale === "en"
                          ? "Open try-on"
                          : "去试穿"
                        : isDress3d(a)
                          ? locale === "en"
                            ? "Open 3D"
                            : "去生成"
                          : isDewrinkle(a)
                            ? locale === "en"
                              ? "Open de-wrinkle"
                              : "去去皱"
                            : t("dash.regen");
  // 功能类型角标:一眼区分这张作品是哪个工具做的。
  const toolBadge = isCutout(a)
    ? { label: locale === "en" ? "Cutout" : "抠图", Icon: Scissors }
    : isFusion(a)
      ? { label: locale === "en" ? "Fusion" : "融图", Icon: Blend }
      : isVariation(a)
        ? { label: locale === "en" ? "Variations" : "图裂变", Icon: Copy }
        : isUpscale(a)
          ? { label: locale === "en" ? "Upscale" : "变清晰", Icon: ImageUp }
          : isInpaint(a)
            ? { label: locale === "en" ? "Inpaint" : "局部改图", Icon: SquarePen }
            : isPrint(a)
              ? { label: locale === "en" ? "Print" : "印花提取", Icon: Stamp }
              : isAvatar(a)
                ? { label: locale === "en" ? "Avatar" : "抠头像", Icon: Smile }
                : isStyle(a)
                  ? { label: locale === "en" ? "Style" : "风格", Icon: Palette }
                  : isGarment(a)
                    ? { label: locale === "en" ? "Garment" : "服装提取", Icon: Shirt }
                    : isPrintfile(a)
                      ? { label: locale === "en" ? "Print" : "印刷图", Icon: Printer }
                      : isTryon(a)
                        ? { label: locale === "en" ? "Try-on" : "服装上身", Icon: PersonStanding }
                        : isDress3d(a)
                          ? { label: locale === "en" ? "3D" : "3D服装", Icon: Box }
                          : isDewrinkle(a)
                            ? { label: locale === "en" ? "De-wrinkle" : "去皱", Icon: Wind }
                            : { label: locale === "en" ? "Generate" : "生图", Icon: Sparkles };
  return (
    <div className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-1 hover:card-shadow">
      <div className="relative">
        {a.status === "completed" ? (
          <Link href={href} className="group/img block" title={openLabel}>
            <Media
              src={cdnUrl(a.image)}
              alt={a.title}
              gradient={a.gradient}
              thumbWidth={640}
              ratio="aspect-[4/3]"
              className="rounded-none border-0"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-sm font-medium text-transparent transition-all group-hover/img:bg-slate-900/35 group-hover/img:text-white">
              {openLabel}
            </span>
          </Link>
        ) : (
          <Media
            src={cdnUrl(a.image)}
            alt={a.title}
            gradient={a.gradient}
            thumbWidth={640}
            ratio="aspect-[4/3]"
            className="rounded-none border-0"
          />
        )}
        <span
          className={cn(
            "absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATUS_CLS[a.status]
          )}
        >
          {t(STATUS_KEY[a.status])}
        </span>
        {/* 功能类型角标(右上):生图 / 抠图 / 融图 */}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <toolBadge.Icon className="h-3 w-3" />
          {toolBadge.label}
        </span>
      </div>
      <div className="space-y-2 p-5">
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {te(`genCat.${a.category}`, CATEGORY_LABELS[a.category])}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDate(a.createdAt)}
          </span>
        </div>
        <h3 className="font-semibold">{a.title}</h3>
        <p className="line-clamp-2 text-sm text-muted-foreground">{a.prompt}</p>
        <div className="flex gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={a.status !== "completed"}
            onClick={() => downloadImage(a.image, `novaryns-${a.id}`)}
          >
            <Download className="h-3.5 w-3.5" />
            {t("dash.export")}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>{isTool ? openLabel : t("dash.regenerate")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// 一键套图批次卡:同一次生成的全部图片 + 提示词聚合,支持整批一键下载 ZIP。
// 横跨整行(sm:col-span-2 lg:col-span-3)。
function SuiteBatchCard({ items }: { items: Artwork[] }) {
  const { t } = useI18n();
  const [showPrompts, setShowPrompts] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 按 主图 → 副图 → 详情页 排序;同类内按电商标准叙事顺序,命中不了再按生成次序。
  const ordered = [...items].sort((x, y) => {
    const rx = suiteRole(x);
    const ry = suiteRole(y);
    const dRole = ROLE_ORDER[rx] - ROLE_ORDER[ry];
    if (dRole !== 0) return dRole;
    const dStd = standardRank(x, rx) - standardRank(y, ry);
    if (dStd !== 0) return dStd;
    return tailIndex(x.id) - tailIndex(y.id);
  });

  // 给每个角色内的图编号(主图1 / 副图1,2… / 详情页1,2…),按排好的顺序连续编。
  const seqOf = new Map<string, number>();
  const counters: Record<SuiteRole, number> = { main: 0, sub: 0, detail: 0 };
  for (const it of ordered) {
    const r = suiteRole(it);
    counters[r] += 1;
    seqOf.set(it.id, counters[r]);
  }

  const roleZh = (a: Artwork): string => {
    const r = suiteRole(a);
    return t(r === "main" ? "dash.roleMain" : r === "sub" ? "dash.roleSub" : "dash.roleDetail");
  };
  // 左下角名字:套图 · 主图1/副图2/详情页3 · 原始小标题(去掉重复的"套图·"前缀)
  const labelOf = (a: Artwork): string => {
    const desc = a.title.replace(/^套图[·\s]*/, "");
    return `${t("dash.suiteBatch")}·${roleZh(a)}${seqOf.get(a.id) ?? ""}·${desc}`;
  };

  const completed = ordered.filter(
    (it) => it.status === "completed" && /^https?:\/\//.test(it.image)
  );

  async function downloadAll() {
    if (downloading || completed.length === 0) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/suite/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: completed.map((it) => ({ url: it.image, name: it.title })),
        }),
      });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `suite-${items[0]?.batchId ?? "batch"}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* swallow; user can retry */
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="sm:col-span-2 lg:col-span-3 overflow-hidden rounded-2xl border border-border bg-card card-shadow">
      {/* 头部:套图标识 + 张数 + 时间 + 一键下载 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-primary/5 to-accent/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary">
            <LibraryBig className="h-4 w-4" />
          </span>
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              {t("dash.suiteBatch")}
              <Badge variant="outline">
                {fmt(t("dash.suiteBatchCount"), { n: items.length })}
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              {formatDate(items[0].createdAt)}
            </p>
          </div>
        </div>
        <Button
          variant="gradient"
          size="sm"
          onClick={downloadAll}
          disabled={downloading || completed.length === 0}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {downloading ? t("dash.downloading") : t("dash.downloadAll")}
        </Button>
      </div>

      {/* 全部图片缩略图网格(主图→副图→详情页) */}
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {ordered.map((it) => (
          <div
            key={it.id}
            className="group/thumb relative overflow-hidden rounded-xl border border-border"
          >
            <Link href={regenHref(it)} title={t("dash.regen")}>
              <Media
                src={cdnUrl(it.image)}
                alt={it.title}
                gradient={it.gradient}
                thumbWidth={480}
                ratio="aspect-square"
                className="rounded-none border-0"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-slate-900/70 to-transparent px-2 py-1 text-[11px] font-medium text-white">
                {labelOf(it)}
              </span>
            </Link>
            {it.status === "completed" && (
              <button
                type="button"
                onClick={() => downloadImage(it.image, `novaryns-${it.id}`)}
                title={t("dash.export")}
                className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-card/85 text-foreground opacity-0 shadow transition-opacity hover:bg-card group-hover/thumb:opacity-100"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 提示词:默认收起,点开看每张的标题 + 完整提示词 */}
      <div className="border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={() => setShowPrompts((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              showPrompts && "rotate-180"
            )}
          />
          {showPrompts ? t("dash.hidePrompts") : t("dash.viewPrompts")}
        </button>
        {showPrompts && (
          <ul className="mt-3 space-y-3">
            {ordered.map((it) => (
              <li key={it.id} className="text-sm">
                <span className="font-medium">{labelOf(it)}</span>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                  {it.prompt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
