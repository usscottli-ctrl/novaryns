"use client";

import * as React from "react";
import { Copy, Check, Sparkles, RefreshCw } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/components/ui/toast";

/**
 * 作品「提示词」展示面板。
 *
 * 只做一件事:把提示词干净地摆出来 + 能一键复制。
 * (2026-07-19:按用户要求去掉了「解析/原文」结构化视图 —— 切换会导致容器高度跳变,
 *  且中文短提示词本来就切不出结构,收益不抵麻烦。别再加回来。)
 *
 * - 默认:4 行折叠 + 「展开全部」(用在生图页/工具页这种内联位置)。
 * - `full`:不折叠、显示全文(用在作品详情这种**外层已固定高度且自带滚动**的面板里,
 *   否则展开/收起会让父容器高度反复跳)。
 *
 * ⚠️ 只展示「对外可展示的提示词」。系统提示词在服务端就不会落库/下发
 * (见 /api/generate-image 的 publicPrompt),这里不做二次过滤。
 */

type Meta = { label: string; value?: string | number | null };

export function PromptPanel({
  prompt,
  meta = [],
  onReuse,
  reuseLabel = "以此提示词再创作",
  title = "提示词",
  className = "",
  full = false,
}: {
  prompt: string;
  meta?: Meta[];
  onReuse?: () => void;
  reuseLabel?: string;
  title?: string;
  className?: string;
  /** 显示全文不折叠(外层已固定高度 + 可滚动时用,避免展开导致高度跳变)。 */
  full?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const text = (prompt || "").trim();
  const shownMeta = meta.filter(
    (m) => m.value !== undefined && m.value !== null && m.value !== ""
  );

  if (!text) return null;

  const doCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      toast("提示词已复制", "success");
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast("复制失败,请手动选中复制", "error");
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-field border border-c-border2 bg-c-card ${className}`}
    >
      {/* 头部:标题 + 字数 + 复制 +(可选)再创作 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-c-border2 bg-c-subtle2 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-c-blue" />
          <span className="text-[13px] font-semibold text-c-text">{title}</span>
          <span className="rounded-full bg-c-tint-b px-2 py-0.5 text-[11px] font-semibold text-c-blue">
            {text.length} 字符
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={doCopy}
            className="inline-flex items-center gap-1 rounded-[9px] border border-c-border px-2.5 py-1.5 text-[11.5px] font-semibold text-c-text2 transition-colors hover:border-c-blue hover:text-c-blue"
          >
            {copied ? (
              <Check className="h-3 w-3 text-c-success" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            复制
          </button>
          {onReuse && (
            <button
              type="button"
              onClick={onReuse}
              className="inline-flex items-center gap-1 rounded-[9px] bg-acc px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <RefreshCw className="h-3 w-3" />
              {reuseLabel}
            </button>
          )}
        </div>
      </div>

      <div className="px-3.5 py-3">
        <p
          className={`whitespace-pre-wrap text-[12.5px] leading-relaxed text-c-text2 ${
            full || expanded ? "" : "line-clamp-4"
          }`}
        >
          {text}
        </p>
        {!full && text.length > 160 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 w-full text-center text-[11.5px] font-semibold text-c-blue"
          >
            {expanded ? "收起 ▴" : "展开全部 ▾"}
          </button>
        )}

        {/* 生成参数 */}
        {shownMeta.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-c-border2 pt-2.5">
            {shownMeta.map((m, i) => (
              <span
                key={i}
                className="rounded-[8px] bg-c-subtle2 px-2 py-1 text-[11px] text-c-text3"
              >
                {m.label}{" "}
                <b className="font-semibold text-c-text2">{m.value}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
