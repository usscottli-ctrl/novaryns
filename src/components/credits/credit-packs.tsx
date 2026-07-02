"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { CREDIT_PACKS, fmtCredits, type CreditPack } from "@/lib/mock-data";
import { usePaymentConfig } from "@/lib/payment-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PayQrModal, type PayProvider } from "@/components/credits/pay-qr-modal";

// 积分充值包网格(月度会员已下线)。点「立即购买」→ 原生创建订单。
// 传 onCheckout 时把原生二维码数据(orderId/qrContent/title)回调上去(画布内用它开二维码支付弹窗)。
// 仅当后台已开收款且配齐收款信息(rechargeEnabled)时显示;否则整段隐藏。
export function CreditPacks({
  className,
  onCheckout,
}: {
  className?: string;
  onCheckout?: (
    orderId: string,
    info: {
      title: string;
      qrContent: string;
      provider: PayProvider;
      pack?: CreditPack;
    }
  ) => void;
}) {
  const { user, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { t } = useI18n();
  const { rechargeEnabled } = usePaymentConfig();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 标准用法(无 onCheckout):本组件自渲染共用扫码支付弹窗 + 轮询到账。
  const [pay, setPay] = useState<{
    orderId: string;
    provider: PayProvider;
    qrContent: string;
    pack: CreditPack;
  } | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      if (user) {
        const ar = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        const ad = await ar.json();
        if (ad?.user) applyServerUser(ad.user);
      }
    } catch {
      /* ignore */
    }
  }, [user, applyServerUser]);

  if (!rechargeEnabled) {
    return (
      <div className={cn("rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground", className)}>
        {t("credits.disabled")}
      </div>
    );
  }

  async function buy(packId: string) {
    if (!user) {
      openAuth("sign-up");
      return;
    }
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    setErr(null);
    setBusy(packId);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          kind: "pack",
          itemId: packId,
          method: "alipay",
        }),
      });
      const data = await res.json();
      // 原生模式:拿 qrContent 渲染二维码 + 轮询到账。
      if (res.ok && data.mode === "native" && data.qrContent) {
        const provider = (String(data.provider || "alipay") as PayProvider);
        if (onCheckout) {
          // 上层(画布)接管展示;把套餐数据一并带上以驱动共用弹窗。
          onCheckout(data.orderId, {
            title: data.title || t("credits.title"),
            qrContent: String(data.qrContent),
            provider,
            pack,
          });
        } else if (pack) {
          // 标准用法:本组件自渲染共用扫码支付弹窗。
          setPay({
            orderId: data.orderId,
            provider,
            qrContent: String(data.qrContent),
            pack,
          });
        } else {
          setErr(t("credits.buyFail"));
        }
        setBusy(null);
      } else {
        setErr(data.error || t("credits.buyFail"));
        setBusy(null);
      }
    } catch {
      setErr(t("credits.buyFail"));
      setBusy(null);
    }
  }

  return (
    <>
    <div className={className}>
      <p className="mb-4 text-xs text-muted-foreground">{t("credits.tip")}</p>
      {err && <p className="mb-3 text-sm text-[#e5484d]">{err}</p>}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {CREDIT_PACKS.map((p) => (
          <div
            key={p.id}
            className="flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="text-2xl font-extrabold tracking-tight">
                {fmtCredits(p.credits)}
              </span>
            </div>
            <p className="mt-1.5 min-h-[18px] text-xs text-muted-foreground">
              {p.bonus > 0
                ? `${t("credits.total")} ${fmtCredits(p.base)}+${fmtCredits(p.bonus)}（${t("credits.bonus")}）${p.discount ? ` · ${p.discount}` : ""}`
                : ""}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-lg font-bold">{p.price}</span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => buy(p.id)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("credits.buy")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>

      {/* 标准用法:本组件自渲染共用扫码支付弹窗 */}
      {pay && (
        <PayQrModal
          open={!!pay}
          orderId={pay.orderId}
          provider={pay.provider}
          qrContent={pay.qrContent}
          credits={pay.pack.credits}
          bonus={pay.pack.bonus}
          fen={pay.pack.fen}
          discount={pay.pack.discount}
          onClose={() => setPay(null)}
          onPaid={refreshCredits}
          onRefresh={() => buy(pay.pack.id)}
        />
      )}
    </>
  );
}
