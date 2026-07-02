"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  X,
  Film,
  Play,
  Download,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

const MAX_REF = 12 * 1024 * 1024;
const DURATIONS = [5, 10] as const;
const RATIOS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = ["720p", "1080p"] as const;
const CAMERAS = ["static", "push", "pull", "pan", "orbit"] as const;

const RATIO_ASPECT: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
};

// Mock 计费:基础 = 时长(秒) × 6 积分,1080p ×1.5。真接 Seedance 后按官方价换算。
function videoCost(duration: number, resolution: string): number {
  const base = duration * 6;
  return Math.round(base * (resolution === "1080p" ? 1.5 : 1));
}

type Job =
  | { status: "idle" }
  | { status: "queued" | "processing"; progress: number }
  | { status: "done"; posterUrl: string | null; ratio: string; duration: number }
  | { status: "error" };

export function VideoStudio() {
  const { user, ready, remaining } = useAuth();
  const { openAuth } = useAuthModal();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number>(5);
  const [ratio, setRatio] = useState<string>("16:9");
  const [resolution, setResolution] = useState<string>("720p");
  const [camera, setCamera] = useState<string>("static");
  const [job, setJob] = useState<Job>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  const cost = videoCost(duration, resolution);
  const busy = job.status === "queued" || job.status === "processing";

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (refPreview) URL.revokeObjectURL(refPreview);
    };
  }, [refPreview]);

  function pickRef(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (f.size > MAX_REF) return;
    if (refPreview) URL.revokeObjectURL(refPreview);
    setRefFile(f);
    setRefPreview(URL.createObjectURL(f));
  }
  function removeRef() {
    if (refPreview) URL.revokeObjectURL(refPreview);
    setRefFile(null);
    setRefPreview(null);
  }

  const cameraLabel = (c: string) =>
    t(
      c === "static"
        ? "vid.cameraStatic"
        : c === "push"
          ? "vid.cameraPush"
          : c === "pull"
            ? "vid.cameraPull"
            : c === "pan"
              ? "vid.cameraPan"
              : "vid.cameraOrbit"
    );

  // ===== Mock 异步生成流程:queued → processing(进度 0→100) → done =====
  function generate() {
    setError(null);
    if (!prompt.trim()) {
      setError(t("vid.errPrompt"));
      return;
    }
    if (!user) {
      openAuth("sign-in");
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);

    setJob({ status: "queued", progress: 0 });
    // 排队 ~800ms 后进入 processing
    setTimeout(() => {
      setJob({ status: "processing", progress: 3 });
      timerRef.current = setInterval(() => {
        setJob((j) => {
          if (j.status !== "processing") return j;
          const next = j.progress + Math.random() * 9 + 4;
          if (next >= 100) {
            if (timerRef.current) clearInterval(timerRef.current);
            return {
              status: "done",
              posterUrl: refPreview, // 有参考图就用它当封面(图生视频既视感)
              ratio,
              duration,
            };
          }
          return { status: "processing", progress: next };
        });
      }, 450);
    }, 800);
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    setJob({ status: "idle" });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* 左:参数面板 */}
      <div className="h-fit space-y-6 rounded-2xl border border-border bg-card p-6 card-shadow">
        {/* 参考图 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("vid.refLabel")}</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pickRef(e.target.files)}
          />
          {refPreview ? (
            <div className="relative aspect-video overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={refPreview}
                alt="ref"
                className="h-full w-full bg-secondary object-cover"
              />
              <button
                onClick={removeRef}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-card/90 text-foreground shadow hover:bg-card"
                aria-label={t("vid.removeRef")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Upload className="h-5 w-5" />
              <span className="text-xs">{t("vid.addRef")}</span>
            </button>
          )}
        </div>

        {/* 提示词 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("vid.promptLabel")}</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("vid.promptPlaceholder")}
            className="min-h-[110px]"
          />
        </div>

        {/* 时长 */}
        <PillGroup
          label={t("vid.durationLabel")}
          options={DURATIONS.map((d) => ({
            key: String(d),
            label: fmt(t("vid.durationUnit"), { n: d }),
          }))}
          value={String(duration)}
          onChange={(v) => setDuration(Number(v))}
        />

        {/* 比例 */}
        <PillGroup
          label={t("vid.ratioLabel")}
          options={RATIOS.map((r) => ({ key: r, label: r }))}
          value={ratio}
          onChange={setRatio}
        />

        {/* 分辨率 */}
        <PillGroup
          label={t("vid.resLabel")}
          options={RESOLUTIONS.map((r) => ({ key: r, label: r }))}
          value={resolution}
          onChange={setResolution}
        />

        {/* 运镜 */}
        <PillGroup
          label={t("vid.cameraLabel")}
          options={CAMERAS.map((c) => ({ key: c, label: cameraLabel(c) }))}
          value={camera}
          onChange={setCamera}
        />

        {/* 费用 + 余额 */}
        <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t("vid.costLabel")}</span>
          <span className="font-semibold text-primary">
            {fmt(t("vid.creditsUnit"), { n: cost })}
          </span>
        </div>
        {ready && user && (
          <p className="-mt-3 text-right text-xs text-muted-foreground">
            {t("vid.balance")}: {remaining}
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {/* 生成按钮 */}
        <Button
          variant="gradient"
          className="h-12 w-full text-[15px]"
          onClick={generate}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {!user
            ? t("vid.loginToGen")
            : fmt(t("vid.genBtn"), { c: cost })}
        </Button>

        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {t("vid.soonNote")}
        </p>
      </div>

      {/* 右:结果区 */}
      <div className="min-h-[420px] rounded-2xl border border-border bg-card p-6 card-shadow">
        {job.status === "idle" && (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Film className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t("vid.empty")}</p>
          </div>
        )}

        {busy && (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-5 text-center">
            <div
              className={cn(
                "relative w-full max-w-md overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200",
                RATIO_ASPECT[ratio]
              )}
            >
              {refPreview && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={refPreview}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-40 blur-[1px]"
                />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {job.status === "queued"
                    ? t("vid.queued")
                    : `${t("vid.processing")} ${Math.round(
                        job.progress
                      )}%`}
                </span>
              </div>
            </div>
            {/* 进度条 */}
            <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: `${job.status === "processing" ? job.progress : 2}%`,
                }}
              />
            </div>
            <p className="max-w-md text-xs text-muted-foreground">
              {t("vid.processingHint")}
            </p>
          </div>
        )}

        {job.status === "done" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("vid.resultTitle")}</h3>
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {t("vid.mockBadge")}
              </span>
            </div>
            {/* 视频结果卡(占位:封面 + 播放按钮 + 时长徽标)。真接后换 <video src> */}
            <div
              className={cn(
                "group relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-slate-800 to-slate-900",
                RATIO_ASPECT[job.ratio]
              )}
            >
              {job.posterUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={job.posterUrl}
                  alt="result"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Film className="h-12 w-12 text-white/30" />
                </div>
              )}
              <div className="absolute inset-0 bg-slate-900/25 transition-colors group-hover:bg-slate-900/35" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-card/90 shadow-lg">
                  <Play className="ml-0.5 h-6 w-6 fill-foreground text-foreground" />
                </span>
              </div>
              <span className="absolute bottom-3 right-3 rounded-md bg-slate-900/70 px-2 py-1 text-xs font-medium text-white">
                {job.duration}s · {job.ratio}
              </span>
            </div>
            <div className="mx-auto flex max-w-lg gap-2">
              <Button
                variant="gradient"
                className="flex-1"
                disabled
                title={t("vid.mockBadge")}
              >
                <Download className="h-4 w-4" />
                {t("vid.download")}
              </Button>
              <Button variant="outline" onClick={reset}>
                <RefreshCw className="h-4 w-4" />
                {t("vid.regenerate")}
              </Button>
            </div>
          </div>
        )}

        {job.status === "error" && (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{t("vid.failed")}</p>
            <Button variant="outline" onClick={reset}>
              {t("vid.regenerate")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PillGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              value === o.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
