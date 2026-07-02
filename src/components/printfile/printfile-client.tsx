"use client";

import { useEffect, useRef, useState } from "react";
import {
  Printer,
  Plus,
  X,
  Download,
  Check,
  AlertCircle,
  Lock,
  LockOpen,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { downloadImage } from "@/lib/download";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";

const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_ITEMS = 12;
const PRINTFILE_COST = 0; // 免费(纯本地处理),登录即可用
const MAX_PX = 8000;
const ACCENT = "#2E7CF6";
const TINT = "rgba(46,124,246,.12)";
const ACC_SOFT = "rgba(46,124,246,.08)";

// 常用成品尺寸(毫米):纸张 + 电商物料。custom=手填。
const PRESETS: { key: string; zh: string; en: string; w: number; h: number }[] = [
  { key: "custom", zh: "自定义", en: "Custom", w: 0, h: 0 },
  { key: "a4p", zh: "A4 纵 (210×297)", en: "A4 ↕ (210×297)", w: 210, h: 297 },
  { key: "a4l", zh: "A4 横 (297×210)", en: "A4 ↔ (297×210)", w: 297, h: 210 },
  { key: "a3", zh: "A3 (297×420)", en: "A3 (297×420)", w: 297, h: 420 },
  { key: "a5", zh: "A5 (148×210)", en: "A5 (148×210)", w: 148, h: 210 },
  { key: "card", zh: "名片 (90×54)", en: "Card (90×54)", w: 90, h: 54 },
  { key: "sq", zh: "方形 (200×200)", en: "Square (200×200)", w: 200, h: 200 },
  { key: "poster", zh: "海报 (600×900)", en: "Poster (600×900)", w: 600, h: 900 },
  { key: "rollup", zh: "易拉宝 (800×2000)", en: "Roll-up (800×2000)", w: 800, h: 2000 },
];

type Status = "pending" | "processing" | "done" | "error";
type Item = {
  id: string;
  file: File;
  url: string;
  status: Status;
  resultUrl?: string;
  px?: { w: number; h: number };
  error?: string;
};

export function PrintfileClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  // 锁比例时联动用的当前宽高比(w/h)
  const aspectRef = useRef(210 / 297);
  const [items, setItems] = useState<Item[]>([]);
  const [preset, setPreset] = useState("a4p");
  const [wMm, setWMm] = useState(210);
  const [hMm, setHMm] = useState(297);
  const [dpi, setDpi] = useState(300);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [lock, setLock] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const doneItems = items.filter((i) => i.status === "done" && i.resultUrl);
  const cost = pendingCount * PRINTFILE_COST;

  // 目标像素预览(与后端同样的上限夹取)
  let wPx = Math.round((wMm / 25.4) * dpi);
  let hPx = Math.round((hMm / 25.4) * dpi);
  const over = Math.max(wPx / MAX_PX, hPx / MAX_PX, 1);
  if (over > 1) {
    wPx = Math.round(wPx / over);
    hPx = Math.round(hPx / over);
  }

  useEffect(() => {
    return () => items.forEach((i) => URL.revokeObjectURL(i.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickPreset(key: string) {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (p && p.w > 0) {
      setWMm(p.w);
      setHMm(p.h);
      aspectRef.current = p.w / p.h;
    }
  }

  function changeW(v: number) {
    setPreset("custom");
    if (lock && v > 0) {
      setWMm(v);
      setHMm(Math.max(1, Math.round(v / aspectRef.current)));
    } else {
      setWMm(v);
      if (v > 0 && hMm > 0) aspectRef.current = v / hMm;
    }
  }
  function changeH(v: number) {
    setPreset("custom");
    if (lock && v > 0) {
      setHMm(v);
      setWMm(Math.max(1, Math.round(v * aspectRef.current)));
    } else {
      setHMm(v);
      if (wMm > 0 && v > 0) aspectRef.current = wMm / v;
    }
  }

  function addFiles(files: File[]) {
    if (!user) {
      openAuth();
      return;
    }
    setError(null);
    const room = MAX_ITEMS - items.length;
    const next: Item[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size > MAX_UPLOAD) {
        setError(L("单张图片需小于 20MB", "Each image must be < 20MB"));
        continue;
      }
      next.push({
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        url: URL.createObjectURL(f),
        status: "pending",
      });
    }
    if (next.length) setItems((prev) => [...prev, ...next]);
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((x) => x.id !== id);
    });
  }

  // 以此结果图再做:把成品图载入成该队列项的新输入图、回到待处理(不自动扣分,需用户再点生成)
  async function regenFrom(id: string, url: string) {
    if (!user) {
      openAuth();
      return;
    }
    try {
      let blob: Blob;
      if (url.startsWith("blob:") || url.startsWith("data:")) {
        blob = await (await fetch(url)).blob();
      } else {
        const r = await fetch(
          `/api/download?u=${encodeURIComponent(url)}&n=input.png`
        );
        if (!r.ok) throw new Error("download failed");
        blob = await r.blob();
      }
      const file = new File([blob], "input.png", {
        type: blob.type || "image/png",
      });
      const nextUrl = URL.createObjectURL(file);
      setItems((prev) =>
        prev.map((x) => {
          if (x.id !== id) return x;
          URL.revokeObjectURL(x.url);
          return {
            id: x.id,
            file,
            url: nextUrl,
            status: "pending",
          };
        })
      );
    } catch {
      setError(L("载入失败,请重试", "Failed to load image, try again"));
    }
  }

  async function processOne(it: Item): Promise<void> {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, status: "processing" } : x))
    );
    try {
      const fd = new FormData();
      fd.append("image", it.file);
      fd.append("dpi", String(dpi));
      fd.append("wMm", String(wMm));
      fd.append("hMm", String(hMm));
      fd.append("fit", fit);
      if (user) fd.append("email", user.email);

      const res = await fetch("/api/printfile", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.url)
        throw new Error(data.error ?? L("生成失败", "Failed"));
      if (data.user) applyServerUser(data.user);
      else if (data.creditsUsed) consumeCredits(data.creditsUsed);
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id
            ? { ...x, status: "done", resultUrl: data.url, px: data.px }
            : x
        )
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id
            ? {
                ...x,
                status: "error",
                error: e instanceof Error ? e.message : "失败",
              }
            : x
        )
      );
    }
  }

  async function start() {
    if (!user) {
      openAuth();
      return;
    }
    if (busyRef.current) return;
    const queue = items.filter((i) => i.status === "pending");
    if (!queue.length) {
      setError(L("请先上传图片", "Upload images first"));
      return;
    }
    if (!(wMm > 0) || !(hMm > 0)) {
      setError(L("请填写成品尺寸", "Enter a size first"));
      return;
    }
    if (remaining < queue.length * PRINTFILE_COST) {
      setError(
        L(
          `积分不足:本次需 ${queue.length * PRINTFILE_COST},剩余 ${remaining}`,
          `Not enough credits: need ${queue.length * PRINTFILE_COST}, have ${remaining}`
        )
      );
      return;
    }
    setError(null);
    busyRef.current = true;
    setProcessing(true);
    for (const it of queue) {
      await processOne(it);
    }
    busyRef.current = false;
    setProcessing(false);
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
      name={L("印刷图", "Print File")}
      desc={L(
        "按 DPI + 成品尺寸生成符合印刷标准的高清文件",
        "Output a print-ready high-res file at your DPI & size"
      )}
      Icon={Printer}
      tint={TINT}
      accent={ACCENT}
      category="printfile"
      cost={cost}
      actionLabel={
        pendingCount > 0 && PRINTFILE_COST === 0
          ? L("生成印刷图 · 免费", "Generate · Free")
          : L("生成印刷图", "Generate")
      }
      onAction={start}
      processing={processing}
      disabled={pendingCount === 0}
      error={error}
      resultTitle={L("印刷图队列", "Print queue")}
      refreshKey={doneItems.length}
      left={
        <>
          {/* 隐藏文件输入 */}
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

          {/* 上传图片(与全站一致:放左侧参数列顶部) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("上传图片", "Upload")}{" "}
              <span className="text-[11px] font-normal text-c-text3">
                {items.length}/{MAX_ITEMS}
              </span>
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={L("可批量,单张 < 20MB", "batch, < 20MB each")}
              className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
            >
              <Printer className="h-4 w-4" />
              <span className="text-[10px]">
                {items.length ? L("继续", "More") : L("上传", "Upload")}
              </span>
            </button>
          </div>

          {/* 成品尺寸(下拉) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("成品尺寸", "Size")}
            </p>
            <SelectMenu
              value={preset}
              onChange={pickPreset}
              className="w-full"
              options={PRESETS.map((p) => ({
                value: p.key,
                label: L(p.zh, p.en),
              }))}
            />
            {/* 宽高 + 锁比例 */}
            <div className="mt-2 flex items-center gap-2">
              <label className="flex flex-1 items-center gap-1 rounded-field border border-c-border px-2 py-1.5 text-xs focus-within:border-acc">
                <span className="text-c-text3">{L("宽", "W")}</span>
                <input
                  type="number"
                  value={wMm || ""}
                  min={10}
                  max={2000}
                  onChange={(e) => changeW(Number(e.target.value))}
                  className="w-full bg-transparent text-right text-c-text focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => setLock((v) => !v)}
                aria-label={L("锁定宽高比", "Lock ratio")}
                title={L("锁定宽高比", "Lock aspect ratio")}
                style={optStyle(lock)}
                className={cn(
                  "flex h-8 w-8 flex-none items-center justify-center rounded-field border",
                  optClass(lock)
                )}
              >
                {lock ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <LockOpen className="h-3.5 w-3.5" />
                )}
              </button>
              <label className="flex flex-1 items-center gap-1 rounded-field border border-c-border px-2 py-1.5 text-xs focus-within:border-acc">
                <span className="text-c-text3">{L("高", "H")}</span>
                <input
                  type="number"
                  value={hMm || ""}
                  min={10}
                  max={2000}
                  onChange={(e) => changeH(Number(e.target.value))}
                  className="w-full bg-transparent text-right text-c-text focus:outline-none"
                />
              </label>
              <span className="text-xs text-c-text3">mm</span>
            </div>
          </div>

          {/* DPI(滑块) */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              DPI{" "}
              <span className="text-[11px] font-normal text-c-text3">
                {dpi <= 150
                  ? L("· 普通", "· basic")
                  : dpi <= 300
                    ? L("· 印刷标准", "· print")
                    : L("· 高精", "· high")}
              </span>
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={72}
                max={1200}
                step={1}
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer"
                style={{ accentColor: ACCENT }}
              />
              <input
                type="number"
                min={72}
                max={1200}
                value={dpi}
                onChange={(e) =>
                  setDpi(Math.min(1200, Math.max(72, Number(e.target.value) || 72)))
                }
                className="w-20 rounded-field border border-c-border bg-c-card px-2 py-1.5 text-right text-sm text-c-text focus:border-acc focus:outline-none"
              />
            </div>
          </div>

          {/* 适应方式 */}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("裁切方式", "Fit")}
            </p>
            <div className="flex gap-2">
              {(
                [
                  ["contain", L("完整 · 留白", "Contain")],
                  ["cover", L("填满 · 裁切", "Cover")],
                ] as ["contain" | "cover", string][]
              ).map(([k, label]) => {
                const active = fit === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFit(k)}
                    style={optStyle(active)}
                    className={cn(
                      "flex-1 rounded-[8px] border px-2 py-1.5 text-xs font-medium",
                      optClass(active)
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 输出像素预览 */}
          <p className="rounded-field bg-c-subtle px-3 py-2 text-center text-xs text-c-text3">
            {L("输出像素", "Output")} ≈{" "}
            <b className="text-c-text">
              {wPx}×{hPx}px
            </b>
          </p>

          {/* 提示 */}
          <p className="text-[11px] leading-relaxed text-c-text3">
            {L(
              "提示:本工具做精确尺寸+DPI 排版重采样,不增加画面细节。原图偏小想更清晰,先用「AI 变清晰」放大再来生成。",
              "Note: this resizes to exact print size + DPI; it doesn't add detail. For small sources, run AI Upscale first."
            )}
          </p>
        </>
      }
    >
      {(zoom) => (
        <div className="flex min-h-0 flex-1 flex-col">
          {items.length === 0 ? (
            <ToolDemo {...getDemo("printfile")!} />
          ) : (
            <>
              {/* 全部下载(多张完成时) */}
              {doneItems.length > 1 && (
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      doneItems.forEach(
                        (it, i) =>
                          it.resultUrl &&
                          downloadImage(it.resultUrl, `print-${i + 1}`)
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-c-border px-3 py-1.5 text-xs font-medium text-c-text2 transition-colors hover:bg-c-subtle"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {L(
                      `下载全部 (${doneItems.length})`,
                      `Download all (${doneItems.length})`
                    )}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="group relative overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.resultUrl || it.url}
                      alt="item"
                      onClick={() =>
                        it.status === "done" && it.resultUrl
                          ? zoom(it.resultUrl)
                          : undefined
                      }
                      className={cn(
                        "aspect-square w-full",
                        it.status === "done"
                          ? "cursor-zoom-in object-contain p-2"
                          : "object-cover"
                      )}
                    />
                    {it.status === "processing" && <GenLoader compact />}
                    {it.status === "done" && (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
                        <Check className="h-3 w-3" />
                        {it.px ? `${it.px.w}×${it.px.h}` : L("完成", "Done")}
                      </span>
                    )}
                    {it.status === "error" && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-900/55 p-2 text-center text-white">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-[10px] leading-tight">
                          {it.error || L("失败", "Failed")}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      aria-label={L("移除", "Remove")}
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {it.status === "done" && it.resultUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          it.resultUrl && downloadImage(it.resultUrl, "print")
                        }
                        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent py-2 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {L("下载 PNG", "Download")}
                      </button>
                    )}
                    {it.status === "done" && it.resultUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          it.resultUrl && regenFrom(it.id, it.resultUrl)
                        }
                        title={L("以此图再做", "Reuse this image")}
                        className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                      >
                        <RefreshCw className="h-3 w-3" />
                        {L("以此图再做", "Reuse")}
                      </button>
                    )}
                  </div>
                ))}
                {items.length < MAX_ITEMS && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[13px] border border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-[11px]">{L("添加", "Add")}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </ToolShell>
  );
}
