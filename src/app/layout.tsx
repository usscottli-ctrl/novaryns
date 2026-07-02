import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { authMode } from "@/lib/auth-mode";
import { SessionBridge } from "@/components/session-bridge";
import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { PaymentProvider } from "@/lib/payment-context";
import { BrandProvider } from "@/lib/brand-context";
import { getRuntimeBrand } from "@/lib/brand-runtime";
import { getPaymentStatus } from "@/lib/settings";
import { proEnabled } from "@/lib/edition";
import { isConfigured } from "@/lib/setup";
import { BRAND, BRAND_FAVICON } from "@/lib/brand";
import { Suspense } from "react";
import { AuthModalProvider } from "@/lib/auth-modal-context";
import { AuthModal } from "@/components/auth-modal";
import { ToastProvider } from "@/components/ui/toast";
import { RechargeModalProvider } from "@/lib/recharge-modal-context";
import { RechargeModal } from "@/components/credits/recharge-modal";

// 站点字体:Geist(拉丁/数字,Vercel)+ 系统中文栈(见 tailwind sans),数字 tabular-nums。
// 中文不走网页字体(CJK 字体包数 MB,拖慢加载),用系统 PingFang/YaHei。

// 主题防闪烁:绘制前读取 localStorage('theme') 给 <html> 加 .dark
const THEME_INIT = `(function(){try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export const metadata: Metadata = {
  title: `${BRAND} — 面向电商卖家的商业视觉生产力工具`,
  description:
    `${BRAND} 是一款面向电商营销的 B2B 生产力工具，帮品牌与卖家高效产出电商主图、Banner、场景图与详情页视觉。`,
  keywords: [
    "电商营销工具",
    "电商主图制作",
    "商品视觉生产力",
    "Banner 制作",
    "商品场景图",
    "B2B 电商工具",
    `${BRAND}`,
  ],
  // 浏览器 tab 图标 — 走 BRAND_FAVICON (方形小图);未设则 fallback 到 BRAND_LOGO
  icons: { icon: BRAND_FAVICON, shortcut: BRAND_FAVICON, apple: BRAND_FAVICON },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 首启配置门控:**未配置的实例**(非官方云、且未填 OpenAI Key)访问任意页
  // 都引到 /setup;已配置(含 NOVARYNS_EDITION=cloud 官方云)完全不跳。
  // isConfigured() 在 cloud 分支直接短路返回 true,不读 DB —— 线上站零开销、永不触发。
  const pathname = headers().get("x-pathname") || "";
  if (pathname !== "/setup" && !(await isConfigured())) {
    redirect("/setup");
  }

  const locale = getServerLocale();
  // Pro 门控:官方云/自托管 Pro 激活 → 全功能;开源版锁。收银是 Pro 能力,
  // 所以在线充值额外要求 pro(开源版即便配了收款也不显示对外收费)。
  const pro = await proEnabled();
  // 后台 DB(开关 + 已配收款)→ env 兜底,SSR 注入前端门控,两站一套代码。
  const rechargeEnabled = pro && (await getPaymentStatus()).enabled;
  // 运行时品牌(白标):DB site_name/brand_logo 覆盖 → env 默认兜底;DB 无覆盖时与现状一致。
  const brand = await getRuntimeBrand();
  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} className={GeistSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <LocaleProvider initialLocale={locale}>
          <PaymentProvider rechargeEnabled={rechargeEnabled} pro={pro}>
          <BrandProvider
            name={brand.name}
            logo={brand.logo}
            logoHasText={brand.logoHasText}
          >
          <AuthProvider>
            <AuthModalProvider>
              <RechargeModalProvider>
                <ToastProvider>
                  {authMode === "supabase" && <SessionBridge />}
                  <AppShell>{children}</AppShell>
                  <Suspense fallback={null}>
                    <AuthModal />
                  </Suspense>
                  <RechargeModal />
                </ToastProvider>
              </RechargeModalProvider>
            </AuthModalProvider>
          </AuthProvider>
          </BrandProvider>
          </PaymentProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
