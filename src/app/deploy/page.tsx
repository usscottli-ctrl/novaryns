import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeployCenter } from "@/components/operator/deploy-center";
import { BRAND } from "@/lib/brand";
import { editionName } from "@/lib/edition";
import { localAdminOk } from "@/lib/admin-auth";
import { relayTokenIdFromBaseUrl } from "@/lib/cloud";

export const metadata = { title: `部署中心 — ${BRAND}` };
export const dynamic = "force-dynamic";

export default function DeployPage() {
  // ⚠️ **云端托管租户一律不可见**(2026-08-16)。租户实例的 editionName 也是 "cloud",
  // 若只按 edition 判断就会命中下面的「公开销售页」分支 —— 结果是买家花钱开的白标站上,
  // 任何访客(含买家自己的终端客户)都能看到「开源版 ¥0 + GitHub 地址 + git clone 一键安装」
  // 和 Pro/云端标准价。既在教付费客户免费自部署,也让按项目谈的定制报价穿帮。
  // 判定用 relay 的 nvr- 通道(与「托管算力」同一信号),官方购买站不受影响。
  if (relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "")) redirect("/");

  // 官方站(cloud):公开销售页,人人可看。
  // 自托管实例(开源/Pro 买家):部署、授权、更新是**站长运营信息**,不给终端
  // 用户看 —— 未登录/非站长访问一律回首页(退出登录后也一样)。
  if (editionName !== "cloud") {
    const cookie = headers().get("cookie") ?? "";
    const fake = new Request("http://local", { headers: { cookie } });
    if (!localAdminOk(fake)) redirect("/");
  }
  return <DeployCenter />;
}
