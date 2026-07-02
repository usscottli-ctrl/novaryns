"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Blend,
  Plus,
  X,
  Download,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
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

const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_IMAGES = 6;
const MIN_IMAGES = 2;
const RESOLUTION = "1K"; // 融图固定 1K 基础尺寸(需要更大再去生图页放大),计费按 1K
const ACCENT = "#2BB3A3";
const TINT = "rgba(43,179,163,.12)";
const ACC_SOFT = "rgba(43,179,163,.08)";

// 用户没写融合要求时的兜底指令:把多张图融成一张自然的电商合成大片,保住各自主体。
const DEFAULT_FUSE =
  "Blend the uploaded images into one cohesive, photorealistic composite. Keep each product's true shape, colour, material and proportions; merge lighting, perspective and colour grading naturally so it reads as a single high-end e-commerce shot. No collage, no borders, no added text.";

type Slot = { id: string; file: File; url: string };
type Ratio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16" | "auto";
type Quality = "low" | "medium" | "high";

const RATIOS: Ratio[] = ["1:1", "3:4", "4:3", "16:9", "9:16", "auto"];

export function FuseClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const router = useRouter();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [quality, setQuality] = useState<Quality>("medium");
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);

  const cost = count * resolutionCost(RESOLUTION);

  // 卸载时释放 objectURL,避免内存泄漏
  useEffect(() => {
    return () => slots.forEach((s) => URL.revokeObjectURL(s.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从作品页点融图作品带 ?view=<url> 进来:右侧直接展示这张融合结果。
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

  function addFiles(files: File[]) {
    if (!user) {
      openAuth();
      return;
    }
    setError(null);
    const room = MAX_IMAGES - slots.length;
    const next: Slot[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size > MAX_UPLOAD) {
        setError(L("单张图片需小于 12MB", "Each image must be < 12MB"));
        continue;
      }
      next.push({
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        url: URL.createObjectURL(f),
      });
    }
    if (next.length) setSlots((prev) => [...prev, ...next]);
  }

  function removeSlot(id: string) {
    setSlots((prev) => {
      const s = prev.find((x) => x.id === id);
      if (s) URL.revokeObjectURL(s.url);
      return prev.filter((x) => x.id !== id);
    });
  }

  // 「以此图再融合」:把该结果图下载成 File,设成第一张输入图,清空旧结果,等用户再点生成。
  async function regenFrom(url: string) {
    if (!user) {
      openAuth();
      return;
    }
    setError(null);
    try {
      const isLocal = url.startsWith("blob:") || url.startsWith("data:");
      const fetchUrl = isLocal
        ? url
        : `/api/download?u=${encodeURIComponent(url)}&n=input.png`;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const file = new File([blob], "fusion.png", {
        type: blob.type || "image/png",
      });
      const slot: Slot = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        url: URL.createObjectURL(file),
      };
      // 设成第一张输入图:释放原第一张的 objectURL,把新图放到首位。
      setSlots((prev) => {
        if (prev[0]) URL.revokeObjectURL(prev[0].url);
        return [slot, ...prev.slice(1)];
      });
      setResults([]);
    } catch {
      setError(L("载入失败,请重试", "Could not load image, please retry"));
    }
  }

  async function generate() {
    if (!user) {
      openAuth();
      return;
    }
    if (slots.length < MIN_IMAGES) {
      setError(L("请至少上传 2 张图片再融合", "Upload at least 2 images to fuse"));
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
      const fd = new FormData();
      fd.append("prompt", prompt.trim() || DEFAULT_FUSE);
      // 落库只存用户原始提示词(可能为空),不存系统兜底词 DEFAULT_FUSE
      fd.append("userPrompt", prompt.trim());
      fd.append("category", "fusion");
      fd.append("ratio", ratio);
      fd.append("resolution", RESOLUTION);
      fd.append("quality", quality);
      fd.append("count", String(count));
      fd.append("email", user.email);
      slots.forEach((s) => fd.append("image", s.file));

      // 异步任务:POST 拿 jobId,再轮询 GET,保证每个请求都短(不撞 CDN ~100s 超时)。
      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error ?? L("融合失败", "Failed"));
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
          throw new Error(s.error ?? L("融合失败", "Failed"));
      }

      if (data.user) applyServerUser(data.user);
      else consumeCredits(cost);
      setResults(data.images);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : L("融合失败,请重试", "Failed, please retry")
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
      name={L("AI 融图", "AI Image Fusion")}
      desc={L(
        "上传多张图,描述如何融合,AI 合成一张自然大片",
        "Upload several images, describe the blend, get one cohesive shot"
      )}
      Icon={Blend}
      tint={TINT}
      accent={ACCENT}
      category="fusion"
      onRegen={regenFrom}
      regenLabel="以此图再融合"
      cost={cost}
      actionLabel={L("开始融合", "Fuse")}
      onAction={generate}
      processing={loading}
      disabled={slots.length < MIN_IMAGES}
      error={error}
      resultTitle={L("融合结果", "Result")}
      refreshKey={results.length}
      left={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {/* 图片槽位 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              <span className="text-c-danger">* </span>
              {L("参考图", "Reference images")}{" "}
              <span className="text-[11px] font-normal text-c-text3">
                {slots.length}/{MAX_IMAGES} · {L("至少 2 张", "min 2")}
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              {slots.map((s, i) => (
                <div
                  key={s.id}
                  className="group relative aspect-square overflow-hidden rounded-field border border-c-border bg-c-subtle2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.url}
                    alt={`ref-${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSlot(s.id)}
                    aria-label={L("移除", "Remove")}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {slots.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[11px]">{L("添加", "Add")}</span>
                </button>
              )}
            </div>
          </div>

          {/* 融合描述 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("融合要求", "Fusion prompt")}{" "}
              <span className="text-[11px] font-normal text-c-text3">
                {L("(可留空,默认自然合成)", "(optional)")}
              </span>
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={L(
                "例如:把第 1 张的产品放进第 2 张的场景里,保留产品材质,统一光线为暖色自然光,电商主图风格。",
                "e.g. Place the product from image 1 into the scene from image 2; keep its material, unify warm natural lighting, hero-shot style."
              )}
              className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2.5 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
            />
          </div>

          {/* 比例 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("比例", "Aspect")}
            </p>
            <div className="flex flex-wrap gap-2">
              {RATIOS.map((r) => {
                const active = ratio === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRatio(r)}
                    style={optStyle(active)}
                    className={cn(
                      "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium",
                      optClass(active)
                    )}
                  >
                    {r === "auto" ? L("自动", "Auto") : r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 出图模式 + 数量 */}
          <div className="flex gap-4">
            <div className="flex-1">
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("出图模式", "Mode")}
              </p>
              <div className="flex gap-1.5">
                {(
                  [
                    ["low", L("基础", "Basic")],
                    ["medium", L("标准", "Standard")],
                    ["high", L("高阶", "Fine")],
                  ] as [Quality, string][]
                ).map(([q, label]) => {
                  const active = quality === q;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuality(q)}
                      style={optStyle(active)}
                      className={cn(
                        "flex-1 rounded-[8px] border px-2 py-1.5 text-[12px] font-medium",
                        optClass(active)
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="w-24">
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("数量", "Count")}
              </p>
              <div className="flex gap-1.5">
                {[1, 2, 4].map((n) => {
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
                      alt="fused"
                      onClick={() => zoom(im.url)}
                      className={cn(
                        "block max-w-full cursor-zoom-in object-contain",
                        results.length === 1 ? "max-h-[60vh]" : "max-h-[42vh]"
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => regenFrom(im.url)}
                      className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded-[8px] bg-black/55 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-black/75"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {L("以此图再融合", "Fuse from this")}
                    </button>
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/55 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => downloadImage(im.url, "fusion")}
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
            <ToolDemo {...getDemo("fusion")!} />
          )}
        </div>
      )}
    </ToolShell>
  );
}
