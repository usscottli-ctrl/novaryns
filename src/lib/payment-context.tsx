"use client";

import { createContext, useContext, useMemo } from "react";

type Ctx = {
  // 前端是否显示「在线充值」(= Pro 解锁 且 后台开关开 且 已配置收款信息;SSR 注入)。
  // 假 → 隐藏在线充值,改显示「兑换码」入口。
  rechargeEnabled: boolean;
  // 本实例是否解锁 Pro 能力(官方云 / 自托管 Pro 激活);假 = 开源精简版。
  pro: boolean;
};

const PaymentContext = createContext<Ctx | null>(null);

export function PaymentProvider({
  rechargeEnabled,
  pro,
  children,
}: {
  rechargeEnabled: boolean;
  pro: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(
    () => ({ rechargeEnabled, pro }),
    [rechargeEnabled, pro]
  );
  return (
    <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>
  );
}

/** Safe-to-call:在 Provider 外用返回默认(开源精简版:无充值、非 Pro)。 */
export function usePaymentConfig(): Ctx {
  const c = useContext(PaymentContext);
  if (!c) return { rechargeEnabled: false, pro: false };
  return c;
}
