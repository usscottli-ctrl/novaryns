"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Images,
  RefreshCw,
  FolderInput,
  Check,
  Maximize2,
  Wand2,
  Trash2,
  Ban,
  ShieldCheck,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Pager } from "@/components/admin/pager";
import { formatDate } from "@/lib/utils";
import { downloadImage } from "@/lib/download";
import { CATEGORY_LABELS, type Category } from "@/lib/mock-data";

type Props = { token: string | null };

type AdminArtwork = {
  id: string;
  email: string;
  title: string;
  category: string;
  prompt: string;
  status: string;
  image: string;
  gradient: string;
  style?: string | null;
  ratio?: string | null;
  resolution?: string | null;
  source?: string | null;
  createdAt: string;
};

const PAGE_SIZE = 24;

// Template-library category vocabulary (the imported template set uses these).
const TEMPLATE_CATEGORIES = [
  "电商主图",
  "Banner 横幅",
  "商品场景图",
  "UI 界面",
  "插画与艺术",
  "图表与信息图",
  "建筑与空间",
  "文档与出版",
  "摄影与写实",
  "角色与人物",
  "历史与古典",
  "品牌与标志",
  "其他用例",
];

function defaultCategory(raw: string): string {
  if (raw in CATEGORY_LABELS) return CATEGORY_LABELS[raw as Category];
  return raw || "电商主图";
}

