"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SquarePen,
  Download,
  Eraser,
  Brush,
  ArrowRight,
  RefreshCw,
  X,
  Wand2,
  Sparkles,
} from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { downloadImage } from "@/lib/download";
import { resolutionCost } from "@/lib/mock-data";
import { BeforeAfter } from "@/components/ui/before-after";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";

const ACCENT = "#7C5CFF";
const TINT = "rgba(124,92,255,.12)";
const ACC_SOFT = "rgba(124,92,255,.08)";

const MAX_UPLOAD = 12 * 1024 * 1024;

export function InpaintClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const router = useRouter();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasMask = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string>("");
  const [brush, setBrush] = useState(40);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cost = resolutionCost(resolution);

  // AI帮写/智能优化(贴按钮弹窗,全站统一)
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistRun, setAssistRun] = useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  function openAssist(mode: "write" | "optimize") {
    if (!file) {
      setError(L("请先上传图片", "Upload an image first"));
      return;
    }
    setError(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }

  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadFile(f: File) {
    if (!user) {
      openAuth();
      return;
    }
    if (f.size > MAX_UPLOAD) {
      setError(L("图片需小于 12MB", "Image must be < 12MB"));
      return;
    }
    setError(null);
    setResult(null);
    hasMask.current = false;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    const url = URL.createObjectURL(f);
    setFile(f);
    setImgUrl(url);
    // 把画布内部尺寸设成原图自然尺寸,涂抹直接在原图坐标系(mask 1:1,不必缩放)。
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    };
    img.src = url;
  }

  // 鼠标/触摸坐标 → 画布内部坐标(原图分辨率)
  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
      // 画笔半径按显示像素换算到画布内部分辨率
      r: (brush / 2) * (c.width / rect.width),
    };
  }

  function paint(e: React.PointerEvent) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { x, y, r } = pos(e);
    ctx.fillStyle = "rgba(56,189,248,0.5)"; // 半透明天蓝高亮(仅显示用)
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    hasMask.current = true;
  }

  function onDown(e: React.PointerEvent) {
    if (!imgUrl) return;
    drawing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    paint(e);
  }
  function onMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    paint(e);
  }
  function onUp() {
    drawing.current = false;
  }

  function clearMask() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    hasMask.current = false;
  }

  // 以结果图再改图:把成品图载入成输入原图,清空涂抹与结果,重新涂抹再生成(不自动扣分)。
  async function regenFrom(url: string) {
    if (!user) {
      openAuth();
      return;
    }
    setError(null);
    try {
      let blob: Blob;
      if (url.startsWith("blob:") || url.startsWith("data:")) {
        blob = await (await fetch(url)).blob();
      } else {
        const res = await fetch(
          `/api/download?u=${encodeURIComponent(url)}&n=input.png`
        );
        if (!res.ok) throw new Error();
        blob = await res.blob();
      }
      const f = new File([blob], "input.png", {
        type: blob.type || "image/png",
      });
      // 替换输入原图 + preview,释放旧 objectURL
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      const next = URL.createObjectURL(f);
      setFile(f);
      setImgUrl(next);
      setResult(null);
      hasMask.current = false;
      // 把画布尺寸重置成新原图自然尺寸并清空涂抹
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
      };
      img.src = next;
    } catch {
      setError(L("载入失败,请重试", "Failed to load, retry"));
    }
  }

  // 从涂抹画布生成 OpenAI mask:涂抹区→透明(被编辑),其余→白色不透明(保留)。
  function buildMask(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const paintC = canvasRef.current;
      if (!paintC) return resolve(null);
      const m = document.createElement("canvas");
      m.width = paintC.width;
      m.height = paintC.height;
      const mc = m.getContext("2d");
      if (!mc) return resolve(null);
      mc.fillStyle = "#ffffff";
      mc.fillRect(0, 0, m.width, m.height); // 全白不透明
      mc.globalCompositeOperation = "destination-out";
      mc.drawImage(paintC, 0, 0); // 涂抹区(有 alpha)擦掉白 → 透明
      m.toBlob((b) => resolve(b), "image/png");
    });
  }

  async function generate() {
    if (!user) {
      openAuth();
      return;
    }
    if (!file) {
      setError(L("请先上传图片", "Upload an image first"));
      return;
    }
    if (!hasMask.current) {
      setError(L("请在图上涂抹要修改的区域", "Paint the area to edit"));
      return;
    }
    if (!prompt.trim()) {
      setError(L("请描述涂抹区域要改成什么", "Describe what to change"));
      return;
    }
    if (remaining < cost) {
      setError(
        L(
          `积分不足:本次需 ${cost},剩余 ${remaining}`,
          `Not enough credits: need ${cost}, have ${remaining}`
        )
      );
      return;
    }
    const mask = await buildMask();
    if (!mask) {
      setError(L("遮罩生成失败,请重试", "Failed to build mask"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("mask", mask, "mask.png");
      fd.append("prompt", prompt.trim());
      fd.append("resolution", resolution);
      fd.append("email", user.email);

      const res = await fetch("/api/inpaint", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.url)
        throw new Error(data.error ?? L("改图失败", "Failed"));
      if (data.user) applyServerUser(data.user);
      else if (data.creditsUsed) consumeCredits(data.creditsUsed);
      setResult(data.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : L("改图失败,请重试", "Failed, retry")
      );
    } finally {
      setLoading(false);
    }
  }

  // 选中态/未选态统一样式(accent 描边 + 浅底)。
  const optClass = (active: boolean) =>
    cn(
      "transition-colors",
      active
        ? "border-acc text-acc"
        : "border-c-border text-c-text2 hover:bg-c-subtle"
    );
  const optStyle = (active: boolean) =>
    active ? { background: ACC_SOFT } : undefined;

  return (
    <ToolShell
      name={L("局部改图", "Inpaint")}
      desc={L(
        "涂抹画面局部,描述要改成什么,只重绘涂抹区、其余原样保留",
        "Paint a region, describe the change — only that area is regenerated"
      )}
      Icon={SquarePen}
      tint={TINT}
      accent={ACCENT}
      category="inpaint"
      onRegen={regenFrom}
      regenLabel="以此图再改图"
      cost={cost}
      actionLabel={L("开始改图", "Generate")}
      onAction={generate}
      processing={loading}
      disabled={!imgUrl}
      error={error}
      resultTitle={L("处理结果", "Result")}
      refreshKey={result}
      left={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = "";
            }}
          />

          {/* 上传图片(与全站一致:放左侧参数列顶部) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              <span className="text-c-danger">* </span>
              {L("上传图片", "Upload image")}
            </p>
            {imgUrl ? (
              <div className="relative overflow-hidden rounded-field border border-c-border bg-c-subtle2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrl}
                  alt=""
                  className="max-h-[180px] w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute right-2 top-2 rounded-[8px] bg-[rgba(22,24,29,.6)] px-2 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                >
                  {L("更换", "Replace")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title={L("支持 png/jpg,单张 < 12MB", "png/jpg, < 12MB")}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
              >
                <SquarePen className="h-4 w-4" />
                <span className="text-[10px]">{L("上传", "Upload")}</span>
              </button>
            )}
          </div>

          {/* 画笔大小 */}
          <div>
            <p className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-c-text2">
              <span className="flex items-center gap-1.5">
                <Brush className="h-3.5 w-3.5" />
                {L("画笔大小", "Brush")}
              </span>
              <span className="text-acc">{brush}px</span>
            </p>
            <input
              type="range"
              min={10}
              max={120}
              step={2}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: ACCENT }}
              disabled={!imgUrl}
            />
            <button
              type="button"
              onClick={clearMask}
              disabled={!imgUrl}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-field border border-c-border px-3 py-1.5 text-[12px] font-medium text-c-text3 transition-colors hover:bg-c-subtle disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" />
              {L("清除涂抹", "Clear")}
            </button>
          </div>

          {/* 描述 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              <span className="text-c-danger">* </span>
              {L("改成什么", "Change to")}
            </p>
            <div className="-mt-1 mb-1.5 flex items-center justify-end gap-2">
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
                className="inline-flex items-center gap-1 text-[12px] font-medium text-acc hover:underline"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {L("AI帮写", "AI write")}
              </button>
            </div>
            <PromptAssistPopup
              open={assistOpen}
              onClose={() => setAssistOpen(false)}
              anchorRef={assistBtnRef}
              tool="inpaint"
              currentPrompt={prompt}
              imageFile={file}
              imageThumb={imgUrl}
              run={assistRun}
              onUse={(t) => setPrompt(t)}
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={L(
                "例如:把这里的文字去掉换成纯色背景;或把这件衣服改成红色。",
                "e.g. remove the text here; or change this to red."
              )}
              className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2.5 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
            />
          </div>

          {/* 分辨率 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("分辨率", "Resolution")}
            </p>
            <div className="flex gap-2">
              {(["1K", "2K"] as const).map((r) => {
                const active = resolution === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResolution(r)}
                    style={optStyle(active)}
                    className={cn(
                      "flex-1 rounded-[8px] border px-3 py-2 text-[13px] font-medium",
                      optClass(active)
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      }
    >
      {(zoom) => (
        <div className="flex min-h-0 flex-1 flex-col">
          {!imgUrl ? (
            <ToolDemo {...getDemo("inpaint")!} />
          ) : result ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-c-text3">
                  {L("改图结果", "Result")}
                </span>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="flex items-center gap-1 text-[12px] text-c-text3 hover:text-c-text"
                >
                  <X className="h-3.5 w-3.5" />
                  {L("继续涂抹", "Back to edit")}
                </button>
              </div>
              <div className="space-y-3">
                <div className="relative">
                  {imgUrl ? (
                    <BeforeAfter
                      before={imgUrl}
                      after={result}
                      beforeLabel={L("原图", "Before")}
                      afterLabel={L("效果图", "After")}
                      className="h-[56vh]"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result}
                      alt="result"
                      onClick={() => zoom(result)}
                      className="mx-auto block max-h-[56vh] max-w-full cursor-zoom-in rounded-field border border-c-border object-contain"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => regenFrom(result)}
                    className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {L("以此图再改图", "Edit this result")}
                  </button>
                </div>
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadImage(result, "inpaint")}
                    className="flex items-center gap-1.5 rounded-field border border-c-border px-3 py-1.5 text-[12px] font-medium text-c-text3 hover:bg-c-subtle"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {L("下载", "Download")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const q = new URLSearchParams();
                      q.set("src", result);
                      q.set("category", "main");
                      router.push(`/generate?${q.toString()}`);
                    }}
                    className="flex items-center gap-1.5 rounded-field px-3 py-1.5 text-[12px] font-medium text-white"
                    style={{ background: ACCENT }}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    {L("拿去生图", "Edit")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-[11px] text-c-text3">
                {L(
                  "在图上涂抹要修改的区域(蓝色),再写描述、点开始改图",
                  "Paint (blue) the area to edit, then describe & generate"
                )}
              </p>
              {/* 原图 + 涂抹层叠加 */}
              <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-field border border-c-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrl}
                  alt="source"
                  className="block max-h-[64vh] max-w-full select-none object-contain"
                  draggable={false}
                />
                <canvas
                  ref={canvasRef}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerLeave={onUp}
                  className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </ToolShell>
  );
}
