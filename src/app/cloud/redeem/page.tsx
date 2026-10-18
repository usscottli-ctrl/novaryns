import type { Metadata } from "next";
import { RedeemClient } from "@/components/cloud/redeem-client";

export const metadata: Metadata = {
  title: "开通我的 AI 生图网站",
  description: "输入开通码,2–5 分钟自动交付你的专属 AI 电商生图网站实例。",
  robots: { index: false, follow: false }, // 核销页,不需要被搜索引擎收录
};

// 开通码自助核销页。买家从渠道(淘宝自动发货)拿到码后打开,无需登录。
// 支持 /cloud/redeem?code=NVCL-... 预填,便于自动发货话术里直接给可点链接。
export default function CloudRedeemPage({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  const initial = (searchParams.code ?? "").trim().toUpperCase();
  return <RedeemClient initialCode={initial} />;
}
