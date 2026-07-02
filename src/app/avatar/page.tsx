import { AvatarClient } from "@/components/avatar/avatar-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `抠头像 — ${BRAND}` };

export default function AvatarPage() {
  return <AvatarClient />;
}
