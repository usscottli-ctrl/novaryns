import { redirect } from "next/navigation";

// 旧路由保留兼容(老书签/外链):全局弹窗替换了独立的登录页。
// 直接跳回首页;打开弹窗的工作在前端组件里完成(?auth=sign-in 通过 query 触发)。
export default function SignInPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const carry = new URLSearchParams();
  if (typeof searchParams?.redirect === "string")
    carry.set("redirect", searchParams.redirect);
  if (typeof searchParams?.plan === "string")
    carry.set("plan", searchParams.plan);
  carry.set("auth", "sign-in");
  redirect(`/?${carry.toString()}`);
}
