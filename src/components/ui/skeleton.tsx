import * as React from "react";
import { cn } from "@/lib/utils";

/** 骨架(spec B.10)。nv-shimmer 微光。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("nv-skeleton rounded-[10px]", className)} />;
}
