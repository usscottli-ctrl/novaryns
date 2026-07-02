import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/setup";
import { SetupClient } from "@/components/setup/setup-client";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: `首启配置 — ${BRAND}` };

// 首启配置向导。**已配置的实例(含官方云 NOVARYNS_EDITION=cloud)直接跳回首页**,
// 向导永不出现;只有「未配置」的自托管新实例才会看到这里。
export default async function SetupPage() {
  if (await isConfigured()) {
    redirect("/");
  }
  return <SetupClient brand={BRAND} />;
}
