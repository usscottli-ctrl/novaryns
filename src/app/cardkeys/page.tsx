import { redirect } from "next/navigation";
import { CardkeysAdmin } from "@/components/operator/cardkeys-admin";
import { BRAND } from "@/lib/brand";
import { proEnabled } from "@/lib/edition";

export const metadata = { title: `兑换码管理 — ${BRAND}` };
export const dynamic = "force-dynamic";

export default async function CardkeysPage() {
  if (!(await proEnabled())) redirect("/dashboard");
  return <CardkeysAdmin />;
}
