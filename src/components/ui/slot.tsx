"use client";

import * as React from "react";

// Minimal asChild Slot implementation (avoids the @radix-ui dependency).
export const Slot = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
>(({ children, ...props }, ref) => {
  if (!React.isValidElement(children)) return null;
  const child = children as React.ReactElement<Record<string, unknown>>;
  return React.cloneElement(child, {
    ...props,
    ...child.props,
    ref,
    className: [
      (props as { className?: string }).className,
      (child.props as { className?: string }).className,
    ]
      .filter(Boolean)
      .join(" "),
  });
});
Slot.displayName = "Slot";
