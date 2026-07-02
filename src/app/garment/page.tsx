import { GarmentClient } from "@/components/garment/garment-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `服装提取 — ${BRAND}` };

export default function GarmentPage() {
  return <GarmentClient />;
}
