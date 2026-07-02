import { HomeDashboard } from "@/components/home/home-dashboard";
import { pickHomepageImages } from "@/lib/homepage-picks";
import { BRAND } from "@/lib/brand";

// 顶栏「工作台」= 个人主场:问候 + 统计 + 快捷入口 + 最近作品(原登录后首页)。
export const revalidate = 86400;
export const metadata = { title: `工作台 — ${BRAND}` };

export default async function DashboardPage() {
  const { showcase } = await pickHomepageImages();
  return <HomeDashboard hot={showcase} />;
}
