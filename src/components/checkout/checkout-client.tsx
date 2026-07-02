"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { getCreditPack, CREDIT_PACKS } from "@/lib/mock-data";
import { PayQrModal, type PayProvider } from "@/components/credits/pay-qr-modal";

// 结账页:为 ?pack= 创建真实订单 → 共用 PayQrModal 展示支付宝/微信二维码 + 轮询到账。
// 无 mock 发放——必须真实支付。月度会员已下线,只接受积分充值包。
export function CheckoutClient({ pack }: { pack?: string } = {}) {
  const params = useSearchParams();
  const { user, ready, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { rechargeEnabled } = usePaymentConfig();
  const [err, setErr] = useState<string | null>(null);
  // 结账页固定走支付宝原生扫码(无方式选择 UI)。
  const method: PayProvider = "alipay";
  const [order, setOrder] = useState<{
    orderId: string;
    qrContent: string;
    provider: PayProvider;
  } | null>(null);
  const started = useRef(false);

  const raw = params.get("pack") || pack || "";
  const packId = getCreditPack(raw) ? raw : CREDIT_PACKS[0].id;
  const pk = getCreditPack(packId) ?? CREDIT_PACKS[0];

  // 创建订单(登录后自动发起一次)。供 PayQrModal onRefresh 复用。
  const createOrder = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          kind: "pack",
          itemId: packId,
          method,
        }),
      });
      const data = await res.json();
      if (res.ok && data.mode === "native" && data.qrContent) {
        setOrder({
          orderId: data.orderId,
          qrContent: String(data.qrContent),
          provider: (data.provider as PayProvider) ?? method,
        });
        setErr(null);
      } else {
        setErr(data.error || "下单失败，请重试 / Failed to create order");
      }
    } catch {
      setErr("网络错误，请重试 / Network error, please retry");
    }
  }, [user, packId, method]);

  useEffect(() => {
    if (!ready) return;
    if (!rechargeEnabled) return; // 收银台仅在开通在线收款(Pro + 已配)时可用
    if (!user) {
      openAuth("sign-up");
      return;
    }
    if (started.current) return;
    started.current = true;
    void createOrder();
  }, [ready, rechargeEnabled, user, openAuth, createOrder]);

  const onPaid = useCallback(async () => {
    try {
      if (user) {
        const ar = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`
        );
        const ad = await ar.json();
        if (ad?.user) applyServerUser(ad.user);
      }
    } catch {
      /* ignore */
    }
  }, [user, applyServerUser]);

  if (ready && !rechargeEnabled) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-c-text3">
          收银台未开放 / Checkout is not available
        </p>
        <a href="/dashboard" className="text-sm text-acc hover:underline">
          返回工作台 / Back
        </a>
      </div>
    );
  }

  if (err) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-c-danger">{err}</p>
        <a
          href="/account?tab=credits"
          className="text-sm text-acc hover:underline"
        >
          返回积分 / Back to credits
        </a>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-acc" />
        <p className="text-sm text-c-text3">
          正在生成支付二维码… / Generating payment QR…
        </p>
      </div>
    );
  }

  return (
    <PayQrModal
      open={!!order}
      orderId={order.orderId}
      provider={order.provider}
      qrContent={order.qrContent}
      credits={pk.credits}
      bonus={pk.bonus}
      fen={pk.fen}
      discount={pk.discount}
      onClose={() => {
        if (typeof window !== "undefined")
          window.location.href = "/account?tab=credits";
      }}
      onPaid={onPaid}
      onRefresh={createOrder}
    />
  );
}
