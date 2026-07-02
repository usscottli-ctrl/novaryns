import { PrintfileClient } from "@/components/printfile/printfile-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `印刷图 — ${BRAND}` };

export default function PrintfilePage() {
  return <PrintfileClient />;
}
