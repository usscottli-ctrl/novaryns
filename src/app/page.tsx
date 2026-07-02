import { HomeGate } from "@/components/home/home-gate";
import { pickHomepageImages } from "@/lib/homepage-picks";

// ISR: 每 24h 重新跑一遍选图,新加的模板自动进池(只要符合分类/宽高比/tag 规则)
export const revalidate = 86400;

export default async function HomePage() {
  const { showcase } = await pickHomepageImages();
  // 未登录→营销落地页 / 已登录→工作台首页(见 HomeGate)
  return <HomeGate hot={showcase} />;
}
