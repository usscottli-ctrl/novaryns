"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, X, Download, ArrowRight, RefreshCw } from "lucide-react";
import type { GeneratedImage } from "@/app/api/generate-image/route";
import type { SessionUser } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { downloadImage } from "@/lib/download";
import { resolutionCost } from "@/lib/mock-data";
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

// 中性基底:具体保什么/改什么由「裂变设置」决定,这里只定调"成系列的电商大片"。
const DEFAULT_VARY =
  "Create a single fresh creative variation of the uploaded product/design image, rendered as ONE standalone full-frame image that fills the entire canvas. Output a polished, high-end e-commerce visual. Critically: the result must be exactly ONE scene — never a grid, collage, montage, multi-panel, split-screen, tiled or contact-sheet layout, and never place several versions side by side. No borders, no watermark, and do not add text that isn't in the source.";

// 裂变设置(对标参考站,按电商「主体 / 背景 / 印花」组合):每项拼一段指令进 prompt。
const SPLIT_MODES: { key: string; zh: string; en: string; hint: string }[] = [
  {
    key: "print",
    zh: "平面印花创意裂变",
    en: "Flat print variations",
    hint: "Treat the image as a flat print / graphic design asset. Redesign the artwork itself with one fresh theme, season, motif and colour story for this single output, keeping it a clean flat graphic.",
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

export function VariationsClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const router = useRouter();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [splitMode, setSplitMode] = useState("print");
  const [similarity, setSimilarity] = useState(80);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);

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
      const finalPrompt = [
        DEFAULT_VARY,
        mode?.hint ?? "",
        similarityHint(similarity),
        prompt.trim(),
      ]
        .filter(Boolean)
        .join(" ");

      const fd = new FormData();
      fd.append("prompt", finalPrompt);
      // 落库只存用户原始补充描述(可能为空),不存拼接的系统提示词
      fd.append("userPrompt", prompt.trim());
      fd.append("category", "variation");
      // 比例/出图模式已从 UI 移除:比例走「自动」(跟随原图),模式固定标准档。
      fd.append("ratio", "auto");
      fd.append("resolution", RESOLUTION);
      fd.append("quality", "medium");
      fd.append("count", String(count));
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
        const sres = await fetch(
          `/api/generate-image?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const s = await sres.json();
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
                  src={slot.url}
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
        <div className="flex flex-1 items-center justify-center">
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
                      src={im.url}
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
