import { SuiteClient } from "@/components/suite/suite-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `一键电商套图 — ${BRAND}` };

export default function SuitePage() {
  return <SuiteClient />;
}
