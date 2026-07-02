"use client";

import { useEffect, useRef, useState } from "react";
import {
  Shirt,
  X,
  Loader2,
  Download,
  ImageIcon,
  Wand2,
  Plus,
  Check,
  ImagePlus,
  Users,
  ZoomIn,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { downloadImage } from "@/lib/download";
import { POINTS_PER_IMAGE } from "@/lib/mock-data";
import {
  TRYON_MODELS,
  TRYON_SCENES,
  MODEL_GROUP_LABELS,
  SCENE_ENVS,
  MODEL_GROUPS as GROUPS,
  type ModelGroup,
  type Gender,
  type SceneEnv,
  type TryonModel,
  type TryonScene,
} from "@/lib/tryon-library";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";
import { ImageLightbox } from "@/components/image-lightbox";

const MAX_UPLOAD = 12 * 1024 * 1024;
const ACCENT = "#E0568B";
const TINT = "rgba(224,86,139,.12)";
const ACC_SOFT = "rgba(224,86,139,.08)";

export function TryonClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const topRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [top, setTop] = useState<{ file: File; url: string } | null>(null);
  const [bottom, setBottom] = useState<{ file: File; url: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [picker, setPicker] = useState<null | "scene" | "model">(null);
  // 库图片放大预览(lightbox);点卡片中间的放大图标看原图
  const [lightbox, setLightbox] = useState<null | { url: string; name: string }>(null);
  const [envFilter, setEnvFilter] = useState<SceneEnv | "all">("all");
  const [groupFilter, setGroupFilter] = useState<ModelGroup | "all">("all");
  const [genderFilter, setGenderFilter] = useState<Gender | "all">("all");
  // AI帮写/智能优化(贴按钮弹窗,全站统一;看图写,必传服装图)
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistRun, setAssistRun] = useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 库走 DB(后台可增删改/排序);初始用内置默认,挂载后拉最新
  const [models, setModels] = useState<TryonModel[]>(TRYON_MODELS);
  const [scenes, setScenes] = useState<TryonScene[]>(TRYON_SCENES);
  // 「以此图再试穿」:把试穿结果当成人物/模特图。人物输入是「库模特选择」(url 形态),
  // 故注入一个临时自定义模特(custom-*,url 指向上传后的 R2/blob)并选中它;generate 仍走原 job 逻辑,
  // 自定义模特会额外把 url 通过 modelUrl 字段传给后端(后端按 url 取图,与库图同款)。
  const [customModel, setCustomModel] = useState<TryonModel | null>(null);

  const allModels = customModel ? [customModel, ...models] : models;
  const model = allModels.find((x) => x.id === modelId);
  const scene = scenes.find((x) => x.id === sceneId);
  const cost = POINTS_PER_IMAGE;

  useEffect(() => {
    let on = true;
    fetch("/api/tryon/library")
      .then((r) => r.json())
      .then((d) => {
        if (!on) return;
        if (Array.isArray(d?.models) && d.models.length) setModels(d.models);
        if (Array.isArray(d?.scenes) && d.scenes.length) setScenes(d.scenes);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (top) URL.revokeObjectURL(top.url);
      if (bottom) URL.revokeObjectURL(bottom.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(slot: "top" | "bottom", f: File) {
    if (!user) return openAuth();
    if (f.size > MAX_UPLOAD)
      return setError(L("图片需小于 12MB", "Image must be < 12MB"));
    setError(null);
    const cur = slot === "top" ? top : bottom;
    if (cur) URL.revokeObjectURL(cur.url);
    const v = { file: f, url: URL.createObjectURL(f) };
    if (slot === "top") setTop(v);
    else setBottom(v);
    setResult(null);
  }
  function clearSlot(slot: "top" | "bottom") {
    const cur = slot === "top" ? top : bottom;
    if (cur) URL.revokeObjectURL(cur.url);
    if (slot === "top") setTop(null);
    else setBottom(null);
  }

  // 「以此图再试穿」:把当前试穿结果载入「人物/模特图」,清空结果。
  // 人物输入 = 库模特选择(url 形态),故造一个临时自定义模特并选中;预览用本地 blob,
  // 后端取图用原始 url(已托管,可直接 fetch)。不自动扣分:用户改完服装再点「开始试穿」。
  async function regenFrom(url: string) {
    if (!url) return;
    try {
      // 预览缩略图:远程 url 走代理下载成 blob;blob:/data: 直接 fetch。
      const blob =
        url.startsWith("blob:") || url.startsWith("data:")
          ? await (await fetch(url)).blob()
          : await (
              await fetch(`/api/download?u=${encodeURIComponent(url)}&n=input.png`)
            ).blob();
      const previewUrl = URL.createObjectURL(blob);
      // 后端实际取图用的 url:远程原 url 直接复用(已托管);本地 blob:/data: 把 blob 重新转 object URL 不行,
      // 但 tryon 结果一定是 R2 托管 url,所以这里 backendUrl 用原 url 即可。
      const backendUrl =
        url.startsWith("blob:") || url.startsWith("data:") ? previewUrl : url;
      // 释放上一次注入的自定义模特预览 objectURL
      if (customModel?.thumb && customModel.thumb.startsWith("blob:"))
        URL.revokeObjectURL(customModel.thumb);
      const cm: TryonModel = {
        id: `custom-${Date.now()}`,
        name: L("试穿结果", "Try-on result"),
        group: "intl",
        gender: "f",
        url: backendUrl,
        thumb: previewUrl,
        medium: previewUrl,
        source: "admin",
      };
      setCustomModel(cm);
      setModelId(cm.id);
      setResult(null);
      setError(null);
    } catch {
      setError(L("载入失败,请重试", "Failed to load, please retry"));
    }
  }

  function openAssist(mode: "write" | "optimize") {
    if (!user) return openAuth();
    if (!top && !bottom)
      return setError(L("请先上传图片", "Upload an image first"));
    setError(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }

  async function generate() {
    if (!user) return openAuth();
    if (busyRef.current) return;
    if (!top && !bottom)
      return setError(L("请先上传上装或下装", "Upload a garment first"));
    if (remaining < cost)
      return setError(
        L(`积分不足:需 ${cost},剩余 ${remaining}`, `Need ${cost}, have ${remaining}`)
      );
    setError(null);
    busyRef.current = true;
    setProcessing(true);
    setResult(null);
    try {
      const fd = new FormData();
      if (top) fd.append("top", top.file);
      if (bottom) fd.append("bottom", bottom.file);
      // 自定义模特(以此图再试穿):不在库里,改传 modelUrl 让后端按 url 取图;否则传库 modelId。
      if (modelId && customModel && modelId === customModel.id)
        fd.append("modelUrl", customModel.url);
      else if (modelId) fd.append("modelId", modelId);
      if (sceneId) fd.append("sceneId", sceneId);
      if (prompt.trim()) fd.append("prompt", prompt.trim());
      if (user) fd.append("email", user.email);
      // 异步任务 + 轮询:POST 立即拿 jobId(避免代理/CDN 对 ~50s 长请求超时),
      // 再轮询结果。与 AI 生图同款,长生成不再被代理切断成「Unexpected end of JSON input」。
      const startRes = await fetch("/api/tryon", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error ?? L("生成失败", "Failed"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(start.error ?? L("生成失败", "Failed"));
      const deadline = Date.now() + 5 * 60 * 1000;
      let data:
        | { url?: string; user?: SessionUser | null; creditsUsed?: number }
        | null = null;
      while (!data) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline)
          throw new Error(L("生成超时,请稍后重试", "Timed out, please retry"));
        const sres = await fetch(`/api/tryon?job=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        const s = await sres.json();
        if (s.status === "done") data = s;
        else if (s.status === "error")
          throw new Error(s.error ?? L("生成失败", "Failed"));
      }
      if (!data.url) throw new Error(L("生成失败", "Failed"));
      if (data.user) applyServerUser(data.user);
      else if (data.creditsUsed) consumeCredits(data.creditsUsed);
      setResult(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : L("生成失败", "Failed"));
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  }

  const scenesShown = scenes.filter(
    (s) => envFilter === "all" || s.env === envFilter
  );
  const modelsShown = models.filter(
    (m) =>
      (groupFilter === "all" || m.group === groupFilter) &&
      (genderFilter === "all" || m.gender === genderFilter)
  );

  // 库选择卡:上传/库选 二合一
  const PickCard = ({
    label,
    picked,
    onPick,
    onClear,
  }: {
    label: string;
    picked?: { name: string; url: string };
    onPick: () => void;
    onClear: () => void;
  }) => (
    <button
      type="button"
      onClick={onPick}
      className="group relative flex w-full items-center gap-3 rounded-field border border-c-border bg-c-card p-2.5 text-left transition-colors hover:border-acc"
    >
      {picked ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picked.url}
          alt={picked.name}
          className="h-14 w-14 flex-none rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-c-subtle2 text-c-text3">
          <Plus className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-c-text">{label}</span>
        <span className="block truncate text-[12px] text-c-text3">
          {picked ? picked.name : L("从库中选择", "Pick from library")}
        </span>
      </span>
      {picked && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );

  return (
    <>
      <ToolShell
        name={L("服装上身", "Virtual Try-On")}
        desc={L(
          "上传服装,选模特与场景,一键生成真实上身电商图",
          "Upload a garment, pick a model & scene, get a real on-body shot"
        )}
        Icon={Shirt}
        tint={TINT}
        accent={ACCENT}
        category="tryon"
      onRegen={regenFrom}
      regenLabel="以此图再试穿"
        cost={cost}
        actionLabel={L("开始试穿", "Generate")}
        onAction={generate}
        processing={processing}
        disabled={!top && !bottom}
        error={error}
        resultTitle={L("试穿效果", "Result")}
        refreshKey={result}
        left={
          <>
            <input
              ref={topRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick("top", f);
                e.target.value = "";
              }}
            />
            <input
              ref={bottomRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick("bottom", f);
                e.target.value = "";
              }}
            />

            {/* 服装图:上装 / 下装(可只传其一,至少一个) */}
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                <span className="text-c-danger">* </span>
                {L("服装图", "Garment")}{" "}
                <span className="text-[11px] font-normal text-c-text3">
                  {L("(上装/下装可只传一个)", "(top and/or bottom)")}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["top", L("上装", "Top"), top, topRef] as const,
                    ["bottom", L("下装", "Bottom"), bottom, bottomRef] as const,
                  ]
                ).map(([slot, label, val, ref]) => (
                  <div key={slot}>
                    {val ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={val.url}
                          alt={label}
                          className="aspect-square w-full rounded-field border border-c-border bg-c-subtle2 object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => clearSlot(slot)}
                          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {label}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => ref.current?.click()}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-field border border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
                      >
                        <ImagePlus className="h-6 w-6 opacity-60" />
                        <span className="text-[12px] font-medium">{label}</span>
                        <span className="text-[10px]">{L("点击上传", "Upload")}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 场景 + 模特 */}
            <PickCard
              label={L("场景", "Scene")}
              picked={scene ? { name: scene.name, url: scene.thumb || scene.url } : undefined}
              onPick={() => setPicker("scene")}
              onClear={() => setSceneId("")}
            />
            <PickCard
              label={L("模特", "Model")}
              picked={model ? { name: model.name, url: model.thumb || model.url } : undefined}
              onPick={() => setPicker("model")}
              onClear={() => {
                setModelId("");
                if (customModel?.thumb && customModel.thumb.startsWith("blob:"))
                  URL.revokeObjectURL(customModel.thumb);
                setCustomModel(null);
              }}
            />

            {/* 描述 + AI帮写 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[12.5px] font-medium text-c-text2">
                  {L("描述", "Prompt")}{" "}
                  <span className="text-[11px] font-normal text-c-text3">
                    {L("(可留空)", "(optional)")}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  {prompt.trim() && (
                    <button
                      type="button"
                      onClick={() => openAssist("optimize")}
                      className="inline-flex items-center gap-1 rounded-md bg-acc-tint px-2 py-1 text-[11.5px] font-medium text-acc hover:brightness-95"
                    >
                      <Sparkles className="h-3 w-3" />
                      {L("智能优化", "Optimize")}
                    </button>
                  )}
                  <button
                    ref={assistBtnRef}
                    type="button"
                    onClick={() => openAssist("write")}
                    className="flex items-center gap-1 text-[12px] font-medium text-acc transition-opacity hover:opacity-80"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {L("AI帮写", "AI write")}
                  </button>
                </div>
              </div>
              <PromptAssistPopup
                open={assistOpen}
                onClose={() => setAssistOpen(false)}
                anchorRef={assistBtnRef}
                tool="tryon"
                currentPrompt={prompt}
                imageFile={(top ?? bottom)?.file ?? null}
                imageThumb={(top ?? bottom)?.url ?? ""}
                run={assistRun}
                onUse={(t) => setPrompt(t)}
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={L(
                  "例如:保留衬衫翻领和门襟纽扣,自然站姿,冷色调。或点「AI 帮写」看图自动生成。",
                  "e.g. keep the collar & buttons, natural pose. Or tap AI write."
                )}
                className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2.5 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
              />
            </div>
          </>
        }
      >
        {(zoom) => (
          <div className="flex flex-1 items-center justify-center">
            {processing ? (
              <div className="relative min-h-[300px] w-full flex-1">
                <GenLoader />
              </div>
            ) : result ? (
              <div className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result}
                  alt="result"
                  onClick={() => zoom(result)}
                  className="max-h-[70vh] cursor-zoom-in rounded-[13px] border border-c-border object-contain"
                />
                <button
                  type="button"
                  onClick={() => regenFrom(result)}
                  className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-black/80"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {L("以此图再试穿", "Try on with this")}
                </button>
                <button
                  type="button"
                  onClick={() => downloadImage(result, "tryon")}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-2 text-[12px] font-medium text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  {L("下载", "Download")}
                </button>
              </div>
            ) : (
              <ToolDemo {...getDemo("tryon")!} />
            )}
          </div>
        )}
      </ToolShell>

      {/* 库选择弹窗 */}
      {picker && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
          onClick={() => setPicker(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "88vh" }}
            className="flex w-full max-w-4xl flex-col overflow-hidden rounded-t-card bg-c-card sm:rounded-card"
          >
            <div className="flex items-center justify-between border-b border-c-border px-5 py-4">
              <h3 className="flex items-center gap-2 text-[16px] font-bold text-c-text">
                {picker === "scene" ? (
                  <ImageIcon className="h-5 w-5 text-acc" />
                ) : (
                  <Users className="h-5 w-5 text-acc" />
                )}
                {picker === "scene" ? L("选择场景", "Pick scene") : L("选择模特", "Pick model")}
              </h3>
              <button
                type="button"
                onClick={() => setPicker(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-c-text3 hover:bg-c-subtle"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 筛选 */}
            <div className="flex flex-wrap gap-2 border-b border-c-border px-5 py-3">
              {picker === "scene" ? (
                <>
                  {(["all", ...SCENE_ENVS] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setEnvFilter(k)}
                      style={envFilter === k ? { background: ACC_SOFT } : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                        envFilter === k
                          ? "border-acc text-acc"
                          : "border-c-border text-c-text3 hover:bg-c-subtle"
                      )}
                    >
                      {k === "all" ? L("全部", "All") : k}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {(["all", ...GROUPS] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setGroupFilter(k)}
                      style={groupFilter === k ? { background: ACC_SOFT } : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                        groupFilter === k
                          ? "border-acc text-acc"
                          : "border-c-border text-c-text3 hover:bg-c-subtle"
                      )}
                    >
                      {k === "all" ? L("全部", "All") : MODEL_GROUP_LABELS[k][locale === "en" ? "en" : "zh"]}
                    </button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-c-border" />
                  {(["all", "f", "m"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setGenderFilter(k)}
                      style={genderFilter === k ? { background: ACC_SOFT } : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                        genderFilter === k
                          ? "border-acc text-acc"
                          : "border-c-border text-c-text3 hover:bg-c-subtle"
                      )}
                    >
                      {k === "all" ? L("不限", "All") : k === "f" ? L("女", "F") : L("男", "M")}
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* 网格:固定高度可滚动区。关键尺寸用内联样式,不依赖 CSS 类(防旧 CSS 缓存导致类失效) */}
            <div
              style={{ maxHeight: "70vh", overflowY: "auto" }}
              className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-4 md:grid-cols-5"
            >
              {(picker === "scene" ? scenesShown : modelsShown).map((it) => {
                const on = picker === "scene" ? sceneId === it.id : modelId === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      if (picker === "scene") setSceneId(it.id);
                      else setModelId(it.id);
                      setPicker(null);
                    }}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border-2 text-left transition-colors",
                      on ? "border-acc" : "border-transparent hover:border-acc/40"
                    )}
                  >
                    {/* 弹窗显示用缩略图(小而快);生成时后端仍用原图 url */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.thumb || it.url}
                      alt={it.name}
                      loading="lazy"
                      style={{ height: 176, width: "100%", objectFit: "cover", display: "block" }}
                    />
                    {/* 悬停遮罩:纯视觉,pointer-events-none 不拦点击 → 点图片=选中 */}
                    <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-150 group-hover:bg-black/25" />
                    {/* 中央放大按钮:仅点它才放大(stopPropagation 不触发选中);hover 时才可点 */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={L("查看大图", "View larger")}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 放大预览用中图(~800px,清晰且远小于原图);无中图回退缩略图
                        setLightbox({ url: it.medium || it.thumb || it.url, name: it.name });
                      }}
                      className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-c-text opacity-0 shadow-md transition-opacity duration-150 hover:bg-white group-hover:pointer-events-auto group-hover:opacity-100"
                    >
                      <ZoomIn className="h-5 w-5" />
                    </span>
                    {on && (
                      <span className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-acc text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] font-medium text-white">
                      {it.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 原图放大预览 */}
      {lightbox && (
        <ImageLightbox
          src={lightbox.url}
          onClose={() => setLightbox(null)}
          downloadName={lightbox.name || "星泽商图-试穿"}
        />
      )}
    </>
  );
}
