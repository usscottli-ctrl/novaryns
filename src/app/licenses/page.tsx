import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { BRAND } from "@/lib/brand";
import { proEnabled, isLicenseIssuerHost } from "@/lib/edition";
import { LicensesClient } from "@/components/operator/licenses-client";

export const metadata = { title: `我的授权 — ${BRAND}` };
export const dynamic = "force-dynamic";

export default async function LicensesPage() {
  // 授权管理(生成/吊销 License)是**签发站专属**运营页:买家自托管实例
  // (host ≠ ai.starzeco.com)不该看到「生成 License」界面,直接跳走。
  if (!(await proEnabled())) redirect("/dashboard");
  if (!isLicenseIssuerHost(headers().get("host"))) redirect("/deploy");
  return <LicensesClient />;
}
