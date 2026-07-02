"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  getBezierPath,
  type NodeProps,
  type EdgeProps,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  X,
  Pencil,
  MoreHorizontal,
  Loader2,
  Sparkles,
  Download,
  Trash2,
  Upload,
  RotateCcw,
  Scissors,
  Sun,
  Type,
  Rotate3d,
  Wand2,
  Image as ImageIcon,
  ChevronDown,
  Home,
  LayoutGrid,
  Plus,
  Maximize,
  ChevronLeft,
  Map as MapIcon,
  Magnet,
  Link2,
  Clock,
  Keyboard,
  HelpCircle,
  ShoppingBag,
  Crown,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { authHeader } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cdnUrl } from "@/lib/cdn";
import { ImageLightbox } from "@/components/image-lightbox";
import { BRAND, BRAND_CANVAS_LOGO } from "@/lib/brand";
import { TemplatesClient } from "@/components/templates/templates-client";
import { CreditPacks } from "@/components/credits/credit-packs";
import { PayQrModal } from "@/components/credits/pay-qr-modal";
import { AccountClient } from "@/components/account/account-client";
import { SecurityClient } from "@/components/account/security-client";
import { GenerateClient } from "@/components/generate/generate-client";
import { CheckoutClient } from "@/components/checkout/checkout-client";
import { cn, formatDate } from "@/lib/utils";
import {
  type Artwork,
  GENERATION_STYLES,
  resolutionCost,
} from "@/lib/mock-data";

// 横向链路布局(对齐原型 node-canvas-preview):深度→x 向右展开,同层兄弟→y 竖排。
// 尺寸对齐定稿原型 fullsite-preview.html#canvas:NWID=170、PY=78、图片高 110
const NODE_W = 170; // 节点宽(原型 .cnode width:170)
const NODE_H = 132; // 节点总高:标签行(~22)+ 图片卡(110)(用于 dock/工具条定位)
const PORT_Y = 78; // 端口/连线锚点相对节点顶部(原型 .port top:78)
const X_GAP = 90; // 层间横向间距
const Y_GAP = 48; // 同层兄弟纵向间距
const MAX_TOTAL_IMAGES = 6; // 节点图 + 追加参考图 合计上限
const MAX_UPLOAD = 12 * 1024 * 1024;

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

type Project = {
  key: string;
  members: Artwork[];
  isSuite: boolean;
  cover: string;
  count: number;
  name: string;
  latestAt: string;
};

// 沿血缘上溯到根作品(带环保护)
function rootOf(a: Artwork, byId: Map<string, Artwork>): Artwork {
  let cur = a;
  let guard = 0;
  while (cur.parentId && byId.has(cur.parentId) && guard++ < 200) {
    cur = byId.get(cur.parentId) as Artwork;
  }
  return cur;
}

// 安全解析接口返回:非 JSON(多为部署瞬间的纯文本 500「Internal Server Error」)
// 时给出可读错误,而不是让前端抛 "Unexpected token 'I'"。
async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      !res.ok
        ? `服务暂时不可用(${res.status}),请刷新页面后重试`
        : "服务返回异常,请重试"
    );
  }
}

// 画布生成器:比例选项(对齐参考站图1 的网格)。w/h 只用于画小图标;
// 实际出图尺寸由后端 sizeFor 按方向(横/竖/方)映射到 gpt-image 支持的尺寸。
const CANVAS_RATIOS: { id: string; w: number; h: number }[] = [
  { id: "auto", w: 0, h: 0 },
  { id: "1:1", w: 1, h: 1 },
  { id: "9:16", w: 9, h: 16 },
  { id: "16:9", w: 16, h: 9 },
  { id: "3:4", w: 3, h: 4 },
  { id: "4:3", w: 4, h: 3 },
  { id: "3:2", w: 3, h: 2 },
  { id: "2:3", w: 2, h: 3 },
  { id: "4:5", w: 4, h: 5 },
  { id: "5:4", w: 5, h: 4 },
  { id: "21:9", w: 21, h: 9 },
];
const CANVAS_RES = ["1K", "2K", "4K"];
// 重生成(拉线新建节点 / 侧栏「生成新版本」)在用户没写提示词、且原图也没有提示词
// 可继承时的兜底词。明确要求别替换背景、别改配色/色调 —— 否则 gpt-image 在宽松指令下
// 会顺手重画背景(实测:背景被改成黄色)。仍是重生成(非像素锁定),只是约束更强。
const FAITHFUL_REGEN_PROMPT =
  "在保持主体、背景、配色、材质、光影与构图不变的前提下,仅提升清晰度与画质,输出一张干净的高质量版本;不要替换背景、不要改变背景颜色或整体色调。";

// 比例小图标:按 w/h 等比缩放的圆角小方块(auto=正方)。
function RatioIcon({ w, h }: { w: number; h: number }) {
  const M = 16;
  let bw = M;
  let bh = M;
  if (w && h) {
    if (w >= h) bh = Math.max(7, Math.round((M * h) / w));
    else bw = Math.max(7, Math.round((M * w) / h));
  }
  return (
    <span
      className="block rounded-[3px] border-[1.5px] border-current"
      style={{ width: bw, height: bh }}
    />
  );
}

