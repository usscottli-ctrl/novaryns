import { CutoutClient } from "@/components/cutout/cutout-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `AI 抠图 — ${BRAND}` };

export default function CutoutPage() {
  return <CutoutClient />;
}
