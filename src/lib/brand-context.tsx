"use client";

import { createContext, useContext, useMemo } from "react";
import { BRAND, BRAND_LOGO, BRAND_LOGO_HAS_TEXT } from "@/lib/brand";

// ---------------------------------------------------------------------------
// 品牌(白标)Context —— 客户端。仿 payment-context.tsx。
//
// layout 用 getRuntimeBrand()(服务端读 DB 覆盖 + env 默认)拿到品牌,SSR 注入本
// Provider;客户端组件(Logo / 页脚等)用 useBrand() 读回,后台改品牌无需重新 build。
//
// Safe-to-call:Provider 外调用回退到 `@/lib/brand` 的 env 默认,渲染结果与现状一致。
// ---------------------------------------------------------------------------

type Ctx = {
  /** 站点名称(DB site_name 覆盖 → env BRAND 兜底)。 */
  name: string;
  /** 导航 Logo 图片 URL(DB brand_logo 覆盖 → env BRAND_LOGO 兜底)。 */
  logo: string;
  /** Logo 图本身是否已含品牌文字;true 则不再外置渲染名称。自定义 Logo 保守为 false。 */
  logoHasText: boolean;
};

const BrandContext = createContext<Ctx | null>(null);

export function BrandProvider({
  name,
  logo,
  logoHasText,
  children,
}: {
  name: string;
  logo: string;
  logoHasText: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(
    () => ({ name, logo, logoHasText }),
    [name, logo, logoHasText]
  );
  return (
    <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
  );
}

/** Safe-to-call:在 Provider 外用回退 env 默认(与 build 期常量一致)。 */
export function useBrand(): Ctx {
  const c = useContext(BrandContext);
  if (!c) {
    return {
      name: BRAND,
      logo: BRAND_LOGO,
      logoHasText: BRAND_LOGO_HAS_TEXT,
    };
  }
  return c;
}
