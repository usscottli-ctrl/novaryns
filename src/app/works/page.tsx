import { BRAND } from "@/lib/brand";
import { WorksClient } from "@/components/works/works-client";

export const metadata = { title: `作品库 — ${BRAND}` };

export default function WorksPage() {
  return <WorksClient />;
}
