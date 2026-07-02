"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";

const TIPS_ZH = [
  "正在理解你的产品…",
  "正在合成商业视觉…",
  "正在精修细节与光影…",
  "马上就好…",
];

const TIPS_EN = [
  "Understanding your product…",
  "Composing the commercial visual…",
  "Refining details, light & shadow…",
  "Almost there…",
];

// 生成中占位:品牌色极光呼吸 + 转圈 + 「生成中」+ 轮播文案。
// 填满父容器(父容器控制宽高/比例)。compact=小格子(如套图13宫格)只显示转圈+「生成中」。
export function GenLoader({ compact = false }: { compact?: boolean }) {
  const { locale } = useI18n();
  const TIPS = locale === "en" ? TIPS_EN : TIPS_ZH;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (compact) return;
    const t = setInterval(() => setI((p) => (p + 1) % TIPS.length), 1600);
    return () => clearInterval(t);
  }, [compact, TIPS.length]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-acc-tint">
      <div className="gl-shim" />
      <div className="relative z-[2] flex h-full w-full flex-col items-center justify-center gap-2">
        <span
          className={cn(
            "rounded-full border-[3px] motion-safe:animate-spin",
            compact ? "h-6 w-6 border-2" : "h-8 w-8"
          )}
          style={{ borderColor: "rgba(79,70,229,.22)", borderTopColor: "#4F46E5" }}
        />
        <span
          className={cn(
            "font-medium text-acc",
            compact ? "text-[11px]" : "text-sm"
          )}
        >
          {locale === "en" ? "Generating" : "生成中"}
        </span>
        {!compact && (
          <span className="px-2 text-center text-[11px] text-muted-foreground">
            {TIPS[i]}
          </span>
        )}
      </div>
    </div>
  );
}
