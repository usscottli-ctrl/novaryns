import { redirect } from "next/navigation";

// 月度会员已下线,积分充值并入账户页。/plans 永久重定向到账户的「积分」tab。
export default function PlansPage() {
  redirect("/account?tab=credits");
}
