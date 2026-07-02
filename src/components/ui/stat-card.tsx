import * as React from "react";
import { cn } from "@/lib/utils";

/** 统计卡(spec B.10)。小标签 + 大数值,accent 数值走 --acc。 */
export function StatCard({
  label,
  value,
  suffix,
  accent,
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  suffix?: React.ReactNode;
  accent?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-c-border bg-c-card p-5 shadow-card",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-c-text3">{label}</span>
        {icon ? <span className="text-c-text4">{icon}</span> : null}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span
          className={cn(
            "text-[27px] font-bold leading-none tabular-nums",
            accent ? "text-acc" : "text-c-text"
          )}
        >
          {value}
        </span>
        {suffix ? <span className="text-[13px] text-c-text3">{suffix}</span> : null}
      </div>
    </div>
  );
}
