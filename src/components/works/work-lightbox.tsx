"use client";

import { cdnUrl } from "@/lib/cdn";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Download, Heart, RotateCcw, Trash2 } from "lucide-react";
import { Media } from "@/components/media";
import { downloadImage } from "@/lib/download";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/locale-context";
import { PromptPanel } from "@/components/ui/prompt-panel";

/** 作品详情灯箱(设计 showView,星泽商图.dc.html 2034–2073)。
 *  **桌面**:920px 卡面 + rgba(12,13,16,.72) blur-5 深色遮罩;左大预览 + 右 360px 详情面板。
 *  **移动端(< sm)**:底部抽屉 —— 贴底 + 顶部圆角 + 90vh 竖排(图在上、详情滚动、操作固定底),
 *  与模板页预览弹窗同一套形态(templates-client.tsx)。原先固定 920px 宽 + 左右分栏在
 *  375px 上会被压成一团、底部三个按钮也放不下,手机基本没法用。
 *  自带 portal/overlay(不复用 Modal 的居中 p-6 卡面,因本屏是贴边分栏/贴底抽屉布局)。 */

export type LightboxWork = {
  id: string;
  image: string;
  title?: string;
  gradient?: string;
  tool?: string;
  prompt?: string;
  ratioLabel?: string; // 例: "1:1 · 1024×1024"
  createdAt?: string;
  cost?: number;
};

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function WorkLightbox({
  work,
  onClose,
  fav = false,
  onToggleFav,
  onDelete,
}: {
  work: LightboxWork | null;
  onClose: () => void;
  fav?: boolean;
  onToggleFav?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const open = !!work;
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !work) return null;

  const tool = work.tool || L("AI 生图", "AI Generation");
  const prompt =
    work.prompt ||
    L(
      "白底高级护肤精华瓶，柔光摄影棚，45°俯拍，电商主图，细腻质感，留白构图",
      "Premium skincare serum bottle on white, soft-light studio, 45° top-down, e-commerce hero shot, fine texture, negative-space composition"
    );
  const ratioLabel = work.ratioLabel || "1:1 · 1024×1024";
  const cost = work.cost ?? 6;

  const metaRows: { label: string; value: string; accent?: boolean }[] = [
    { label: L("使用工具", "Tool"), value: tool },
    { label: L("比例 / 尺寸", "Ratio / Size"), value: ratioLabel },
    { label: L("生成时间", "Created"), value: formatTime(work.createdAt) },
    { label: L("消耗积分", "Credits Used"), value: L(`${cost} 积分`, `${cost} credits`), accent: true },
  ];

  return createPortal(
    // 手机:贴底抽屉(items-end + 无内边距);sm 起:居中卡片
    <div className="fixed inset-0 z-[160] flex items-end justify-center p-0 sm:items-center sm:p-8">
      {/* 深色遮罩(比通用 Modal 更深 + blur-5) */}
      <button
        type="button"
        aria-label={L("关闭", "Close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[rgba(12,13,16,.72)] backdrop-blur-[5px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="nv-sheet relative z-10 flex h-[90vh] max-h-[90vh] w-full max-w-full flex-col overflow-hidden rounded-t-[18px] bg-c-card shadow-pop sm:h-[min(680px,calc(100vh-64px))] sm:w-[920px] sm:flex-row sm:rounded-[18px]"
      >
        {/* 手机顶部抓手:一眼看出可以下滑/这是个抽屉 */}
        <div className="flex shrink-0 justify-center pb-1 pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-c-border2" />
        </div>

        {/* 预览:手机在上(占 38vh,给下方详情留出空间),桌面在左自适应 */}
        <div className="relative flex h-[38vh] shrink-0 items-center justify-center p-5 [background:radial-gradient(120%_90%_at_50%_20%,#FBFBFD,#E7EAF0_60%,#D7DBE4)] sm:h-auto sm:min-w-0 sm:flex-1 sm:shrink sm:p-10">
          {/* ratio 传空 + h-full:让容器高度说了算(手机 38vh / 桌面填满),
              imgClassName 改 object-contain —— 作品比例各异(1:1 / 4:5 / 9:16),
              默认的 object-cover 会把图裁掉,详情弹窗里不能裁。 */}
          <Media
            src={cdnUrl(work.image)}
            alt={work.title || tool}
            gradient={work.gradient}
            ratio=""
            className="h-full w-full rounded-[16px] border-0 bg-transparent shadow-none"
            imgClassName="object-contain drop-shadow-[0_30px_60px_rgba(40,46,58,.35)]"
            overlay={false}
          />
          <span className="absolute left-4 top-4 rounded-[8px] bg-[rgba(22,24,29,.5)] px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-[4px]">
            {tool}
          </span>
        </div>

        {/* 详情面板:手机占剩余高度并可滚,桌面固定 360px 在右
            (360 比原 300 宽,长提示词好读;宽度从左侧预览区借,弹窗总宽仍 920px) */}
        <div className="flex min-h-0 flex-1 flex-col border-c-line sm:w-[360px] sm:flex-shrink-0 sm:flex-none sm:border-l">
          {/* 头 */}
          <div className="flex items-center justify-between border-b border-c-line px-5 py-[18px]">
            <span className="text-[15px] font-semibold text-c-text">{L("作品详情", "Work Details")}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label={L("关闭", "Close")}
              className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-c-subtle text-c-text2 transition-colors hover:bg-c-border hover:text-c-text"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {/* 主体 */}
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-[18px]">
            <PromptPanel className="shrink-0" prompt={prompt} title={L("提示词", "Prompt")} full />

            {/* 生成参数:芯片式(比一行一条省一半竖向空间,长提示词也不会把它挤出视野) */}
            {/* shrink-0:同上,防止被长提示词压扁 */}
            <div className="shrink-0">
              <div className="mb-[7px] text-[11.5px] text-c-text3">{L("生成参数", "Parameters")}</div>
              <div className="flex flex-wrap gap-1.5">
                {metaRows.map((row) => (
                  <span
                    key={row.label}
                    className="rounded-[8px] bg-c-subtle2 px-2 py-1 text-[11.5px] text-c-text3"
                  >
                    {row.label}{" "}
                    <b
                      className={
                        row.accent
                          ? "font-semibold text-acc"
                          : "font-semibold text-c-text2"
                      }
                    >
                      {row.value}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 底部操作。pb 带 safe-area:iPhone 底部横条会盖住按钮。 */}
          <div className="flex shrink-0 flex-col gap-[9px] border-t border-c-line px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:pb-4">
            {/* 主按钮 = 以此重做(带提示词 + 原图跳生图页):鼓励复用创作,比"下载"更高价值 */}
            <button
              type="button"
              onClick={() => {
                const q = new URLSearchParams();
                if (work.prompt) q.set("prompt", work.prompt);
                q.set("src", work.image);
                onClose();
                router.push(`/generate?${q.toString()}`);
              }}
              className="flex h-[42px] w-full items-center justify-center gap-[7px] rounded-[11px] text-[13.5px] font-semibold text-white shadow-btn [background:var(--grad-acc)] transition-all hover:brightness-95"
            >
              <RotateCcw size={16} strokeWidth={1.9} />
              {L("以此重做", "Recreate from this")}
            </button>
            {/* 三个次级按钮:375px 上挤一行放不下(每个还要图标+文字),
                手机改 2 列(删除独占第二行,也降低误触),sm 起回到一行三等分。 */}
            <div className="grid grid-cols-2 gap-[9px] sm:flex">
              <button
                type="button"
                onClick={() => onToggleFav?.(work.id)}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-[10px] border text-[12.5px] font-medium transition-colors sm:flex-1",
                  fav
                    ? "border-c-danger/40 bg-c-tint-r text-c-danger"
                    : "border-c-border2 text-c-text2 hover:bg-c-subtle"
                )}
              >
                <Heart
                  size={15}
                  strokeWidth={1.8}
                  className={fav ? "fill-c-danger" : ""}
                />
                {fav ? L("已收藏", "Favorited") : L("收藏", "Favorite")}
              </button>
              <button
                type="button"
                onClick={() => downloadImage(work.image, work.title || tool)}
                className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle sm:flex-1"
              >
                <Download size={15} strokeWidth={1.8} />
                {L("下载", "Download")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete?.(work.id);
                  onClose();
                }}
                className="col-span-2 flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 text-[12.5px] font-medium text-c-danger transition-colors hover:bg-c-tint-r sm:col-span-1 sm:flex-1"
              >
                <Trash2 size={15} strokeWidth={1.8} />
                {L("删除", "Delete")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
