import * as React from "react";
import { Slot } from "@/components/ui/slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* 设计系统按钮 (spec B.1) — 4 个规范变体 primary/secondary/ghost/danger,
   每个含 default/hover/active/focus/disabled/loading 全状态;
   保留旧别名 default/gradient/outline/link 不破坏既有页面。 */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-[7px] whitespace-nowrap transition-all duration-150 focus-visible:outline-none disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        // 主 CTA = 靛蓝渐变药丸(走 --grad-acc,随强调色切换)。
        primary:
          "rounded-[11px] text-white font-semibold [background:var(--grad-acc)] shadow-btn hover:brightness-95 hover:shadow-btn-hover active:brightness-90 focus-visible:ring-[3px] focus-visible:ring-[color:var(--ring-focus,rgba(79,70,229,.14))] disabled:[background:var(--c-disabled-fill)] disabled:opacity-70 disabled:shadow-none disabled:brightness-100",
        // 次级 = 白底描边(spec secondary)。
        secondary:
          "rounded-[10px] text-c-text font-medium border border-c-border2 bg-c-card hover:bg-c-subtle2 hover:border-[#D2D5DD] active:bg-c-subtle focus-visible:ring-[3px] focus-visible:ring-[rgba(79,70,229,.12)] disabled:border-c-line disabled:bg-c-line disabled:text-c-text4",
        ghost:
          "rounded-[9px] text-c-text2 font-medium hover:text-c-text hover:bg-c-subtle active:bg-c-border disabled:text-c-text4",
        danger:
          "rounded-[9px] text-c-danger font-medium hover:bg-c-tint-r active:text-[#C2403F] disabled:opacity-45",
        // ── 旧别名(保持兼容,逐步迁移到上面 4 个) ──
        gradient:
          "rounded-[11px] text-white font-semibold [background:var(--grad-acc)] shadow-btn hover:brightness-95 hover:shadow-btn-hover active:brightness-90 disabled:[background:var(--c-disabled-fill)] disabled:opacity-70 disabled:shadow-none",
        outline:
          "rounded-[10px] text-c-text font-medium border border-c-border2 bg-c-card hover:bg-c-subtle2 active:bg-c-subtle",
        default:
          "rounded-lg font-semibold bg-foreground text-background hover:opacity-90 active:opacity-100",
        link: "text-[color:var(--acc)] font-medium underline-offset-4 hover:underline",
      },
      size: {
        sm: "text-[12.5px] px-3.5 py-[7px]",
        md: "text-[13.5px] px-5 py-[11px]",
        default: "h-10 px-5 py-2 text-sm",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** 显示内联转圈并禁用(spec B.1 loading 态)。 */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading, children, disabled, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    // asChild 模式下 Slot 只允许单一子元素,不能注入 spinner。
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Comp>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span
            aria-hidden
            className="nv-spin h-3.5 w-3.5 rounded-full border-2 border-white/45 border-t-white"
          />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
