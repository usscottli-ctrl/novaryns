"use client";

import { Landing } from "@/components/home/landing";
import type { PickedTemplate } from "@/lib/homepage-picks";

/**
 * 首页对所有人一致 = 营销落地页 Landing(登录态无关,利于 SEO + 一致体验)。
 * 个人「工作台」(问候 + 统计 + 快捷入口 + 最近作品)移到 /dashboard(顶栏「工作台」)。
 */
export function HomeGate({ hot }: { hot: PickedTemplate[] }) {
  return <Landing hot={hot} />;
}
