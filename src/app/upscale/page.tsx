import { UpscaleClient } from "@/components/upscale/upscale-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `AI 变清晰 — ${BRAND}` };

export default function UpscalePage() {
  return <UpscaleClient />;
}
