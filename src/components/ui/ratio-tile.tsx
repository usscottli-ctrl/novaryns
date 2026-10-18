"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { RatioTileData } from "@/lib/ratios";

export function RatioTileGroup({
  tiles,
  value,
  onChange,
  columns = 4,
  className,
}: {
  tiles: RatioTileData[];
  value: string;
  onChange: (id: string) => void;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
    >
      {tiles.map((t) => {
        const active = t.id === value;
        const dashed = t.id === "auto";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={cn(
              // 不用 aspect-square —— 那会让方块随栏宽变得很高(6 个就占掉大半屏)。
              // 固定 52px 矮高度,一行放得下更多档。
              "group flex h-[44px] flex-col items-center justify-center gap-1.5 rounded-[10px] border transition-colors",
              active
                ? "border-acc-border bg-acc-tint"
                : "border-transparent bg-c-subtle2 hover:border-c-border2 hover:bg-c-subtle"
            )}
          >
            <span className="flex items-center justify-center" style={{ width: 24, height: 17 }}>
              <span
                className={cn("block", !active && "border-[#B6BAC4] group-hover:border-[#9AA0AE]")}
                style={{
                  width: t.w,
                  height: t.h,
                  borderWidth: 1.5,
                  borderStyle: dashed ? "dashed" : "solid",
                  borderColor: active ? "var(--acc)" : undefined,
                  borderRadius: 3,
                }}
              />
            </span>
            <span
              className={cn(
                "text-[10.5px] font-medium leading-none",
                active ? "text-acc" : "text-c-text3"
              )}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
