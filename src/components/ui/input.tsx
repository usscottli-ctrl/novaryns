import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 错误态:红框 + 红聚焦环(spec B.2)。 */
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => (
    <input
      type={type}
      aria-invalid={error || undefined}
      className={cn(
        "flex h-[42px] w-full rounded-[10px] border bg-c-subtle2 px-[13px] text-[13.5px] text-c-text transition-colors placeholder:text-c-text4 focus-visible:outline-none disabled:cursor-not-allowed",
        error
          ? "border-[1.5px] border-c-danger bg-c-card focus-visible:ring-[3px] focus-visible:ring-[rgba(229,72,77,.12)]"
          : "border-c-border2 focus-visible:border-[1.5px] focus-visible:border-acc focus-visible:bg-c-card focus-visible:ring-[3px] focus-visible:ring-[rgba(79,70,229,.12)]",
        "disabled:border-c-border disabled:bg-c-line disabled:text-c-disabled-text",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
