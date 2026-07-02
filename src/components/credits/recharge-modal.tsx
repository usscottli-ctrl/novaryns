"use client";

import * as React from "react";
import { Check, Loader2, Gift } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useRecharge } from "@/lib/recharge-modal-context";
import { useToast } from "@/components/ui/toast";
import { authHeader } from "@/lib/supabase";
import { CREDIT_PACKS, fmtCredits } from "@/lib/mock-data";
import { usePaymentConfig } from "@/lib/payment-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { PayQrModal } from "@/components/credits/pay-qr-modal";

type PayMethod = "alipay" | "wechat";

export function RechargeModal() {
  const { open, tab, closeRecharge, setTab } = useRecharge();
  const { user, remaining, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useI18n();
  const { rechargeEnabled, pro } = usePaymentConfig();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const [packIdx, setPackIdx] = React.useState(1);
  const [method, setMethod] = React.useState<PayMethod>("alipay");
  const [buying, setBuying] = React.useState(false);

  // 原生模式扫码支付:拿到 qrContent 后交给共用 PayQrModal 渲染二维码 + 轮询到账。
  const [pay, setPay] = React.useState<{
    orderId: string;
    provider: PayMethod;
    qrContent: string;
  } | null>(null);

  // 兑换码
  const [code, setCode] = React.useState("");
  const [redeeming, setRedeeming] = React.useState(false);
  const [result, setResult] = React.useState<
    { ok: true; credits: number } | { ok: false; msg: string } | null
  >(null);

  const pack = CREDIT_PACKS[packIdx] ?? CREDIT_PACKS[0];

  async function buy() {
    if (!user) {
      openAuth("sign-up");
      return;
    }
    setBuying(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          kind: "pack",
          itemId: pack.id,
          method,
        }),
      });
      const data = await res.json();
      // 原生模式:拿 qrContent 交给 PayQrModal 渲染二维码 + 轮询到账。
      if (res.ok && data.mode === "native" && data.qrContent) {
        setPay({
          orderId: data.orderId,
          provider: (data.provider as PayMethod) ?? method,
          qrContent: String(data.qrContent),
        });
        setBuying(false);
        return;
      }
      toast(data.error || L("下单失败,请稍后再试", "Failed to place order, please try again later"), "error");
      setBuying(false);
    } catch {
      toast(L("网络异常,请稍后再试", "Network error, please try again later"), "error");
      setBuying(false);
    }
  }

  // 到账后刷新积分余额(拉一次账户数据)。供 PayQrModal onPaid 调用。
  const refreshCredits = React.useCallback(async () => {
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

  // 关闭充值弹窗时清掉扫码态。
  React.useEffect(() => {
    if (!open) setPay(null);
  }, [open]);

  async function redeem() {
    if (!user) {
      openAuth("sign-up");
      return;
    }
    const c = code.trim();
    if (!c) return;
    setRedeeming(true);
    setResult(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json();
      if (res.ok && data.credits) {
        setResult({ ok: true, credits: data.credits });
        setCode("");
        toast(L(`兑换成功,到账 ${fmtCredits(data.credits)} 积分`, `Redeemed successfully, ${fmtCredits(data.credits)} credits added`), "success");
        if (data.user) applyServerUser(data.user);
      } else {
        setResult({ ok: false, msg: data.error || L("兑换码无效或已被使用", "Invalid or already used redemption code") });
      }
    } catch {
      setResult({ ok: false, msg: L("网络异常,请稍后再试", "Network error, please try again later") });
    } finally {
      setRedeeming(false);
    }
  }

  // 兑换码格式化:大写 + 每 4 位插 -(NOVA-XXXX-XXXX-XXXX)
  function onCodeChange(v: string) {
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const parts = raw.match(/.{1,4}/g) ?? [];
    setCode(parts.join("-"));
    setResult(null);
  }

  return (
    <>
      <Modal open={open} onClose={closeRecharge} width={520}>
      <h2 className="text-[18px] font-bold text-c-text">{L("充值积分", "Top Up Credits")}</h2>
      <p className="mt-1 text-[12.5px] text-c-text3">
        {L(
          `当前余额 ${fmtCredits(remaining)} 积分 · 按量消耗`,
          `Current balance ${fmtCredits(remaining)} credits · pay as you go`
        )}
      </p>

      {/* 未开在线充值的站点(海外站)只留兑换码,不显示 tab 切换 */}
      {rechargeEnabled && (
        <Segmented<"pay" | "code">
          className="mt-4"
          value={tab}
          onChange={setTab}
          options={[
            { value: "pay", label: L("在线充值", "Online Top-Up") },
            { value: "code", label: L("兑换码", "Redemption Code") },
          ]}
        />
      )}

      {!pro ? (
        <div className="mt-4 rounded-[10px] bg-c-subtle px-3 py-6 text-center text-[12.5px] text-c-text3">
          {L("该功能为 Pro 版功能。", "This is a Pro-only feature.")}
        </div>
      ) : rechargeEnabled && tab === "pay" ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2.5">
            {CREDIT_PACKS.map((p, i) => {
              const sel = i === packIdx;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPackIdx(i)}
                  className={cn(
                    "relative rounded-[12px] border p-3 text-left transition-colors",
                    sel
                      ? "border-[1.5px] border-acc bg-acc-tint"
                      : "border-c-border2 bg-c-card hover:bg-c-subtle2"
                  )}
                >
                  {i === 1 && (
                    <span className="absolute -top-2 right-2.5 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold text-white [background:var(--grad-acc)]">
                      {L("最划算", "Best Value")}
                    </span>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span className="text-[19px] font-bold tabular-nums text-c-text">
                      {fmtCredits(p.credits)}
                    </span>
                    <span className="text-[11px] text-c-text3">{L("积分", "credits")}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-c-text">{p.price}</span>
                    {p.bonus > 0 && (
                      <span className="rounded-[4px] bg-c-tint-g px-1 py-0.5 text-[10px] font-bold text-c-success">
                        {L(`赠 ${fmtCredits(p.bonus)}`, `+${fmtCredits(p.bonus)} bonus`)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 支付方式 */}
          <p className="mb-2 mt-4 text-[12.5px] font-medium text-c-text2">{L("支付方式", "Payment Method")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {([
              { id: "wechat", label: L("微信支付", "WeChat Pay"), color: "#1AAD19" },
              { id: "alipay", label: L("支付宝", "Alipay"), color: "#1677FF" },
            ] as const).map((m) => {
              const sel = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "flex items-center justify-between rounded-[10px] border px-3 py-2.5 text-[13px] font-medium transition-colors",
                    sel ? "border-[1.5px] border-acc bg-acc-tint" : "border-c-border2 hover:bg-c-subtle2"
                  )}
                >
                  <span className="flex items-center gap-2 text-c-text">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                    {m.label}
                  </span>
                  {sel && <Check className="h-4 w-4 text-acc" />}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <span className="text-[13px] text-c-text2">
              {L("实付", "Total")} <span className="text-[17px] font-bold text-acc">{pack.price}</span>
            </span>
            <Button variant="primary" loading={buying} onClick={buy}>
              {L("立即支付", "Pay Now")}
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-c-text4">
            {L("不支持退款", "Non-refundable")}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder="NOVA-XXXX-XXXX-XXXX"
              maxLength={19}
              inputMode="text"
              className="h-[42px] flex-1 rounded-[10px] border border-c-border2 bg-c-subtle2 px-3 font-mono text-[13.5px] tracking-wider text-c-text placeholder:text-c-text4 focus-visible:border-acc focus-visible:bg-c-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,70,229,.12)]"
            />
            <Button variant="primary" disabled={!code.trim() || redeeming} onClick={redeem}>
              {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : L("兑换", "Redeem")}
            </Button>
          </div>

          {result?.ok && (
            <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-c-border bg-c-tint-g px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-c-success text-white">
                <Check className="h-5 w-5" strokeWidth={2.6} />
              </span>
              <div>
                <p className="text-[13.5px] font-semibold text-c-text">{L("兑换成功", "Redeemed Successfully")}</p>
                <p className="text-[12px] text-c-text3">
                  {L(`到账 ${fmtCredits(result.credits)} 积分`, `${fmtCredits(result.credits)} credits added`)}
                </p>
              </div>
            </div>
          )}
          {result && !result.ok && (
            <div className="mt-3 rounded-[12px] border border-c-border bg-c-tint-r px-4 py-3 text-[13px] text-c-danger">
              {result.msg}
            </div>
          )}

          <div className="mt-4 rounded-[12px] bg-c-subtle2 p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-c-text2">
              <Gift className="h-4 w-4 text-acc" /> {L("如何获取兑换码?", "How to get a redemption code?")}
            </p>
            <ul className="space-y-1.5 text-[12px] text-c-text3">
              <li>{L("· 参加官方活动、社群福利获得", "· Earn it through official campaigns and community perks")}</li>
              <li>{L("· 企业 / 团队批量采购发放", "· Issued via enterprise / team bulk purchases")}</li>
              <li>{L("· 客服补偿或推广合作赠送", "· Gifted as support compensation or promotional partnerships")}</li>
            </ul>
          </div>
          <p className="mt-2 text-center text-[11px] text-c-text4">
            {L("每个兑换码仅可使用一次", "Each code can be used only once")}
          </p>
        </div>
      )}
      </Modal>

      {/* 共用扫码支付弹窗(原生支付宝/微信二维码 + 轮询到账) */}
      {pay && (
        <PayQrModal
          open={!!pay}
          orderId={pay.orderId}
          provider={pay.provider}
          qrContent={pay.qrContent}
          credits={pack.credits}
          bonus={pack.bonus}
          fen={pack.fen}
          discount={pack.discount}
          onClose={() => setPay(null)}
          onPaid={refreshCredits}
          onRefresh={buy}
        />
      )}
    </>
  );
}
