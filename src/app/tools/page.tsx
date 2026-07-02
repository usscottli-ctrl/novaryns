import { CreateHubPage } from "@/components/create-hub-page";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `创作工具中心 — ${BRAND}` };

export default function ToolsPage() {
  return <CreateHubPage />;
}
