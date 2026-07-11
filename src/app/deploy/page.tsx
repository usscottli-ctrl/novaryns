import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeployCenter } from "@/components/operator/deploy-center";
import { BRAND } from "@/lib/brand";
import { editionName } from "@/lib/edition";
import { localAdminOk } from "@/lib/admin-auth";

export const metadata = { title: `部署中心 — ${BRAND}` };
export const dynamic = "force-dynamic";

export default function DeployPage() {
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
