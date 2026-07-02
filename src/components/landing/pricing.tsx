"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { CreditPacks } from "@/components/credits/credit-packs";

// 月度会员已下线 → 营销首页的价格区改成积分充值包。海外站(无充值)整段隐藏。
export function Pricing() {
  const { t } = useI18n();
  const { rechargeEnabled } = usePaymentConfig();
  if (!rechargeEnabled) return null;

  return (
    <section id="pricing" className="scroll-mt-20 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("home.pricingKicker")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("home.pricingTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground">{t("home.pricingSubtitle")}</p>
        </div>
        <div className="mx-auto mt-14 max-w-5xl">
          <CreditPacks />
        </div>
      </div>
    </section>
  );
}
