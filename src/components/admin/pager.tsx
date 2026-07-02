"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** 0-based current page index. */
  page: number;
  /** Total number of pages (>= 1). */
  totalPages: number;
  /** Called with the new 0-based page index. */
  onChange: (page: number) => void;
  /** Optional extra label, e.g. "共 42 条". */
  totalLabel?: string;
  /** Disable controls (e.g. while loading). */
  disabled?: boolean;
};

// Shared admin pagination: prev/next + a jump box for quickly locating a page.
export function Pager({ page, totalPages, onChange, totalLabel, disabled }: Props) {
  const [jump, setJump] = useState("");
  if (totalPages <= 1) return null;

  function go() {
    const n = Math.trunc(Number(jump));
    if (!Number.isFinite(n) || n < 1) return;
    onChange(Math.min(totalPages, Math.max(1, n)) - 1);
    setJump("");
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        第 {page + 1} / {totalPages} 页{totalLabel ? ` · ${totalLabel}` : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={disabled || page <= 0}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
          disabled={disabled || page >= totalPages - 1}
        >
          下一页
        </Button>
        <span className="ml-1 text-muted-foreground">跳至</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jump}
          disabled={disabled}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder={String(page + 1)}
          className="h-8 w-14 rounded-md border border-border bg-card px-2 text-center text-xs disabled:opacity-50"
        />
        <span className="text-muted-foreground">页</span>
        <Button variant="outline" size="sm" onClick={go} disabled={disabled}>
          跳转
        </Button>
      </div>
    </div>
  );
}
