import { ExtractClient } from "@/components/extract/extract-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `印花提取 — ${BRAND}` };

export default function ExtractPage() {
  return <ExtractClient />;
}
