"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SegOption<T extends string> = { value: T; label: React.ReactNode };

/** 分段控件(spec B.3)。variant: light=白片激活 / dark=近黑片激活(兑换码/作品筛选)。 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "light",
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  variant?: "light" | "dark";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-0.5 rounded-[10px] bg-c-track p-[3px]", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold leading-none transition-all",
              active
                ? variant === "dark"
                  ? "bg-c-text text-c-card"
                  : "bg-c-card text-c-text shadow-[0_1px_2px_rgba(16,18,23,.06)]"
                : "text-c-seg-inactive hover:text-c-text2"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
