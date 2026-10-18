"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Zap, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { PayQrModal, type PayProvider } from "@/components/credits/pay-qr-modal";
import { COMPUTE_PACKS } from "@/lib/cloud";

const fmtYuan = (fen: number) => `¥${(fen / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const fmtCredits = (n: number) => n.toLocaleString("zh-CN");

type Balance = { status: string; quotaTotal: number; quotaUsed: number; quotaLeft: number | null; issuedTotal?: number; issuable?: number | null };

function ComputeInner() {
  const params = useSearchParams();
  const token = (params.get("token") || "").trim().toLowerCase();
  const { toast } = useToast();
  const { user } = useAuth();

  const [balance, setBalance] = React.useState<Balance | null | "loading" | "notfound">("loading");
  const [packId, setPackId] = React.useState(COMPUTE_PACKS[1]?.id ?? COMPUTE_PACKS[0]?.id ?? "");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [qr, setQr] = React.useState<{ orderId: string; provider: PayProvider; qrContent: string; fen: number } | null>(null);
  const [paidOk, setPaidOk] = React.useState(false);

  const tokenValid = /^[0-9a-f]{16}$/.test(token);
  // 可发放 = 已购买 − 已发放。老版本 relay 没有 issued_total → 退回"还能烧多少"。
  const issuable =
    typeof balance === "object" && balance !== null
      ? balance.issuable === null
        ? null
        : (balance.issuable ?? balance.quotaLeft)
      : null;

  // 「接收凭证邮箱」默认值:**租户站长邮箱优先**(租户后台经 URL fragment 传过来),
  // 没有才退回本站登录用户。以前只认后者 —— 客户在自己站点点「充值算力」,看到的却是
  // 购买站上碰巧登录的那个邮箱(或空白)。
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const m = /(?:^|[#&])email=([^&]+)/.exec(window.location.hash || "");
    if (!m) return;
    try {
      setEmail(decodeURIComponent(m[1]).trim());
    } catch {
      /* 坏值忽略,用户自己填 */
    }
    // 读完抹掉 hash:别把邮箱留在地址栏和浏览历史里
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  // 兜底:本站登录用户。用函数式更新,不会盖掉上面已填好的租户邮箱。
  React.useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email);
  }, [user]);

  const loadBalance = React.useCallback(async () => {
    if (!tokenValid) { setBalance("notfound"); return; }
    try {
      const r = await fetch(`/api/compute/balance?token=${token}`, { cache: "no-store" });
      if (!r.ok) { setBalance("notfound"); return; }
      setBalance(await r.json());
    } catch { setBalance("notfound"); }
  }, [token, tokenValid]);

  React.useEffect(() => { loadBalance(); }, [loadBalance]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pack = COMPUTE_PACKS.find((p) => p.id === packId) ?? null;
  const canBuy = tokenValid && emailOk && !!pack && !busy && balance !== "notfound";

  async function buy(method: PayProvider) {
    if (!canBuy || !pack) return;
    setBusy(true);
    try {
      const r = await fetch("/api/payments/create", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, kind: "compute", itemId: `${pack.id}:${token}`, method }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { toast(d.error || "下单失败", "error"); return; }
      setQr({ orderId: d.orderId, provider: d.provider, qrContent: d.qrContent, fen: d.amount });
    } catch { toast("下单失败,请重试", "error"); }
    finally { setBusy(false); }
  }

  function onPaid() {
    setQr(null); setPaidOk(true);
    // 到账有 30s 内存 flush + 秒级充值,轮询余额刷新展示
    let n = 0;
    const t = setInterval(() => { loadBalance(); if (++n >= 5) clearInterval(t); }, 2500);
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-c-tint-b">
          <Zap className="h-5.5 w-5.5 text-c-blue" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-c-text">云端算力充值</h1>
          <p className="text-[12.5px] text-c-text3">给你的云端托管实例充值算力积分 · 单价按模型与分辨率计:1K 6 积分起、4K 23 积分</p>
        </div>
      </div>

      {/* 余额卡 */}
      <div className="mt-5 rounded-2xl border border-c-border bg-c-card p-4">
        {balance === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-c-text3"><Loader2 className="h-4 w-4 animate-spin" />查询余额…</div>
        ) : balance === "notfound" || balance === null || !tokenValid ? (
          <div className="flex items-start gap-2 text-sm text-c-text2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-c-danger" />
            <span>未识别到有效的实例算力凭据。请从你实例后台的「接口与模型 → 算力」卡片点击「去充值」进入本页。</span>
          </div>
        ) : (
          <div className="flex items-baseline justify-between">
            <div>
              {/* 主数字 = **可发放**(还能发给用户多少),与实例后台「算力」卡片同口径。
                  以前这里显示 quotaLeft(还能烧多少)—— 两处数字不一样,站长会以为哪边错了。
                  已发到用户钱包的那部分虽然还没烧,但已经不能再发第二次。 */}
              <p className="text-[12px] text-c-text3">可发放算力</p>
              <p className="mt-0.5 text-[26px] font-bold leading-none text-c-text">
                {issuable === null ? "不限量" : fmtCredits(issuable)}
                {issuable !== null && <span className="ml-1 text-[13px] font-normal text-c-text3">积分 ≈ {Math.floor(issuable / 6)} 张 1K / {Math.floor(issuable / 23)} 张 4K</span>}
              </p>
              {issuable !== null && (
                <p className="mt-1 text-[12px] text-c-text3">
                  已发放到用户钱包 {fmtCredits(balance.issuedTotal ?? 0)} · 实例剩余可用 {balance.quotaLeft === null ? "不限量" : fmtCredits(balance.quotaLeft)}
                </p>
              )}
            </div>
            {balance.status !== "active" && (
              <span className="rounded-full bg-c-tint-r px-2.5 py-1 text-[12px] font-medium text-c-danger">已停用</span>
            )}
          </div>
        )}
      </div>

      {paidOk && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-c-tint-g p-3.5 text-[13.5px] text-c-success">
          <CheckCircle2 className="h-4.5 w-4.5 flex-none" />支付成功,算力已充值到账(余额稍后自动刷新)。
        </div>
      )}

      {/* 算力包 */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {COMPUTE_PACKS.map((p) => {
          const active = p.id === packId;
          // ⚠️ 别只按 6 积分折算:6 分只是 GPT 1K,4K 要 23 分 —— 只显示 1K 会让
          // 4K 用户以为能出 4 倍的图(客户已因此质疑过账单)。两档都给出。
          const per1K = (p.fen / 100 / (p.credits / 6)).toFixed(2);
          const per4K = (p.fen / 100 / (p.credits / 23)).toFixed(2);
          return (
            <button
              key={p.id} type="button" onClick={() => setPackId(p.id)}
              className={`rounded-xl border p-3.5 text-left transition-colors ${active ? "border-c-blue bg-c-tint-b" : "border-c-border bg-c-card hover:border-c-text4"}`}
            >
              <p className="text-[16px] font-bold text-c-text">{fmtCredits(p.credits)} 积分</p>
              <p className="mt-0.5 text-[12px] text-c-text3">1K ≈ {fmtCredits(Math.floor(p.credits / 6))} 张(¥{per1K}/张)<br />4K ≈ {fmtCredits(Math.floor(p.credits / 23))} 张(¥{per4K}/张)</p>
              <p className="mt-1.5 text-[15px] font-semibold text-acc">{fmtYuan(p.fen)}</p>
            </button>
          );
        })}
      </div>

      {/* 邮箱 + 支付 */}
      <div className="mt-4">
        <label className="text-[12px] font-semibold text-c-text2">接收凭证邮箱</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())}
          placeholder="you@example.com"
          className="mt-1.5 w-full rounded-xl border border-c-border bg-c-card px-3 py-2 text-[14px] text-c-text outline-none focus:border-c-blue"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="primary" disabled={!canBuy} onClick={() => buy("alipay")} style={{ background: "#1677FF" }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}支付宝支付
        </Button>
        <Button variant="primary" disabled={!canBuy} onClick={() => buy("wechat")} style={{ background: "#07C160" }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}微信支付
        </Button>
      </div>
      <p className="mt-3 text-center text-[11.5px] text-c-text4">
        支付成功后配额自动充入你的实例,无需其它操作 · 想改用自己的模型 Key?在实例后台「接口与模型」填入即可,余额保留不清零
      </p>

      {qr && pack && (
        <PayQrModal
          open={!!qr} orderId={qr.orderId} provider={qr.provider} qrContent={qr.qrContent}
          credits={0} bonus={0} fen={qr.fen}
          productTitle={`云端算力包 ${fmtCredits(pack.credits)} 积分`}
          onClose={() => setQr(null)} onPaid={onPaid}
        />
      )}
    </div>
  );
}

export function ComputeClient() {
  return (
    <React.Suspense fallback={<div className="p-10 text-center text-sm text-c-text3">加载中…</div>}>
      <ComputeInner />
    </React.Suspense>
  );
}
