"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Upload,
  X,
  Sparkles,
  Download,
  ImageIcon,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  RefreshCw,
  ChevronRight,
  Clock,
  Check,
  Wand2,
} from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { authHeader } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cdnUrl } from "@/lib/cdn";
import { ImageLightbox } from "@/components/image-lightbox";
import { Media } from "@/components/media";
import { RecordPager, RECORDS_PER_PAGE } from "@/components/tools/record-pager";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";
import { downloadImage } from "@/lib/download";
import { cn } from "@/lib/utils";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

const MAX_UPLOAD = 12 * 1024 * 1024;
const RATIO_ASPECT: Record<string, string> = {
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
};

type Shot = {
  id: string;
  role: "main" | "sub" | "detail";
  label: string;
  ratio: string;
  status: "pending" | "done" | "error";
  url: string | null;
  gradient: string;
};

export function SuiteClient() {
  const { user, ready, remaining, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { t, locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [title2, setTitle2] = useState("");
  const [points, setPoints] = useState("");
  // 产品图上限 4 张(设计稿权威:最多 4 张)
  const maxProduct = 4;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  // AI帮写/智能优化(贴按钮弹窗,全站统一;套图必传产品图)
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistRun, setAssistRun] = useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  function openAssist(mode: "write" | "optimize") {
    if (!files[0]) {
      setError(L("请先上传图片", "Upload an image first"));
      return;
    }
    setError(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(13);
  const [finished, setFinished] = useState(false);
  const [viewing, setViewing] = useState<Shot | null>(null);
  const [zipping, setZipping] = useState(false);
  // 右侧「本工具记录」(套图历史):列表 / 选中 / 放大 / 打包 / 分页。
  const [recItems, setRecItems] = useState<
    { id: string; url: string; gradient?: string }[] | null
  >(null);
  const [recSel, setRecSel] = useState<Set<string>>(new Set());
  const [recView, setRecView] = useState("");
  const [recZip, setRecZip] = useState(false);
  const [recPage, setRecPage] = useState(0);
  // 点记录 → 中间载入该张大图 + 提示词;null=显示当前套图结果。
  const [shownRec, setShownRec] = useState<{
    id: string;
    url: string;
    gradient?: string;
    prompt?: string;
  } | null>(null);

  const cost = 78; // 13 × 6 积分(1K 档)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      previews.forEach((p) => URL.revokeObjectURL(p));
    };
  }, [previews]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [...files];
    const nextPrev: string[] = [...previews];
    for (const f of Array.from(list)) {
      if (next.length >= maxProduct) break;
      if (f.size > MAX_UPLOAD) continue;
      next.push(f);
      nextPrev.push(URL.createObjectURL(f));
    }
    setFiles(next);
    setPreviews(nextPrev);
  }
  function removeFile(i: number) {
    URL.revokeObjectURL(previews[i]);
    setFiles(files.filter((_, j) => j !== i));
    setPreviews(previews.filter((_, j) => j !== i));
  }

  async function generate() {
    setError(null);
    // 未登录:直接弹登录/注册窗(优先于上传校验),登录后再点生成。
    if (!user) {
      if (ready) openAuth("sign-in");
      return;
    }
    if (files.length === 0) {
      setError(t("suite.errNoImage"));
      return;
    }
    setLoading(true);
    setFinished(false);
    setShots([]);
    setDone(0);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("image", f));
      const copy = [
        title2.trim() && `主标题：${title2.trim()}`,
        points.trim() && `卖点：${points.trim()}`,
      ]
        .filter(Boolean)
        .join("；");
      if (copy) fd.append("text", copy);
      fd.append("email", user.email);
      const res = await fetch("/api/suite", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("suite.errFail"));
      const jobId: string = data.jobId;
      if (data.total) setTotal(data.total);

      // 轮询进度
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/suite?job=${jobId}`, {
            cache: "no-store",
          });
          const s = await r.json();
          if (Array.isArray(s.shots)) setShots(s.shots);
          if (typeof s.done === "number") setDone(s.done);
          if (typeof s.total === "number") setTotal(s.total);
          if (s.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (s.user) applyServerUser(s.user);
            setFinished(true);
            setLoading(false);
          } else if (s.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(s.error || t("suite.errFail"));
            setLoading(false);
          }
        } catch {
          /* 单次轮询失败忽略,下次再试 */
        }
      }, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("suite.errFail"));
      setLoading(false);
    }
  }

  // 打包 ZIP 下载:把图片 URL 交给服务端拉取+压缩(避免浏览器跨域 R2)
  async function downloadAll() {
    const items = shots
      .filter((s) => s.status === "done" && s.url)
      .map((s) => ({ url: s.url!, name: s.label }));
    if (items.length === 0) return;
    setZipping(true);
    try {
      const res = await fetch("/api/suite/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("zip failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `星泽商图-套图-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // 服务端打包失败时,退化为逐张下载
      shots
        .filter((s) => s.status === "done" && s.url)
        .forEach((s, i) =>
          setTimeout(() => downloadImage(s.url!, `suite-${s.label}-${i + 1}`), i * 350)
        );
    } finally {
      setZipping(false);
    }
  }

  const group = (role: Shot["role"]) => shots.filter((s) => s.role === role);
  const hasResult = shots.length > 0;

  // 本工具记录:套图作品(batch_id 以 "suite-" 开头);套图完成后刷新。
  useEffect(() => {
    if (!user?.email) {
      setRecItems(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const arts = (d.artworks ?? []) as {
          id: string;
          image: string;
          status?: string;
          gradient?: string;
          batchId?: string;
          prompt?: string;
        }[];
        if (cancelled) return;
        setRecItems(
          arts
            .filter(
              (a) =>
                a.image &&
                a.status !== "failed" &&
                (a.batchId ?? "").startsWith("suite-")
            )
            .slice(0, 60)
            .map((a) => ({
              id: a.id,
              url: a.image,
              gradient: a.gradient,
              prompt: a.prompt,
            }))
        );
        setRecPage(0);
        setShownRec(null);
      } catch {
        if (!cancelled) setRecItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, finished]);

  function toggleRecSel(id: string) {
    setRecSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function downloadRecSelected() {
    const items = (recItems ?? [])
      .filter((r) => recSel.has(r.id))
      .map((r, i) => ({ url: r.url, name: `套图-${i + 1}` }));
    if (!items.length) return;
    setRecZip(true);
    try {
      const res = await fetch("/api/suite/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("zip failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `星泽商图-套图记录-${items.length}张.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      items.forEach((it, i) =>
        setTimeout(() => downloadImage(it.url, it.name), i * 350)
      );
    } finally {
      setRecZip(false);
    }
  }

  return (
    <div className="w-full px-5 py-6 sm:px-6 lg:px-8">
      <div className="w-full">
        <div className="mb-4">
          <nav className="flex items-center gap-1.5 text-[13px]">
            <Link
              href="/tools"
              className="text-c-text3 transition-colors hover:text-c-text"
            >
              创作工具
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-c-text4" />
            <span className="font-semibold text-c-text">{t("suite.title")}</span>
          </nav>
        </div>
    <div className="grid gap-5 lg:h-[890px] lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_280px]">
      {/* 左:参数面板 */}
      <div className="h-fit space-y-5 rounded-card border border-c-border bg-c-card p-5 shadow-card nv-panel-scroll lg:h-full lg:min-h-0 lg:overflow-y-auto">
        {/* 工具头:图标 + 名称 + 描述(与其它工具页一致) */}
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 flex-none place-items-center rounded-[10px]"
            style={{ background: "rgba(79,70,229,.12)", color: "#4F46E5" }}
          >
            <ImageIcon className="h-[21px] w-[21px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold text-c-text">
              {t("suite.title")}
            </h1>
            <p className="text-[12px] text-c-text3">
              上传产品图,自动出 1 主图 + 4 副图 + 8 详情页图
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t("suite.uploadLabel")}
            <span className="ml-1 text-xs text-c-text3">最多 {maxProduct} 张</span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => pickFiles(e.target.files)}
          />
          {/* 小尺寸缩略图横排,不再占大块 */}
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div
                key={src}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`product ${i + 1}`}
                  className="h-full w-full bg-secondary object-cover"
                />
                <button
                  onClick={() => removeFile(i)}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-card/90 text-foreground shadow hover:bg-card"
                  aria-label={t("suite.removeImage")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {files.length < maxProduct && (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Upload className="h-4 w-4" />
                <span className="text-[10px]">{t("suite.addImage")}</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("suite.titleLabel")}</label>
          <input
            value={title2}
            onChange={(e) => setTitle2(e.target.value)}
            placeholder={t("suite.titlePlaceholder")}
            className="w-full rounded-[10px] border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{t("suite.pointsLabel")}</label>
            <div className="flex items-center gap-2">
              {points.trim() && (
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
          </div>
          <PromptAssistPopup
            open={assistOpen}
            onClose={() => setAssistOpen(false)}
            anchorRef={assistBtnRef}
            tool="suite"
            currentPrompt={points}
            imageFile={files[0] ?? null}
            imageThumb={previews[0] ?? ""}
            run={assistRun}
            onUse={(t2) => setPoints(t2)}
          />
          <Textarea
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder={t("suite.pointsPlaceholder")}
            className="min-h-[64px] bg-secondary"
          />
          <p className="text-xs text-muted-foreground">{t("suite.textHint")}</p>
        </div>

        <div className="rounded-xl bg-secondary/50 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("suite.output")}</span>
            <span className="font-medium">{t("suite.outputDetail")}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">{t("suite.costLabel")}</span>
            <span className="font-semibold text-primary">
              {fmt(t("suite.creditsUnit"), { n: cost })}
            </span>
          </div>
        </div>
        {ready && user && (
          <p className="-mt-3 text-right text-xs text-muted-foreground">
            {t("suite.balance")}: {remaining}
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button
          variant="gradient"
          className="h-12 w-full text-[15px]"
          onClick={generate}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {!user
            ? t("suite.loginToGen")
            : loading
              ? fmt(t("suite.generating"), { done, total })
              : fmt(t("suite.genBtn"), { c: cost })}
        </Button>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("suite.note")}
        </p>
      </div>

      {/* 中:结果区 */}
      <div className="flex min-h-[520px] flex-col rounded-card border border-c-border bg-c-card p-5 shadow-card nv-panel-scroll lg:h-full lg:min-h-0 lg:overflow-y-auto">
        {shownRec ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-c-text">记录详情</h3>
              <button
                type="button"
                onClick={() => setShownRec(null)}
                className="text-[12.5px] font-medium text-acc hover:underline"
              >
                ← 返回当前
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cdnUrl(shownRec.url)}
                alt=""
                onClick={() => setRecView(shownRec.url)}
                className="max-h-[460px] max-w-full cursor-zoom-in object-contain"
              />
            </div>
            {shownRec.prompt && (
              <div className="mt-3 rounded-field bg-c-subtle2 px-3 py-2 text-[12px] leading-relaxed text-c-text2">
                <span className="font-medium text-c-text3">提示词:</span>{" "}
                {shownRec.prompt}
              </div>
            )}
          </div>
        ) : (
          <>
        {!hasResult && !loading && (
          <>
            {/* 头部行 + demo(flex-1)+ 底部 note:与其它功能页同构,示例图位置一致。 */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-c-text">
                {t("suite.resultTitle")}
              </h2>
              <span className="text-[12.5px] text-c-text3">
                {L("示例预览", "Preview")}
              </span>
            </div>
            <ToolDemo {...getDemo("suite")!} />
            <p className="mt-3 text-center text-[11px] text-c-text4">
              {L(
                "生成结果将自动保存到「作品库」,保留 180 天",
                "Results are auto-saved to your Library for 180 days"
              )}
            </p>
          </>
        )}

        {(hasResult || loading) && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{t("suite.resultTitle")}</h3>
                <span className="text-xs text-muted-foreground">
                  {fmt(t("suite.progress"), { done, total })}
                </span>
              </div>
              {finished && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadAll}
                  disabled={zipping}
                >
                  {zipping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("suite.downloadAll")}
                </Button>
              )}
            </div>

            {(["main", "sub", "detail"] as const).map((role) => {
              const list = group(role);
              if (list.length === 0 && !loading) return null;
              return (
                <div key={role} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {role === "main"
                      ? t("suite.groupMain")
                      : role === "sub"
                        ? t("suite.groupSub")
                        : t("suite.groupDetail")}
                  </p>
                  <div
                    className={cn(
                      "grid gap-3",
                      role === "main"
                        ? "grid-cols-2 sm:grid-cols-3"
                        : role === "sub"
                          ? "grid-cols-2 sm:grid-cols-4"
                          : "grid-cols-2 sm:grid-cols-4"
                    )}
                  >
                    {list.map((s) => (
                      <ShotCard
                        key={s.id}
                        shot={s}
                        t={t}
                        onView={() => setViewing(s)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>

      {/* 右:本工具记录(套图历史) */}
      <aside className="hidden rounded-card border border-c-border bg-c-card p-4 shadow-card xl:flex xl:h-full xl:flex-col">
        <div className="mb-3 flex min-h-[28px] items-center gap-1.5">
          <Clock className="h-4 w-4 text-c-text3" />
          <span className="text-[13px] font-semibold text-c-text">本工具记录</span>
          {recItems && recItems.length > 0 && (
            <span className="text-[12px] text-c-text3">· {recItems.length} 张</span>
          )}
          {recSel.size > 0 && (
            <button
              type="button"
              onClick={downloadRecSelected}
              disabled={recZip}
              className="ml-auto inline-flex items-center gap-1 rounded-[8px] bg-acc px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
            >
              {recZip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              下载 {recSel.size}
            </button>
          )}
        </div>
        <div className="nv-panel-scroll min-h-0 flex-1 overflow-y-auto pr-0.5">
          {recItems === null && user ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="nv-skeleton aspect-square rounded-lg" />
              ))}
            </div>
          ) : recItems && recItems.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {recItems
                .slice(recPage * RECORDS_PER_PAGE, (recPage + 1) * RECORDS_PER_PAGE)
                .map((r) => {
                  const sel = recSel.has(r.id);
                  return (
                    <div
                      key={r.id}
                      onClick={() => setShownRec(r)}
                      title="点击查看大图 / 详情"
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all",
                        shownRec?.id === r.id
                          ? "border-acc"
                          : sel
                            ? "border-acc/40"
                            : "border-c-border hover:border-c-border2"
                      )}
                    >
                      <Media
                        src={r.url}
                        alt=""
                        gradient={r.gradient}
                        thumbWidth={220}
                        ratio="aspect-square"
                        className="rounded-none border-0 transition-transform group-hover:scale-105"
                      />
                      <span
                        role="checkbox"
                        aria-checked={sel}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRecSel(r.id);
                        }}
                        className={cn(
                          "absolute left-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-[6px] border-2 transition-colors",
                          sel
                            ? "border-acc bg-acc text-white"
                            : "border-white bg-black/25 text-transparent hover:bg-black/40"
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="px-2 py-10 text-center text-[12px] text-c-text3">
              还没有套图记录
            </p>
          )}
        </div>
        <RecordPager
          page={recPage}
          total={Math.ceil((recItems?.length ?? 0) / RECORDS_PER_PAGE)}
          onPage={setRecPage}
        />
        <Link
          href="/works"
          className="mt-3 text-center text-[12px] font-medium text-acc hover:underline"
        >
          在作品库查看全部 →
        </Link>
      </aside>
    </div>
      </div>

      {/* 看大图 lightbox */}
      {viewing && viewing.url && (
        <ImageLightbox
          src={viewing.url}
          alt={viewing.label}
          onClose={() => setViewing(null)}
          downloadName="星泽商图-套图"
        />
      )}
      {/* 记录列放大 */}
      {recView && (
        <ImageLightbox
          src={recView}
          onClose={() => setRecView("")}
          downloadName="星泽商图-套图"
        />
      )}
    </div>
  );
}

function ShotCard({
  shot,
  t,
  onView,
}: {
  shot: Shot;
  t: (k: string) => string;
  onView: () => void;
}) {
  return (
    <div className="group space-y-1.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-gradient-to-br",
          shot.gradient,
          RATIO_ASPECT[shot.ratio] ?? "aspect-square"
        )}
      >
        {shot.status === "done" && shot.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cdnUrl(shot.url)}
              alt={shot.label}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* 点图 → 看大图 */}
            <button
              onClick={onView}
              className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-transparent transition-all group-hover:bg-slate-900/35 group-hover:text-white"
              aria-label={t("suite.view")}
            >
              <Maximize2 className="h-5 w-5" />
            </button>
            {/* 左下角:以此图再做(跳生图页,以该图为源图) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.location.href = `/generate?src=${encodeURIComponent(
                  shot.url!
                )}`;
              }}
              className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-all hover:bg-[rgba(22,24,29,.8)] group-hover:opacity-100"
            >
              <RefreshCw className="h-3 w-3" />
              {t("suite.remakeFromThis")}
            </button>
            {/* 右下角单张下载,不挡看大图 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadImage(shot.url!, `suite-${shot.label}`);
              }}
              className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-card/85 text-foreground opacity-0 shadow transition-opacity hover:bg-card group-hover:opacity-100"
              aria-label={t("suite.download")}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </>
        ) : shot.status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-400" />
          </div>
        ) : (
          <GenLoader compact />
        )}
        {shot.status === "done" && (
          <CheckCircle2 className="absolute right-1.5 top-1.5 h-4 w-4 text-emerald-500 drop-shadow" />
        )}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{shot.label}</p>
    </div>
  );
}
