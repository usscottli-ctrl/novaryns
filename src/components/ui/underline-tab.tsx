"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type UnderlineTabOption<T extends string> = { value: T; label: React.ReactNode };

/** 下划线分页(spec critic C2,登录弹窗 验证码/密码 用)。激活 = --acc 文字 + 2px 下划线。 */
export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: UnderlineTabOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-6 border-b border-c-line", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "relative -mb-px pb-2.5 text-[13.5px] font-medium transition-colors",
              active ? "text-acc" : "text-c-text3 hover:text-c-text2"
            )}
          >
            {o.label}
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-acc" />
            )}
          </button>
        );
      })}
    </div>
  );
}