// 画布通用深色下拉(替代系统原生 select 的白底下拉):portal 到 body 脱离 dock 裁切,
// dir="up" 向上弹(dock 里用)、"down" 向下弹(顶部工具条用)。
function DarkSelect({
  trigger,
  triggerClass,
  value,
  options,
  onPick,
  dir = "up",
  disabled,
}: {
  trigger: ReactNode;
  triggerClass?: string;
  value: string;
  options: { value: string; label: ReactNode }[];
  onPick: (v: string) => void;
  dir?: "up" | "down";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.top, bottom: r.bottom });
    setOpen((v) => !v);
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={triggerClass}
      >
        {trigger}
        <ChevronDown
          className={cn(
            "h-3 w-3 flex-none text-[#9aa1ae] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            className="dark fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={
                dir === "down"
                  ? { left: rect.left, top: rect.bottom + 8 }
                  : {
                      left: rect.left,
                      bottom:
                        (typeof window !== "undefined"
                          ? window.innerHeight
                          : 0) -
                        rect.top +
                        8,
                    }
              }
              className={cn(
                "fixed min-w-[128px] rounded-xl border border-[#2a2d36] bg-[#191b21] p-1 shadow-2xl",
                dir === "down" ? "menu-pop-down" : "menu-pop-up"
              )}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onPick(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                    o.value === value
                      ? "bg-[#2a2e38] font-semibold text-white"
                      : "text-[#9aa1ae] hover:bg-[#1f2229] hover:text-white"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// 项目键:只有"一键套图"(batchId 以 suite- 开头)整批算一个项目;
// 普通生成的批次号是 b-...(每次生成都有),不能当项目分组依据,否则每次迭代都成独立项目、
// 血缘连不起来 —— 普通图一律按血缘树(根 id)分组。
function isSuiteBatch(id?: string | null): boolean {
  return !!id && id.startsWith("suite-");
}
function projectKey(a: Artwork, byId: Map<string, Artwork>): string {
  const r = rootOf(a, byId);
  if (isSuiteBatch(r.batchId)) return `batch:${r.batchId}`;
  // 稳定分组:优先用 group_id(删中间节点也不变,下游节点不会跑去别的项目);
  // 没有 group_id 的老数据回退到"血缘树根 id"。
  return `tree:${a.groupId || r.id}`;
}

// 占位节点(空白/上传中)动作上下文:让 React Flow 内的节点能调用主组件的上传
type PendCtx = {
  onUpload: (id: string) => void;
  onRemove: (id: string) => void;
};
const PendContext = createContext<PendCtx | null>(null);

// 占位/上传中节点(对齐参考站:空白节点→里面上传→进度条→填充)
function PendNode({ data, selected }: NodeProps) {
  const ctx = useContext(PendContext);
  const d = data as {
    label: string;
    uploading?: boolean;
    progress?: number;
    fileName?: string;
    fileInfo?: string;
    generating?: boolean;
    selected?: boolean;
  };
  const sel = selected || d.selected;
  return (
    <div className="group relative w-[170px]">
      {/* 标签(图片上方,对齐原型 .lb2) */}
      <div className="mb-1.5 flex items-center gap-1.5 truncate pl-0.5 text-[12px] text-[#9aa1ae]">
        <span>🖼</span>
        <span className="truncate">{d.label}</span>
      </div>
      {/* 占位卡(原型 .nb2 + .ph2:单层卡片,选中=teal) */}
      <div
        className={cn(
          "relative flex h-[110px] flex-col items-center justify-center rounded-[12px] border bg-[#191b21] px-3 text-center transition-all",
          sel
            ? "border-[#6366f1] shadow-[0_0_0_3px_rgba(99,102,241,0.22)]"
            : "border-dashed border-[#2a2d36]"
        )}
      >
        {d.generating ? (
          <div className="flex w-full flex-col items-center gap-2.5">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
            <div className="text-[12px] font-medium text-slate-200">
              生成中…
            </div>
          </div>
        ) : d.uploading ? (
          <div className="flex w-full flex-col items-center gap-2.5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-[12px] font-medium text-slate-200">
              上传中（{Math.round(d.progress ?? 0)}%）
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(d.progress ?? 0)}%` }}
              />
            </div>
            {d.fileInfo && (
              <div className="w-full truncate text-[10px] text-slate-500">
                {d.fileInfo}
              </div>
            )}
          </div>
        ) : (
          <>
            <ImageIcon className="mb-2 h-6 w-6 text-slate-600" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ctx?.onUpload(String((data as { __id?: string }).__id ?? ""));
              }}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-100 transition-colors hover:border-primary/60 hover:bg-primary/15 hover:text-white"
            >
              <Upload className="h-3.5 w-3.5" /> 上传图片
            </button>
          </>
        )}
      </div>
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        style={{ top: PORT_Y }}
        className="!flex !h-[22px] !w-[22px] !-left-[11px] !-translate-y-1/2 !items-center !justify-center !rounded-full !border-[1.5px] !border-[#444b57] !bg-[#191b21] !text-[15px] !leading-none !text-[#9aa1ae] transition-colors hover:!border-[#6366f1] hover:!bg-[#1e1b3a] hover:!text-[#6366f1]"
      >
        <span className="pointer-events-none leading-none">+</span>
      </Handle>
      {!d.uploading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ctx?.onRemove(String((data as { __id?: string }).__id ?? ""));
          }}
          className="nodrag absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[#0e0f13] bg-[#2a2e38] text-[11px] text-slate-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          title="删除空白节点"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// 自定义连线:点亮链路时叠多层彗星流光(严格对齐原型 cw-tail/body/head/spark)
function CometEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const d = data as { lit?: boolean; dim?: boolean } | undefined;
  const lit = !!d?.lit;
  return (
    <>
      {/* 加宽的透明命中区:让"鼠标放到线上"更容易触发悬停/剪断 */}
      <path
        className="react-flow__edge-interaction"
        d={path}
        fill="none"
        strokeWidth={22}
        stroke="transparent"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
      />
      <path
        className={cn("cw-base", lit && "cw-on", d?.dim && "cw-dim2")}
        d={path}
        fill="none"
      />
      {lit && (
        <>
          <path className="cw-comet cw-tail" pathLength={100} d={path} fill="none" />
          <path className="cw-comet cw-body" pathLength={100} d={path} fill="none" />
          <path className="cw-comet cw-head" pathLength={100} d={path} fill="none" />
          <path className="cw-comet cw-spark" pathLength={100} d={path} fill="none" />
        </>
      )}
    </>
  );
}

function ArtNode({ data, selected }: NodeProps) {
  const d = data as {
    image?: string;
    label: string;
    rootLabel?: string | null;
    version?: number;
    prompt?: string;
    date?: string;
    pending?: boolean;
    inChain?: boolean;
  };
  const title = d.pending
    ? d.label
    : `${d.version ? `v${d.version}` : ""}${d.date ? ` · ${formatDate(d.date)}` : ""}${d.prompt ? `\n${d.prompt}` : ""}`;
  return (
    <div className="group relative w-[170px]">
      {/* 标签(图片上方,对齐原型 .lb2) */}
      <div className="mb-1.5 flex items-center gap-1.5 truncate pl-0.5 text-[12px] text-[#9aa1ae]">
        <span>{d.pending ? "⏳" : "🖼"}</span>
        <span className="truncate">{d.label}</span>
        {d.version && (
          <span className="ml-auto flex-none rounded bg-white/10 px-1 text-[10px] font-semibold text-slate-200">
            v{d.version}
          </span>
        )}
      </div>

      {/* 图片卡(原型 .nb2:单层卡片带边框,选中=teal 描边+光晕) */}
      <div
        title={title}
        className={cn(
          "relative overflow-hidden rounded-[12px] border bg-[#191b21] transition-all",
          selected
            ? "border-[#6366f1] shadow-[0_0_0_3px_rgba(99,102,241,0.22)]"
            : d.inChain
              ? "border-[#6366f1]/50"
              : "border-[#2a2d36]"
        )}
      >
        {d.pending ? (
          <div className="flex h-[110px] flex-col items-center justify-center gap-2 bg-[#191b21]">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
            <span className="text-[12px] text-[#9aa1ae]">生成中…</span>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cdnUrl(d.image as string)}
              alt={d.label}
              draggable={false}
              className="block h-[110px] w-full object-cover"
            />
            {d.rootLabel && (
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {d.rootLabel}
              </span>
            )}
          </>
        )}
      </div>

      {/* 端口(原型 .port:22px 圆,top:78,hover 变 teal);左右都是 + 圆点 */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        style={{ top: PORT_Y }}
        className="!flex !h-[22px] !w-[22px] !-left-[11px] !-translate-y-1/2 !items-center !justify-center !rounded-full !border-[1.5px] !border-[#444b57] !bg-[#191b21] !text-[15px] !leading-none !text-[#9aa1ae] transition-colors hover:!border-[#6366f1] hover:!bg-[#1e1b3a] hover:!text-[#6366f1]"
      >
        <span className="pointer-events-none leading-none">+</span>
      </Handle>
      {!d.pending && (
        <Handle
          id="out"
          type="source"
          position={Position.Right}
          style={{ top: PORT_Y }}
          className="!flex !h-[22px] !w-[22px] !-right-[11px] !-translate-y-1/2 !items-center !justify-center !rounded-full !border-[1.5px] !border-[#444b57] !bg-[#191b21] !text-[15px] !leading-none !text-[#9aa1ae] transition-colors hover:!border-[#6366f1] hover:!bg-[#1e1b3a] hover:!text-[#6366f1]"
        >
          <span className="pointer-events-none leading-none">+</span>
        </Handle>
      )}
    </div>
  );
}

// 计算当前选中节点的整条血缘链路:上溯所有祖先 + 下延所有衍生(含自身)
function lineageChain(
  members: Artwork[],
  selectedId: string | null
): Set<string> {
  const chain = new Set<string>();
  if (!selectedId) return chain;
  const byId = new Map(members.map((m) => [m.id, m]));
  // 某节点的全部父(primary + 多输入);canvas-add 独立节点无血缘父
  const parentsOf = (m: Artwork): string[] => {
    if (m.source === "canvas-add") return [];
    const ps: string[] = [];
    if (m.parentId && byId.has(m.parentId)) ps.push(m.parentId);
    for (const pid of m.parentIds ?? [])
      if (pid && byId.has(pid) && pid !== m.parentId) ps.push(pid);
    return ps;
  };
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    for (const p of parentsOf(m)) {
      const arr = childrenOf.get(p) ?? [];
      arr.push(m.id);
      childrenOf.set(p, arr);
    }
  }
  // 上溯祖先(含多输入父,BFS)
  const up = [selectedId];
  let guard = 0;
  while (up.length && guard++ < 2000) {
    const id = up.pop() as string;
    if (chain.has(id)) continue;
    chain.add(id);
    const m = byId.get(id);
    if (m) for (const p of parentsOf(m)) up.push(p);
  }
  // 下延衍生(BFS)
  const stack = [selectedId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const c of childrenOf.get(id) ?? []) {
      if (!chain.has(c)) {
        chain.add(c);
        stack.push(c);
      }
    }
  }
  return chain;
}

// 把一组作品(可能是森林:多个根)排成整齐的血缘树布局
function layoutGraph(
  arts: Artwork[],
  rootLabel: string
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(arts.map((a) => [a.id, a]));
  const sorted = [...arts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const a of sorted) {
    // 手动加的节点(canvas-add:上传/副本/从历史)是独立节点:不连父、自成一格
    const p =
      a.parentId && byId.has(a.parentId) && a.source !== "canvas-add"
        ? a.parentId
        : null;
    if (p) {
      const arr = children.get(p) ?? [];
      arr.push(a.id);
      children.set(p, arr);
    } else {
      roots.push(a.id);
    }
  }
  // 横向布局:深度 depth → x(向右展开),同层兄弟 → y(竖排)。对齐原型左→右链路。
  const pos: Record<string, { x: number; y: number }> = {};
  let leaf = 0;
  const place = (id: string, depth: number) => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      pos[id] = { x: depth * (NODE_W + X_GAP), y: leaf * (NODE_H + Y_GAP) };
      leaf++;
    } else {
      kids.forEach((k) => place(k, depth + 1));
      const ys = kids.map((k) => pos[k].y);
      pos[id] = {
        x: depth * (NODE_W + X_GAP),
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }
  };
  roots.forEach((r) => place(r, 0));
  const nodes: Node[] = sorted.map((a, idx) => {
    const isRoot = !(a.parentId && byId.has(a.parentId));
    // 手动拖过的节点用记住的坐标,否则用自动布局
    const position =
      a.canvasX != null && a.canvasY != null
        ? { x: a.canvasX, y: a.canvasY }
        : pos[a.id] ?? { x: 0, y: 0 };
    return {
      id: a.id,
      type: "art",
      position,
      data: {
        image: a.image,
        label: a.title,
        rootLabel: isRoot ? rootLabel : null,
        version: idx + 1, // 项目内按生成时间的版本序号
        prompt: a.prompt,
        date: a.createdAt,
      },
    };
  });
  const edges: Edge[] = [];
  for (const a of sorted) {
    // primary 血缘边(canvas-add 独立节点不画)
    if (a.parentId && byId.has(a.parentId) && a.source !== "canvas-add") {
      edges.push({
        id: `e-${a.parentId}-${a.id}`,
        source: a.parentId as string,
        sourceHandle: "out",
        target: a.id,
        targetHandle: "in",
        type: "default",
      });
    }
    // 多输入额外边(显式连接,总是画)
    for (const pid of a.parentIds ?? []) {
      if (pid && byId.has(pid) && pid !== a.parentId) {
        edges.push({
          id: `e-${pid}-${a.id}`,
          source: pid,
          sourceHandle: "out",
          target: a.id,
          targetHandle: "in",
          type: "default",
        });
      }
    }
  }
  return { nodes, edges };
}

export function CanvasClient() {
  const { user, ready, persistMode, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { t } = useI18n();
  const router = useRouter();
  const [works, setWorks] = useState<Artwork[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // 管理员看指定用户:?email=<用户> → 只读查看该用户画布;?node=<作品id> → 预选中那张
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const pendingNodeRef = useRef<string | null>(null);
  // 通过 ?node= 深链进入的节点 id(如 AI 抠图「送画布」):即使它是单张一次性作品
  // (按常规规则不算项目),也让它所在项目在列表里显示出来,否则深链会落到空项目列表。
  const [pinnedNode, setPinnedNode] = useState<string | null>(null);
  // 生成中占位节点(__pending__)被手动拖动后的位置(记了就用记的,避免重渲染打回默认位)
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  // 仅"后台深链 ?node="进入时才自动平移聚焦;日常新建/上传/生成节点都不动画布
  const deepFocusRef = useRef(false);
  // 是否已做过"刷新恢复上次项目"的初始化(避免初始挂载误清本地保存)
  const restoredRef = useRef(false);
  // 「基于上一级重做」:切到父节点时把本节点提示词带过去(避免被选中-清空逻辑抹掉)
  const carryPromptRef = useRef<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const cancelEditRef = useRef(false); // Esc 取消时跳过失焦保存
  const [editPrompt, setEditPrompt] = useState("");
  const [genRatio, setGenRatio] = useState("auto"); // 默认自适应
  const [genResolution, setGenResolution] = useState("1K"); // 默认 1K
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false); // 比例/分辨率弹出面板
  const ratioBtnRef = useRef<HTMLButtonElement>(null);
  const [ratioMenuRect, setRatioMenuRect] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [genStyle, setGenStyle] = useState(GENERATION_STYLES[0]);
  const [genCount, setGenCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  // 生成中占位节点挂靠的源节点(独立于"选中",这样点空白取消选中也不会让占位消失)
  const [genSourceId, setGenSourceId] = useState<string | null>(null);
  // 左下控件:小地图开关、网格吸附(原型默认吸附 on)
  const [showMinimap, setShowMinimap] = useState(false);
  const [snapGrid, setSnapGrid] = useState(true);
  const [genError, setGenError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  // 视口变换(平移/缩放),用于把生成器面板停靠到选中节点正下方并跟随
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  // 拉线建节点(5b):从 +端口拉出 → 记源节点;落空白弹「新建节点」菜单
  const spawnSourceRef = useRef<string | null>(null);
  const connectedRef = useRef(false);
  const [spawnMenu, setSpawnMenu] = useState<{
    x: number;
    y: number;
    sourceId: string;
  } | null>(null);
  // 右键菜单(5c):nodeId 有值=节点菜单,无值=空白菜单
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; // 画布区相对坐标(供添加节点/上传/历史落点)
    y: number;
    cx: number; // 视口坐标(供 body portal 固定定位)
    cy: number;
    nodeId?: string;
  } | null>(null);
  // 生成器面板停靠在选中节点正下方(不再可拖);panelRef 仍用于测量
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 追加参考图(与节点图一起参与图生图)
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [extraPreviews, setExtraPreviews] = useState<string[]>([]);
  const extraInputRef = useRef<HTMLInputElement>(null);
  // 节点剪贴板(复制/粘贴节点)+ 上传作根节点的文件 input
  const nodeClipRef = useRef<Artwork | null>(null);
  const [hasClip, setHasClip] = useState(false);
  const [copyTip, setCopyTip] = useState(false);
  const rootUploadRef = useRef<HTMLInputElement>(null);
  // 空白右键「上传图片/添加节点」时记下落点(画布坐标)与挂靠的当前项目根,供 uploadRoot 用
  const uploadCtxRef = useRef<{ parentId: string | null; x: number; y: number } | null>(
    null
  );
  // 从生成历史选择:打开作品选择器(记下落点)
  const [historyPicker, setHistoryPicker] = useState<{ x: number; y: number } | null>(
    null
  );
  // 「全部项目」网格里每张卡片的「...」菜单(重命名/删除)当前展开的是哪个项目
  const [projMenuKey, setProjMenuKey] = useState<string | null>(null);
  // 回收站(软删除的作品):打开状态 + 列表 + 操作中
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<Artwork[] | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  // 剪刀剪线:鼠标悬停的连线 + 光标在画布内的位置(屏幕坐标,相对 canvasArea)
  const [edgeCut, setEdgeCut] = useState<{
    id: string;
    source: string;
    target: string;
    x: number;
    y: number;
  } | null>(null);
  // 占位/空白节点(添加节点/拉线建节点 → 先出空白节点,里面上传带进度,完成后变真节点)
  type Pend = {
    id: string;
    x: number;
    y: number;
    parentId: string | null;
    linked: boolean;
    label: string;
    uploading: boolean;
    progress: number;
    fileInfo?: string;
    inputs: string[]; // 多输入:连进这个空白节点的源节点 id(生成时作参考图)
    generating?: boolean; // 该空白节点正在文生图/合并生成中
  };
  const [pendNodes, setPendNodes] = useState<Pend[]>([]);
  const pendSeqRef = useRef(1);
  // 拉线「生成衍生图」:建好空白节点后,把光标自动落进提示词框,引导用户写"改什么"
  const pendPromptRef = useRef<HTMLTextAreaElement>(null);
  const wantFocusPendPrompt = useRef(false);
  // 重命名节点(改作品标题):正在改的节点 id + 输入值
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [nodeRenameValue, setNodeRenameValue] = useState("");
  const nodeRenameCancelRef = useRef(false); // Esc 取消时跳过失焦保存
  const pendUploadRef = useRef<HTMLInputElement>(null);
  const pendUploadTargetRef = useRef<string | null>(null);
  // 选中的空白节点(显示文生图/合并 dock)
  const [selectedPendId, setSelectedPendId] = useState<string | null>(null);
  // 新建项目:进入空白画布(无任何节点),右键添加节点/上传第一张图后即成新项目并切过去
  const [creatingNew, setCreatingNew] = useState(false);
  // 项目网格落地页(Figma 式):进画布先看项目卡片,点卡片才进入该项目的画布
  const [browsing, setBrowsing] = useState(true);
  // 浏览器后退支持:进做图页(browsing=false)时往历史压一条,使「后退」先回项目页而非离开 /canvas。
  const editorPushedRef = useRef(false);
  const browsingRef = useRef(true);
  // 剩余积分(右上会员挂件展示)
  const [credits, setCredits] = useState<number | null>(null);
  // 帮助/快捷键弹框 + 底部工具条临时提示
  const [helpOpen, setHelpOpen] = useState(false);
  const [tipMsg, setTipMsg] = useState<string | null>(null);
  // 底部 + 号的「添加节点/上传/历史」菜单
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // 左下角缩放下拉菜单 + 可输入的缩放值
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState("100");
  // 右上角按钮在画布内弹窗打开的页面;支持层叠(下一级页面也在弹窗内,可返回)
  type ModalRoute = {
    page: "templates" | "plans" | "account" | "generate" | "checkout" | "security";
    params?: Record<string, string>;
  };
  const [modalStack, setModalStack] = useState<ModalRoute[]>([]);
  const modalTop = modalStack[modalStack.length - 1] ?? null;
  // 画布内扫码支付(原生支付宝/微信二维码 + 轮询到账,统一走共用 PayQrModal)
  const [payModal, setPayModal] = useState<{
    orderId: string;
    qrContent: string;
    provider: "alipay" | "wechat";
    credits: number;
    bonus: number;
    fen: number;
    discount?: string;
    packId: string;
  } | null>(null);
  // 打开一级弹窗(右上角按钮)
  function openModal(page: ModalRoute["page"]) {
    setModalStack([{ page }]);
  }
  // 弹窗内点链接 → 进下一级(画布内层叠);返回 = 出栈
  const MODAL_ROUTES: Record<string, ModalRoute["page"]> = {
    "/templates": "templates",
    "/plans": "plans",
    "/account": "account",
    "/account/security": "security",
    "/generate": "generate",
  };
  function pushModalHref(href: string): boolean {
    const [path, qs] = href.split("?");
    const route = path.replace(/\/+$/, "") || "/";
    const page = MODAL_ROUTES[route];
    if (!page) return false; // 未知/外部 → 不拦截,照常跳转
    const params = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
    setModalStack((s) => [...s, { page, params }]);
    return true;
  }
  function modalBack() {
    setModalStack((s) => (s.length > 1 ? s.slice(0, -1) : []));
  }
  // 模板「做同款」→ 关弹窗 + 用模板图在画布里新建一个项目(独立根节点),选中后即可在画布内生成衍生
  async function applyTemplateToCanvas(templateId: string) {
    if (!user || readOnly) return;
    setModalStack([]);
    setBrowsing(false);
    setCreatingNew(true); // 先进空白画布态,避免闪到旧项目;拿到新节点后自动切过去
    setActiveKey(null);
    setSelectedId(null);
    try {
      const res = await fetch(
        `/api/templates?ids=${encodeURIComponent(templateId)}&pageSize=1`,
        { cache: "no-store" }
      );
      const data = await res.json();
      const list = (data.templates ?? []) as Artwork[];
      const tpl =
        list.find((t) => t.id === templateId) ?? (list[0] as Artwork | undefined);
      if (!tpl) return;
      const r = await fetch("/api/artworks/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          // 不传 parentId → 独立根节点 → 自成一个新项目(新画布)
          src: {
            image: tpl.image,
            title: tpl.title || (tpl.prompt ? tpl.prompt.slice(0, 16) : "模板"),
            category: tpl.category || "main",
            prompt: tpl.prompt || "",
            style: tpl.style,
            ratio: tpl.ratio,
            resolution: tpl.resolution,
            templateId: tpl.id,
          },
        }),
      });
      const d = await r.json();
      if (d?.id) pendingNodeRef.current = d.id; // 切到新项目并选中该节点
      const fresh = await mergeWorks(d?.id ? [d.id] : []);
      pushAddUndo(d?.id ?? null, fresh);
    } catch {
      /* ignore */
    }
  }
  async function refreshCredits() {
    const em = targetEmail || user?.email;
    if (!em) return;
    try {
      const r = await fetch(`/api/account?email=${encodeURIComponent(em)}`, {
        headers: await authHeader(),
      });
      const d = await r.json();
      const u = d?.user as
        | { creditsTotal?: number; creditsUsed?: number }
        | undefined;
      if (u && typeof u.creditsTotal === "number")
        setCredits(Math.max(0, u.creditsTotal - (u.creditsUsed ?? 0)));
    } catch {
      /* ignore */
    }
  }
  // 扫码支付二维码渲染 + 轮询到账 + 倒计时统一由共用 PayQrModal 处理(见下方 JSX)。
  // 预加载二维码库:进会员弹窗时就把 qrcode chunk 拉好,点开通后秒出码
  useEffect(() => {
    if (modalTop?.page === "plans") void import("qrcode");
  }, [modalTop?.page]);
  // 缩放输入框跟随实际缩放(用户改值后回车应用)
  useEffect(() => {
    setZoomInput(String(Math.round((viewport.zoom || 1) * 100)));
  }, [viewport.zoom]);
  function applyZoomInput() {
    const v = parseInt(zoomInput, 10);
    if (Number.isFinite(v) && v >= 15 && v <= 800)
      rfRef.current?.zoomTo(v / 100, { duration: 200 });
  }
  // 撤销/重做(实用版:移动/删除/添加)
  type UndoAct =
    | { kind: "move"; id: string; from: { x: number; y: number }; to: { x: number; y: number } }
    | { kind: "delete"; records: Artwork[] }
    | { kind: "add"; records: Artwork[] };
  const [undoStack, setUndoStack] = useState<UndoAct[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAct[]>([]);
  const dragStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  // 框选多选(React Flow 选中集合)
  const [multiSel, setMultiSel] = useState<string[]>([]);
  // 居中确认弹框(替代浏览器原生 confirm,贴合站点配色)
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    return () => extraPreviews.forEach((u) => URL.revokeObjectURL(u));
  }, [extraPreviews]);

  function pickExtra(list: FileList | null) {
    if (!list) return;
    const room = MAX_TOTAL_IMAGES - 1 - extraFiles.length; // 减去节点图本身占 1
    if (room <= 0) return;
    const nf: File[] = [];
    const np: string[] = [];
    for (const f of Array.from(list)) {
      if (nf.length >= room) break;
      if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) continue;
      if (f.size > MAX_UPLOAD) continue;
      nf.push(f);
      np.push(URL.createObjectURL(f));
    }
    if (nf.length === 0) return;
    setExtraFiles((prev) => [...prev, ...nf]);
    setExtraPreviews((prev) => [...prev, ...np]);
    if (extraInputRef.current) extraInputRef.current.value = "";
  }
  function removeExtra(i: number) {
    setExtraPreviews((prev) => {
      const u = prev[i];
      if (u) URL.revokeObjectURL(u);
      return prev.filter((_, j) => j !== i);
    });
    setExtraFiles((prev) => prev.filter((_, j) => j !== i));
  }

  useEffect(() => {
    if (ready && !user) openAuth("sign-in");
  }, [ready, user, openAuth]);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    const sp = new URLSearchParams(window.location.search);
    const emailParam = sp.get("email");
    const target = emailParam || user.email;
    const ro =
      !!emailParam && emailParam.toLowerCase() !== user.email.toLowerCase();
    pendingNodeRef.current = sp.get("node");
    if (sp.get("node")) {
      setPinnedNode(sp.get("node")); // 让该节点所在项目即使单张也显示在列表/可直达
      setBrowsing(false); // 深链直达某节点 → 跳过网格落地页
      deepFocusRef.current = true; // 深链才允许自动聚焦
    } else {
      // 刷新恢复:加载数据前就先决定停在上次的项目画布,避免网格一闪而过
      try {
        const last = localStorage.getItem("nv:canvas:last");
        if (last) {
          setActiveKey(last);
          setBrowsing(false);
        }
      } catch {
        /* ignore */
      }
    }
    restoredRef.current = true;
    setTargetEmail(target);
    setReadOnly(ro);
    Promise.all([
      (async () =>
        (
          await fetch(`/api/account?email=${encodeURIComponent(target)}`, {
            headers: await authHeader(),
          })
        ).json())(),
      fetch(`/api/projects?email=${encodeURIComponent(target)}`)
        .then((r) => r.json())
        .catch(() => ({ names: {} })),
    ])
      .then(([acc, proj]) => {
        if (cancelled) return;
        setWorks((acc?.artworks ?? []) as Artwork[]);
        setNames((proj?.names ?? {}) as Record<string, string>);
        const u = acc?.user as
          | { creditsTotal?: number; creditsUsed?: number }
          | undefined;
        if (u && typeof u.creditsTotal === "number") {
          setCredits(Math.max(0, u.creditsTotal - (u.creditsUsed ?? 0)));
        }
      })
      .catch(() => {
        if (!cancelled) setWorks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  // 从收银台返回(支付完成/取消)→ 自动重开会员弹窗,并清掉 URL 上的标记
  useEffect(() => {
    if (!ready || !user) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("pay")) {
        openModal("plans");
        sp.delete("pay");
        const qs = sp.toString();
        window.history.replaceState(
          null,
          "",
          window.location.pathname + (qs ? `?${qs}` : "")
        );
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  const { projects } = useMemo(() => {
    const arts = (works ?? []).filter(
      (a) => a.status === "completed" && /^https?:\/\//.test(a.image)
    );
    const byId = new Map(arts.map((a) => [a.id, a]));
    const groups = new Map<string, Artwork[]>();
    for (const a of arts) {
      const k = projectKey(a, byId);
      const arr = groups.get(k) ?? [];
      arr.push(a);
      groups.set(k, arr);
    }
    // 画布只是"高级工作台":单一作品库不分家,但项目列表只展示真正在画布作业过的项目 ——
    //   · 套图批次(本来就是一组)
    //   · 多节点血缘树(用户在画布上迭代/衍生过)
    //   · 含"显式加入画布"的节点(上传/复制/历史/拉线衍生 = source∈下表)
    //   · 用户重命名过的(说明在意它)
    // 那些从没在画布动过的、孤张一次性生图(生图页/套图页直接产出的单图)不在画布出现,
    // 它们仍在作品库/生图页可见。轻度用户因此基本不会看到画布。
    const CANVAS_SOURCES = new Set(["canvas-add", "derived", "upload"]);
    const projects: Project[] = Array.from(groups.entries())
      .map(([key, members]) => {
        members.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        const latest = members[members.length - 1];
        const root =
          members.find((m) => !(m.parentId && byId.has(m.parentId))) ??
          members[0];
        const isSuite = key.startsWith("batch:");
        const defaultName = isSuite ? t("canvas.suiteProject") : root.title;
        return {
          key,
          members,
          isSuite,
          cover: latest.image,
          count: members.length,
          name: names[key] ?? defaultName,
          latestAt: latest.createdAt,
        };
      })
      .filter(
        (p) =>
          // 管理员只读查看用户作品时不过滤:让单张一次性生图也能进画布(否则深链找不到→空白)
          readOnly ||
          p.isSuite ||
          p.members.length > 1 ||
          p.members.some((m) => m.source && CANVAS_SOURCES.has(m.source)) ||
          p.members.some((m) => m.origin === "canvas") ||
          names[p.key] != null ||
          // ?node= 深链进来的那张(如抠图「送画布」):即使单张也放行,否则落到空列表
          (pinnedNode != null && p.members.some((m) => m.id === pinnedNode))
      );
    projects.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
    return { projects };
  }, [works, names, t, readOnly, pinnedNode]);

  // 打开中的项目消失了(被删 / 根节点变化导致 key 变)→ 回到项目网格,而非自动弹别的项目
  useEffect(() => {
    if (creatingNew || browsing) return;
    if (works === null) return; // 数据还没加载完别误判(否则刷新恢复会被踢回网格)
    if (activeKey && !projects.some((p) => p.key === activeKey)) {
      setBrowsing(true);
      setActiveKey(null);
      setSelectedId(null);
      try {
        localStorage.removeItem("nv:canvas:last");
      } catch {
        /* ignore */
      }
    }
  }, [projects, activeKey, creatingNew, browsing, works]);

  // ?node=<作品id>:跳到该图所在项目并选中聚焦(管理员从后台点图进来时)
  useEffect(() => {
    const node = pendingNodeRef.current;
    if (!node || projects.length === 0) return;
    pendingNodeRef.current = null;
    const proj = projects.find((p) => p.members.some((m) => m.id === node));
    if (proj) {
      setActiveKey(proj.key);
      setSelectedId(node);
      // 只有后台深链进入才自动聚焦;日常新建/上传/生成不动画布
      if (deepFocusRef.current) {
        setFocusId(node);
        deepFocusRef.current = false;
      }
      setBrowsing(false); // 新建/上传/深链 → 直接进入该项目画布,不停在网格
    }
  }, [projects]);

  // 同步当前打开的项目到本地(供刷新恢复);只写不清,清除交给返回/删除路径,
  // 避免初始挂载时(browsing=true)误清掉上次保存的项目。
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      if (!browsing && activeKey)
        localStorage.setItem("nv:canvas:last", activeKey);
    } catch {
      /* ignore */
    }
  }, [browsing, activeKey]);

  const active = useMemo(
    () => projects.find((p) => p.key === activeKey) ?? null,
    [projects, activeKey]
  );

  // 进入空白画布 = 新建项目;选中/拿到真实项目后自动退出该模式
  function startNewProject() {
    setCreatingNew(true);
    setBrowsing(false);
    setActiveKey(null);
    setSelectedId(null);
    setPendNodes([]);
    setSidebarOpen(false);
  }
  useEffect(() => {
    if (active) setCreatingNew(false);
  }, [active]);
  // 打开某个画布项目(从网格落地页点卡片)
  function openProject(key: string) {
    setActiveKey(key);
    setSelectedId(null);
    setPendNodes([]);
    setCreatingNew(false);
    setBrowsing(false);
    setSidebarOpen(false);
    try {
      localStorage.setItem("nv:canvas:last", key);
    } catch {
      /* ignore */
    }
  }
  // 返回项目网格落地页(实际状态切换)
  function doBackToBrowser() {
    setBrowsing(true);
    setSelectedId(null);
    setCreatingNew(false);
    setPendNodes([]);
    setSidebarOpen(false);
    try {
      localStorage.removeItem("nv:canvas:last");
    } catch {
      /* ignore */
    }
  }
  // 「全部项目」按钮:若进做图页时压过历史,用浏览器后退消费掉它(popstate 里完成回项目页),
  // 保持历史栈一致;否则直接切回网格。
  function backToBrowser() {
    if (editorPushedRef.current && typeof window !== "undefined") {
      window.history.back();
      return;
    }
    doBackToBrowser();
  }

  // popstate 回调只挂一次,闭包里读不到最新 browsing,用 ref 同步。
  useEffect(() => {
    browsingRef.current = browsing;
  }, [browsing]);

  // 进做图页(browsing=false)→ 往历史压一条同 URL 记录,使浏览器「后退」先回项目页;
  // 回到项目页(browsing=true)→ 复位标记。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!browsing && !editorPushedRef.current) {
      editorPushedRef.current = true;
      window.history.pushState({ nvCanvasEditor: true }, "");
    } else if (browsing) {
      editorPushedRef.current = false;
    }
  }, [browsing]);

  // 后退键:在做图页 → 回项目页(消费掉上面压的记录,停在 /canvas);
  // 已在项目页 → 不拦截,让浏览器正常退回进画布前的上一页。
  useEffect(() => {
    const onPop = () => {
      if (!browsingRef.current) {
        editorPushedRef.current = false;
        doBackToBrowser();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!active) return { nodes: [], edges: [] };
    return layoutGraph(active.members, t("canvas.rootBadge"));
  }, [active, t]);

  const nodeTypes = useMemo(() => ({ art: ArtNode, pend: PendNode }), []);
  const edgeTypes = useMemo(() => ({ comet: CometEdge }), []);
  const selected = useMemo(
    () => active?.members.find((a) => a.id === selectedId) ?? null,
    [active, selectedId]
  );
  // dock 的"引用图"= 该节点的上一级父节点(它由此生成);根节点无父则用自身。
  // 用于:① dock 缩略图显示父图 ② 生成时以父图为底图(改提示词→生成同级新版本)
  const dockRefs = useMemo<Artwork[]>(() => {
    if (!selected || !active) return [];
    // canvas-add(空白处新增/独立上传):parentId 只是"分组挂靠"、无血缘线,
    // 这类节点本身就是原图 → 引用图=自身,不把分组父图(项目第一张)带出来。
    if (selected.source === "canvas-add") return [selected];
    const ids = [
      selected.parentId,
      ...(selected.parentIds ?? []),
    ].filter((x): x is string => !!x);
    const arts = ids
      .map((id) => active.members.find((m) => m.id === id))
      .filter(Boolean) as Artwork[];
    return arts.length ? arts : [selected];
  }, [selected, active]);
  // 用户可在 dock 里"×"掉自动引用图(改用自己上传的);hiddenRefIds 随选中切换清空
  const [hiddenRefIds, setHiddenRefIds] = useState<string[]>([]);
  const visibleDockRefs = useMemo(
    () => dockRefs.filter((r) => !hiddenRefIds.includes(r.id)),
    [dockRefs, hiddenRefIds]
  );
  const selectedPend = useMemo(
    () => pendNodes.find((p) => p.id === selectedPendId) ?? null,
    [pendNodes, selectedPendId]
  );
  // 选中空白节点时的输入图(参考图)
  const pendInputArts = useMemo(
    () =>
      (selectedPend?.inputs ?? [])
        .map((id) => active?.members.find((m) => m.id === id))
        .filter(Boolean) as Artwork[],
    [selectedPend, active]
  );

  // 生成中:在选中节点下方临时插入"生成中"占位节点;
  // 选中时:整条血缘链路点亮(蓝色流光),其余节点/连线变暗。
  const { displayNodes, displayEdges } = useMemo<{
    displayNodes: Node[];
    displayEdges: Edge[];
  }>(() => {
    let baseNodes = nodes;
    let baseEdges = edges;
    // 占位"生成中"节点挂在 genSourceId 节点右侧(横向链路;与"选中"无关,点空白也不消失)
    if (generating && genSourceId) {
      const parentNode = nodes.find((n) => n.id === genSourceId);
      const pos = pendingPosRef.current ?? (parentNode
        ? { x: parentNode.position.x + NODE_W + X_GAP, y: parentNode.position.y }
        : { x: 0, y: 0 });
      baseNodes = [
        ...nodes,
        {
          id: "__pending__",
          type: "art",
          position: pos,
          data: { pending: true, label: t("canvas.pending") },
          selectable: false,
          draggable: true, // 生成中也允许鼠标拖动这个占位节点
        },
      ];
      baseEdges = [
        ...edges,
        {
          id: "e-__pending__",
          source: genSourceId,
          sourceHandle: "out",
          target: "__pending__",
          targetHandle: "in",
          type: "default",
          animated: true,
        },
      ];
    }
    const chain = active
      ? lineageChain(active.members, selectedId)
      : new Set<string>();
    const hasSel = !!selectedId && chain.size > 0;
    const displayNodes: Node[] = baseNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as Record<string, unknown>),
        inChain: hasSel && chain.has(n.id),
      },
      className:
        hasSel && !chain.has(n.id) && n.id !== "__pending__"
          ? "cw-dim"
          : undefined,
    }));
    const displayEdges: Edge[] = baseEdges.map((e) => {
      if (e.id === "e-__pending__") return e;
      if (!hasSel)
        return {
          ...e,
          type: "comet",
          data: { lit: false, dim: false },
          className: undefined,
          animated: false,
        };
      const lit = chain.has(e.source) && chain.has(e.target);
      return {
        ...e,
        type: "comet",
        data: { lit, dim: !lit },
        className: undefined,
        animated: false,
      };
    });
    // 追加占位/空白节点(及其连线:每个 input 一条)
    for (const p of pendNodes) {
      displayNodes.push({
        id: p.id,
        type: "pend",
        position: { x: p.x, y: p.y },
        // 不设 RF 受控 selected(避免与 onSelectionChange 互相触发循环),只用 data.selected 做高亮
        data: {
          __id: p.id,
          label: p.label,
          uploading: p.uploading,
          progress: p.progress,
          fileInfo: p.fileInfo,
          generating: p.generating,
          selected: p.id === selectedPendId,
        },
      } as Node);
      for (const src of p.inputs ?? []) {
        if (!src) continue;
        displayEdges.push({
          id: `e-pend-${src}-${p.id}`,
          source: src,
          sourceHandle: "out",
          target: p.id,
          targetHandle: "in",
          type: "comet",
          data: { lit: false, dim: false },
        } as Edge);
      }
    }
    // 防御:节点/边按 id 去重,并丢弃指向不存在节点的悬空边
    // (React Flow 遇到重复 key 或悬空边会抛出 client-side exception → 白屏)
    const nSeen = new Set<string>();
    const finalNodes = displayNodes.filter((n) =>
      nSeen.has(n.id) ? false : (nSeen.add(n.id), true)
    );
    const nIds = nSeen;
    const eSeen = new Set<string>();
    const finalEdges = displayEdges.filter((e) =>
      !e.id ||
      eSeen.has(e.id) ||
      !e.source ||
      !e.target ||
      !nIds.has(e.source) ||
      !nIds.has(e.target)
        ? false
        : (eSeen.add(e.id), true)
    );
    return { displayNodes: finalNodes, displayEdges: finalEdges };
  }, [
    nodes,
    edges,
    generating,
    genSourceId,
    selectedId,
    selectedPendId,
    active,
    t,
    pendNodes,
  ]);

  // 受控节点状态(支持拖拽);仅当底层数据/位置真正变化时重新灌入,拖拽过程中不重置。
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesSig = displayNodes
    .map(
      (n) =>
        `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}:${
          (n.data as { pending?: boolean }).pending ? 1 : 0
        }:${(n.data as { inChain?: boolean }).inChain ? 1 : 0}:${n.className ?? ""}:${
          Math.round((n.data as { progress?: number }).progress ?? -1)
        }:${(n.data as { uploading?: boolean }).uploading ? 1 : 0}:${
          (n.data as { selected?: boolean }).selected ? 1 : 0
        }:${(n.data as { generating?: boolean }).generating ? 1 : 0}`
    )
    .join("|");
  const edgesSig = displayEdges
    .map(
      (e) =>
        `${e.id}:${(e.data as { lit?: boolean })?.lit ? 1 : 0}:${
          (e.data as { dim?: boolean })?.dim ? 1 : 0
        }`
    )
    .join("|");
  useEffect(() => {
    setRfNodes(displayNodes);
    setRfEdges(displayEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesSig, edgesSig]);

  // 选中节点在画布坐标系里的屏幕位置(用模块级 NODE_W/NODE_H = 184/158)
  const nodeScreen = useMemo<
    { left: number; top: number; bottom: number; cx: number } | undefined
  >(() => {
    // 当前用于停靠上下面板的节点:真实选中节点优先,否则选中的空白节点
    const anchorId = selectedId ?? selectedPendId;
    if (!anchorId) return undefined;
    const selNode = rfNodes.find((n) => n.id === anchorId);
    if (!selNode) return undefined;
    const z = viewport.zoom || 1;
    const left = selNode.position.x * z + viewport.x;
    const top = selNode.position.y * z + viewport.y;
    return { left, top, bottom: top + NODE_H * z, cx: left + (NODE_W * z) / 2 };
  }, [selectedId, selectedPendId, rfNodes, viewport]);

  // 顶部工具条与底部 dock 共用同一个"中心 x"(按 dock 宽度夹取),保证两者左右对齐。
  const DOCK_W = 680; // 与实际渲染 w-[680px] 一致
  // 节点中心 x(夹取到画布内,使最宽的 dock 不出界);工具条也用这个中心 → 上下对齐。
  const anchorCenterX = useMemo<number | undefined>(() => {
    if (!nodeScreen) return undefined;
    const cw = canvasAreaRef.current?.clientWidth ?? 0;
    const HALF = DOCK_W / 2;
    let cx = nodeScreen.cx;
    if (cw) cx = Math.max(HALF + 8, Math.min(cx, cw - HALF - 8));
    return cx;
  }, [nodeScreen]);

  // 底部生成器:节点正下方,中心对齐 anchorCenterX
  const dockStyle = useMemo<
    { left: number; top: number; maxHeight?: number } | undefined
  >(() => {
    if (!nodeScreen || anchorCenterX == null) return undefined;
    const ch = canvasAreaRef.current?.clientHeight ?? 0;
    const left = anchorCenterX - DOCK_W / 2;
    const top = nodeScreen.bottom + 14;
    const maxHeight = ch ? Math.max(150, ch - top - 12) : undefined;
    return { left, top, maxHeight };
  }, [nodeScreen, anchorCenterX]);

  // 顶部图像工具条:节点正上方,中心 = anchorCenterX(渲染时用 -translate-x-1/2 自居中)
  const topbarStyle = useMemo<{ left: number; top: number } | undefined>(() => {
    if (!nodeScreen || anchorCenterX == null) return undefined;
    const TBAR_H = 46;
    const top = Math.max(8, nodeScreen.top - TBAR_H - 12);
    return { left: anchorCenterX, top };
  }, [nodeScreen, anchorCenterX]);

  // 重命名节点:本地改标题 + 落库(节点标签 = 作品 title)
  async function saveNodeRename() {
    const id = renamingNodeId;
    const name = nodeRenameValue.trim();
    setRenamingNodeId(null);
    if (!id || !user || readOnly || !name) return;
    const cur = (works ?? []).find((w) => w.id === id);
    if (!cur || cur.title === name) return;
    setWorks((prev) =>
      prev ? prev.map((w) => (w.id === id ? { ...w, title: name } : w)) : prev
    );
    try {
      await fetch("/api/artworks/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, id, title: name }),
      });
    } catch {
      /* ignore — 本地已更新,刷新会回落服务端 */
    }
  }

  async function saveRename(key: string) {
    const name = renameValue.trim();
    setRenamingKey(null);
    if (readOnly || !name || !user) return;
    setNames((prev) => ({ ...prev, [key]: name }));
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, key, name }),
      });
    } catch {
      /* ignore — 本地已更新,下次刷新会回落到服务端 */
    }
  }

  // 选中节点变化时:Fuser 式——新提示词框留空(只读管理员视图才显示该图原提示词供查看);
  // 比例/风格沿用该节点作默认。「基于上一级重做」会用 carryPromptRef 把上一版提示词带过来。
  useEffect(() => {
    const carried = carryPromptRef.current;
    carryPromptRef.current = null;
    // 预填该节点自己的提示词(可编辑),便于"看着配方改一改再生成";有 carry 的优先用 carry
    setEditPrompt(carried ?? selected?.prompt ?? "");
    setGenRatio(selected?.ratio || "auto"); // 默认自适应
    setGenStyle(selected?.style || GENERATION_STYLES[0]);
    setGenCount(1);
    setRatioMenuOpen(false);
    setGenError(null);
    setExtraFiles([]);
    setExtraPreviews([]);
    setHiddenRefIds([]); // 切换节点:恢复显示自动引用图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // 拉线「生成衍生图」建好空白节点后:把光标落进提示词框,引导用户写改动
  useEffect(() => {
    if (!wantFocusPendPrompt.current || !selectedPendId) return;
    wantFocusPendPrompt.current = false;
    const raf = requestAnimationFrame(() => pendPromptRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [selectedPendId]);

  // 整表重拉(仅初次加载 / 兜底用)。日常增删改用下面的局部更新,省 egress。
  async function refetchWorks(): Promise<Artwork[]> {
    const em = targetEmail || user?.email;
    if (!em) return works ?? [];
    try {
      const r = await fetch(`/api/account?email=${encodeURIComponent(em)}`, {
        headers: await authHeader(),
      });
      const d = await r.json();
      const arr = (d?.artworks ?? []) as Artwork[];
      setWorks(arr);
      return arr;
    } catch {
      return works ?? [];
    }
  }

  // 只补指定 id 的几行(创建/连线后):取代整表重拉。返回更新后的 works(供调用方用)。
  // 失败时兜底走整表重拉,保证数据最终一致。
  async function mergeWorks(ids: string[]): Promise<Artwork[]> {
    const em = targetEmail || user?.email;
    const valid = ids.filter(Boolean);
    if (!em || valid.length === 0) return works ?? [];
    try {
      const r = await fetch(
        `/api/artworks/get?email=${encodeURIComponent(em)}&ids=${valid
          .map(encodeURIComponent)
          .join(",")}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      const fetched = (d?.artworks ?? []) as Artwork[];
      if (fetched.length === 0) return works ?? [];
      const map = new Map((works ?? []).map((w) => [w.id, w]));
      for (const a of fetched) map.set(a.id, a);
      const next = Array.from(map.values()).sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || "")
      );
      setWorks(next);
      return next;
    } catch {
      // 单行补取失败 → 兜底整表重拉,确保不漏数据
      return refetchWorks();
    }
  }

  // 本地移除指定 id(删除节点/项目):不重拉,返回更新后的 works。
  function removeWorksLocal(ids: string[]): Artwork[] {
    const set = new Set(ids);
    const next = (works ?? []).filter((w) => !set.has(w.id));
    setWorks(next);
    return next;
  }

  // ── 回收站 ──
  async function openTrash() {
    setSidebarOpen(false);
    setTrashOpen(true);
    setTrashItems(null);
    const em = targetEmail || user?.email;
    if (!em) {
      setTrashItems([]);
      return;
    }
    try {
      const r = await fetch(`/api/artworks/trash?email=${encodeURIComponent(em)}`);
      const d = await r.json();
      setTrashItems((d?.artworks ?? []) as Artwork[]);
    } catch {
      setTrashItems([]);
    }
  }
  async function trashAction(action: "restore" | "purge", ids: string[]) {
    const em = targetEmail || user?.email;
    if (!em || ids.length === 0 || trashBusy) return;
    setTrashBusy(true);
    try {
      await fetch("/api/artworks/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em, action, ids }),
      });
      // 从回收站列表里移除这些
      setTrashItems((prev) =>
        prev ? prev.filter((w) => !ids.includes(w.id)) : prev
      );
      // 恢复:把它们补回画布工作区
      if (action === "restore") await mergeWorks(ids);
    } catch {
      /* ignore */
    } finally {
      setTrashBusy(false);
    }
  }

  // 本地恢复整条记录(撤销删除时已持有完整记录):不重拉,返回更新后的 works。
  function restoreWorksLocal(records: Artwork[]): Artwork[] {
    if (!records.length) return works ?? [];
    const map = new Map((works ?? []).map((w) => [w.id, w]));
    for (const a of records) map.set(a.id, a);
    const next = Array.from(map.values()).sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );
    setWorks(next);
    return next;
  }

  // 生成核心:以某节点为底图(图生图)+ 提示词 → 新图作为其子节点。
  async function runGen(
    source: Artwork,
    prompt: string,
    opts?: {
      ratio?: string;
      style?: string;
      count?: number;
      resolution?: string;
      transparent?: boolean;
      ratiogen?: boolean; // 改比例(ChatGPT 式重生成):用节点自身提示词+原图参考按比例重画,无需额外提示词
      extra?: File[];
      baseFile?: File; // 指定底图(用户在 dock 删掉自动引用图、改用自己上传的)
      // dock 里的全部引用图 URL(多图合成时一起送;第一张=主底图,其余=附加参考图)。
      refUrls?: string[];
      // 血缘父覆盖:默认挂在 source 下;多图引用时把它设成"选中节点",新图落在选中节点下方。
      parentId?: string;
      parentIds?: string[];
    }
  ) {
    if (readOnly || !user || generating) return;
    const text = prompt.trim();
    if (!text && !opts?.ratiogen) return; // 改比例可无提示词(服务端用固定重构图指令)
    setSelectedId(source.id); // 占位节点挂在它下面,工具条/面板也对齐它
    setGenSourceId(source.id); // 占位节点的挂靠源(独立于选中)
    pendingPosRef.current = null; // 新一轮生成,占位从默认位开始
    setGenerating(true);
    setGenError(null);
    try {
      // 下载一张图为 File(底图/参考图统一走 /api/download 代理)
      const dlFile = async (url: string, name: string): Promise<File> => {
        const dl = await fetch(
          `/api/download?u=${encodeURIComponent(url)}&n=${name}`
        );
        if (!dl.ok) throw new Error(t("canvas.genFail"));
        const blob = await dl.blob();
        return new File([blob], name, { type: blob.type || "image/png" });
      };
      // 参考图集合(第一张=主底图,其余=附加参考图一起送给模型):
      //  ① 用户指定上传底图 baseFile  ② 否则 dock 里的全部引用图 refUrls  ③ 都没有→源节点自身图。
      // 这样从"多图合成节点"再生成时,两张原始输入都会被引用,不会丢图。
      const refUrls = (opts?.refUrls ?? []).filter(Boolean);
      const refFiles: File[] = [];
      if (opts?.baseFile) {
        refFiles.push(opts.baseFile);
      } else if (refUrls.length) {
        for (let i = 0; i < refUrls.length; i++) {
          refFiles.push(await dlFile(refUrls[i], `ref-${i}.png`));
        }
      } else {
        refFiles.push(await dlFile(source.image, "base.png"));
      }
      const fd = new FormData();
      fd.append("prompt", text);
      fd.append("category", source.category || "main");
      fd.append("ratio", opts?.ratio || source.ratio || "1:1");
      fd.append("resolution", opts?.resolution || source.resolution || "1K");
      fd.append("style", opts?.style ?? "");
      fd.append("count", String(opts?.count ?? 1));
      if (opts?.transparent) fd.append("transparent", "1");
      if (opts?.ratiogen) fd.append("ratiogen", "1");
      fd.append("email", user.email);
      // 血缘父=选中节点(opts.parentId),新图落其下方;默认仍挂 source。
      fd.append("parentId", opts?.parentId ?? source.id);
      fd.append("parentIds", JSON.stringify(opts?.parentIds ?? []));
      fd.append("origin", "canvas"); // 画布里产出 → 永远留画布(见 projects 过滤)
      // 第一张=主底图,其后是其余引用图 + 用户追加的参考图
      refFiles.forEach((f) => fd.append("image", f));
      (opts?.extra ?? []).forEach((f) => fd.append("image", f));
      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await readJsonSafe(startRes);
      if (!startRes.ok) throw new Error(start.error || t("canvas.genFail"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(t("canvas.genFail"));
      const deadline = Date.now() + 6 * 60 * 1000;
      let newId: string | null = null;
      let newIds: string[] = [];
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline) throw new Error(t("canvas.genFail"));
        const pr = await fetch(
          `/api/generate-image?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const pj = await readJsonSafe(pr);
        if (pj.status === "done") {
          newIds = ((pj.images ?? []) as { id?: string }[])
            .map((im) => im.id)
            .filter((x): x is string => !!x);
          newId = newIds[0] ?? null;
          if (pj.user) applyServerUser(pj.user); // 即时回写余额积分
          break;
        }
        if (pj.status === "error") {
          throw new Error(pj.error || t("canvas.genFail"));
        }
      }
      setExtraFiles([]);
      setExtraPreviews([]);
      // 把新节点落到"生成中占位"所在的位置(源节点右侧,或用户拖动后的位置),
      // 这样生成完成后不会跳到自动布局的位置 —— 与图1的占位位置一致。
      const srcNode = rfNodes.find((n) => n.id === source.id);
      const basePos =
        pendingPosRef.current ??
        (srcNode
          ? { x: srcNode.position.x + NODE_W + X_GAP, y: srcNode.position.y }
          : null);
      if (basePos && newIds.length) {
        await Promise.all(
          newIds.map((id, i) =>
            fetch("/api/artworks/position", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: user.email,
                id,
                x: Math.round(basePos.x + i * (NODE_W + 20)),
                y: Math.round(basePos.y),
              }),
            }).catch(() => {})
          )
        );
      }
      await mergeWorks(newIds); // 补这次新生成的几张(已带上面保存的坐标),不整表重拉
      if (newId) {
        setSelectedId(newId); // 选中新生成的子节点,便于继续迭代(但不移动/缩放画布)
      }
    } catch (e) {
      setGenError(
        e instanceof Error && e.message ? e.message : t("canvas.genFail")
      );
    } finally {
      setGenSourceId(null);
      setGenerating(false);
    }
  }

  // 抠图:不走生成(不重绘主体),调自托管 rembg 服务把主体原样抠出、背景置透明。
  // 同步返回,新节点落在生成占位处,挂在源节点下。
  async function runCutout(source: Artwork, quality: "fast" | "fine" = "fine") {
    if (readOnly || !user || generating) return;
    setSelectedId(source.id);
    setGenSourceId(source.id);
    pendingPosRef.current = null;
    setGenerating(true);
    setGenError(null);
    try {
      const fd = new FormData();
      fd.append("sourceUrl", source.image);
      fd.append("email", user.email);
      fd.append("parentId", source.id);
      fd.append("title", `${source.title || "作品"} · 抠图`);
      fd.append("category", source.category || "main");
      fd.append("ratio", source.ratio || "1:1");
      fd.append("resolution", source.resolution || "1K");
      // 抠图统一发丝级(Replicate),扣 1 积分/张,与抠图页一致
      fd.append("quality", quality);
      const res = await fetch("/api/cutout", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const j = await readJsonSafe(res);
      if (!res.ok || !j.ok) throw new Error(j.error || t("canvas.genFail"));
      const newId: string | undefined = j.id;
      if (!newId) throw new Error(t("canvas.genFail"));
      if (j.user) applyServerUser(j.user); // 即时回写余额积分(扣 1 分)
      // 落到生成占位处(源节点右侧或用户拖动后的位置),与生成流一致
      const srcNode = rfNodes.find((n) => n.id === source.id);
      const basePos =
        pendingPosRef.current ??
        (srcNode
          ? { x: srcNode.position.x + NODE_W + X_GAP, y: srcNode.position.y }
          : null);
      if (basePos) {
        await fetch("/api/artworks/position", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            id: newId,
            x: Math.round(basePos.x),
            y: Math.round(basePos.y),
          }),
        }).catch(() => {});
      }
      await mergeWorks([newId]);
      setSelectedId(newId);
    } catch (e) {
      setGenError(
        e instanceof Error && e.message ? e.message : t("canvas.genFail")
      );
    } finally {
      setGenSourceId(null);
      setGenerating(false);
    }
  }

  // 面板「生成」:用编辑框提示词 + 参数 + 追加参考图(留空=按这张图再生成一张)
  async function generateChild() {
    if (!selected) return;
    const text =
      editPrompt.trim() || selected.prompt || FAITHFUL_REGEN_PROMPT;
    // 新图 = 选中节点的子节点(落在它下方,血缘父=选中节点)。
    // 参考图 = dock 里可见的全部引用图(用户所见即所用,多图全送、不丢图)。
    // 若用户在 dock 删掉了自动引用图、改上传了自己的图:用上传图作参考。
    const useUploadAsBase = visibleDockRefs.length === 0 && extraFiles.length > 0;
    await runGen(selected, text, {
      ratio: genRatio,
      style: genStyle,
      count: genCount,
      resolution: genResolution,
      parentId: selected.id,
      baseFile: useUploadAsBase ? extraFiles[0] : undefined,
      extra: useUploadAsBase ? extraFiles.slice(1) : extraFiles,
      refUrls: useUploadAsBase ? [] : visibleDockRefs.map((r) => r.image),
    });
  }

  // 顶部图像工具条:6 个一键动作(预设提示词,各自衍生一个子节点)
  const QUICK_ACTIONS: {
    key: string;
    icon: LucideIcon;
    emoji: string;
    prompt: string;
    transparent?: boolean;
    resolution?: string;
  }[] = useMemo(
    () => [
      {
        key: "bg",
        icon: ImageIcon,
        emoji: "🖼",
        prompt:
          "在保持主体完全不变的前提下,把背景替换为简洁高级的纯色或微场景背景,光影与主体自然衔接,电商主图风格,商业产品摄影,干净通透",
      },
      {
        key: "cutout",
        icon: Scissors,
        emoji: "✂️",
        prompt: "精确沿主体边缘抠出主体,移除背景,输出干净的透明底 PNG",
        transparent: true,
      },
      {
        key: "relight",
        icon: Sun,
        emoji: "💡",
        prompt:
          "为主体重新布光,柔和专业的商业棚拍灯光,增强质感、立体感与高光层次,主体、角度与构图保持不变",
      },
      {
        key: "angle",
        icon: Rotate3d,
        emoji: "🧭",
        prompt:
          "保持同一主体、材质与风格,换一个拍摄视角(约 45° 侧前方)重新呈现,商业产品摄影,背景与光线协调一致",
      },
      {
        key: "caption",
        icon: Type,
        emoji: "🅣",
        prompt:
          "在画面留白区域加入精致的中文营销标题与卖点文案排版,字体现代、层级清晰、排版高级,主体保持不变,电商主图风格",
      },
      {
        key: "hd",
        icon: Wand2,
        emoji: "🔍",
        prompt:
          "在不改变画面内容、主体与构图的前提下,提升清晰度、细节与质感,输出高清成片",
        resolution: "2K",
      },
    ],
    []
  );
  function onQuickAction(action: string) {
    if (readOnly || !selected || generating) return;
    const a = QUICK_ACTIONS.find((x) => x.key === action);
    if (!a) return;
    // 抠图走专用自托管服务(不重绘主体);其余动作仍走 gpt-image 生成。
    if (a.key === "cutout") {
      void runCutout(selected);
      return;
    }
    void runGen(selected, a.prompt, {
      transparent: a.transparent,
      resolution: a.resolution,
      count: 1,
    });
  }
  // 抠图:统一发丝级(Replicate),扣 1 积分/张
  function onCutout(quality: string) {
    if (readOnly || !selected || generating) return;
    void runCutout(selected, quality === "fast" ? "fast" : "fine");
  }
  // 高清:按所选分辨率(1K/2K/4K)放大当前节点
  function onHd(resolution: string) {
    if (readOnly || !selected || generating) return;
    void runGen(
      selected,
      "在不改变画面内容、主体与构图的前提下,提升清晰度、细节与质感,输出高清成片",
      { resolution, count: 1 }
    );
  }
  // 改比例(ChatGPT 式重生成):拿当前节点自身的提示词 + 原图当参考,按目标比例重画一张。
  // 仿 ChatGPT「用不同宽高比生成此图片」——同主体/风格/配色,自然重构图,无需用户额外输入提示词。
  // 新图作为当前节点的子节点;只引用当前节点自己的图。
  function onRatioGen(ratio: string) {
    if (readOnly || !selected || generating) return;
    void runGen(selected, selected.prompt || "", {
      ratio,
      count: 1,
      resolution: selected.resolution || "1K",
      ratiogen: true,
      parentId: selected.id,
      refUrls: [selected.image],
    });
  }

  // 删除某节点(只删这一个,确认后调接口)。
  // 重要:绝不连删子孙、也不主动把子节点重挂到父节点 —— 其余所有节点的位置与父子关系一律不动。
  // (若删的是中间/根节点,其子节点的 parentId 会指向已删节点 → 画布上自然变成根,各自成项目,
  //  但没有任何数据丢失、位置也不变。)
  async function deleteTree(rootId: string) {
    if (readOnly || !user || !active) return;
    if (!active.members.some((m) => m.id === rootId)) return;
    const ids = [rootId];
    // 仅当这是项目里最后一个节点时,删完才算清空(回项目网格)
    const willEmpty = active.members.length === 1;
    setConfirmModal({
      title: t("canvas.deleteNodeTitle"),
      message: t("canvas.deleteOne"),
      confirmLabel: t("canvas.confirmDelete"),
      onConfirm: () => void runDelete(ids, willEmpty),
    });
  }
  // 真正执行删除(确认后)
  async function runDelete(ids: string[], willEmpty: boolean) {
    if (!user) return;
    // 捕获被删记录(供撤销恢复)
    const records = (works ?? []).filter((w) => ids.includes(w.id));
    setSelectedId(null);
    // 删空当前画布 → 回到项目网格,不自动弹出作品库里的旧图
    if (willEmpty) {
      setActiveKey(null);
      setCreatingNew(false);
      setBrowsing(true);
    }
    try {
      await fetch("/api/artworks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, ids }),
      });
      if (records.length) pushUndo({ kind: "delete", records });
    } catch {
      /* ignore */
    }
    removeWorksLocal(ids); // 本地移除,不整表重拉
  }

  // ── 撤销/重做(实用版)──
  function pushUndo(a: UndoAct) {
    setUndoStack((s) => [...s.slice(-30), a]);
    setRedoStack([]);
  }
  async function restoreRecordsSilent(records: Artwork[]) {
    if (!user || !records.length) return;
    await fetch("/api/artworks/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, records }),
    }).catch(() => {});
    restoreWorksLocal(records); // 已持有完整记录,本地恢复即可
  }
  async function deleteIdsSilent(ids: string[]) {
    if (!user || !ids.length) return;
    await fetch("/api/artworks/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, ids }),
    }).catch(() => {});
    removeWorksLocal(ids); // 本地移除,不整表重拉
  }
  function setPosSilent(id: string, x: number, y: number) {
    if (!user) return;
    setWorks((prev) =>
      prev ? prev.map((w) => (w.id === id ? { ...w, canvasX: x, canvasY: y } : w)) : prev
    );
    fetch("/api/artworks/position", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, id, x, y }),
    }).catch(() => {});
  }
  async function doUndo() {
    if (!undoStack.length) return;
    const act = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, act]);
    if (act.kind === "move") setPosSilent(act.id, act.from.x, act.from.y);
    else if (act.kind === "delete") await restoreRecordsSilent(act.records);
    else if (act.kind === "add") await deleteIdsSilent(act.records.map((r) => r.id));
  }
  async function doRedo() {
    if (!redoStack.length) return;
    const act = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, act]);
    if (act.kind === "move") setPosSilent(act.id, act.to.x, act.to.y);
    else if (act.kind === "delete") await deleteIdsSilent(act.records.map((r) => r.id));
    else if (act.kind === "add") await restoreRecordsSilent(act.records);
  }
  // 添加节点后记一笔可撤销(从刚刷新的列表取完整记录)
  function pushAddUndo(newId: string | null, fresh: Artwork[]) {
    if (!newId) return;
    const rec = fresh.find((a) => a.id === newId);
    if (rec) pushUndo({ kind: "add", records: [rec] });
  }
  // 批量删除选中的多个节点(框选 + Del)
  function batchDelete(ids: string[]) {
    if (readOnly || !user || !active) return;
    const real = ids.filter(
      (id) => !id.startsWith("pend-") && id !== "__pending__"
    );
    if (!real.length) return;
    const set = new Set(real);
    const willEmpty = active.members.every((m) => set.has(m.id));
    setConfirmModal({
      title: t("canvas.deleteNodeTitle"),
      message: fmt(t("canvas.deleteMany"), { n: real.length }),
      confirmLabel: t("canvas.confirmDelete"),
      onConfirm: () => void runDelete(real, willEmpty),
    });
  }
  // 删除当前选中节点(供面板按钮 / Delete 键)
  async function deleteSelected() {
    if (selected) await deleteTree(selected.id);
  }

  // 删除整个项目(其全部成员图)
  function deleteProject(p: Project) {
    if (readOnly || !user) return;
    const ids = p.members.map((m) => m.id);
    setConfirmModal({
      title: t("canvas.deleteProjectTitle"),
      message: fmt(t("canvas.deleteProject"), { n: ids.length }),
      confirmLabel: t("canvas.confirmDelete"),
      onConfirm: () => void runProjectDelete(p, ids),
    });
  }
  async function runProjectDelete(p: Project, ids: string[]) {
    if (!user) return;
    setSidebarOpen(false);
    // 删的是当前项目 → 回到项目网格(不自动跳到别的项目)
    if (p.key === activeKey) {
      setActiveKey(null);
      setSelectedId(null);
      setCreatingNew(false);
      setBrowsing(true);
    }
    try {
      await fetch("/api/artworks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, ids }),
      });
    } catch {
      /* ignore */
    }
    removeWorksLocal(ids); // 本地移除整组,不整表重拉
  }

  // 把当前项目所有图打包下载 ZIP(复用套图下载接口)
  async function downloadProject() {
    if (!active || zipping) return;
    setZipping(true);
    try {
      const items = active.members
        .filter((m) => /^https?:\/\//.test(m.image))
        .slice(0, 30)
        .map((m, i) => ({ url: m.image, name: m.title || `img-${i + 1}` }));
      const res = await fetch("/api/suite/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${active.name || "project"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    } finally {
      setZipping(false);
    }
  }

  // 拉线建节点(5b):+端口拖出 → onConnectStart 记源;落到别节点 onConnect(多输入=5d,暂忽略);
  // 落空白 onConnectEnd → 在释放点弹「新建节点」菜单(自动以源图为底图)。
  function onConnectStart(
    _e: unknown,
    params: { nodeId?: string | null; handleId?: string | null }
  ) {
    connectedRef.current = false;
    spawnSourceRef.current = params.nodeId ?? null;
  }
  function onConnect(conn: {
    source?: string | null;
    target?: string | null;
  }) {
    // 连到了某个目标节点 → 多输入(标记避免误弹新建菜单)
    connectedRef.current = true;
    const source = conn.source;
    const target = conn.target;
    if (!source || !target || source === target) return;
    if (source === "__pending__" || target === "__pending__") return;
    // 连到空白占位节点 → 加为它的输入(客户端)
    if (target.startsWith("pend-")) {
      setPendNodes((prev) =>
        prev.map((p) =>
          p.id === target
            ? {
                ...p,
                inputs: Array.from(new Set([...(p.inputs ?? []), source])),
              }
            : p
        )
      );
      return;
    }
    if (source.startsWith("pend-") || target.startsWith("pend-")) return;
    // 连到已有真实节点 → 多输入,写库(带防环)
    void addParentToNode(target, source);
  }
  // 多输入:给目标节点追加父节点(防环:源不能是目标的后代)
  async function addParentToNode(targetId: string, sourceId: string) {
    if (readOnly || !user || !active) return;
    const byId = new Map(active.members.map((m) => [m.id, m]));
    const parents = (id: string): string[] => {
      const m = byId.get(id);
      if (!m || m.source === "canvas-add") return [];
      const ps: string[] = [];
      if (m.parentId && byId.has(m.parentId)) ps.push(m.parentId);
      for (const pid of m.parentIds ?? [])
        if (pid && byId.has(pid)) ps.push(pid);
      return ps;
    };
    // target 是否是 source 的祖先?是则连接会成环,跳过
    const up = [sourceId];
    const seen = new Set<string>();
    let guard = 0;
    while (up.length && guard++ < 2000) {
      const id = up.pop() as string;
      if (id === targetId) {
        flashTip(t("canvas.linkCycle"));
        return;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      up.push(...parents(id));
    }
    try {
      await fetch("/api/artworks/parents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          id: targetId,
          parentId: sourceId,
        }),
      });
      await mergeWorks([targetId]); // 只补受影响的目标节点这一行
    } catch {
      /* ignore */
    }
  }
  // 剪断连线:把 source 从 target 的父节点(primary / parent_ids)里移除
  async function cutEdge(edge: { id: string; source: string; target: string }) {
    if (readOnly || !user) return;
    setEdgeCut(null);
    // 乐观:本地先去掉这条线,点击即刻有反馈
    setRfEdges((eds) => eds.filter((e) => e.id !== edge.id));
    try {
      await fetch("/api/artworks/parents", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          id: edge.target,
          parentId: edge.source,
        }),
      });
      await mergeWorks([edge.target]); // 只补受影响的目标节点这一行
    } catch {
      /* ignore — 本地已去掉,刷新会回落服务端 */
    }
  }
  function onConnectEnd(
    event: MouseEvent | TouchEvent,
    connectionState?: { isValid?: boolean | null }
  ) {
    const src = spawnSourceRef.current;
    spawnSourceRef.current = null;
    if (!src || src === "__pending__" || readOnly) return;
    // 落到了已有节点(有效连接)= 多输入,留 5d,不弹新建菜单
    if (connectionState?.isValid || connectedRef.current) return;
    const pt =
      "changedTouches" in event && event.changedTouches.length
        ? event.changedTouches[0]
        : (event as MouseEvent);
    const box = canvasAreaRef.current?.getBoundingClientRect();
    const x = box ? pt.clientX - box.left : pt.clientX;
    const y = box ? pt.clientY - box.top : pt.clientY;
    setCtxMenu(null);
    // 拉线落空白 → 在落点弹「新建节点」菜单(选类型后再建节点)
    setSpawnMenu({ x, y, sourceId: src });
  }
  // 拉线落空白后的「新建节点」菜单动作:图片 / 上传图片(都在落点建连着源图的节点)
  function spawnNode(type: string) {
    if (!spawnMenu) return;
    const { sourceId, x, y } = spawnMenu;
    setSpawnMenu(null);
    const pend = addPendAtScreen(x, y, sourceId, true);
    if (type === "upload") {
      // 节点 + 立刻弹出上传窗口
      onPendUpload(pend.id);
    } else {
      // 「图片」:落点建好节点后,把光标落进提示词框,写"改什么"→点生成出衍生(img2img)
      setEditPrompt("");
      wantFocusPendPrompt.current = true;
    }
  }
  // 右键菜单(5c):算出相对画布区的坐标后弹出
  function relPoint(e: { clientX: number; clientY: number }) {
    const box = canvasAreaRef.current?.getBoundingClientRect();
    return {
      x: box ? e.clientX - box.left : e.clientX,
      y: box ? e.clientY - box.top : e.clientY,
    };
  }
  function onNodeContextMenu(
    e: ReactMouseEvent,
    node: { id: string }
  ) {
    e.preventDefault();
    if (node.id === "__pending__") return;
    setSpawnMenu(null);
    const p = relPoint(e);
    setCtxMenu({ x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, nodeId: node.id });
  }
  function onPaneContextMenu(e: ReactMouseEvent | MouseEvent) {
    e.preventDefault();
    setSpawnMenu(null);
    const p = relPoint(e);
    setCtxMenu({ x: p.x, y: p.y, cx: e.clientX, cy: e.clientY });
  }
  // 整理画布:抛掉手动坐标,按血缘自动重排并持久化,再适应视图
  function tidyLayout() {
    if (!active || readOnly || !user) return;
    setCtxMenu(null);
    const stripped = active.members.map((m) => ({
      ...m,
      canvasX: null,
      canvasY: null,
    }));
    const { nodes: laid } = layoutGraph(stripped, "");
    const coord = new Map(
      laid.map((n) => [
        n.id,
        { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ])
    );
    setWorks((prev) =>
      prev
        ? prev.map((w) => {
            const c = coord.get(w.id);
            return c ? { ...w, canvasX: c.x, canvasY: c.y } : w;
          })
        : prev
    );
    for (const [id, c] of Array.from(coord.entries())) {
      fetch("/api/artworks/position", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, id, x: c.x, y: c.y }),
      }).catch(() => {});
    }
    setTimeout(
      () => rfRef.current?.fitView({ duration: 500, padding: 0.25, maxZoom: 1 }),
      60
    );
  }

  // 下载单张图
  async function downloadOne(image: string, name: string) {
    try {
      const r = await fetch(
        `/api/download?u=${encodeURIComponent(image)}&n=${encodeURIComponent(
          (name || "image").replace(/[^\w.-]+/g, "_") + ".png"
        )}`
      );
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "image").replace(/[^\w.-]+/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  // 当前项目的根 id(用于把手动加的节点归到当前项目,而非自成新项目)
  function activeRootId(): string | null {
    if (!active) return null;
    const ids = new Set(active.members.map((m) => m.id));
    const root = active.members.find(
      (m) => !(m.parentId && ids.has(m.parentId))
    );
    return root?.id ?? active.members[0]?.id ?? null;
  }
  // ── 节点操作(真功能,对齐原型右键菜单)──
  // 创建副本 / 粘贴:复制成一个独立节点(无连线),落在源节点旁边
  async function duplicateArt(a: Artwork) {
    if (readOnly || !user) return;
    // 落点:源节点当前位置右下偏移
    const sn = rfNodes.find((n) => n.id === a.id);
    const sx = sn?.position.x ?? a.canvasX ?? 0;
    const sy = sn?.position.y ?? a.canvasY ?? 0;
    try {
      const r = await fetch("/api/artworks/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          parentId: activeRootId(), // 归当前项目(但 source=canvas-add 不画线)
          x: Math.round(sx + 40),
          y: Math.round(sy + NODE_H + 30),
          src: {
            image: a.image,
            title: `${a.title} 副本`,
            category: a.category,
            prompt: a.prompt,
            style: a.style,
            ratio: a.ratio,
            resolution: a.resolution,
          },
        }),
      });
      const d = await r.json();
      if (d?.id) pendingNodeRef.current = d.id; // 选中新节点
      const fresh = await mergeWorks(d?.id ? [d.id] : []);
      pushAddUndo(d?.id ?? null, fresh);
    } catch {
      /* ignore */
    }
  }
  // 上传图片作新节点:落在当前项目、鼠标位置(uploadCtxRef);无上下文时退回新根
  async function uploadRoot(files: FileList | null) {
    if (readOnly || !user || !files?.length) return;
    const ctx = uploadCtxRef.current;
    uploadCtxRef.current = null;
    const fd = new FormData();
    fd.append("email", user.email);
    fd.append("image", files[0]);
    if (ctx?.parentId) fd.append("parentId", ctx.parentId);
    if (ctx) {
      fd.append("x", String(Math.round(ctx.x)));
      fd.append("y", String(Math.round(ctx.y)));
    }
    try {
      const r = await fetch("/api/artworks/add", { method: "POST", body: fd });
      const d = await r.json();
      if (d?.id) pendingNodeRef.current = d.id; // 切到新节点并选中(在当前项目内则不切项目)
      const fresh = await mergeWorks(d?.id ? [d.id] : []);
      pushAddUndo(d?.id ?? null, fresh);
    } catch {
      /* ignore */
    }
    if (rootUploadRef.current) rootUploadRef.current.value = "";
  }
  // 在画布某屏幕点(相对画布区)上传图片:落在当前项目、该点的画布坐标
  function triggerUpload(screenX: number, screenY: number) {
    const z = viewport.zoom || 1;
    const wx = (screenX - viewport.x) / z - NODE_W / 2;
    const wy = (screenY - viewport.y) / z - NODE_H / 2;
    let parentId: string | null = null;
    if (active) {
      const ids = new Set(active.members.map((m) => m.id));
      const root = active.members.find(
        (m) => !(m.parentId && ids.has(m.parentId))
      );
      parentId = root?.id ?? active.members[0]?.id ?? null;
    }
    uploadCtxRef.current = { parentId, x: wx, y: wy };
    rootUploadRef.current?.click();
  }
  // 从生成历史选择:在画布某点打开作品选择器
  function openHistoryPicker(screenX: number, screenY: number) {
    const z = viewport.zoom || 1;
    const wx = (screenX - viewport.x) / z - NODE_W / 2;
    const wy = (screenY - viewport.y) / z - NODE_H / 2;
    setHistoryPicker({ x: wx, y: wy });
  }
  // 选中历史作品 → 作为节点加入当前项目(落在记下的点)
  async function addFromHistory(a: Artwork) {
    if (readOnly || !user || !historyPicker) return;
    let parentId: string | null = null;
    if (active) {
      const ids = new Set(active.members.map((m) => m.id));
      const root = active.members.find(
        (m) => !(m.parentId && ids.has(m.parentId))
      );
      parentId = root?.id ?? active.members[0]?.id ?? null;
    }
    const pos = historyPicker;
    setHistoryPicker(null);
    try {
      const r = await fetch("/api/artworks/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          parentId,
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          src: {
            image: a.image,
            title: a.title,
            category: a.category,
            prompt: a.prompt,
            style: a.style,
            ratio: a.ratio,
            resolution: a.resolution,
          },
        }),
      });
      const d = await r.json();
      if (d?.id) pendingNodeRef.current = d.id;
      const fresh = await mergeWorks(d?.id ? [d.id] : []);
      pushAddUndo(d?.id ?? null, fresh);
    } catch {
      /* ignore */
    }
  }
  // 在画布某屏幕点新建一个空白占位节点(linked=拉线建的,连源节点)
  function addPendAtScreen(
    screenX: number,
    screenY: number,
    parentId: string | null,
    linked: boolean
  ): Pend {
    const z = viewport.zoom || 1;
    const wx = (screenX - viewport.x) / z - NODE_W / 2;
    const wy = (screenY - viewport.y) / z - NODE_H / 2;
    const seq = pendSeqRef.current++;
    const id = `pend-${Date.now()}-${seq}`;
    const pend: Pend = {
      id,
      x: wx,
      y: wy,
      parentId,
      linked,
      label: `${t("canvas.imageNode")} ${seq}`,
      uploading: false,
      progress: 0,
      inputs: linked && parentId ? [parentId] : [],
    };
    setPendNodes((prev) => [...prev, pend]);
    // 选中新空白节点 → 自动出生成 dock(图3:加节点即可直接写提示词生成)
    setSelectedId(null);
    setSelectedPendId(id);
    return pend;
  }
  function flashTip(m: string) {
    setTipMsg(m);
    setTimeout(() => setTipMsg(null), 1900);
  }
  // 画布可视区中心(屏幕坐标,相对画布区)
  function centerScreen() {
    const box = canvasAreaRef.current;
    return {
      x: (box?.clientWidth ?? 600) / 2,
      y: (box?.clientHeight ?? 400) / 2,
    };
  }
  // 底部工具条:＋ 添加空白节点(画布中心)
  function toolAddNode() {
    if (readOnly) return;
    const c = centerScreen();
    addPendAtScreen(c.x, c.y, null, false);
  }
  // 底部工具条:✦ 生成衍生(选中则聚焦生成器,否则选根/提示)
  function toolGenerate() {
    if (readOnly) return;
    if (selected) {
      setFocusId(selected.id);
      return;
    }
    const root = activeRootId();
    if (root) {
      setSelectedId(root);
      setFocusId(root);
    } else {
      flashTip(t("canvas.tipSelectFirst"));
    }
  }
  // 底部工具条:🕘 从生成历史选择(画布中心)
  function toolHistory() {
    if (readOnly) return;
    const c = centerScreen();
    openHistoryPicker(c.x, c.y);
  }
  function onPendUpload(id: string) {
    pendUploadTargetRef.current = id;
    pendUploadRef.current?.click();
  }
  function onPendRemove(id: string) {
    setPendNodes((prev) => prev.filter((p) => p.id !== id));
    setSelectedPendId((cur) => (cur === id ? null : cur));
  }
  // 空白节点生成(文生图 / 合并多输入):用 dock 的提示词 + 输入图(若有)生成,填充本节点
  async function generatePend(opts?: {
    pend?: Pend;
    prompt?: string;
    ratio?: string;
  }) {
    if (readOnly || !user || generating) return;
    // 可传入指定的空白节点(拉线「生成衍生图」用,避免依赖尚未刷新的 state)
    const pend = opts?.pend ?? pendNodes.find((p) => p.id === selectedPendId);
    if (!pend) return;
    const text = (opts?.prompt ?? editPrompt).trim();
    if (!text && !pend.inputs.length) {
      flashTip(t("canvas.pendNeedPrompt"));
      return;
    }
    const inputArts = pend.inputs
      .map((id) => active?.members.find((m) => m.id === id))
      .filter(Boolean) as Artwork[];
    // 没写提示词时:不再注入"生成一张电商商业图"这种会重绘/改风格的通用词
    // (那会让输出莫名其妙变样,还被存成节点提示词)。改为沿用主输入图自身的
    // 提示词(延续它的配方);没有则用"保持主体/构图/风格"的中性词。
    const promptToUse =
      text || inputArts[0]?.prompt?.trim() || FAITHFUL_REGEN_PROMPT;
    setGenerating(true);
    setGenError(null);
    setPendNodes((prev) =>
      prev.map((p) => (p.id === pend.id ? { ...p, generating: true } : p))
    );
    try {
      const fd = new FormData();
      fd.append("prompt", promptToUse);
      fd.append("category", "main");
      fd.append("ratio", opts?.ratio || genRatio || "auto");
      fd.append("resolution", genResolution);
      fd.append("style", genStyle ?? "");
      fd.append("count", String(genCount || 1));
      fd.append("email", user.email);
      fd.append("origin", "canvas"); // 画布里产出 → 永远留画布
      // 主父 = 第一个输入;其余进 parentIds
      if (inputArts.length) {
        fd.append("parentId", inputArts[0].id);
        fd.append(
          "parentIds",
          JSON.stringify(inputArts.slice(1).map((a) => a.id))
        );
      }
      // 把每个输入图下载后作为参考图一起送(图生图/合并);无输入=纯文生图
      for (const a of inputArts) {
        const dl = await fetch(
          `/api/download?u=${encodeURIComponent(a.image)}&n=ref.png`
        );
        if (dl.ok) {
          const blob = await dl.blob();
          fd.append(
            "image",
            new File([blob], "ref.png", { type: blob.type || "image/png" })
          );
        }
      }
      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await readJsonSafe(startRes);
      if (!startRes.ok) throw new Error(start.error || t("canvas.genFail"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(t("canvas.genFail"));
      const deadline = Date.now() + 6 * 60 * 1000;
      let newId: string | null = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline) throw new Error(t("canvas.genFail"));
        const pr = await fetch(
          `/api/generate-image?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const pj = await readJsonSafe(pr);
        if (pj.status === "done") {
          newId = pj.images?.[0]?.id ?? null;
          if (pj.user) applyServerUser(pj.user); // 即时回写余额积分
          break;
        }
        if (pj.status === "error")
          throw new Error(pj.error || t("canvas.genFail"));
      }
      // 把生成结果落到空白节点的位置
      if (newId) {
        await fetch("/api/artworks/position", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            id: newId,
            x: Math.round(pend.x),
            y: Math.round(pend.y),
          }),
        }).catch(() => {});
        pendingNodeRef.current = newId;
      }
      setPendNodes((prev) => prev.filter((p) => p.id !== pend.id));
      setSelectedPendId(null);
      const fresh = await mergeWorks(newId ? [newId] : []);
      pushAddUndo(newId, fresh);
    } catch (e) {
      setGenError(
        e instanceof Error && e.message ? e.message : t("canvas.genFail")
      );
      setPendNodes((prev) =>
        prev.map((p) => (p.id === pend.id ? { ...p, generating: false } : p))
      );
    } finally {
      setGenerating(false);
    }
  }
  // 占位节点里选了图片 → 带进度上传 → 完成后移除占位、刷新出真节点
  function doUploadPend(files: FileList | null) {
    const pendId = pendUploadTargetRef.current;
    pendUploadTargetRef.current = null;
    // 必须先取出 File 再清空 input —— input.value="" 会清空这个"活的"FileList,
    // 若先清空,后面 files[0] 就拿不到文件了(之前上传无反应的根因)。
    const file = files && files.length ? files[0] : null;
    if (pendUploadRef.current) pendUploadRef.current.value = "";
    if (!pendId || !file || !user) return;
    const pend = pendNodes.find((p) => p.id === pendId);
    if (!pend) return;
    const info = `${file.name} · ${Math.round(file.size / 1024)}KB`;
    setPendNodes((prev) =>
      prev.map((p) =>
        p.id === pendId
          ? { ...p, uploading: true, progress: 0, fileInfo: info }
          : p
      )
    );
    const fd = new FormData();
    fd.append("email", user.email);
    fd.append("image", file);
    // 有输入(拉线/连多输入)→挂第一个输入并画线;否则挂当前项目根、独立无线
    if (pend.inputs && pend.inputs.length) {
      fd.append("parentId", pend.inputs[0]);
      fd.append("linked", "1");
    } else {
      const root = activeRootId();
      if (root) fd.append("parentId", root);
    }
    fd.append("x", String(Math.round(pend.x)));
    fd.append("y", String(Math.round(pend.y)));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/artworks/add");
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = (e.loaded / e.total) * 100;
        setPendNodes((prev) =>
          prev.map((p) => (p.id === pendId ? { ...p, progress: pct } : p))
        );
      };
    }
    xhr.onload = () => {
      let newId: string | null = null;
      try {
        newId = (JSON.parse(xhr.responseText) as { id?: string }).id ?? null;
      } catch {
        /* ignore */
      }
      setPendNodes((prev) => prev.filter((p) => p.id !== pendId));
      setSelectedPendId((cur) => (cur === pendId ? null : cur));
      if (newId) pendingNodeRef.current = newId;
      void mergeWorks(newId ? [newId] : []).then((fresh) =>
        pushAddUndo(newId, fresh)
      );
    };
    xhr.onerror = () => {
      setPendNodes((prev) =>
        prev.map((p) => (p.id === pendId ? { ...p, uploading: false } : p))
      );
    };
    xhr.send(fd);
  }
  function showCopyTip() {
    setCopyTip(true);
    setTimeout(() => setCopyTip(false), 1500);
  }
  // 复制图片到系统剪贴板(剪贴板只可靠支持 PNG,非 PNG 先转码;失败退回复制图片链接)
  async function copyImageToClipboard(image: string) {
    try {
      const res = await fetch(
        `/api/download?u=${encodeURIComponent(image)}&n=img.png`
      );
      let blob = await res.blob();
      if (blob.type !== "image/png") {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")?.drawImage(bmp, 0, 0);
        blob = await new Promise<Blob>((resolve) =>
          c.toBlob((b) => resolve(b as Blob), "image/png")
        );
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showCopyTip();
    } catch {
      try {
        await navigator.clipboard.writeText(cdnUrl(image));
        showCopyTip();
      } catch {
        /* ignore */
      }
    }
  }
  function copyNodeToClip(a: Artwork) {
    nodeClipRef.current = a;
    setHasClip(true);
  }
  async function pasteNode() {
    if (nodeClipRef.current) await duplicateArt(nodeClipRef.current);
  }

  // 拖拽后记住节点坐标(本地即时生效 + 异步持久化)
  function saveNodePosition(id: string, x: number, y: number) {
    if (readOnly || id === "__pending__" || !user) return;
    setWorks((prev) =>
      prev
        ? prev.map((w) =>
            w.id === id ? { ...w, canvasX: x, canvasY: y } : w
          )
        : prev
    );
    fetch("/api/artworks/position", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, id, x, y }),
    }).catch(() => {});
  }

  // 生成完成后自动平移聚焦到新节点
  useEffect(() => {
    if (!focusId || !rfRef.current) return;
    if (!nodes.some((n) => n.id === focusId)) return;
    rfRef.current.fitView({
      nodes: [{ id: focusId }],
      duration: 600,
      maxZoom: 1.2,
      padding: 0.6,
    });
    setFocusId(null);
  }, [focusId, nodes]);

  // 键盘:Delete 删除(支持框选批量)· ⌘/Ctrl+Z 撤销 · ⌘/Ctrl+⇧+Z 重做;输入框内不触发
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (readOnly) return;
        e.preventDefault();
        if (e.shiftKey) void doRedo();
        else void doUndo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (readOnly) return;
        e.preventDefault();
        void doRedo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (readOnly || generating) return;
        const realSel = multiSel.filter(
          (id) => !id.startsWith("pend-") && id !== "__pending__"
        );
        if (realSel.length > 1) {
          e.preventDefault();
          batchDelete(realSel);
        } else if (selectedId) {
          e.preventDefault();
          void deleteSelected();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, selectedId, generating, multiSel, undoStack, redoStack]);

  // Ctrl/⌘ + 滚轮:阻止浏览器整页缩放(画布内由 React Flow 自己缩放)
  useEffect(() => {
    if (!ready || !user) return;
    const el = canvasAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, user, browsing]);

  if (!ready || !user) {
    return (
      <div className="container py-20 text-sm text-muted-foreground">
        {t("canvas.loading")}
      </div>
    );
  }

  const loading = persistMode === "server" && works === null;

  // dock 里的「比例·分辨率」按钮(对齐参考站图1)。面板用 portal 渲染到 body,
  // 脱离 dock 的 overflow-hidden(否则向上展开的分辨率行会被裁掉)。
  const openRatioMenu = () => {
    const r = ratioBtnRef.current?.getBoundingClientRect();
    if (r) setRatioMenuRect({ left: r.left, top: r.top });
    setRatioMenuOpen((v) => !v);
  };
  const ratioControl = (
    <button
      ref={ratioBtnRef}
      type="button"
      onClick={openRatioMenu}
      className="flex items-center gap-1.5 rounded-[9px] bg-[#1f2229] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#e7e9ee] transition-colors hover:bg-[#262a33]"
    >
      📐
      <span>
        {genRatio === "auto" ? t("canvas.ratioAuto") : genRatio} ·{" "}
        {genResolution}
      </span>
      <ChevronDown
        className={cn(
          "h-3 w-3 text-[#9aa1ae] transition-transform",
          ratioMenuOpen && "rotate-180"
        )}
      />
    </button>
  );
  const ratioMenu =
    ratioMenuOpen && ratioMenuRect
      ? createPortal(
          <div
            className="dark fixed inset-0 z-[200]"
            onClick={() => setRatioMenuOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                left: Math.max(
                  8,
                  Math.min(
                    ratioMenuRect.left,
                    (typeof window !== "undefined" ? window.innerWidth : 9999) -
                      344
                  )
                ),
                bottom:
                  (typeof window !== "undefined" ? window.innerHeight : 0) -
                  ratioMenuRect.top +
                  8,
              }}
              className="menu-pop-up fixed w-[336px] rounded-2xl border border-[#2a2d36] bg-[#191b21] p-4 text-[#e7e9ee] shadow-2xl"
            >
              <p className="mb-2 text-[12px] font-semibold text-[#9aa1ae]">
                {t("canvas.resolution")}
              </p>
              <div className="mb-4 grid grid-cols-3 gap-2">
                {CANVAS_RES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setGenResolution(r)}
                    className={cn(
                      "rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                      genResolution === r
                        ? "border-white/70 bg-[#2a2e38] text-white"
                        : "border-[#2a2d36] bg-[#1f2229] text-[#9aa1ae] hover:text-white"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="mb-2 text-[12px] font-semibold text-[#9aa1ae]">
                {t("canvas.ratio")}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {CANVAS_RATIOS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setGenRatio(r.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 rounded-xl border py-2.5 transition-colors",
                      genRatio === r.id
                        ? "border-white/70 bg-[#2a2e38] text-white"
                        : "border-[#2a2d36] bg-[#1f2229] text-[#9aa1ae] hover:text-white"
                    )}
                  >
                    <RatioIcon w={r.w} h={r.h} />
                    <span className="text-[11px] font-medium leading-none">
                      {r.id === "auto" ? t("canvas.ratioAuto") : r.id}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <PendContext.Provider value={{ onUpload: onPendUpload, onRemove: onPendRemove }}>
    <div className="dark flex h-dvh flex-col bg-background text-foreground">
      {ratioMenu}
      {/* 占位节点上传用的隐藏 input */}
      <input
        ref={pendUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => doUploadPend(e.target.files)}
      />
      {/* 顶栏:仅项目网格落地页显示(进入项目后用全屏悬浮挂件,见下) */}
      {browsing && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          {/* 左上:画布专属 logo(回主页) */}
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRAND_CANVAS_LOGO}
              alt={BRAND}
              className="h-9 w-auto max-w-[180px] object-contain"
            />
            {readOnly && (
              <span className="flex-none rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                只读·查看用户
              </span>
            )}
          </Link>
          {/* 右上:与画布右上角一致(分享暂无项目,故只放 模板/会员/头像) */}
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => openModal("templates")}
              title={t("nav.templates")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ShoppingBag className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openModal("plans")}
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-xs font-semibold text-amber-500 shadow-sm transition-colors hover:bg-amber-400/20"
            >
              <Crown className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t("canvas.memberDeal")}</span>
              <span className="flex items-center gap-0.5">
                <Zap className="h-3 w-3" />
                {credits != null ? credits : "—"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openModal("account")}
              title={user.email}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold uppercase text-primary-foreground shadow-sm"
            >
              {user.email?.[0] ?? "U"}
            </button>
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* 左上项目下拉:点击外部关闭 */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={cn(
            "absolute left-3 top-[60px] z-40 flex max-h-[min(72vh,540px)] w-[200px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150",
            sidebarOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-1 opacity-0"
          )}
        >
          {/* 项目菜单(对齐原型图3:回到主页/全部项目/创建新项目/重命名/删除项目) */}
          <div className="flex-none border-b border-border p-1.5">
            {/* 全部项目 = 画布的项目网格(不是作品库) */}
            <button
              type="button"
              onClick={backToBrowser}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              {t("canvas.allProjects")}
            </button>
            <Link
              href="/"
              onClick={() => setSidebarOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Home className="h-4 w-4 text-muted-foreground" />
              {t("canvas.home")}
            </Link>
            {/* 作品库 = 所有生成作品的画廊(/dashboard),与画布项目区分开 */}
            <Link
              href="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              {t("nav.dashboard")}
            </Link>
            {/* 回收站:已删除的作品(保留 180 天,可恢复) */}
            {!readOnly && (
              <button
                type="button"
                onClick={openTrash}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                {t("canvas.trash")}
              </button>
            )}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={startNewProject}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              {t("canvas.newProject")}
            </button>
            {active && !readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    // 关掉下拉,改名统一在左上 pill 内联完成(避免双输入抢焦点)
                    setSidebarOpen(false);
                    setRenamingKey(active.key);
                    setRenameValue(active.name);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  {t("canvas.rename")}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteProject(active)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("canvas.deleteProjectShort")}
                </button>
              </>
            )}
          </div>
        </aside>

        {/* 右:画布 */}
        <div
          ref={canvasAreaRef}
          className="relative min-w-0 flex-1"
          style={{
            // 画布底色 + 点阵,像素级对齐原型 .cvz/.board
            backgroundColor: "#0e0f13",
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("canvas.loading")}
            </div>
          ) : browsing ? (
            /* 项目网格落地页(对齐 Fuser:轻量缩略图 + 标题下置,留白更精致) */
            <div className="h-full overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
              <div className="w-full">
                {/* 标题栏:全部项目(对齐参考图,去掉 hero 横幅) */}
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("canvas.allProjects")}
                  </h2>
                </div>

                {/* 点开「...」菜单时的点击外部关闭层 */}
                {projMenuKey && (
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setProjMenuKey(null)}
                  />
                )}

                {/* 大屏不留白:卡片维持参考图尺寸,宽了就多排(5→6→7→8 列) */}
                <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 min-[1920px]:grid-cols-6 min-[2320px]:grid-cols-7 min-[2720px]:grid-cols-8">
                  {/* 首卡:实色渐变「开始创作」 */}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={startNewProject}
                      className="group flex flex-col gap-2.5 text-left"
                    >
                      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c2433] to-[#11141b] text-muted-foreground transition-all group-hover:border-primary/50 group-hover:text-foreground">
                        <Plus className="h-7 w-7" strokeWidth={1.5} />
                        <span className="text-sm font-medium">
                          {t("canvas.startCreate")}
                        </span>
                      </div>
                      <div className="px-0.5">
                        <div className="text-sm font-medium text-foreground">
                          {t("canvas.blankProjectSub")}
                        </div>
                      </div>
                    </button>
                  )}

                  {projects.map((p) => (
                    <div key={p.key} className="group flex flex-col gap-2.5">
                      {/* 封面 */}
                      <button
                        type="button"
                        onClick={() => openProject(p.key)}
                        title={p.name}
                        className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-secondary ring-1 ring-white/10 transition-all group-hover:ring-2 group-hover:ring-primary/50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cdnUrl(p.cover)}
                          alt={p.name}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      </button>
                      {/* 标题 + 日期 + 「...」菜单 */}
                      <div className="flex min-w-0 items-start justify-between gap-2 px-0.5">
                        <div className="min-w-0 flex-1">
                          {renamingKey === p.key && !readOnly ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onFocus={(e) => e.currentTarget.select()}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") {
                                  cancelEditRef.current = true;
                                  setRenamingKey(null);
                                }
                              }}
                              onBlur={() => {
                                if (cancelEditRef.current) {
                                  cancelEditRef.current = false;
                                  return;
                                }
                                saveRename(p.key);
                              }}
                              maxLength={60}
                              className="w-full rounded-md border border-primary/60 bg-background px-1.5 py-0.5 text-sm font-medium text-foreground outline-none"
                            />
                          ) : (
                            <div className="truncate text-sm font-medium text-foreground">
                              {p.name}
                            </div>
                          )}
                          <div className="truncate text-[11px] text-muted-foreground">
                            {formatDate(p.latestAt)}
                          </div>
                        </div>
                        {!readOnly && (
                          <div className="relative flex-none">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProjMenuKey((k) =>
                                  k === p.key ? null : p.key
                                );
                              }}
                              title={t("canvas.more")}
                              className="-mr-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {projMenuKey === p.key && (
                              <div className="menu-pop-down absolute right-0 top-9 z-30 w-32 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-2xl">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProjMenuKey(null);
                                    setRenamingKey(p.key);
                                    setRenameValue(p.name);
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                                >
                                  <Pencil className="h-4 w-4 text-muted-foreground" />
                                  {t("canvas.rename")}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProjMenuKey(null);
                                    deleteProject(p);
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {t("canvas.deleteProjectShort")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {projects.length > 0 ? (
                  <div className="py-10 text-center text-xs text-muted-foreground">
                    {t("canvas.noMore")}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <p className="max-w-sm text-sm text-muted-foreground">
                      {t("canvas.empty")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ReactFlow
              key={active?.key ?? "__new__"}
              colorMode="dark"
              style={{ background: "transparent" }}
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(inst) => {
                rfRef.current = inst;
                setViewport(inst.getViewport());
              }}
              onMove={(_, vp) => setViewport(vp)}
              onNodeClick={(_, node) => {
                if (node.id === "__pending__") return;
                if (node.id.startsWith("pend-")) {
                  // 选中空白节点 → 出文生图/合并 dock
                  setSelectedId(null);
                  setSelectedPendId(node.id);
                  return;
                }
                setSelectedPendId(null);
                setSelectedId(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                const m = active?.members.find((x) => x.id === node.id);
                if (m) setLightbox({ src: m.image, alt: m.title });
              }}
              // 连线交互:悬停出剪刀(跟随光标)、点击线即剪断
              onEdgeMouseMove={
                readOnly
                  ? undefined
                  : (ev, edge) => {
                      const rect =
                        canvasAreaRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setEdgeCut({
                        id: edge.id,
                        source: edge.source,
                        target: edge.target,
                        x: ev.clientX - rect.left,
                        y: ev.clientY - rect.top,
                      });
                    }
              }
              onEdgeMouseLeave={readOnly ? undefined : () => setEdgeCut(null)}
              onEdgeClick={
                readOnly
                  ? undefined
                  : (_, edge) =>
                      void cutEdge({
                        id: edge.id,
                        source: edge.source,
                        target: edge.target,
                      })
              }
              onPaneClick={() => {
                setSelectedId(null);
                setSelectedPendId(null);
                setCtxMenu(null);
                setEdgeCut(null);
              }}
              onMoveStart={() => {
                if (spawnMenu) setSpawnMenu(null);
                if (ctxMenu) setCtxMenu(null);
              }}
              onNodeContextMenu={onNodeContextMenu}
              onPaneContextMenu={onPaneContextMenu}
              onSelectionChange={({ nodes: sel }) => {
                const ids = sel.map((n) => n.id);
                // 只在选中集合"真的变化"时才更新,否则会和受控选中态形成无限 setState 循环(React #185)
                setMultiSel((prev) =>
                  prev.length === ids.length &&
                  prev.every((v, i) => v === ids[i])
                    ? prev
                    : ids
                );
              }}
              onNodeDragStart={(_, node) => {
                dragStartRef.current = {
                  id: node.id,
                  x: node.position.x,
                  y: node.position.y,
                };
              }}
              onNodeDragStop={(_, node) => {
                if (node.id === "__pending__") {
                  // 生成中占位:记住拖到的位置(重渲染不再打回默认位)
                  pendingPosRef.current = {
                    x: node.position.x,
                    y: node.position.y,
                  };
                  return;
                }
                if (node.id.startsWith("pend-")) {
                  setPendNodes((prev) =>
                    prev.map((p) =>
                      p.id === node.id
                        ? { ...p, x: node.position.x, y: node.position.y }
                        : p
                    )
                  );
                  return;
                }
                const st = dragStartRef.current;
                if (
                  st &&
                  st.id === node.id &&
                  (Math.round(st.x) !== Math.round(node.position.x) ||
                    Math.round(st.y) !== Math.round(node.position.y))
                ) {
                  pushUndo({
                    kind: "move",
                    id: node.id,
                    from: { x: st.x, y: st.y },
                    to: { x: node.position.x, y: node.position.y },
                  });
                }
                saveNodePosition(node.id, node.position.x, node.position.y);
              }}
              onConnectStart={onConnectStart}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.15}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={!readOnly}
              deleteKeyCode={null}
              panOnDrag={[0, 1]}
              selectionKeyCode="Shift"
              panOnScroll
              zoomOnScroll={false}
              zoomOnPinch
              zoomActivationKeyCode="Control"
              snapToGrid={snapGrid}
              snapGrid={[16, 16]}
              onlyRenderVisibleElements={rfNodes.length > 60}
            >
              {showMinimap && (
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-left"
                  // 显示在左下角工具条上方(而不是右侧)
                  style={{ left: 16, bottom: 72, margin: 0 }}
                  maskColor="rgba(0,0,0,0.55)"
                />
              )}
            </ReactFlow>
          )}

          {/* 剪刀:鼠标在连线上时跟随光标(pointer-events-none,点击穿透到线 → onEdgeClick 剪断) */}
          {!browsing && !readOnly && edgeCut && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: edgeCut.x, top: edgeCut.y }}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#1a1d24]/90 text-slate-100 shadow-lg backdrop-blur">
                <Scissors className="h-4 w-4" />
              </span>
            </div>
          )}

          {/* ── 进入项目后的全屏悬浮挂件(对齐原型:左上项目/右上挂件/底部工具条) ── */}
          {!browsing && (
            <>
              {/* 左上:logo(点开项目菜单) + 项目名(点进入内联编辑,失焦/回车确定) */}
              <div className="absolute left-3 top-3 z-30">
                <div
                  className={cn(
                    "flex items-center gap-0.5 rounded-xl border px-1.5 py-1.5 shadow-lg backdrop-blur transition-colors",
                    sidebarOpen
                      ? "border-[#3a414c] bg-[#2a2e38]"
                      : "border-white/10 bg-card/85"
                  )}
                >
                  {/* logo:点击展开「项目/重命名/删除…」菜单 */}
                  <button
                    type="button"
                    onClick={() => setSidebarOpen((v) => !v)}
                    title={BRAND}
                    className="flex flex-none items-center gap-1 rounded-lg px-1 pr-0.5 transition-colors hover:bg-white/5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={BRAND_CANVAS_LOGO}
                      alt={BRAND}
                      className="h-7 w-auto max-w-[140px] flex-none rounded-lg object-contain"
                    />
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 flex-none text-muted-foreground transition-transform",
                        sidebarOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {/* 项目名:只读时纯展示;否则点击进入内联编辑 */}
                  {renamingKey === active?.key && active && !readOnly ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          cancelEditRef.current = true;
                          setRenamingKey(null);
                        }
                      }}
                      onBlur={() => {
                        if (cancelEditRef.current) {
                          cancelEditRef.current = false;
                          return;
                        }
                        saveRename(active.key);
                      }}
                      maxLength={60}
                      placeholder={t("canvas.renamePlaceholder")}
                      className="ml-0.5 w-[180px] rounded-lg border border-primary/60 bg-background px-2 py-1 text-sm font-bold text-foreground outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (readOnly || !active) {
                          setSidebarOpen((v) => !v);
                          return;
                        }
                        setRenamingKey(active.key);
                        setRenameValue(active.name);
                      }}
                      title={
                        readOnly ? undefined : t("canvas.rename")
                      }
                      className="ml-0.5 max-w-[200px] truncate rounded-lg px-2 py-1 text-left text-sm font-bold text-foreground transition-colors hover:bg-white/5"
                    >
                      {active ? active.name : t("canvas.newProject")}
                    </button>
                  )}
                  {readOnly && (
                    <span className="flex-none rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                      只读
                    </span>
                  )}
                </div>
              </div>

              {/* 右上:分享(下载)/ 模板库 / 会员特惠+积分 / 头像 */}
              <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
                {active && (
                  <button
                    type="button"
                    onClick={downloadProject}
                    disabled={zipping}
                    title={t("canvas.downloadProject")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-card/85 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
                  >
                    {zipping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openModal("templates")}
                  title={t("nav.templates")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-card/85 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground"
                >
                  <ShoppingBag className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => openModal("plans")}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-xs font-semibold text-amber-300 shadow-lg backdrop-blur transition-colors hover:bg-amber-400/20"
                >
                  <Crown className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{t("canvas.memberDeal")}</span>
                  <span className="flex items-center gap-0.5">
                    <Zap className="h-3 w-3" />
                    {credits != null ? credits : "—"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openModal("account")}
                  title={user.email}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold uppercase text-primary-foreground shadow-lg"
                >
                  {user.email?.[0] ?? "U"}
                </button>
              </div>

              {/* 底部中间:工具条(选中节点时淡出滑下让位给生成器,对齐原型 czbc) */}
              {!readOnly && (
                <div
                  className={cn(
                    "absolute bottom-5 left-1/2 z-30 flex items-center gap-1 rounded-2xl border border-white/10 bg-card/90 p-1.5 shadow-2xl backdrop-blur transition-all duration-200",
                    selected || selectedPend
                      ? "pointer-events-none translate-x-[-50%] translate-y-4 opacity-0"
                      : "translate-x-[-50%] translate-y-0 opacity-100"
                  )}
                >
                  {/* ＋ 弹出「添加节点/上传图片/从生成历史选择」菜单 */}
                  {addMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-0"
                        onClick={() => setAddMenuOpen(false)}
                      />
                      <div className="menu-pop-up absolute bottom-[calc(100%+10px)] left-0 z-10 w-48 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setAddMenuOpen(false);
                            toolAddNode();
                          }}
                          className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                        >
                          {t("canvas.addNode")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddMenuOpen(false);
                            const c = centerScreen();
                            triggerUpload(c.x, c.y);
                          }}
                          className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                        >
                          {t("canvas.uploadImage")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddMenuOpen(false);
                            toolHistory();
                          }}
                          className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                        >
                          {t("canvas.fromHistory")}
                        </button>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setAddMenuOpen((v) => !v)}
                    title={t("canvas.addNode")}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl shadow-sm transition-colors",
                      addMenuOpen
                        ? "bg-primary/90 text-primary-foreground"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    <Plus
                      className={cn(
                        "h-4 w-4 transition-transform",
                        addMenuOpen && "rotate-45"
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => flashTip(t("canvas.linkTip"))}
                    title={t("canvas.linkTip")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toolGenerate}
                    title={t("canvas.spawnGenerate")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Sparkles className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toolHistory}
                    title={t("canvas.fromHistory")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Clock className="h-4 w-4" />
                  </button>
                  <span className="mx-0.5 h-5 w-px bg-border" />
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    title={t("canvas.shortcuts")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Keyboard className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    title={t("canvas.help")}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}

          {/* 新建项目空白画布:引导文案(右键即可加节点) */}
          {creatingNew && !active && pendNodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/20 text-2xl text-slate-500">
                ＋
              </div>
              <p className="max-w-xs text-sm text-slate-400">
                {t("canvas.newCanvasHint")}
              </p>
            </div>
          )}

          {/* 左下角工具(原型 cz-bl):整理画布 / 小地图 / 网格吸附 / 适应视图 / 缩放% */}
          {!browsing && (active || creatingNew) && (
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-lg">
              {!readOnly && (
                <button
                  type="button"
                  title={t("canvas.ctxTidy")}
                  onClick={tidyLayout}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                title={t("canvas.minimap")}
                onClick={() => setShowMinimap((v) => !v)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-secondary",
                  showMinimap ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <MapIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={t("canvas.snap")}
                onClick={() => setSnapGrid((v) => !v)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-secondary",
                  snapGrid ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Magnet className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={t("canvas.ctxFit")}
                onClick={() =>
                  rfRef.current?.fitView({ duration: 400, padding: 0.2, maxZoom: 1 })
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Maximize className="h-4 w-4" />
              </button>
              <span className="mx-0.5 h-5 w-px bg-border" />
              {/* 缩放 % → 点击弹出缩放菜单(放大/缩小/适合屏幕/缩放至…) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setZoomMenuOpen((v) => !v)}
                  className="rounded-lg px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {Math.round(viewport.zoom * 100)}%
                </button>
                {zoomMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setZoomMenuOpen(false)}
                    />
                    <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-50 -translate-x-1/2">
                    <div className="menu-pop-up w-52 overflow-hidden rounded-xl border border-[#2a2d36] bg-[#1f2229] py-1.5 text-[#e7e9ee] shadow-2xl">
                      {/* 可输入的缩放值 */}
                      <div className="mx-1.5 mb-1 flex items-center justify-between rounded-lg bg-[#2a2e38] px-3 py-2">
                        <input
                          value={zoomInput}
                          onChange={(e) =>
                            setZoomInput(e.target.value.replace(/[^\d]/g, ""))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              applyZoomInput();
                              setZoomMenuOpen(false);
                            }
                          }}
                          className="w-16 bg-transparent text-sm font-medium outline-none"
                          inputMode="numeric"
                        />
                        <span className="text-sm text-[#9aa1ae]">%</span>
                      </div>
                      {[
                        {
                          label: "放大",
                          hk: "⌘ +",
                          fn: () => rfRef.current?.zoomIn({ duration: 200 }),
                        },
                        {
                          label: "缩小",
                          hk: "⌘ -",
                          fn: () => rfRef.current?.zoomOut({ duration: 200 }),
                        },
                        {
                          label: "适合屏幕",
                          hk: "⌘ 0",
                          fn: () =>
                            rfRef.current?.fitView({
                              duration: 300,
                              padding: 0.2,
                              maxZoom: 1,
                            }),
                        },
                        { sep: true },
                        {
                          label: "缩放至50%",
                          fn: () => rfRef.current?.zoomTo(0.5, { duration: 200 }),
                        },
                        {
                          label: "缩放至100%",
                          fn: () => rfRef.current?.zoomTo(1, { duration: 200 }),
                        },
                        {
                          label: "缩放至800%",
                          fn: () => rfRef.current?.zoomTo(8, { duration: 200 }),
                        },
                      ].map((it, i) =>
                        it.sep ? (
                          <div
                            key={`s${i}`}
                            className="my-1 h-px bg-[#2a2d36]"
                          />
                        ) : (
                          <button
                            key={it.label}
                            type="button"
                            onClick={() => {
                              it.fn?.();
                              setZoomMenuOpen(false);
                            }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-[#2a2e38]"
                          >
                            <span>{it.label}</span>
                            {it.hk && (
                              <span className="text-xs text-[#9aa1ae]">
                                {it.hk}
                              </span>
                            )}
                          </button>
                        )
                      )}
                    </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 拉线落空白:新建节点菜单(基于源图衍生) */}
          {spawnMenu &&
            (() => {
              const src = active?.members.find(
                (m) => m.id === spawnMenu.sourceId
              );
              if (!src) return null;
              return (
                <>
                  <div
                    className="absolute inset-0 z-40"
                    onPointerDown={() => setSpawnMenu(null)}
                  />
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      left: Math.max(8, Math.min(spawnMenu.x, (canvasAreaRef.current?.clientWidth ?? 9999) - 212)),
                      top: Math.max(8, Math.min(spawnMenu.y, (canvasAreaRef.current?.clientHeight ?? 9999) - 230)),
                    }}
                    className="menu-pop absolute z-50 w-[204px] overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-2xl"
                  >
                    <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">
                      {t("canvas.spawnTitle")}
                    </p>
                    {[
                      { key: "image", icon: "🖼️", label: t("canvas.spawnImage") },
                      { key: "upload", icon: "⬆️", label: t("canvas.spawnUpload") },
                    ].map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        onClick={() => void spawnNode(it.key)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                      >
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-secondary text-[15px]">
                          {it.icon}
                        </span>
                        {it.label}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}

          {/* 上传图片作根节点(隐藏 input,右键「上传图片/添加节点」触发) */}
          <input
            ref={rootUploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void uploadRoot(e.target.files)}
          />

          {/* 右键菜单(5c):节点 / 空白 */}
          {ctxMenu &&
            (() => {
              const node = ctxMenu.nodeId
                ? active?.members.find((m) => m.id === ctxMenu.nodeId)
                : null;
              if (ctxMenu.nodeId && !node) return null;
              const Item = ({
                label,
                hk,
                onClick,
                danger,
                disabled,
              }: {
                label: string;
                hk?: string;
                onClick?: () => void;
                danger?: boolean;
                disabled?: boolean;
              }) => (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setCtxMenu(null);
                    onClick?.();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors",
                    disabled
                      ? "cursor-default text-[#9aa1ae]/40"
                      : danger
                        ? "text-[#ff6b63] hover:bg-[#ff6b63]/12"
                        : "text-[#e7e9ee] hover:bg-[#2a2e38]"
                  )}
                >
                  <span className="truncate">{label}</span>
                  {hk && (
                    <span className="text-xs text-[#9aa1ae]/70">{hk}</span>
                  )}
                </button>
              );
              const Sep = () => <div className="my-1 h-px bg-[#2a2d36]" />;
              const vw =
                typeof window !== "undefined" ? window.innerWidth : 9999;
              const vh =
                typeof window !== "undefined" ? window.innerHeight : 9999;
              const menu = (
                <>
                  <div
                    className="fixed inset-0 z-[998]"
                    onPointerDown={() => setCtxMenu(null)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu(null);
                    }}
                  />
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "fixed",
                      left: Math.min(ctxMenu.cx, vw - 228),
                      top: Math.min(ctxMenu.cy, vh - 360),
                    }}
                    className="menu-pop z-[999] w-[216px] overflow-hidden rounded-xl border border-[#2a2d36] bg-[#1f2229] py-1 shadow-2xl"
                  >
                    {node ? (
                      /* 节点右键菜单(对齐原型 cznode) */
                      <>
                        <Item
                          label={t("canvas.ctxDownload")}
                          onClick={() =>
                            void downloadOne(node.image, node.title)
                          }
                        />
                        {!readOnly && (
                          <Item
                            label={t("canvas.ctxGenerate")}
                            onClick={() => {
                              setSelectedId(node.id);
                              setFocusId(node.id);
                            }}
                          />
                        )}
                        {!readOnly && (
                          <Item label={t("canvas.optimizeLayout")} onClick={tidyLayout} />
                        )}
                        <Sep />
                        {!readOnly && (
                          <Item
                            label={t("canvas.copyNode")}
                            hk="⌘C"
                            onClick={() => copyNodeToClip(node)}
                          />
                        )}
                        <Item
                          label={t("canvas.copyImage")}
                          onClick={() => void copyImageToClipboard(node.image)}
                        />
                        {!readOnly && (
                          <Item
                            label={t("canvas.duplicate")}
                            onClick={() => void duplicateArt(node)}
                          />
                        )}
                        {!readOnly && (
                          <Item
                            label={t("canvas.paste")}
                            hk="⌘V"
                            disabled={!hasClip}
                            onClick={() => void pasteNode()}
                          />
                        )}
                        <Sep />
                        {!readOnly && (
                          <Item
                            label={t("canvas.delete")}
                            hk="⌘⌫"
                            danger
                            onClick={() => void deleteTree(node.id)}
                          />
                        )}
                      </>
                    ) : (
                      /* 空白右键菜单(对齐原型 czcanvas) */
                      <>
                        <Item
                          label={t("canvas.addNode")}
                          disabled={readOnly}
                          onClick={() =>
                            addPendAtScreen(ctxMenu.x, ctxMenu.y, null, false)
                          }
                        />
                        <Item
                          label={t("canvas.uploadImage")}
                          disabled={readOnly}
                          onClick={() => triggerUpload(ctxMenu.x, ctxMenu.y)}
                        />
                        <Item
                          label={t("canvas.fromHistory")}
                          disabled={readOnly}
                          onClick={() => openHistoryPicker(ctxMenu.x, ctxMenu.y)}
                        />
                        <Sep />
                        <Item
                          label={t("canvas.undo")}
                          hk="⌘Z"
                          disabled={readOnly || undoStack.length === 0}
                          onClick={() => void doUndo()}
                        />
                        <Item
                          label={t("canvas.redo")}
                          hk="⇧⌘Z"
                          disabled={readOnly || redoStack.length === 0}
                          onClick={() => void doRedo()}
                        />
                        <Sep />
                        <Item
                          label={t("canvas.paste")}
                          hk="⌘V"
                          disabled={readOnly || !hasClip}
                          onClick={() => void pasteNode()}
                        />
                      </>
                    )}
                  </div>
                </>
              );
              return typeof document !== "undefined"
                ? createPortal(menu, document.body)
                : menu;
            })()}

          {/* 顶部图像工具条:选中节点(含空白节点)正上方居中(原型 .cz-toolbar,emoji+配色+inT 入场) */}
          {(selected || selectedPend) && !readOnly && topbarStyle && (
            <div
              key={selectedId ?? selectedPendId ?? "tb"}
              style={{ left: topbarStyle.left, top: topbarStyle.top }}
              className="cz-anim-top absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] border border-[#2a2d36] bg-[#191b21] p-1.5 shadow-2xl"
            >
              {QUICK_ACTIONS.filter(
                (a) => a.key !== "hd" && a.key !== "cutout"
              ).map((a) => (
                <button
                  key={a.key}
                  type="button"
                  disabled={generating || !selected}
                  title={!selected ? t("canvas.toolNeedImage") : undefined}
                  onClick={() => onQuickAction(a.key)}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-2 text-[13px] font-semibold text-[#e7e9ee] transition-colors hover:bg-[#1f2229] disabled:opacity-40"
                >
                  <span className="text-[15px] leading-none">{a.emoji}</span>
                  {t(`canvas.qa.${a.key}`)}
                </button>
              ))}
              {/* 抠图:发丝级,扣 1 积分/张(已去掉免费极速档) */}
              <button
                type="button"
                disabled={generating || !selected}
                title={!selected ? t("canvas.toolNeedImage") : undefined}
                onClick={() => onCutout("fine")}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-2 text-[13px] font-semibold text-[#e7e9ee] transition-colors hover:bg-[#1f2229] disabled:opacity-40"
              >
                <span className="text-[15px] leading-none">✂️</span>
                {t("canvas.qa.cutout")}
              </button>
              {/* 高清:下拉选分辨率(深色弹出,向下) */}
              <DarkSelect
                dir="down"
                disabled={generating || !selected}
                value=""
                options={[
                  { value: "1K", label: "1K" },
                  { value: "2K", label: "2K" },
                  { value: "4K", label: "4K" },
                ]}
                onPick={(v) => onHd(v)}
                triggerClass={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-2 text-[13px] font-semibold text-[#e7e9ee] transition-colors hover:bg-[#1f2229]",
                  selected && !generating
                    ? "cursor-pointer"
                    : "cursor-default opacity-40"
                )}
                trigger={
                  <>
                    <span className="text-[15px] leading-none">🔍</span>
                    {t("canvas.qa.hd")}
                  </>
                }
              />
              {/* 改比例(ChatGPT 式重生成):选目标比例,按原图重画再裁切,无需提示词 */}
              <DarkSelect
                dir="down"
                disabled={generating || !selected}
                value=""
                options={[
                  { value: "1:1", label: t("canvas.ratioSquare") },
                  { value: "3:4", label: t("canvas.ratioPort") },
                  { value: "9:16", label: t("canvas.ratioStory") },
                  { value: "4:3", label: t("canvas.ratioLand") },
                  { value: "16:9", label: t("canvas.ratioWide") },
                ]}
                onPick={(v) => onRatioGen(v)}
                triggerClass={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-2 text-[13px] font-semibold text-[#e7e9ee] transition-colors hover:bg-[#1f2229]",
                  selected && !generating
                    ? "cursor-pointer"
                    : "cursor-default opacity-40"
                )}
                trigger={
                  <>
                    <span className="text-[15px] leading-none">⤢</span>
                    {t("canvas.qa.ratio")}
                  </>
                }
              />
              <span className="mx-1.5 h-5 w-px flex-none bg-[#2a2d36]" />
              {/* 尾部图标:✏️编辑 / 📤上传 / ⬇️下载 / ⛶放大(对齐原型 .ic) */}
              <button
                type="button"
                title={t("canvas.editName")}
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  setNodeRenameValue(selected.title);
                  setRenamingNodeId(selected.id);
                }}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[16px] leading-none transition-colors hover:bg-[#1f2229] disabled:opacity-40"
              >
                ✏️
              </button>
              <button
                type="button"
                title={selected ? t("canvas.addImage") : t("canvas.uploadImage")}
                onClick={() =>
                  selected
                    ? extraInputRef.current?.click()
                    : selectedPend && onPendUpload(selectedPend.id)
                }
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[16px] leading-none transition-colors hover:bg-[#1f2229]"
              >
                📤
              </button>
              <button
                type="button"
                title={t("canvas.ctxDownload")}
                disabled={!selected}
                onClick={() =>
                  selected && void downloadOne(selected.image, selected.title)
                }
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[16px] leading-none transition-colors hover:bg-[#1f2229] disabled:opacity-40"
              >
                ⬇️
              </button>
              <button
                type="button"
                title={t("canvas.viewLarge")}
                disabled={!selected}
                onClick={() =>
                  selected &&
                  setLightbox({ src: selected.image, alt: selected.title })
                }
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[15px] leading-none text-[#9aa1ae] transition-colors hover:bg-[#1f2229] hover:text-[#e7e9ee] disabled:opacity-40"
              >
                ⛶
              </button>
            </div>
          )}

          {/* 重命名节点:在节点标签处弹出内联输入(✏️ 触发),失焦/回车确定、Esc 取消 */}
          {renamingNodeId &&
            selected &&
            renamingNodeId === selected.id &&
            nodeScreen && (
              <div
                className="absolute z-30 -translate-x-1/2"
                style={{
                  left: nodeScreen.cx,
                  top: Math.max(8, nodeScreen.top - 40),
                }}
              >
                <input
                  autoFocus
                  value={nodeRenameValue}
                  onChange={(e) => setNodeRenameValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      nodeRenameCancelRef.current = true;
                      setRenamingNodeId(null);
                    }
                  }}
                  onBlur={() => {
                    if (nodeRenameCancelRef.current) {
                      nodeRenameCancelRef.current = false;
                      return;
                    }
                    void saveNodeRename();
                  }}
                  maxLength={60}
                  placeholder={t("canvas.renamePlaceholder")}
                  className="w-[210px] rounded-lg border border-primary/70 bg-[#191b21] px-2.5 py-1.5 text-center text-sm font-semibold text-[#e7e9ee] shadow-2xl outline-none"
                />
              </div>
            )}

          {/* 底部生成器(配方):选中节点正下方居中,横向 dock(原型 dock) */}
          {selected && (
            <div
              key={`dock-${selected.id}`}
              ref={panelRef}
              style={dockStyle ?? { left: 12, bottom: 12, maxHeight: "60%" }}
              className="cz-anim-bottom absolute z-10 flex w-[680px] max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[18px] border border-[#2a2d36] bg-[#191b21] shadow-2xl"
            >
              {/* dbody:风格/标记/聚焦 chips + 引用图 + 提示词(对齐原型 .cz-dock .dbody) */}
              <div className="min-h-0 overflow-y-auto px-4 pb-1.5 pt-3.5">
                <div className="mb-3 flex items-center gap-2">
                  {!readOnly && (
                    <>
                      <DarkSelect
                        dir="up"
                        value={genStyle}
                        options={GENERATION_STYLES.map((s) => ({
                          value: s,
                          label: s,
                        }))}
                        onPick={(v) => setGenStyle(v)}
                        triggerClass="flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#2a2d36] px-2.5 py-2 text-[12.5px] text-[#e7e9ee] transition-colors hover:bg-[#1f2229]"
                        trigger={
                          <>
                            🧊
                            <span className="max-w-[88px] truncate">
                              {genStyle}
                            </span>
                          </>
                        }
                      />
                      <button
                        type="button"
                        onClick={() => flashTip(t("canvas.dockMarkTip"))}
                        className="flex items-center gap-1.5 rounded-[10px] border border-[#2a2d36] px-2.5 py-2 text-[12.5px] text-[#e7e9ee] transition-colors hover:bg-[#1f2229]"
                      >
                        📍 {t("canvas.dockMark")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFocusId(selected.id)}
                        className="flex items-center gap-1.5 rounded-[10px] border border-[#2a2d36] px-2.5 py-2 text-[12.5px] text-[#e7e9ee] transition-colors hover:bg-[#1f2229]"
                      >
                        ⊡ {t("canvas.dockFocus")}
                      </button>
                    </>
                  )}
                  {/* 引用图:上一级父节点的图(本节点由此生成);多输入则全部显示。
                      悬停右上角"×"可移除(改用自己上传的参考图) */}
                  {visibleDockRefs.map((ref) => (
                    <div
                      key={ref.id}
                      className="group relative h-[46px] w-[46px] flex-none overflow-hidden rounded-[9px] border border-[#2a2d36]"
                    >
                      <button
                        type="button"
                        title={ref.title}
                        onClick={() =>
                          setLightbox({ src: ref.image, alt: ref.title })
                        }
                        className="block h-full w-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cdnUrl(ref.image)}
                          alt={ref.title}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            setHiddenRefIds((prev) =>
                              prev.includes(ref.id) ? prev : [...prev, ref.id]
                            )
                          }
                          aria-label={t("canvas.removeImage")}
                          className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!readOnly &&
                    extraPreviews.map((src, i) => (
                      <div
                        key={i}
                        className="relative h-[46px] w-[46px] flex-none overflow-hidden rounded-[9px] border border-[#2a2d36]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`ref ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeExtra(i)}
                          aria-label={t("canvas.removeImage")}
                          className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-black/65 text-white"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  {!readOnly && (
                    <>
                      <input
                        ref={extraInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => pickExtra(e.target.files)}
                      />
                      {extraFiles.length < MAX_TOTAL_IMAGES - 1 && (
                        <button
                          type="button"
                          onClick={() => extraInputRef.current?.click()}
                          title={t("canvas.addImage")}
                          className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[9px] border border-dashed border-[#2a2d36] text-[#9aa1ae] transition-colors hover:border-[#6366f1]/60 hover:text-[#e7e9ee]"
                        >
                          <Upload className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                  <span className="ml-1 min-w-0 flex-1 truncate text-[12px] text-[#9aa1ae]">
                    {fmt(t("canvas.dockRef"), {
                      n: visibleDockRefs.length + extraFiles.length,
                      name: selected.title,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label={t("canvas.close")}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[#9aa1ae] transition-colors hover:bg-[#1f2229] hover:text-[#e7e9ee]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* 提示词(留空=按这张图再生成一张) */}
                <Textarea
                  value={editPrompt}
                  readOnly={readOnly}
                  placeholder={readOnly ? "" : t("canvas.promptPlaceholder")}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  className="min-h-[40px] max-h-40 resize-none border-0 bg-transparent px-0 py-0.5 text-sm text-[#e7e9ee] shadow-none placeholder:text-[#9aa1ae] focus-visible:ring-0"
                />
                {genError && (
                  <p className="pb-1 text-xs font-medium text-red-400">
                    {genError}
                  </p>
                )}
              </div>

              {/* dbar:模型 / 比例·清晰度 / 数量 + 积分 + 发送(对齐原型 .dbar) */}
              {!readOnly && (
                <div className="flex flex-none items-center gap-2 border-t border-[#2a2d36] px-3.5 py-2.5">
                  <span
                    className="flex items-center gap-1.5 rounded-[9px] bg-[#1f2229] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#e7e9ee]"
                    title={t("canvas.dockModelHint")}
                  >
                    {t("canvas.dockModel")}
                  </span>
                  {ratioControl}
                  <DarkSelect
                    dir="up"
                    value={String(genCount)}
                    options={[1, 2, 4].map((n) => ({
                      value: String(n),
                      label: `${n} 张`,
                    }))}
                    onPick={(v) => setGenCount(Number(v))}
                    triggerClass="flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-[#1f2229] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#e7e9ee]"
                    trigger={<>🖼 {genCount} 张</>}
                  />
                  <span className="flex-1" />
                  <span className="text-[13px] font-semibold text-[#f0c64a]">
                    ⚡ {genCount * resolutionCost(genResolution)}
                  </span>
                  <button
                    type="button"
                    onClick={generateChild}
                    disabled={generating}
                    title={t("canvas.generate")}
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-white text-[18px] font-bold text-[#111] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "↑"
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 空白节点生成 dock(文生图 / 合并多输入):选中空白节点时出现(图3 旁支节点) */}
          {selectedPend && !readOnly && (
            <div
              key={`pdock-${selectedPend.id}`}
              style={dockStyle ?? { left: 12, bottom: 12 }}
              className="cz-anim-bottom absolute z-10 flex w-[680px] max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[18px] border border-[#2a2d36] bg-[#191b21] shadow-2xl"
            >
              <div className="px-4 pb-1.5 pt-3.5">
                <div className="mb-3 flex items-center gap-2">
                  {pendInputArts.length > 0 ? (
                    pendInputArts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        title={a.title}
                        onClick={() => setLightbox({ src: a.image, alt: a.title })}
                        className="h-[46px] w-[46px] flex-none overflow-hidden rounded-[9px] border border-[#2a2d36]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cdnUrl(a.image)}
                          alt={a.title}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))
                  ) : (
                    <span className="flex h-[46px] items-center rounded-[9px] border border-dashed border-[#2a2d36] px-3 text-[12px] text-[#9aa1ae]">
                      🅰️ {t("canvas.pendText2img")}
                    </span>
                  )}
                  <span className="ml-1 min-w-0 flex-1 truncate text-[12px] text-[#9aa1ae]">
                    {pendInputArts.length > 0
                      ? fmt(t("canvas.pendMerge"), { n: pendInputArts.length })
                      : t("canvas.pendNewImage")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedPendId(null)}
                    aria-label={t("canvas.close")}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[#9aa1ae] transition-colors hover:bg-[#1f2229] hover:text-[#e7e9ee]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Textarea
                  ref={pendPromptRef}
                  value={editPrompt}
                  placeholder={t("canvas.pendPromptPlaceholder")}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  className="min-h-[40px] max-h-40 resize-none border-0 bg-transparent px-0 py-0.5 text-sm text-[#e7e9ee] shadow-none placeholder:text-[#9aa1ae] focus-visible:ring-0"
                />
                {genError && (
                  <p className="pb-1 text-xs font-medium text-red-400">
                    {genError}
                  </p>
                )}
              </div>
              <div className="flex flex-none items-center gap-2 border-t border-[#2a2d36] px-3.5 py-2.5">
                <span className="flex items-center gap-1.5 rounded-[9px] bg-[#1f2229] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#e7e9ee]">
                  {t("canvas.dockModel")}
                </span>
                {ratioControl}
                <DarkSelect
                  dir="up"
                  value={String(genCount)}
                  options={[1, 2, 4].map((n) => ({
                    value: String(n),
                    label: `${n} 张`,
                  }))}
                  onPick={(v) => setGenCount(Number(v))}
                  triggerClass="flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-[#1f2229] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#e7e9ee]"
                  trigger={<>🖼 {genCount} 张</>}
                />
                <span className="flex-1" />
                <span className="text-[13px] font-semibold text-[#f0c64a]">
                  ⚡ {genCount * resolutionCost(genResolution)}
                </span>
                <button
                  type="button"
                  onClick={() => void generatePend()}
                  disabled={generating}
                  title={t("canvas.generate")}
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-white text-[18px] font-bold text-[#111] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "↑"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 回收站:已删除作品(保留 180 天,可恢复 / 彻底删除) */}
      {trashOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setTrashOpen(false)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t("canvas.trash")}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t("canvas.trashHint")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {trashItems && trashItems.length > 0 && (
                  <button
                    type="button"
                    disabled={trashBusy}
                    onClick={() =>
                      trashAction(
                        "purge",
                        (trashItems ?? []).map((w) => w.id)
                      )
                    }
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {t("canvas.trashClear")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTrashOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {trashItems === null ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t("canvas.loading")}
                </p>
              ) : trashItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t("canvas.trashEmpty")}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {trashItems.map((w) => (
                    <div
                      key={w.id}
                      className="group relative overflow-hidden rounded-xl border border-border bg-secondary"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cdnUrl(w.image)}
                        alt={w.title}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      {/* 悬停操作:恢复 / 彻底删除 */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={trashBusy}
                          onClick={() => trashAction("restore", [w.id])}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow disabled:opacity-50"
                        >
                          {t("canvas.restore")}
                        </button>
                        <button
                          type="button"
                          disabled={trashBusy}
                          onClick={() => trashAction("purge", [w.id])}
                          className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500/70 disabled:opacity-50"
                        >
                          {t("canvas.purge")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 从生成历史选择:作品选择器 */}
      {historyPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setHistoryPicker(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">
                {t("canvas.fromHistory")}
              </span>
              <button
                type="button"
                onClick={() => setHistoryPicker(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {(() => {
                const items = (works ?? [])
                  .filter(
                    (w) =>
                      w.status === "completed" && /^https?:\/\//.test(w.image)
                  )
                  .slice(0, 60);
                if (items.length === 0)
                  return (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      {t("canvas.empty")}
                    </p>
                  );
                // 瀑布流:每张图按原始比例排列,不裁切、不变形,高低错落
                return (
                  <div className="columns-3 gap-3 [column-fill:_balance] sm:columns-5">
                    {items.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => void addFromHistory(w)}
                        title={w.title}
                        className="group mb-3 block w-full break-inside-avoid overflow-hidden rounded-xl border border-border bg-secondary transition-all hover:-translate-y-0.5 hover:border-primary/50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cdnUrl(w.image)}
                          alt={w.title}
                          loading="lazy"
                          className="block w-full"
                        />
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 复制成功提示 */}
      {copyTip && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background shadow-lg">
          {t("canvas.copied")}
        </div>
      )}
      {/* 底部工具条临时提示 */}
      {tipMsg && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background shadow-lg">
          {tipMsg}
        </div>
      )}
      {/* 快捷键 / 帮助弹框 */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">
                {t("canvas.shortcuts")}
              </h3>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                t("canvas.help1"),
                t("canvas.help2"),
                t("canvas.help3"),
                t("canvas.help4"),
                t("canvas.help5"),
                t("canvas.help6"),
              ].map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {/* 居中确认弹框(删除等),贴合站点暗色配色 */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground">
              {confirmModal.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {confirmModal.message}
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
              >
                {t("canvas.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = confirmModal.onConfirm;
                  setConfirmModal(null);
                  fn();
                }}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
      {/* 右上角按钮:在画布内弹窗打开模板/会员/账户(可层叠下一级,可返回) */}
      {modalTop &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="dark fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm text-foreground"
            onClick={() => setModalStack([])}
          >
            <div
              className={cn(
                "relative flex h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl",
                modalTop.page === "templates" || modalTop.page === "generate"
                  ? "max-w-6xl"
                  : "max-w-5xl"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-none items-center justify-between border-b border-border px-5 py-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  {modalStack.length > 1 && (
                    <button
                      type="button"
                      onClick={modalBack}
                      aria-label={t("canvas.backToProjects")}
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                  )}
                  <span className="truncate text-base font-bold text-foreground">
                    {modalTop.page === "templates"
                      ? t("nav.templates")
                      : modalTop.page === "plans"
                        ? t("nav.plans")
                        : modalTop.page === "account"
                          ? t("nav.account")
                          : modalTop.page === "security"
                            ? "账户与安全"
                            : modalTop.page === "generate"
                              ? t("nav.generate")
                              : "结算"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setModalStack([])}
                  aria-label={t("canvas.close")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto"
                onClickCapture={(e) => {
                  // 弹窗内点向 模板/会员/账户/生成 的内部链接 → 不跳页面,改为在弹窗内进下一级;
                  // 未知/外部(支付等)照常跳转。
                  const a = (e.target as HTMLElement).closest("a");
                  if (!a) return;
                  const href = a.getAttribute("href") || "";
                  if (!href.startsWith("/")) return; // 外链照常
                  // 模板「做同款」(/generate?template=ID)→ 关弹窗,在画布里新建一个项目
                  const [hp, hq] = href.split("?");
                  if (hp.replace(/\/+$/, "") === "/generate") {
                    const tplId = new URLSearchParams(hq || "").get("template");
                    if (tplId) {
                      e.preventDefault();
                      e.stopPropagation();
                      void applyTemplateToCanvas(tplId);
                      return;
                    }
                  }
                  if (pushModalHref(href)) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              >
                {modalTop.page === "templates" && (
                  <TemplatesClient gridClass="columns-2 md:columns-3 xl:columns-4" />
                )}
                {modalTop.page === "plans" && (
                  <div className="p-4">
                    <CreditPacks
                      onCheckout={(orderId, info) => {
                        if (!info.pack) return;
                        setPayModal({
                          orderId,
                          qrContent: info.qrContent,
                          provider: info.provider,
                          credits: info.pack.credits,
                          bonus: info.pack.bonus,
                          fen: info.pack.fen,
                          discount: info.pack.discount,
                          packId: info.pack.id,
                        });
                      }}
                    />
                  </div>
                )}
                {modalTop.page === "account" && <AccountClient />}
                {modalTop.page === "security" && <SecurityClient />}
                {modalTop.page === "generate" && (
                  <GenerateClient seedTemplateId={modalTop.params?.template} />
                )}
                {modalTop.page === "checkout" && (
                  <CheckoutClient pack={modalTop.params?.pack} />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      {/* 画布内扫码支付:统一走共用 PayQrModal */}
      {payModal && (
        <PayQrModal
          open={!!payModal}
          orderId={payModal.orderId}
          provider={payModal.provider}
          qrContent={payModal.qrContent}
          credits={payModal.credits}
          bonus={payModal.bonus}
          fen={payModal.fen}
          discount={payModal.discount}
          onClose={() => setPayModal(null)}
          onPaid={() => void refreshCredits()}
          onRefresh={async () => {
            const em = targetEmail || user?.email;
            if (!em) return;
            try {
              const res = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: em,
                  kind: "pack",
                  itemId: payModal.packId,
                  method: payModal.provider,
                }),
              });
              const data = await res.json();
              if (res.ok && data.mode === "native" && data.qrContent) {
                setPayModal((m) =>
                  m
                    ? {
                        ...m,
                        orderId: data.orderId,
                        qrContent: String(data.qrContent),
                        provider:
                          (data.provider as "alipay" | "wechat") ?? m.provider,
                      }
                    : m
                );
              }
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
    </PendContext.Provider>
  );
}
