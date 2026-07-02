import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      aria-invalid={error || undefined}
      className={cn(
        "flex min-h-[78px] w-full rounded-[10px] border bg-c-subtle2 px-[13px] py-[10px] text-[13.5px] leading-relaxed text-c-text transition-colors placeholder:text-c-text4 focus-visible:outline-none disabled:cursor-not-allowed resize-none",
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
Textarea.displayName = "Textarea";

export { Textarea };
