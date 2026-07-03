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

/** 作品详情灯箱(设计 showView,星泽商图.dc.html 2034–2073)。
 *  920px 卡面 + rgba(12,13,16,.72) blur-5 深色遮罩;左大预览 + 右 300px 详情面板。
 *  自带 portal/overlay(不复用 Modal 的居中 p-6 卡面,因本屏是左右贴边分栏布局)。 */

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
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-8">
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
        style={{ width: 920 }}
        className="nv-menu-down relative z-10 flex max-h-full max-w-full overflow-hidden rounded-[18px] bg-c-card shadow-pop"
      >
        {/* 左:大预览 */}
        <div className="relative flex min-w-0 flex-1 items-center justify-center p-10 [background:radial-gradient(120%_90%_at_50%_20%,#FBFBFD,#E7EAF0_60%,#D7DBE4)]">
          <Media
            src={cdnUrl(work.image)}
            alt={work.title || tool}
            gradient={work.gradient}
            ratio="aspect-[4/5]"
            className="w-[62%] rounded-[16px] border-0 shadow-[0_30px_60px_-18px_rgba(40,46,58,.5)]"
            overlay={false}
          />
          <span className="absolute left-4 top-4 rounded-[8px] bg-[rgba(22,24,29,.5)] px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-[4px]">
            {tool}
          </span>
        </div>

        {/* 右:300px 详情面板 */}
        <div className="flex w-[300px] flex-shrink-0 flex-col border-l border-c-line">
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
          <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-[18px]">
            <div>
              <div className="mb-[7px] text-[11.5px] text-c-text3">{L("提示词", "Prompt")}</div>
              <div className="rounded-[10px] border border-c-border3 bg-c-subtle2 px-3 py-[11px] text-[12.5px] leading-[1.6] text-c-text2">
                {prompt}
              </div>
            </div>

            <div className="flex flex-col gap-[11px]">
              {metaRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between"
                >
                  <span className="text-[12.5px] text-c-text3">{row.label}</span>
                  <span
                    className={
                      row.accent
                        ? "text-[12.5px] font-semibold text-acc"
                        : "text-[12.5px] font-semibold text-c-text"
                    }
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 底部操作 */}
          <div className="flex flex-col gap-[9px] border-t border-c-line px-5 py-4">
            <button
              type="button"
              onClick={() => downloadImage(work.image, work.title || tool)}
              className="flex h-[42px] w-full items-center justify-center gap-[7px] rounded-[11px] text-[13.5px] font-semibold text-white shadow-btn [background:var(--grad-acc)] transition-all hover:brightness-95"
            >
              <Download size={16} strokeWidth={1.9} />
              {L("下载原图", "Download Original")}
            </button>
            <div className="flex gap-[9px]">
              <button
                type="button"
                onClick={() => onToggleFav?.(work.id)}
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border text-[12.5px] font-medium transition-colors",
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
                onClick={() => {
                  const q = new URLSearchParams();
                  if (work.prompt) q.set("prompt", work.prompt);
                  q.set("src", work.image);
                  onClose();
                  router.push(`/generate?${q.toString()}`);
                }}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle"
              >
                <RotateCcw size={15} strokeWidth={1.8} />
                {L("重做", "Redo")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete?.(work.id);
                  onClose();
                }}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 text-[12.5px] font-medium text-c-danger transition-colors hover:bg-c-tint-r"
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
