import { redirect } from "next/navigation";

// 旧路由保留兼容:全局弹窗替换了独立的注册页。
export default function SignUpPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const carry = new URLSearchParams();
  if (typeof searchParams?.redirect === "string")
    carry.set("redirect", searchParams.redirect);
  if (typeof searchParams?.plan === "string")
    carry.set("plan", searchParams.plan);
  // 邀请有奖:别把 ?invite=码 在跳转时丢了(首页的 InviteCapture 会把它记进 cookie)
  if (typeof searchParams?.invite === "string")
    carry.set("invite", searchParams.invite);
  carry.set("auth", "sign-up");
  redirect(`/?${carry.toString()}`);
}
