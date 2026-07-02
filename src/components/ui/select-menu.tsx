"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 全站统一下拉菜单(方案 A:净白卡片 + 翠绿对勾)。替代原生 <select> 的系统白蓝下拉。
 * - 触发钮:卡片底 + 细边框,展开时翠绿描边,箭头翻转(与输入框 focus 风格一致)。
 * - 菜单:portal 到 body(不被 overflow 容器裁切),空间不足自动向上弹。
 * - 选中:右侧翠绿 ✓;hover 浅灰。全部用设计令牌,深色模式自动适配。
 * - 画布(/canvas)不用这个 —— 画布有专属深色 DarkSelect。
 */
export function SelectMenu({
  value,
  options,
  onChange,
  disabled,
  className,
  size = "md",
}: {
  value: string;
  options: { value: string; label: ReactNode }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  /** 触发钮额外类(常用于宽度,如 "w-full") */
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    minWidth: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  function toggle() {
    if (disabled) return;
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        // 估算菜单高(每项 ~36px + padding),不够就向上弹
        const estH = Math.min(options.length * 36 + 12, 320);
        const downOk = r.bottom + 6 + estH <= window.innerHeight - 8;
        setPos({
          left: Math.min(r.left, window.innerWidth - r.width - 8),
          minWidth: r.width,
          ...(downOk
            ? { top: r.bottom + 6 }
            : { bottom: window.innerHeight - r.top + 6 }),
        });
      }
    }
    setOpen((v) => !v);
  }

  // 缩放/页面滚动时收起(避免菜单漂移),但菜单自身内部滚动(选项多出现滚动条)不收起
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && menuRef.current && menuRef.current.contains(t)) return; // 菜单内滚动,忽略
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "flex items-center justify-between gap-2 rounded-[10px] border bg-card text-left font-medium text-foreground transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
          open
            ? "border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            : "border-border hover:border-primary/45",
          className
        )}
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 flex-none text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-[300]" onClick={() => setOpen(false)}>
            <div
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                left: pos.left,
                top: pos.top,
                bottom: pos.bottom,
                minWidth: pos.minWidth,
              }}
              className={cn(
                "fixed max-h-80 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-[0_12px_40px_rgba(16,20,23,.12),0_2px_8px_rgba(16,20,23,.06)]",
                pos.top != null ? "menu-pop-down" : "menu-pop-up"
              )}
            >
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-secondary",
                      size === "sm" ? "py-1.5 text-xs" : "py-2 text-[13.5px]",
                      on ? "font-semibold text-foreground" : "text-foreground"
                    )}
                  >
                    <span className="min-w-0 truncate">{o.label}</span>
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 flex-none text-primary",
                        on ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
