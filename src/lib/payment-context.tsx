"use client";

import { createContext, useContext, useMemo } from "react";

type Ctx = {
  // 前端是否显示「在线充值」(= Pro 解锁 且 后台开关开 且 已配置收款信息;SSR 注入)。
  // 假 → 隐藏在线充值,改显示「兑换码」入口。
  rechargeEnabled: boolean;
  // 本实例是否解锁 Pro 能力(官方云 / 自托管 Pro 激活);假 = 开源精简版。
  pro: boolean;
  // 是否为官方站(NOVARYNS_EDITION=cloud)。落地页据此决定显不显示"我们的"销售内容
  // (定价三档 / 开通云端 / 获取授权 / 指向我们的 GitHub)——自部署实例一律不显示。
  official: boolean;
};

const PaymentContext = createContext<Ctx | null>(null);

export function PaymentProvider({
  rechargeEnabled,
  pro,
  official,
  children,
}: {
  rechargeEnabled: boolean;
  pro: boolean;
  official: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(
    () => ({ rechargeEnabled, pro, official }),
    [rechargeEnabled, pro, official]
  );
  return (
    <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>
  );
}

/** Safe-to-call:在 Provider 外用返回默认(开源精简版:无充值、非 Pro、非官方站)。 */
export function usePaymentConfig(): Ctx {
  const c = useContext(PaymentContext);
  if (!c) return { rechargeEnabled: false, pro: false, official: false };
  return c;
}
