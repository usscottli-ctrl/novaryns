import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { authMode } from "@/lib/auth-mode";
import { SessionBridge } from "@/components/session-bridge";
import { SignedOutNotice } from "@/components/signed-out-notice";
import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { PaymentProvider } from "@/lib/payment-context";
import { BrandProvider } from "@/lib/brand-context";
import { getRuntimeBrand } from "@/lib/brand-runtime";
import { PriceProvider } from "@/lib/price-context";
import { setI18nBrand } from "@/lib/i18n/dict";
import { getPriceOverrides } from "@/lib/price-overrides";
import { getPaymentStatus } from "@/lib/settings";
import { relayTokenIdFromBaseUrl } from "@/lib/cloud";
import { proEnabled, editionName } from "@/lib/edition";
import { isConfigured } from "@/lib/setup";
import { BRAND, BRAND_FAVICON } from "@/lib/brand";
import { Suspense } from "react";
import { AuthModalProvider } from "@/lib/auth-modal-context";
import { AuthModal } from "@/components/auth-modal";
import { ToastProvider } from "@/components/ui/toast";
import { RechargeModalProvider } from "@/lib/recharge-modal-context";
import { RechargeModal } from "@/components/credits/recharge-modal";
import { Tracker } from "@/components/analytics/tracker";

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
  setI18nBrand(brand.name); // 服务端渲染的 {brand} 文案也用站点名
  // 后台「各板块积分」覆盖表(站长自定义价格),SSR 注入前端计价函数
  const prices = await getPriceOverrides();
  // 本实例是否为云端托管租户(OPENAI_BASE_URL 指向 relay 的 nvr- 通道)。
  const isCloudTenant =
    relayTokenIdFromBaseUrl(process.env.OPENAI_BASE_URL || "") !== null;
  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} className={GeistSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <LocaleProvider initialLocale={locale}>
          <PaymentProvider
            rechargeEnabled={rechargeEnabled}
            pro={pro}
            // official = **是不是 Novaryns 自己的站**。云端托管租户的 edition 也是 cloud,
            // 但它是买家的白标站,不是我们的站 —— 之前只判 edition 会让租户站上出现
            // 「开源自部署 ¥0 + GitHub + 一键安装」和我们的标准价,既教付费客户免费自建,
            // 也让按项目谈的报价穿帮。在源头修正,所有消费方(落地页/页脚/后台)一起生效。
            official={editionName === "cloud" && !isCloudTenant}
            cloudTenant={isCloudTenant}
          >
          <BrandProvider
            name={brand.name}
            logo={brand.logo}
            logoHasText={brand.logoHasText}
          >
          <PriceProvider prices={prices}>
          <AuthProvider>
            <AuthModalProvider>
              <RechargeModalProvider>
                <ToastProvider>
                  {authMode === "supabase" && <SessionBridge />}
                  <Tracker />
                  <SignedOutNotice />
                  <AppShell>{children}</AppShell>
                  <Suspense fallback={null}>
                    <AuthModal />
                  </Suspense>
                  <RechargeModal />
                </ToastProvider>
              </RechargeModalProvider>
            </AuthModalProvider>
          </AuthProvider>
          </PriceProvider>
          </BrandProvider>
          </PaymentProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
