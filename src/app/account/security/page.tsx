import { SecurityClient } from "@/components/account/security-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `账户与安全 — ${BRAND}` };

export default function SecurityPage() {
  return <SecurityClient />;
}
