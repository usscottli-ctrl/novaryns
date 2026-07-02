import { DeployCenter } from "@/components/operator/deploy-center";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `部署中心 — ${BRAND}` };

export default function DeployPage() {
  return <DeployCenter />;
}
