"use client";

import { cn } from "@/lib/utils";

// 原图 / 效果图 左右对比(参考站同款,方便用户对照生成前后)。
// before/after 为图片 URL;compact=网格内紧凑模式(标签更小)。
export function BeforeAfter({
  before,
  after,
  beforeLabel = "原图",
  afterLabel = "效果图",
  className,
  compact = false,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const Tag = ({ children }: { children: React.ReactNode }) => (
    <span
      className={cn(
        "absolute left-2 top-2 z-10 rounded-md bg-black/55 font-medium text-white",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      )}
    >
      {children}
    </span>
  );
  return (
    <div className={cn("grid grid-cols-2 gap-1.5", className)}>
      <div className="relative overflow-hidden rounded-lg border border-border bg-secondary/20">
        <Tag>{beforeLabel}</Tag>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={before}
          alt={beforeLabel}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="relative overflow-hidden rounded-lg border border-border bg-secondary/20">
        <Tag>{afterLabel}</Tag>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={afterLabel} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}
