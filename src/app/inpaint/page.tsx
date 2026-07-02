import { InpaintClient } from "@/components/inpaint/inpaint-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `局部改图 — ${BRAND}` };

export default function InpaintPage() {
  return <InpaintClient />;
}
