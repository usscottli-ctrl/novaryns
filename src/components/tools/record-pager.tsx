"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";

// 本工具记录每页张数(全站统一:2 列 × 6 行)。
export const RECORDS_PER_PAGE = 12;

/** 右侧「本工具记录」翻页器。total<=1 时不渲染。 */
export function RecordPager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  if (total <= 1) return null;
  return (
    <div className="mt-2 flex flex-none items-center justify-center gap-2 text-[12px] text-c-text2">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
        aria-label={L("上一页", "Previous page")}
        className="grid h-6 w-6 place-items-center rounded-[7px] border border-c-border transition-colors hover:bg-c-subtle disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="tabular-nums">
        {page + 1} / {total}
      </span>
      <button
        type="button"
        disabled={page >= total - 1}
        onClick={() => onPage(Math.min(total - 1, page + 1))}
        aria-label={L("下一页", "Next page")}
        className="grid h-6 w-6 place-items-center rounded-[7px] border border-c-border transition-colors hover:bg-c-subtle disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