// Seed /generate with this artwork so an admin can iterate on it.
function regenHref(a: AdminArtwork): string {
  const q = new URLSearchParams();
  q.set("prompt", a.prompt);
  if (a.category) q.set("category", a.category);
  if (a.style) q.set("style", a.style);
  if (a.ratio) q.set("ratio", a.ratio);
  if (a.resolution) q.set("resolution", a.resolution);
  if (a.source && /^https?:\/\//.test(a.source)) q.set("src", a.source);
  if (a.status === "completed" && /^https?:\/\//.test(a.image)) {
    q.set("gen", a.image);
  }
  return `/generate?${q.toString()}`;
}

export function AdminArtworks({ token }: Props) {
  const [list, setList] = useState<AdminArtwork[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [banned, setBanned] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState<AdminArtwork | null>(null);
  const [viewing, setViewing] = useState<AdminArtwork | null>(null);

  async function load(tok: string, p: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/artworks?page=${p}&pageSize=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取失败");
      setList(data.artworks ?? []);
      setTotal(data.total ?? 0);
      const imported: string[] = data.importedIds ?? [];
      setDone(Object.fromEntries(imported.map((id) => [id, true])));
      const bannedList: string[] = data.bannedEmails ?? [];
      setBanned(Object.fromEntries(bannedList.map((e) => [e, true])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    void load(token, page);
  }, [token, page]);

  async function post(payload: Record<string, unknown>) {
    if (!token) throw new Error("缺少凭证");
    const res = await fetch("/api/admin/artworks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "操作失败");
    return data;
  }

  async function confirmImport(a: AdminArtwork, title: string, category: string) {
    setBusyId(a.id);
    setMsg(null);
    try {
      const data = await post({
        action: "import",
        artworkId: a.id,
        title,
        category,
      });
      setDone((d) => ({ ...d, [a.id]: true }));
      setImporting(null);
      setMsg({
        ok: true,
        text: data.created
          ? `已导入模板库：${data.template?.title ?? title}`
          : "该作品此前已导入，已更新到最新",
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "导入失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function removeArtwork(a: AdminArtwork) {
    if (!window.confirm("确定删除这张作品？此操作不可恢复（图片文件保留）。"))
      return;
    setBusyId(a.id);
    setMsg(null);
    try {
      await post({ action: "delete", artworkId: a.id });
      setList((prev) => prev.filter((x) => x.id !== a.id));
      setTotal((t) => Math.max(0, t - 1));
      setMsg({ ok: true, text: "已删除该作品" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "删除失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBan(a: AdminArtwork) {
    const next = !banned[a.email];
    const verb = next ? "封禁" : "解封";
    if (
      !window.confirm(
        next
          ? `确定封禁用户 ${a.email}？封禁后该用户将无法继续生成。`
          : `确定解封用户 ${a.email}？解封后该用户可恢复生成。`
      )
    )
      return;
    setBusyId(a.id);
    setMsg(null);
    try {
      await post({ action: "ban-user", email: a.email, banned: next });
      setBanned((b) => ({ ...b, [a.email]: next }));
      setMsg({ ok: true, text: `已${verb}用户 ${a.email}` });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : `${verb}失败`,
      });
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Images className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">全部作品</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            共 {total} 张 · 可一键导入模板库
          </span>
        </div>
        {token && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(token, page)}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        )}
      </div>

      {msg && (
        <p
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground card-shadow">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载作品中…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-12 text-center text-sm text-muted-foreground card-shadow">
          还没有任何用户作品
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((a) => {
              const imported = done[a.id];
              const busy = busyId === a.id;
              const isBanned = banned[a.email];
              return (
                <div
                  key={a.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card card-shadow"
                >
                  <button
                    type="button"
                    onClick={() => setViewing(a)}
                    className="group relative aspect-[4/3] bg-secondary text-left"
                    aria-label="查看大图"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.image}
                      alt={a.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                      {a.category && (
                        <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] font-medium text-white">
                          {a.category}
                        </span>
                      )}
                      {a.resolution && (
                        <span className="rounded-full bg-primary/80 px-2 py-0.5 text-[11px] font-medium text-white">
                          {a.resolution}
                        </span>
                      )}
                      {imported && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600/85 px-2 py-0.5 text-[11px] font-medium text-white">
                          <Check className="h-3 w-3" />
                          已入库
                        </span>
                      )}
                    </div>
                    <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-slate-900/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Maximize2 className="h-3.5 w-3.5" />
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <p
                      className="line-clamp-2 text-sm font-medium"
                      title={a.prompt}
                    >
                      {a.prompt || a.title}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span
                        className="flex max-w-[62%] items-center gap-1"
                        title={a.email}
                      >
                        {isBanned && (
                          <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                            已封禁
                          </span>
                        )}
                        <span className="truncate">{a.email}</span>
                      </span>
                      <span className="shrink-0">{formatDate(a.createdAt)}</span>
                    </div>

                    <Button
                      variant={imported ? "outline" : "gradient"}
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => setImporting(a)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : imported ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <FolderInput className="h-3.5 w-3.5" />
                      )}
                      {imported ? "已导入 · 重新导入" : "导入模板库"}
                    </Button>

                    <div className="grid grid-cols-4 gap-1">
                      <button
                        onClick={() => setViewing(a)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-1.5 py-1.5 text-[11px] hover:bg-secondary disabled:opacity-50"
                      >
                        <Maximize2 className="h-3 w-3" />
                        大图
                      </button>
                      <a
                        href={regenHref(a)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-1.5 py-1.5 text-[11px] hover:bg-secondary"
                      >
                        <Wand2 className="h-3 w-3" />
                        再生成
                      </a>
                      <button
                        onClick={() => void removeArtwork(a)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-red-200 px-1.5 py-1.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                      <button
                        onClick={() => void toggleBan(a)}
                        disabled={busy}
                        className={`inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[11px] disabled:opacity-50 ${
                          isBanned
                            ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                            : "border-red-200 text-red-600 hover:bg-red-50"
                        }`}
                      >
                        {isBanned ? (
                          <ShieldCheck className="h-3 w-3" />
                        ) : (
                          <Ban className="h-3 w-3" />
                        )}
                        {isBanned ? "解封" : "封禁"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pager
            page={page}
            totalPages={totalPages}
            onChange={setPage}
            totalLabel={`共 ${total} 张`}
            disabled={loading}
          />
        </>
      )}

      {importing && (
        <ImportDialog
          artwork={importing}
          busy={busyId === importing.id}
          onCancel={() => setImporting(null)}
          onConfirm={(title, category) =>
            void confirmImport(importing, title, category)
          }
        />
      )}

      {viewing && (
        <ImageViewer artwork={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function ImportDialog({
  artwork,
  busy,
  onCancel,
  onConfirm,
}: {
  artwork: AdminArtwork;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (title: string, category: string) => void;
}) {
  const initCat = defaultCategory(artwork.category);
  const cats = TEMPLATE_CATEGORIES.includes(initCat)
    ? TEMPLATE_CATEGORIES
    : [initCat, ...TEMPLATE_CATEGORIES];
  const [title, setTitle] = useState(artwork.title || "");
  const [category, setCategory] = useState(initCat);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-md rounded-2xl bg-card p-6 card-shadow">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">导入到模板库</h3>
          <button
            onClick={onCancel}
            aria-label="关闭"
            className="rounded-md p-1 hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artwork.image}
              alt=""
              className="h-20 w-28 shrink-0 rounded-lg border border-border object-cover"
            />
            <p className="line-clamp-4 text-xs text-muted-foreground">
              {artwork.prompt}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">模板标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给这个模板起个标题"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">分类</label>
            <SelectMenu
              className="w-full"
              value={category}
              onChange={setCategory}
              options={cats.map((c) => ({ value: c, label: c }))}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              取消
            </Button>
            <Button
              variant="gradient"
              onClick={() => onConfirm(title.trim() || artwork.title, category)}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              确认导入
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageViewer({
  artwork,
  onClose,
}: {
  artwork: AdminArtwork;
  onClose: () => void;
}) {
  const hasSource = !!artwork.source && /^https?:\/\//.test(artwork.source);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-2xl bg-card p-4 card-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">作品大图</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">生成结果</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artwork.image}
              alt={artwork.title}
              className="max-h-[70vh] w-full rounded-lg border border-border object-contain"
            />
          </div>
          {hasSource && (
            <div className="sm:w-44">
              <p className="mb-1.5 text-xs text-muted-foreground">用户原图</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artwork.source as string}
                alt="用户上传原图"
                className="w-full rounded-lg border border-border object-contain"
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="truncate">{artwork.prompt}</span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadImage(artwork.image, `artwork-${artwork.id}`)}
            >
              <Download className="h-3.5 w-3.5" />
              下载大图
            </Button>
            <a
              href={artwork.image}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              新窗口打开
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
