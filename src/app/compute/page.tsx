import { ComputeClient } from "@/components/compute/compute-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `云端算力充值 — ${BRAND}` };
export const dynamic = "force-dynamic";

// 云端托管租户的算力充值页(购买站专用)。租户从自己实例后台「算力」卡片跳转过来,
// URL 带 ?token=<中转token id>;选算力包 → 扫码支付 → 配额自动到账。
export default function ComputePage() {
  return <ComputeClient />;
}
