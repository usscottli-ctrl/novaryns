"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  Trash2,
  ChevronUp,
  ChevronDown,
  ImagePlus,
} from "lucide-react";
import {
  MODEL_GROUP_LABELS,
  MODEL_GROUPS,
  SCENE_ENVS,
  type TryonModel,
  type TryonScene,
  type ModelGroup,
  type Gender,
  type SceneEnv,
} from "@/lib/tryon-library";
import { cn } from "@/lib/utils";
import { cdnThumb } from "@/lib/cdn";

type Kind = "model" | "scene";

export function AdminTryon({ token }: { token: string | null }) {
  const [tab, setTab] = useState<Kind>("model");
  const [models, setModels] = useState<TryonModel[]>([]);
  const [scenes, setScenes] = useState<TryonScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 上传表单
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<ModelGroup>("cn");
  const [gender, setGender] = useState<Gender>("f");
  const [env, setEnv] = useState<SceneEnv>("室内");

  const auth = useCallback(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/tryon", { headers: auth() });
      const d = await r.json();
      setModels(Array.isArray(d.models) ? d.models : []);
      setScenes(Array.isArray(d.scenes) ? d.scenes : []);
    } catch {
      setMsg("加载失败");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  async function saveOrder(kind: Kind, list: { id: string }[]) {
    await fetch("/api/admin/tryon", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ action: "reorder", kind, ids: list.map((x) => x.id) }),
    });
  }

  function move(kind: Kind, idx: number, dir: -1 | 1) {
    const arr = kind === "model" ? [...models] : [...scenes];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    if (kind === "model") setModels(arr as TryonModel[]);
    else setScenes(arr as TryonScene[]);
    void saveOrder(kind, arr);
  }

  async function doDelete(kind: Kind, id: string) {
    if (!confirm("确认删除该素材?")) return;
    if (kind === "model") setModels((p) => p.filter((x) => x.id !== id));
    else setScenes((p) => p.filter((x) => x.id !== id));
    await fetch("/api/admin/tryon", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", kind, id }),
    });
  }

  async function doUpload() {
    if (!file) return setMsg("请选择图片");
    if (!name.trim()) return setMsg("请填写名称");
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("kind", tab);
      fd.append("image", file);
      fd.append("name", name.trim());
      if (tab === "model") {
        fd.append("group", group);
        fd.append("gender", gender);
      } else {
        fd.append("env", env);
      }
      const r = await fetch("/api/admin/tryon", {
        method: "POST",
        headers: auth(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "上传失败");
      if (tab === "model") setModels((p) => [d.item, ...p]);
      else setScenes((p) => [d.item, ...p]);
      setFile(null);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      setMsg("已上传");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  const list: (TryonModel | TryonScene)[] = tab === "model" ? models : scenes;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["model", "scene"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                tab === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {k === "model" ? `模特库 (${models.length})` : `场景库 (${scenes.length})`}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          顺序即用户「选模特/选场景」弹窗里的展示顺序
        </span>
      </div>

      {/* 上传表单 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold">
          上传新{tab === "model" ? "模特" : "场景"}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-24 w-20 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-border bg-secondary/30 text-muted-foreground hover:border-primary/50"
            >
              {file ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={URL.createObjectURL(file)}
                  alt="preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px]">选图</span>
                </>
              )}
            </button>
          </div>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tab === "model" ? "如 林晚晴 / Emma" : "如 花园清新"}
              className="w-40 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          {tab === "model" ? (
            <>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">分组</span>
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value as ModelGroup)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {MODEL_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {MODEL_GROUP_LABELS[g].zh}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">性别</span>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="f">女</option>
                  <option value="m">男</option>
                </select>
              </label>
            </>
          ) : (
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">环境</span>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value as SceneEnv)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              >
                {SCENE_ENVS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={doUpload}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            上传
          </button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {list.map((it, idx) => (
            <div
              key={it.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-card"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cdnThumb(it.thumb || it.url, 320)}
                alt={it.name}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover"
              />
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="min-w-0 truncate text-xs font-medium">{it.name}</span>
                <span className="flex-none text-[10px] text-muted-foreground">
                  {tab === "model"
                    ? `${MODEL_GROUP_LABELS[(it as TryonModel).group].zh}·${(it as TryonModel).gender === "f" ? "女" : "男"}`
                    : (it as TryonScene).env}
                </span>
              </div>
              {/* 操作:上移/下移/删除 */}
              <div className="absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => move(tab, idx, -1)}
                  disabled={idx === 0}
                  title="上移"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/75 disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(tab, idx, 1)}
                  disabled={idx === list.length - 1}
                  title="下移"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/75 disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => doDelete(tab, it.id)}
                  title="删除"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-red-600/80 text-white hover:bg-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="absolute left-1.5 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">
                {idx + 1}
                {it.source === "admin" ? " · 自传" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
