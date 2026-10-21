"use client";

import { fetchJobStatus } from "@/lib/poll-job";
import { cdnUrl } from "@/lib/cdn";
import { useStickyState } from "@/lib/use-sticky-state";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, X, Download, ArrowRight, RefreshCw, Wand2, Sparkles } from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import type { GeneratedImage } from "@/app/api/generate-image/route";
import type { SessionUser } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { downloadImage } from "@/lib/download";
import { resolutionCost, GENERATION_RATIOS } from "@/lib/mock-data";
import { RatioTileGroup } from "@/components/ui/ratio-tile";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";
import { SelectMenu } from "@/components/ui/select-menu";

const MAX_UPLOAD = 12 * 1024 * 1024;
const RESOLUTION = "1K"; // 图裂变固定 1K(要更大去生图页放大),计费按 1K
const ACCENT = "#6D5BF6";
const TINT = "rgba(109,91,246,.12)";
const ACC_SOFT = "rgba(109,91,246,.08)";

// 中性基底:只管"出一张完整的图、别拼图"。保什么/改什么由「裂变设置」决定。
const DEFAULT_VARY =
  "Create a single fresh creative variation of the uploaded image, rendered as ONE standalone full-frame image that fills the entire canvas. Critically: the result must be exactly ONE scene — never a grid, collage, montage, multi-panel, split-screen, tiled or contact-sheet layout, and never place several versions side by side. No borders, no watermark, and do not add text that isn't in the source.";
// 产品类裂变(换背景/换主体等)才要"电商大片"调性;平面印花不要(会被画成产品摄影)
const ECOM_LOOK = "Output a polished, high-end e-commerce visual.";

// 平面印花裂变(2026-10-21 按客户给的提示词改写):原图只当风格参考,出**新设计**而不是
// 换色/近似复制 —— 原来默认相似度 95% 发的是"只做细微改动",和"重新设计"互相打架,
// 出来基本是原图换个颜色。{N} 由相似度滑块决定要改几项。
const PRINT_BRIEF =
  "Use the uploaded image only as a visual style reference for a print / graphic design — do not copy it. " +
  "Create ONE new original design that keeps the reference's overall art direction so it clearly belongs to the same collection: " +
  "mood, colour family, illustration language, line and shading style, level of detail, visual cleanliness, and its cute or decorative charm. " +
  "At the same time make it a genuinely new design, not a recolour or near-duplicate: change {N} of these — main subject shape or silhouette, " +
  "composition structure, size proportions, number of elements, decorative marks, facial expression or pose, accent placement, " +
  "secondary shape details, internal pattern details. Do not reuse the same silhouette. " +
  "Design goals: commercially attractive, clean, balanced composition, suitable for printing on products. " +
  "Output one finished flat artwork only: no text, no logo, no watermark, no product mockup, no collage; " +
  "plain clean background (keep it a seamless repeat if the reference is a repeating pattern); crisp, print-ready edges.";

// 印花模式下相似度 → 要改几项(滑块越低改得越多)
function printChangeCount(v: number): string {
  if (v >= 90) return "2 to 3";
  if (v >= 75) return "3 to 5";
  if (v >= 60) return "5 or more";
  return "most";
}

// 一次出多张时每张各往不同方向变(同一提示词出的几张会大同小异)
const PRINT_FOCUS = [
  "For this output, put most of the change into the main subject's silhouette and shape.",
  "For this output, put most of the change into the composition and the number / arrangement of elements.",
  "For this output, put most of the change into decorative marks, accents and internal pattern details.",
  "For this output, put most of the change into proportions, pose or expression, and secondary shape details.",
];
function variantHints(mode: string, n: number): string[] | null {
  if (n <= 1) return null;
  return Array.from({ length: n }, (_, i) =>
    mode === "print"
      ? `${PRINT_FOCUS[i % PRINT_FOCUS.length]} It must also look clearly different from the other ${n - 1} designs generated in this batch.`
      : `This is output ${i + 1} of ${n}: take a concept clearly different from the other outputs in this batch, not a minor tweak of them.`
  );
}

