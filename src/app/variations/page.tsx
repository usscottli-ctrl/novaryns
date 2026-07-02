import { VariationsClient } from "@/components/variations/variations-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `图裂变 — ${BRAND}` };

export default function VariationsPage() {
  return <VariationsClient />;
}
