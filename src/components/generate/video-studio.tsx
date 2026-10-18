"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  X,
  Film,
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
import { videoCost } from "@/lib/mock-data";
import { downloadImage } from "@/lib/download";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

const MAX_REF = 12 * 1024 * 1024;
// 实测(2026-08-15,Seedance 2.5):3 秒**不支持**,4/5/8/10/12 可用。别加回 3。
const DURATIONS = [5, 8, 10, 12] as const;
const RATIOS = ["16:9", "9:16", "1:1"] as const;
// 实测可用档位。1080p 要账号权益(本账号报 "not supported for this account and model"),
// 4k 提交时返回 200 但异步跑完 failed —— **提交成功 ≠ 参数有效**,所以只放这两档。
// 账号开通 1080p 后把它加回来即可,价格表 VIDEO_COST_PER_SEC 里已留好。
const RESOLUTIONS = ["480p", "720p"] as const;
const CAMERAS = ["static", "push", "pull", "pan", "orbit"] as const;

const RATIO_ASPECT: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
};

// 运镜没有独立的接口参数,只能作为提示词的一部分送进去。
const CAMERA_PROMPT: Record<string, string> = {
  static: "固定机位，镜头不动",
  push: "镜头缓慢推近",
  pull: "镜头缓慢拉远",
  pan: "镜头平稳横移",
  orbit: "镜头环绕主体缓慢运动",
};

// 轮询节奏:5 秒一次,最多 6 分钟(12 秒 1080p 偶尔会跑到 3 分钟以上)。
const POLL_MS = 5000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

type Job =
  | { status: "idle" }
  | { status: "queued" | "processing"; startedAt: number; elapsed: number }
  | { status: "done"; url: string; posterUrl: string | null; ratio: string; duration: number }
  | { status: "error" };

export function VideoStudio() {
  const { user, ready, remaining, applyServerUser } = useAuth();
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

  // ===== 真实生成流程 =====
  // POST /api/video 拿 taskId(此时积分已预扣)→ 每 5 秒轮询 /api/video/status。
  // 上游出片要 30 秒~数分钟,所以创建与查询是两个接口,中间不占连接。
  // 失败由后端退积分,前端只负责把提示显示出来。
  async function generate() {
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

    const startedAt = Date.now();
    setJob({ status: "queued", startedAt, elapsed: 0 });

    try {
      const fd = new FormData();
      // 运镜没有独立参数,追加到提示词末尾。
      const cam = CAMERA_PROMPT[camera];
      fd.append("prompt", cam ? `${prompt.trim()}，${cam}` : prompt.trim());
      fd.append("duration", String(duration));
      fd.append("resolution", resolution);
      fd.append("ratio", ratio);
      fd.append("title", prompt.trim().slice(0, 24) || "AI 视频");
      if (refFile) fd.append("image", refFile);

      const res = await fetch("/api/video", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.taskId) {
        setJob({ status: "error" });
        setError(data?.error || t("vid.failed"));
        return;
      }

      const taskId: string = data.taskId;
      timerRef.current = setInterval(async () => {
        const elapsed = Date.now() - startedAt;
        if (elapsed > POLL_TIMEOUT_MS) {
          if (timerRef.current) clearInterval(timerRef.current);
          setJob({ status: "error" });
          setError(t("vid.failed"));
          return;
        }
        try {
          const r = await fetch(
            `/api/video/status?taskId=${encodeURIComponent(taskId)}`
          );
          const s = await r.json().catch(() => ({}));
          if (!r.ok) return; // 单次查询失败不打断,等下一轮

          if (s.status === "done" && s.url) {
            if (timerRef.current) clearInterval(timerRef.current);
            if (s.user) applyServerUser(s.user);
            setJob({
              status: "done",
              url: s.url,
              posterUrl: refPreview,
              ratio,
              duration,
            });
          } else if (s.status === "failed") {
            if (timerRef.current) clearInterval(timerRef.current);
            setJob({ status: "error" });
            setError(s.error || t("vid.failed"));
          } else {
            setJob({
              status: s.status === "queued" ? "queued" : "processing",
              startedAt,
              elapsed,
            });
          }
        } catch {
          // 网络抖动,下一轮再试
        }
      }, POLL_MS);
    } catch {
      setJob({ status: "error" });
      setError(t("vid.failed"));
    }
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    setJob({ status: "idle" });
    setError(null);
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

        {/* 比例(图生视频时由参考图决定,上游会忽略这里的选择) */}
        <div className="space-y-1.5">
          <PillGroup
            label={t("vid.ratioLabel")}
            options={RATIOS.map((r) => ({ key: r, label: r }))}
            value={ratio}
            onChange={setRatio}
          />
          {refFile && (
            <p className="text-xs text-muted-foreground">
              {t("vid.ratioLockedHint")}
            </p>
          )}
        </div>

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
            {t("vid.balance")}: {Number.isFinite(remaining) ? remaining : "不限"}
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
                        job.elapsed / 1000
                      )}s`}
                </span>
              </div>
            </div>
            {/* 上游不返回百分比,别编一个假进度 —— 用不定进度条表示"在跑"。 */}
            <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-1/3 animate-[nv-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
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
              <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {job.duration}s · {job.ratio} · {resolution}
              </span>
            </div>
            {/* 成片:上游带原生音轨,所以给 controls 而不是静音自动播。 */}
            <div
              className={cn(
                "relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-slate-900",
                RATIO_ASPECT[job.ratio]
              )}
            >
              <video
                src={job.url}
                poster={job.posterUrl ?? undefined}
                controls
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
              />
            </div>
            <div className="mx-auto flex max-w-lg gap-2">
              <Button
                variant="gradient"
                className="flex-1"
                onClick={() => downloadImage(job.url, undefined, "mp4")}
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