// 裂变设置(对标参考站,按电商「主体 / 背景 / 印花」组合):每项拼一段指令进 prompt。
const SPLIT_MODES: { key: string; zh: string; en: string; hint: string }[] = [
  {
    key: "print",
    zh: "平面印花创意裂变",
    en: "Flat print variations",
    hint: PRINT_BRIEF, // {N} 在生成时按相似度替换
  },
  {
    key: "bg",
    zh: "主体不变 · 只换背景",
    en: "Keep product, change background",
    hint: "Keep the product subject's exact shape, colour, material and logo unchanged. Only replace the background scene, environment and props.",
  },
  {
    key: "surface",
    zh: "主体不变 · 只换表面印花",
    en: "Keep shape, change surface print",
    hint: "Keep the product's exact shape and silhouette. Only change the surface pattern, print or graphics applied on the product.",
  },
  {
    key: "both",
    zh: "主体 + 背景都改",
    en: "Change product & background",
    hint: "Reimagine both the product styling and the background scene together into fresh creative variations, keeping the same product category.",
  },
  {
    key: "subject",
    zh: "背景不变 · 只换主体",
    en: "Keep background, change product",
    hint: "Keep the background and scene unchanged. Vary the product subject's styling, colourway and details.",
  },
  { key: "custom", zh: "自定义裂变要求", en: "Custom", hint: "" },
];

// 相似度档→指令:控制变体偏离原图的幅度(gpt-image 无 strength 参数,靠措辞表达)。
function similarityHint(v: number): string {
  if (v >= 90)
    return "Stay very close to the original — only subtle, minimal changes.";
  if (v >= 75)
    return "Apply moderate variation while keeping it clearly recognizable as the same product.";
  if (v >= 60) return "Apply noticeable, creative variation.";
  return "Boldly reinterpret it with dramatic, adventurous changes.";
}

type Slot = { id: string; file: File; url: string };

/** 原图宽高比,化简成 "w:h"(限制在 1:3 ~ 3:1 之间);读不到图时回退 auto。 */
async function sourceRatio(url: string): Promise<string> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) return "auto";
    if (w / h > 3) h = Math.round(w / 3);
    if (h / w > 3) w = Math.round(h / 3);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
  } catch {
    return "auto";
  }
}

