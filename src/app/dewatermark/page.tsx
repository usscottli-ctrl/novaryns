import { DewatermarkClient } from "@/components/dewatermark/dewatermark-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `去水印 — ${BRAND}` };

export default function DewatermarkPage() {
  return <DewatermarkClient />;
}
