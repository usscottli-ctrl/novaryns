import { IpcheckClient } from "@/components/ipcheck/ipcheck-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `侵权检测 — ${BRAND}` };

export default function IpcheckPage() {
  return <IpcheckClient />;
}