export function VariationsClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const router = useRouter();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [splitMode, setSplitMode] = useState("print");
  // 默认 80:原来 95 = "只做细微改动",出来和原图几乎一样(客户投诉裂变没变化)
  const [similarity, setSimilarity] = useState(80);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useStickyState("variations.count", 1, (v) => [1, 2, 4].includes(v));
  const [ratio, setRatio] = useStickyState("variations.ratio", "auto", (v) =>
    GENERATION_RATIOS.some((r) => r.id === v)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  // AI帮写/智能优化(贴按钮弹窗,全站统一)
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistRun, setAssistRun] = useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  function openAssist(mode: "write" | "optimize") {
    if (!slot) {
      setError(L("请先上传图片", "Upload an image first"));
      return;
    }
    setError(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }

  const cost = count * resolutionCost(RESOLUTION);
  const isCustom = splitMode === "custom";

  // 卸载时释放 objectURL
  useEffect(() => {
    return () => {
      if (slot) URL.revokeObjectURL(slot.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从作品页点图裂变作品带 ?view=<url> 进来:右侧直接展示这张结果。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const view = new URLSearchParams(window.location.search).get("view");
    if (!view) return;
    setResults([
      {
        id: `view-${Date.now()}`,
        url: view,
        gradient: "",
        prompt: "",
        ratio: "1:1",
        createdAt: "",
      },
    ]);
  }, []);

  function addFile(files: File[]) {
    if (!user) {
      openAuth();
      return;
    }
    setError(null);
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      setError(L("图片需小于 12MB", "Image must be < 12MB"));
      return;
    }
    setSlot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return {
        id: `s-${Date.now()}`,
        file: f,
        url: URL.createObjectURL(f),
      };
    });
  }

  function removeSlot() {
    setSlot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  // 「以此图再裂变」:把指定结果图载入成参考图(输入图)、清空旧结果,等用户再点「开始裂变」(不自动扣分)。
  async function regenFrom(url: string) {
    if (!user) {
      openAuth();
      return;
    }
    if (!url) return;
    try {
      const blob =
        url.startsWith("blob:") || url.startsWith("data:")
          ? await (await fetch(url)).blob()
          : await (
              await fetch(`/api/download?u=${encodeURIComponent(url)}&n=input.png`)
            ).blob();
      const f = new File([blob], "input.png", { type: blob.type || "image/png" });
      setSlot((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { id: `s-${Date.now()}`, file: f, url: URL.createObjectURL(f) };
      });
      setResults([]);
      setError(null);
    } catch {
      setError(L("载入失败,请重试", "Failed to load, please retry"));
    }
  }

  async function generate() {
    if (!user) {
      openAuth();
      return;
    }
    if (!slot) {
      setError(L("请先上传一张图片", "Upload an image first"));
      return;
    }
    if (isCustom && !prompt.trim()) {
      setError(L("自定义模式请填写裂变要求", "Describe your custom requirement"));
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
    setError(null);
    setLoading(true);
    try {
      const mode = SPLIT_MODES.find((m) => m.key === splitMode);
      const isPrint = splitMode === "print";
      const finalPrompt = [
        DEFAULT_VARY,
        isPrint ? "" : ECOM_LOOK,
        isPrint ? PRINT_BRIEF.replace("{N}", printChangeCount(similarity)) : mode?.hint ?? "",
        // 印花模式的改动幅度已体现在 {N} 里;通用相似度措辞说的是"同一个产品",不适用
        isPrint ? "" : similarityHint(similarity),
        prompt.trim(),
      ]
        .filter(Boolean)
        .join(" ");
      const variants = variantHints(splitMode, count);

      const fd = new FormData();
      fd.append("prompt", finalPrompt);
      // 落库只存用户原始补充描述(可能为空),不存拼接的系统提示词
      fd.append("userPrompt", prompt.trim());
      fd.append("category", "variation");
      // 比例:选了具体比例按该比例出图;「默认」= 跟随原图 —— 读出原图宽高比按它出,
      // 不再交给模型自选(自选时同一批会出 1254×1254 / 1230×1278 这种不一致的尺寸,客户反馈)。
      fd.append("ratio", ratio === "auto" ? await sourceRatio(slot.url) : ratio);
      fd.append("resolution", RESOLUTION);
      fd.append("quality", "medium");
      fd.append("count", String(count));
      if (variants) fd.append("variants", JSON.stringify(variants));
      fd.append("email", user.email);
      fd.append("image", slot.file);

      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error ?? L("生成失败", "Failed"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(L("任务创建失败,请重试", "Could not start job"));

      const deadline = Date.now() + 6 * 60 * 1000;
      let data: { images: GeneratedImage[]; user?: SessionUser | null } | null =
        null;
      while (!data) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline)
          throw new Error(L("生成超时,请重试", "Timed out, please retry"));
        const s = await fetchJobStatus(`/api/generate-image?job=${encodeURIComponent(jobId)}`);
        if (s.status === "done") data = s;
        else if (s.status === "error")
          throw new Error(s.error ?? L("生成失败", "Failed"));
      }

      if (data.user) applyServerUser(data.user);
      else consumeCredits(cost);
      setResults(data.images);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : L("生成失败,请重试", "Failed, please retry")
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
      name={L("图裂变", "Variations")}
      desc={L(
        "基于单张图片生成多维度创意变体,快速产出系列化视觉素材",
        "Derive multiple creative variations from one image — a ready-made series"
      )}
      Icon={Copy}
      tint={TINT}
      accent={ACCENT}
      category="variation"
      onRegen={regenFrom}
      regenLabel="以此图再裂变"
      cost={cost}
      actionLabel={L("开始裂变", "Generate")}
      onAction={generate}
      processing={loading}
      disabled={!slot}
      error={error}
      resultTitle={L("裂变结果", "Variations")}
      refreshKey={results.length}
      left={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              addFile(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {/* 参考图 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              <span className="text-c-danger">* </span>
              {L("参考图", "Reference image")}
            </p>
            {slot ? (
              <div className="group relative h-16 w-16 overflow-hidden rounded-field border border-c-border bg-c-subtle2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cdnUrl(slot.url)}
                  alt="source"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={removeSlot}
                  aria-label={L("移除", "Remove")}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
              >
                <Plus className="h-4 w-4" />
                <span className="text-[10px]">{L("上传", "Upload")}</span>
              </button>
            )}
          </div>

          {/* 裂变设置 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              <span className="text-c-danger">* </span>
              {L("裂变设置", "Split mode")}
            </p>
            <SelectMenu
              value={splitMode}
              onChange={setSplitMode}
              className="w-full"
              options={SPLIT_MODES.map((m) => ({
                value: m.key,
                label: L(m.zh, m.en),
              }))}
            />
          </div>

          {/* 补充描述 / 自定义要求 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {isCustom && <span className="text-c-danger">* </span>}
              {isCustom
                ? L("自定义裂变要求", "Custom requirement")
                : L("补充描述", "Extra prompt")}{" "}
              {!isCustom && (
                <span className="text-[11px] font-normal text-c-text3">
                  {L("(可留空)", "(optional)")}
                </span>
              )}
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
              tool="variations"
              currentPrompt={prompt}
              imageFile={slot?.file ?? null}
              imageThumb={slot?.url ?? ""}
              run={assistRun}
              onUse={(t) => setPrompt(t)}
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                isCustom
                  ? L(
                      "描述你想要的裂变方向,例如:做成四季主题系列,各换对应季节的配色和元素。",
                      "Describe the variation you want, e.g. a four-season themed series."
                    )
                  : L(
                      "例如:保留产品标签文字,整体偏清新色调。",
                      "e.g. Keep the label text; overall fresh tone."
                    )
              }
              className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2.5 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
            />
          </div>

          {/* 相似度 */}
          <div>
            <p className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-c-text2">
              <span>{L("相似度", "Similarity")}</span>
              <span className="text-acc">{similarity}%</span>
            </p>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={similarity}
              onChange={(e) => setSimilarity(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: ACCENT }}
            />
            <p className="mt-1 text-[11px] text-c-text3">
              {L(
                "越高越接近原图,越低变化越大胆",
                "Higher = closer to the original; lower = bolder changes"
              )}
            </p>
          </div>

          {/* 比例(与生图页同一组件与选项;默认=跟随原图) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">{L("比例", "Aspect ratio")}</p>
            <RatioTileGroup
              columns={4}
              value={ratio}
              onChange={setRatio}
              tiles={GENERATION_RATIOS.map((r) => {
                const max = 26;
                const w = !r.w || !r.h ? 24 : r.w >= r.h ? max : Math.round((r.w / r.h) * max);
                const h = !r.w || !r.h ? 18 : r.h >= r.w ? max : Math.round((r.h / r.w) * max);
                return { id: r.id, label: r.id === "auto" ? L("默认", "Auto") : r.id, w, h };
              })}
            />
          </div>

          {/* 生成数量(默认 1,最多 8) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("生成数量", "Quantity")}
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 4, 8].map((n) => {
                const active = count === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    style={optStyle(active)}
                    className={cn(
                      "flex-1 rounded-[8px] border py-1.5 text-[12px] font-medium",
                      optClass(active)
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      }
    >
      {(zoom) => (
        <div className="flex flex-1 flex-col">
          {loading ? (
            <div className="relative min-h-[300px] w-full flex-1">
              <GenLoader />
            </div>
          ) : results.length > 0 ? (
            <div
              className={cn(
                "grid w-full gap-3",
                results.length === 1 ? "grid-cols-1" : "grid-cols-2"
              )}
            >
              {results.map((im) => (
                <div key={im.id} className="flex items-center justify-center">
                  <div className="group relative inline-block overflow-hidden rounded-[13px] border border-c-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cdnUrl(im.url)}
                      alt="variation"
                      onClick={() => zoom(im.url)}
                      className={cn(
                        "block max-w-full cursor-zoom-in object-contain",
                        results.length === 1 ? "max-h-[60vh]" : "max-h-[40vh]"
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => regenFrom(im.url)}
                      className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {L("以此图再裂变", "Vary from this")}
                    </button>
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/55 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => downloadImage(im.url, "variation")}
                        className="flex items-center gap-1.5 rounded-[8px] bg-white/90 px-3 py-1.5 text-[12px] font-medium text-slate-900 hover:bg-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {L("下载", "Download")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const q = new URLSearchParams();
                          q.set("src", im.url);
                          q.set("category", "main");
                          router.push(`/generate?${q.toString()}`);
                        }}
                        className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium text-white"
                        style={{ background: ACCENT }}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        {L("拿去生图", "Edit")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ToolDemo {...getDemo("variation")!} />
          )}
        </div>
      )}
    </ToolShell>
  );
}
