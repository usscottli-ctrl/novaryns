"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** 下拉容器(spec B.9)。圆角16 + 发丝边 + pop 阴影。 */
export function MenuPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-c-border bg-c-card p-1.5 shadow-pop",
        className
      )}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  danger,
  icon,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors",
        danger ? "text-c-danger hover:bg-c-tint-r" : "text-c-text hover:bg-c-subtle",
        className
      )}
    >
      {icon ? <span className="shrink-0 text-c-text3">{icon}</span> : null}
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1.5 h-px bg-c-line" />;
}
