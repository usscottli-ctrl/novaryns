import { TryonClient } from "@/components/tryon/tryon-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `服装上身 — ${BRAND}` };

export default function TryonPage() {
  return <TryonClient />;
}
