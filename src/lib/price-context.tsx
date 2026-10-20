"use client";

import { setPriceOverrides } from "@/lib/mock-data";

// 后台「各板块积分」覆盖表 → 前端计价函数(toolCost / resolutionCost / videoCost …)。
// layout SSR 读出后传进来,**在渲染子组件之前**同步写入,页面首帧显示的就是站长定的价,
// 与后端实扣一致(见 mock-data.ts PRICE_BOARDS 段)。没有覆盖时传 {},一切按默认价。
export function PriceProvider({
  prices,
  children,
}: {
  prices: Record<string, number>;
  children: React.ReactNode;
}) {
  setPriceOverrides(prices);
  return <>{children}</>;
}
