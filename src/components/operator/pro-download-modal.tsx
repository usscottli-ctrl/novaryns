"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, KeyRound, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { PayQrModal, type PayProvider } from "@/components/credits/pay-qr-modal";
import { RMB_PRO_LICENSE_FEN } from "@/lib/mock-data";

/**
 * Pro 授权弹窗 —— 官网直售自动发货(2026-07-03 起,替代爱发电主通道)。
 * 主流程:登录 → 支付宝/微信扫码付 ¥1,999 → 支付回调自动生成 License Key
 * (绑定买家邮箱)→ 轮询订单拿 Key → 验证换取一键部署命令。
 * 次流程:已有 Key 直接验证(POST /api/pro/redeem)。
 * 非购买站(海外官方站/自托管实例)引导到国内官方站;兜底 = 联系微信。
 */
const WECHAT_ID = "xingze063";
const BUY_HOST = "ai.starzeco.com";
const BUY_URL = `https://${BUY_HOST}/deploy`;

export function ProDownloadModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  const [code, setCode] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [copied, setCopied] = React.useState<"docker" | "license" | null>(null);
  const [info, setInfo] = React.useState<{
    licenseKey: string;
    dockerRun: string;
    expiresAt: string | null;
  } | null>(null);
  // 直售支付态
  const [creating, setCreating] = React.useState<PayProvider | null>(null);
  const [pay, setPay] = React.useState<{
    orderId: string;
    provider: PayProvider;
    qrContent: string;
  } | null>(null);
  // 是否就在购买站上(挂载后判 host,SSR 期间按“不是”渲染,避免水合不一致)
  const [onBuyHost, setOnBuyHost] = React.useState(false);
  React.useEffect(() => {
    setOnBuyHost(window.location.host === BUY_HOST);
  }, []);

  // 关闭时重置内部态,下次打开是干净流程。
  React.useEffect(() => {
    if (!open) {
      setCode("");
      setVerified(false);
      setVerifying(false);
      setCopied(null);
      setInfo(null);
      setCreating(null);
      setPay(null);
    }
  }, [open]);

  // 用 Key 换部署命令(购买到账与手动验证共用)。
  const redeem = React.useCallback(
    async (key: string, silent = false) => {
      setVerifying(true);
      try {
        const res = await fetch("/api/pro/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (!silent) toast(data.error || "验证失败", "error");
          return false;
        }
        setInfo({
          licenseKey: data.licenseKey,
          dockerRun: data.dockerRun,
          expiresAt: data.expiresAt ?? null,
        });
        setVerified(true);
        if (!silent) toast("授权有效", "success");
        return true;
      } catch {
        if (!silent) toast("网络异常,请稍后再试", "error");
        return false;
      } finally {
        setVerifying(false);
      }
    },
    [toast]
  );

  // 直售下单:创建 pro 订单拿扫码内容。
  async function buy(provider: PayProvider) {
    if (!user) return openAuth();
    setCreating(provider);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          kind: "pro",
          itemId: "pro-1y",
          method: provider,
        }),
      });
      const data = await res.json();
      if (res.ok && data.mode === "native" && data.qrContent) {
        setPay({
          orderId: String(data.orderId),
          provider,
          qrContent: String(data.qrContent),
        });
      } else {
        toast(data.error || "下单失败,请稍后再试或联系微信", "error");
      }
    } catch {
      toast("网络异常,请稍后再试", "error");
    } finally {
      setCreating(null);
    }
  }

  // 到账:轮询订单拿 licenseKey → 直接进入“已发货”视图。
  async function handlePaid() {
    if (!pay) return;
    for (let i = 0; i < 10; i++) {
      try {
        const r = await fetch(
          `/api/payments/order?id=${encodeURIComponent(pay.orderId)}`,
          { cache: "no-store" }
        );
        const d = await r.json();
        if (d.licenseKey) {
          setPay(null);
          setCode(d.licenseKey);
          await redeem(d.licenseKey, true);
          toast("购买成功,授权已发放", "success");
          return;
        }
      } catch {
        /* 单次失败重试 */
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    setPay(null);
    toast(`已到账,但拉取授权超时 —— 请联系微信 ${WECHAT_ID} 补发`, "error");
  }

  function copyText(text: string, key: "docker" | "license") {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
      },
      () => toast("复制失败,请手动选择", "error")
    );
  }

  const priceYuan = (RMB_PRO_LICENSE_FEN / 100).toLocaleString("zh-CN");

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <div className="pr-6">
        <h2 className="text-[18px] font-bold leading-tight text-c-text">
          获取 Pro 授权
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-c-text3">
          在线购买后系统自动发放 License Key(绑定你的账号邮箱);镜像公开,填入
          License Key 即解锁 Pro 全部能力。
        </p>
      </div>

      {!verified ? (
        <div className="mt-5 space-y-5">
          {/* 直售购买(仅购买站;其它实例引导过去) */}
          <div className="rounded-[12px] border border-acc/40 bg-acc-tint p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[13.5px] font-semibold text-c-text">
                Pro 商业授权 · 1 年
              </span>
              <span className="text-[20px] font-extrabold text-acc">
                ¥{priceYuan}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-c-text3">
              含商业授权(可闭源自用)· License Key 激活 · 优先支持。付款成功即时发放。
            </p>
            {onBuyHost ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  loading={creating === "alipay"}
                  disabled={!!creating}
                  onClick={() => buy("alipay")}
                >
                  支付宝购买
                </Button>
                <Button
                  variant="outline"
                  loading={creating === "wechat"}
                  disabled={!!creating}
                  onClick={() => buy("wechat")}
                >
                  微信支付购买
                </Button>
              </div>
            ) : (
              <Button variant="primary" className="mt-3 w-full" asChild>
                <a href={BUY_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  前往官方站购买
                </a>
              </Button>
            )}
            <p className="mt-2 flex items-center gap-1 text-[11.5px] text-c-text4">
              <MessageCircle className="h-3.5 w-3.5" />
              支付遇到问题?加微信 <b className="text-c-text3">{WECHAT_ID}</b>
              ,支持开具凭证。
            </p>
          </div>

          {/* 已有 Key:直接验证 */}
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-c-text2">
              已有 License Key?在此验证
            </label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim()) redeem(code.trim());
                }}
                placeholder="NOVA-XXXX-XXXX-XXXX-XXXX"
                className="flex-1 font-mono tracking-wide"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="outline"
                onClick={() => {
                  const t = code.trim();
                  if (!t) return toast("请先填写 License Key", "error");
                  redeem(t);
                }}
                loading={verifying}
                className="shrink-0"
              >
                验证
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 rounded-[10px] border border-c-success bg-c-tint-g px-3.5 py-2.5">
            <Check size={16} className="shrink-0 text-c-success" strokeWidth={2.6} />
            <span className="text-[12.5px] font-medium text-c-text2">
              授权有效
              {info?.expiresAt
                ? ` —— 有效期至 ${new Date(info.expiresAt).toLocaleDateString("zh-CN")}`
                : " —— 永久有效"}
            </span>
          </div>

          {/* Docker 一键部署 */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-c-text3">
              一键部署（填入下方 License Key 即解锁 Pro）
            </label>
            <div className="relative">
              <pre className="overflow-x-auto rounded-[10px] bg-[#15161B] p-3.5 pr-12 font-mono text-[12px] leading-relaxed text-[#E6E8EC]">
                {info?.dockerRun}
              </pre>
              <button
                type="button"
                onClick={() => copyText(info?.dockerRun ?? "", "docker")}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-[7px] bg-[rgba(255,255,255,.08)] px-2 py-1 text-[11px] font-medium text-[#E6E8EC] transition-colors hover:bg-[rgba(255,255,255,.16)]"
              >
                {copied === "docker" ? <Check size={12} /> : <Copy size={12} />}
                {copied === "docker" ? "已复制" : "复制"}
              </button>
            </div>
          </div>

          {/* License Key */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-c-text3">
              License Key
            </label>
            <div className="flex items-center gap-2 rounded-[10px] border border-c-border2 bg-c-subtle2 px-3.5 py-2.5">
              <KeyRound size={14} className="shrink-0 text-acc" />
              <span className="flex-1 select-all font-mono text-[13px] tracking-wide text-c-text">
                {info?.licenseKey}
              </span>
              <button
                type="button"
                onClick={() => copyText(info?.licenseKey ?? "", "license")}
                className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
              >
                {copied === "license" ? <Check size={12} /> : <Copy size={12} />}
                {copied === "license" ? "已复制" : "复制"}
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-c-text4">
              Key 已绑定你的账号邮箱并同步发放,部署后在「License Key
              激活」处填入即可解锁 Pro 全部能力;丢失可联系微信 {WECHAT_ID} 找回。
            </p>
          </div>
        </div>
      )}

      {/* 直售扫码支付弹窗 */}
      {pay && (
        <PayQrModal
          open={!!pay}
          orderId={pay.orderId}
          provider={pay.provider}
          qrContent={pay.qrContent}
          credits={0}
          bonus={0}
          fen={RMB_PRO_LICENSE_FEN}
          productTitle="Pro 商业授权(1 年)"
          onClose={() => setPay(null)}
          onPaid={() => void handlePaid()}
        />
      )}
    </Modal>
  );
}
