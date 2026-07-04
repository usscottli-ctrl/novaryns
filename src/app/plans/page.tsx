import { redirect } from "next/navigation";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { editionName } from "@/lib/edition";
import { getSitePage } from "@/lib/settings";
import { CustomPage } from "@/components/custom-page";

// 官方云:月度会员已下线,/plans 重定向到账户「积分」tab。
// 自部署实例:渲染站长后台自定义的「定价」页(单用户无计费,内容由站长自定)。
export default async function PlansPage() {
  if (editionName !== "cloud") {
    const locale = getServerLocale();
    const custom = await getSitePage("plans");
    return (
      <CustomPage
        title={locale === "en" ? "Pricing" : "定价"}
        content={
          custom ||
          (locale === "en" ? "Content coming soon." : "内容建设中，敬请期待。")
        }
      />
    );
  }
  redirect("/account?tab=credits");
}
