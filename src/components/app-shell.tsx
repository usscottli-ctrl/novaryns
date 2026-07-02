"use client";

import { usePathname } from "next/navigation";
import { AppRail } from "@/components/app-rail";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";

/**
 * 全站工作台壳:左侧图标导航栏(手机为底部 tab)+ 右侧内容区。
 * - 登录/注册页:无壳(全屏)。
 * - 画布页:有壳、无页脚(全屏沉浸由画布自身处理)。
 * - 其余页:壳 + 页脚(保留 ICP 备案等)。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const noShell = path === "/sign-in" || path === "/sign-up";
  const isCanvas = path.startsWith("/canvas");
  // 沉浸全屏(无页脚):画布 / 对话生成。生图/套图/工作台改成和工具页一致的自然流(带页脚)。
  const isImmersive = isCanvas || path.startsWith("/genchat");

  if (noShell) return <main className="min-h-screen">{children}</main>;

  return (
    <>
      <AppRail />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
          isCanvas ? "pb-0 md:pt-0" : "pb-[58px] md:pb-0 md:pt-[60px]"
        )}
      >
        <main className="flex-1">{children}</main>
        {!isImmersive && <SiteFooter />}
      </div>
    </>
  );
}
