"use client";

import Link from "next/link";
import { X, Sparkles, ArrowRight, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";
import { TOOL_CATEGORIES, toolsByCategory } from "@/lib/tool-meta";

type Tool = {
  zh: string;
  en: string;
  Icon: LucideIcon;
  href?: string; // 有 = 已上线可点;无 = 即将上线
};
type Group = { zh: string; en: string; tools: Tool[] };

// 目录派生自工具单一事实源 @/lib/tool-meta(新增工具只改那里)。
// 导出供顶栏「创作」hover 下拉复用。即将上线工具(live:false)不带 href → 标「即将上线」。
export const GROUPS: Group[] = TOOL_CATEGORIES.map((c) => ({
  zh: c.name,
  en: c.en,
  tools: toolsByCategory(c.name).map((t) => ({
    zh: t.key,
    en: t.en,
    Icon: t.Icon,
    href: t.live === false ? undefined : t.href,
  })),
}));

export function CreateHub({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          // 遮罩盖全屏(顶栏 z-40 仍在其上可见);层级在顶栏之下、内容之上
          "fixed inset-0 z-[38] bg-black/40 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        role="dialog"
        aria-label={L("AI 创作工具", "AI tools")}
        className={cn(
          // 从左侧滑出(桌面在顶栏 z-40 之下、top-14 起;移动全高)。
          "fixed inset-y-0 left-0 z-[39] flex w-[min(460px,92vw)] flex-col border-r border-border bg-card transition-transform duration-300 ease-out md:top-14",
          open ? "translate-x-0 shadow-[0_0_60px_rgba(0,0,0,.35)]" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-5 w-5 text-primary" />
            {L("AI 创作工具", "AI tools")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={L("关闭", "Close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {GROUPS.map((g) => (
            <div key={g.zh}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {L(g.zh, g.en)}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {g.tools.map((t) => {
                  const live = !!t.href;
                  const cls = cn(
                    "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors",
                    live
                      ? "border-border hover:border-primary/50 hover:bg-secondary/50"
                      : "cursor-default border-dashed border-border/70 opacity-60"
                  );
                  const inner = (
                    <>
                      <span
                        className={cn(
                          "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
                          live
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-muted-foreground"
                        )}
                      >
                        <t.Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {L(t.zh, t.en)}
                        </span>
                        {live ? (
                          <span className="flex items-center gap-0.5 text-[11px] text-primary">
                            {L("去使用", "Open")}
                            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {L("即将上线", "Coming soon")}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  // 已上线工具用 <Link>:抽屉打开时 Next 自动预取该页(后台先取好),
                  // 点击即秒开,把"回美国源站取页面"的 ~1.6s 延迟藏到点击之前。
                  return live ? (
                    <Link
                      key={t.zh}
                      href={t.href!}
                      prefetch
                      onClick={onClose}
                      className={cls}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button key={t.zh} type="button" disabled className={cls}>
                      {inner}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
