"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Check,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Media } from "@/components/media";
import { ImageLightbox } from "@/components/image-lightbox";
import { RecordPager, RECORDS_PER_PAGE } from "@/components/tools/record-pager";
import { authHeader } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { downloadImage } from "@/lib/download";
import { cn } from "@/lib/utils";

/**
 * 通用工具页外壳(spec C.4 三列):
 *   左 320 参数卡(图标标题 + 控件 slot + 统一「消耗/按钮/积分」footer)
 *   中 1fr 结果卡(标题栏 + children 自由结果内容,带 zoom 放大回调)
 *   右 280 本工具记录(按 category 拉本人作品 + 多选打包下载)
 *
 * 与 ToolWorkspace 视觉完全一致 —— 给「多图/多输入/文本」等无法套单图模板的工具用,
 * 保证所有功能页边框/边距/配色/布局统一,无割裂感。
 *
 * - category 不传 → 不渲染右侧记录列(两列布局,给文本类工具如标题生成)。
 * - children 是 render-prop:(zoom) => 结果内容;调用 zoom(url) 全屏放大查看。
 */
export function ToolShell({
  name,
  desc,
  Icon,
  tint,
  accent,
  category,
  cost,
  actionLabel,
  onAction,
  processing,
  disabled,
  error,
  left,
  children,
  resultTitle = "处理结果",
  resultHint,
  refreshKey,
  footerNote = "生成结果将自动保存到「作品库」,保留 180 天",
  onRegen,
  regenLabel = "以此图重新生成",
  rightPanel,
  promptLabel = "提示词",
}: {
  name: string;
  desc: string;
  Icon: LucideIcon;
  tint: string;
  accent: string;
  category?: string;
  cost: number;
  actionLabel: string;
  onAction: () => void;
  processing: boolean;
  disabled?: boolean;
  error?: string | null;
  left: React.ReactNode;
  children: (zoom: (url: string) => void) => React.ReactNode;
  resultTitle?: string;
  resultHint?: React.ReactNode;
  /** 改变时重新拉取本工具记录(通常传本次结果 url / 计数)。 */
  refreshKey?: unknown;
  footerNote?: string;
  /** 「以此图重新生成」回调:把记录详情里的成品图载入成本工具的输入(各工具传自己的)。 */
  onRegen?: (url: string) => void;
  regenLabel?: string;
  /** 自定义右列(传了就替代「本工具记录」,如标题生成的「图片列表」)。 */
  rightPanel?: React.ReactNode;
  /** 记录详情里那栏文字的标签(默认「提示词」;标题生成传「生成标题」)。 */
  promptLabel?: string;
}) {
  const { user, ready, remaining } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [records, setRecords] = React.useState<
    {
      id: string;
      url: string;
      gradient?: string;
      source?: string;
      prompt?: string;
    }[] | null
  >(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [viewing, setViewing] = React.useState("");
  const [zipping, setZipping] = React.useState(false);
  const [recPage, setRecPage] = React.useState(0);
  // 点记录 → 中间载入该记录的「原图 / 成品对比」;null=显示工具当前结果。
  const [shown, setShown] = React.useState<{
    id: string;
    url: string;
    gradient?: string;
    source?: string;
    prompt?: string;
  } | null>(null);

  // 本工具记录:按 category 过滤本人作品。
  React.useEffect(() => {
    if (!category || !user?.email) {
      setRecords(null);
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
          category?: string;
          status?: string;
          gradient?: string;
          source?: string;
          prompt?: string;
        }[];
        if (cancelled) return;
        setRecords(
          arts
            .filter(
              (a) => a.image && a.status !== "failed" && a.category === category
            )
            .slice(0, 60)
            .map((a) => ({
              id: a.id,
              url: a.image,
              gradient: a.gradient,
              source: a.source,
              prompt: a.prompt,
            }))
        );
        setRecPage(0);
        setShown(null);
      } catch {
        if (!cancelled) setRecords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, category, refreshKey]);

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // 批量打包下载选中记录(走 /api/suite/download zip;失败回退逐张)。
  async function downloadSelected() {
    const items = (records ?? [])
      .filter((r) => selected.has(r.id))
      .map((r, i) => ({ url: r.url, name: `${name}-${i + 1}` }));
    if (!items.length) return;
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
      a.download = `${name}-${items.length}张.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      items.forEach((it, i) =>
        setTimeout(() => downloadImage(it.url, it.name), i * 350)
      );
    } finally {
      setZipping(false);
    }
  }

  const threeCol = !!category || !!rightPanel;

  return (
    <div className="w-full px-5 py-6 sm:px-6 lg:px-8">
      {/* 面包屑 */}
      <nav className="flex items-center gap-1.5 text-[13px]">
        <Link
          href="/tools"
          className="text-c-text3 transition-colors hover:text-c-text"
        >
          {L("创作工具", "Creative Tools")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-c-text4" />
        <span className="font-semibold text-c-text">{name}</span>
      </nav>

      <div
        className={cn(
          "mt-4 grid gap-5",
          threeCol
            ? "lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_280px]"
            : "lg:grid-cols-[320px_1fr]"
        )}
      >
        {/* 左:参数(撑到与中右两栏等高,操作区压到底部避免留白割裂) */}
        <div className="flex flex-col gap-[18px] rounded-card border border-c-border bg-c-card p-5 shadow-card">
          <div className="flex items-center gap-3">
            <span
              className="grid h-11 w-11 flex-none place-items-center rounded-[10px]"
              style={{ background: tint, color: accent }}
            >
              <Icon className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[16px] font-bold text-c-text">{name}</h1>
              <p className="text-[12px] text-c-text3">{desc}</p>
            </div>
          </div>

          {left}

          <div className="mt-auto space-y-3 border-t border-c-line pt-4">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-c-text3">{L("预计消耗", "Est. cost")}</span>
              <span className="font-semibold text-acc">{L(`${cost} 积分`, `${cost} credits`)}</span>
            </div>
            <button
              type="button"
              onClick={onAction}
              disabled={processing || disabled}
              className="flex w-full items-center justify-center gap-2 rounded-[11px] py-3 text-[14px] font-semibold text-white shadow-btn [background:var(--grad-acc)] transition-all hover:brightness-95 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {processing ? L("处理中…", "Processing…") : actionLabel}
            </button>
            {error && <p className="text-[12.5px] text-c-danger">{error}</p>}
            {ready && !user && (
              <button
                type="button"
                onClick={() => openAuth()}
                className="text-[12.5px] font-medium text-acc hover:underline"
              >
                {L("登录后即可使用 →", "Sign in to use →")}
              </button>
            )}
            <p className="text-center text-[11px] text-c-text4">
              {L(`💎 ${remaining} 积分剩余`, `💎 ${remaining} credits left`)}
            </p>
          </div>
        </div>

        {/* 中:结果(shown 时切换成记录详情:原图/成品对比) */}
        <section className="flex min-h-[520px] flex-col rounded-card border border-c-border bg-c-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-c-text">
              {shown ? L("记录详情", "Record details") : resultTitle}
            </h2>
            {shown ? (
              <button
                type="button"
                onClick={() => setShown(null)}
                className="text-[12.5px] font-medium text-acc hover:underline"
              >
                {L("← 返回当前", "← Back to current")}
              </button>
            ) : resultHint ? (
              <span className="text-[12.5px] text-c-text3">{resultHint}</span>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {shown ? (
              <>
                <div className="grid flex-1 grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium text-c-text3">
                      {L("原图", "Original")}
                    </span>
                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2">
                      {shown.source ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={shown.source}
                            alt={L("原图", "Original")}
                            onClick={() => setViewing(shown.source!)}
                            className="max-h-[460px] max-w-full cursor-zoom-in object-contain"
                          />
                          {onRegen && (
                            <button
                              type="button"
                              onClick={() => onRegen(shown.source!)}
                              className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                            >
                              <RefreshCw className="h-3 w-3" />
                              {regenLabel}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[12px] text-c-text4">{L("无原图", "No original")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: accent }}
                    >
                      {L("效果", "Result")}
                    </span>
                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shown.url}
                        alt={L("效果", "Result")}
                        onClick={() => setViewing(shown.url)}
                        className="max-h-[460px] max-w-full cursor-zoom-in object-contain"
                      />
                      {onRegen && (
                        <button
                          type="button"
                          onClick={() => onRegen(shown.url)}
                          className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {regenLabel}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => downloadImage(shown.url, name)}
                        className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[rgba(22,24,29,.6)] text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                {shown.prompt && (
                  <div className="mt-3 rounded-field bg-c-subtle2 px-3 py-2 text-[12px] leading-relaxed text-c-text2">
                    <span className="font-medium text-c-text3">{promptLabel}:</span>{" "}
                    {shown.prompt}
                  </div>
                )}
              </>
            ) : (
              children(setViewing)
            )}
          </div>
          <p className="mt-3 text-center text-[11px] text-c-text4">{footerNote}</p>
        </section>

        {/* 右:自定义面板(标题生成的「图片列表」等),传了就替代本工具记录 */}
        {threeCol && rightPanel && (
          <aside className="hidden rounded-card border border-c-border bg-c-card p-4 shadow-card xl:flex xl:flex-col">
            {rightPanel}
          </aside>
        )}
        {/* 右:本工具记录 */}
        {threeCol && !rightPanel && (
          <aside className="hidden rounded-card border border-c-border bg-c-card p-4 shadow-card xl:flex xl:flex-col">
            <div className="mb-3 flex min-h-[28px] items-center gap-1.5">
              <Clock className="h-4 w-4 text-c-text3" />
              <span className="text-[13px] font-semibold text-c-text">
                {L("本工具记录", "Tool history")}
              </span>
              {records && records.length > 0 && (
                <span className="text-[12px] text-c-text3">
                  {L(`· ${records.length} 张`, `· ${records.length}`)}
                </span>
              )}
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={downloadSelected}
                  disabled={zipping}
                  className="ml-auto inline-flex items-center gap-1 rounded-[8px] bg-acc px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
                >
                  {zipping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {L(`下载 ${selected.size}`, `Download ${selected.size}`)}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
              {records === null && user ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="nv-skeleton aspect-square rounded-lg"
                    />
                  ))}
                </div>
              ) : records && records.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {records
                    .slice(recPage * RECORDS_PER_PAGE, (recPage + 1) * RECORDS_PER_PAGE)
                    .map((r) => {
                    const sel = selected.has(r.id);
                    return (
                      <div
                        key={r.id}
                        onClick={() => setShown(r)}
                        title={L("点击查看原图 / 成品", "Click to view original / result")}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all",
                          shown?.id === r.id
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
                        {/* 左上选择框:点它才选中(用于批量打包下载) */}
                        <span
                          role="checkbox"
                          aria-checked={sel}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(r.id);
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
                  {L("还没有记录", "No records yet")}
                </p>
              )}
            </div>
            <RecordPager
              page={recPage}
              total={Math.ceil((records?.length ?? 0) / RECORDS_PER_PAGE)}
              onPage={setRecPage}
            />
            <Link
              href={category ? `/works?cat=${category}` : "/works"}
              className="mt-3 text-center text-[12px] font-medium text-acc hover:underline"
            >
              {L("在作品库查看全部 →", "View all in Library →")}
            </Link>
          </aside>
        )}
      </div>

      {/* 全屏放大查看(全站统一 ImageLightbox:缩放/平移/导出) */}
      {viewing && (
        <ImageLightbox
          src={viewing}
          onClose={() => setViewing("")}
          downloadName={name}
        />
      )}
    </div>
  );
}

/** 工具参数 chip 组(与 ToolWorkspace 的 ToolChips 视觉一致)。 */
export function ShellChips({
  label,
  options,
  value,
  onChange,
  accent = "var(--acc)",
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  accent?: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-medium text-c-text2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key)}
              className={cn(
                "rounded-[8px] px-3.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "text-white"
                  : "bg-c-subtle text-c-text2 hover:bg-c-subtle2"
              )}
              style={active ? { background: accent } : undefined}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
