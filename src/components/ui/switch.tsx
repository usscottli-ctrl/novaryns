"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** 开关(spec B.6)。track 42×24,thumb 18,inset 3。 */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,70,229,.12)]",
        checked ? "bg-acc" : "bg-c-border2",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all",
          checked ? "left-[21px]" : "left-[3px]"
        )}
      />
    </button>
  );
}
