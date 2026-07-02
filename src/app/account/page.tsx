import { AccountClient } from "@/components/account/account-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `我的积分 — ${BRAND}` };

export default function AccountPage() {
  return <AccountClient />;
}
