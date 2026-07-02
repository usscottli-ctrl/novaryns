import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { proEnabled } from "@/lib/edition";
import { LicensesClient } from "@/components/operator/licenses-client";

export const metadata = { title: `我的授权 — ${BRAND}` };
export const dynamic = "force-dynamic";

export default async function LicensesPage() {
  if (!(await proEnabled())) redirect("/dashboard");
  return <LicensesClient />;
}
