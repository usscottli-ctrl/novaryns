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
  carry.set("auth", "sign-up");
  redirect(`/?${carry.toString()}`);
}
