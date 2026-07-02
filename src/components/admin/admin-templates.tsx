"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Pencil,
  Search,
  Upload,
  ImageIcon,
  X,
  RefreshCw,
} from "lucide-react";
import type { PromptTemplate } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pager } from "@/components/admin/pager";

type Props = { token: string | null };

const PAGE = 20;

export function AdminTemplates({ token }: Props) {
  const [list, setList] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  // 防浏览器把登录账号自动填进搜索框：初始只读，聚焦时才解锁（Chrome 不会往只读字段自动填充）。
  const [searchUnlocked, setSearchUnlocked] = useState(false);

  async function load(tok: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/templates", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取失败");
      setList(data.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    void load(token);
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.industry.toLowerCase().includes(q) ||
        t.prompt.toLowerCase().includes(q)
    );
  }, [list, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const visible = filtered.slice(page * PAGE, (page + 1) * PAGE);

  function onSaved(updated: PromptTemplate) {
    setList((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
    setEditing(null);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">模板管理</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            仅管理员可见
          </span>
        </div>
        {token && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(token)}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="tpl-q"
            autoComplete="off"
            data-form-type="other"
            data-1p-ignore
            data-lpignore="true"
            readOnly={!searchUnlocked}
            onFocus={() => setSearchUnlocked(true)}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="搜索 ID / 标题 / 分类 / 行业 / prompt"
            className="bg-card pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          共 {filtered.length} 条
          {filtered.length !== list.length && `（全部 ${list.length}）`}
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground card-shadow">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载模板中…
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-card card-shadow">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">封面</th>
                  <th className="px-4 py-2.5 font-medium">ID</th>
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium">分类</th>
                  <th className="px-4 py-2.5 font-medium">行业</th>
                  <th className="px-4 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.image}
                        alt=""
                        loading="lazy"
                        className="h-10 w-14 rounded border border-border object-cover"
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {t.id}
                    </td>
                    <td className="px-4 py-2 max-w-[240px] truncate">
                      {t.title}
                    </td>
                    <td className="px-4 py-2 text-xs">{t.category}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {t.industry}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setEditing(t)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                      >
                        <Pencil className="h-3 w-3" />
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      没有匹配的模板
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            totalPages={totalPages}
            onChange={setPage}
            totalLabel={`共 ${filtered.length} 条`}
          />
        </>
      )}

      {editing && (
        <EditTemplateModal
          template={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function EditTemplateModal({
  template,
  token,
  onClose,
  onSaved,
}: {
  template: PromptTemplate;
  token: string | null;
  onClose: () => void;
  onSaved: (t: PromptTemplate) => void;
}) {
  const [form, setForm] = useState<PromptTemplate>({ ...template });
  const [tagsText, setTagsText] = useState(template.tags.join(", "));
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  function pickFile(f: File | null) {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
      setError("仅支持 PNG / JPG / WebP");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setError("图片过大（请 < 8MB）");
      return;
    }
    setError(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  }

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("id", template.id);
      fd.append("title", form.title);
      fd.append("category", form.category);
      fd.append("industry", form.industry);
      fd.append("description", form.description);
      fd.append("prompt", form.prompt);
      fd.append("tags", tagsText);
      fd.append("gradient", form.gradient);
      fd.append("popular", form.popular ? "true" : "false");
      fd.append(
        "homepageFeatured",
        form.homepageFeatured ? "true" : "false"
      );
      if (file) fd.append("image", file);

      const res = await fetch("/api/admin/templates", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      onSaved(data.template as PromptTemplate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-card p-6 card-shadow">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            编辑模板{" "}
            <code className="ml-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">
              {template.id}
            </code>
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Image */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">封面图</label>
            <div className="flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={filePreview ?? form.image}
                alt=""
                className="h-28 w-40 shrink-0 rounded-lg border border-border bg-secondary object-cover"
              />
              <div className="flex-1 space-y-2">
                <input
                  id={`tpl-img-${template.id}`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      document
                        .getElementById(`tpl-img-${template.id}`)
                        ?.click()
                    }
                  >
                    <Upload className="h-3.5 w-3.5" />
                    上传新图
                  </Button>
                  {file && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (filePreview) URL.revokeObjectURL(filePreview);
                        setFile(null);
                        setFilePreview(null);
                      }}
                    >
                      取消选择
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG / JPG / WebP，≤ 8MB。新图上传到 R2，原图不会删除。
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">标题</label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">分类</label>
              <Input
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                行业 / 作者
              </label>
              <Input
                value={form.industry}
                onChange={(e) =>
                  setForm({ ...form, industry: e.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              描述（卡片副标题，简短）
            </label>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">完整 Prompt</label>
            <Textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              标签（用逗号分隔，最多 8 个）
            </label>
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="写实, 商业, 科技"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              卡片渐变（Tailwind class，无紫）
            </label>
            <Input
              value={form.gradient}
              onChange={(e) =>
                setForm({ ...form, gradient: e.target.value })
              }
              className="font-mono text-xs"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.popular === true}
              onChange={(e) =>
                setForm({ ...form, popular: e.target.checked })
              }
            />
            标记为热门（卡片左上显示「热门」徽标）
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.homepageFeatured === true}
              onChange={(e) =>
                setForm({ ...form, homepageFeatured: e.target.checked })
              }
            />
            上首页（强制加入首页 hero/showcase 轮换池，不受分类/宽高比/tag 过滤约束）
          </label>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button variant="gradient" onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
