import { FuseClient } from "@/components/fuse/fuse-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `AI 融图 — ${BRAND}` };

export default function FusePage() {
  return <FuseClient />;
}
