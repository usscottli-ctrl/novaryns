"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, Zap, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { fmtCredits } from "@/lib/mock-data";

export type PayProvider = "alipay" | "wechat";

/**
 * 共用「原生支付二维码」弹窗(纯前端 UI,支付逻辑/接口在调用方)。
 * 自上而下:充值积分头部 → 支付倒计时行 → 价格行 → 二维码 → 说明 → 取消 → 页脚。
 * - 轮询 /api/payments/order?id= 到 paid → 成功态 + onPaid + 1.5s 自动关闭。
 * - 15 分钟倒计时;到 0 显示「二维码已过期」+ 刷新(调 onRefresh 重新下单)。
 * - 无加赠(bonus<=0)时只显示实付价,不显示划线原价/折扣标签。
 */
export function PayQrModal({
  open,
  orderId,
  provider,
  qrContent,
  credits,
  bonus,
  fen,
  discount,
  onClose,
  onPaid,
  onRefresh,
  productTitle,
}: {
  open: boolean;
  orderId: string;
  provider: PayProvider;
  qrContent: string;
  credits: number; // 到账总积分(基础 + 加赠)
  bonus: number; // 加赠积分
  fen: number; // 实付金额(分)
  discount?: string; // 折扣标签,如「约 8 折」(仅有加赠时显示)
  onClose: () => void;
  onPaid: () => void; // 到账回调(刷新积分)
  onRefresh?: () => void; // 过期后重新下单
  productTitle?: string; // 非积分商品(如 Pro 授权):覆盖标题区文案,隐藏积分行
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [qrImg, setQrImg] = React.useState<string | null>(null);
  const [paid, setPaid] = React.useState(false);
  const [remain, setRemain] = React.useState(15 * 60); // 秒
  const deadlineRef = React.useRef(0);

  const hasBonus = bonus > 0;
  const wechat = provider === "wechat";
  const yuan = fen / 100;
  // 原价基准:10 积分 = ¥1(见 mock-data PACK 定义)。
  const originYuan = credits / 10;
  const fmtYuan = (v: number) =>
    `¥${Number.isInteger(v) ? v : v.toFixed(2)}`;

  // 锁滚动 + ESC 关闭
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // 重新下单(orderId/qrContent 变)时复位倒计时 + 成功态
  React.useEffect(() => {
    if (!open) return;
    setPaid(false);
    deadlineRef.current = Date.now() + 15 * 60 * 1000;
    setRemain(15 * 60);
  }, [open, orderId, qrContent]);

  // 渲染二维码
  React.useEffect(() => {
    if (!open || !qrContent) return;
    let stop = false;
    setQrImg(null);
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(qrContent, { width: 176, margin: 0 });
        if (!stop) setQrImg(url);
      } catch {
        /* 渲染失败时下方维持 loading;用户可关闭重试 */
      }
    })();
    return () => {
      stop = true;
    };
  }, [open, qrContent]);

  // 15 分钟倒计时
  React.useEffect(() => {
    if (!open || paid) return;
    const tick = () =>
      setRemain(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, paid, orderId]);

  // 轮询订单状态(每 2.5s),到账 → 成功态 + onPaid + 1.5s 自动关闭
  React.useEffect(() => {
    if (!open || paid || !orderId) return;
    let stop = false;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/payments/order?id=${encodeURIComponent(orderId)}`,
          { cache: "no-store" }
        );
        const d = await r.json();
        if (!stop && d.status === "paid") {
          clearInterval(poll);
          setPaid(true);
          onPaid();
          setTimeout(() => {
            if (!stop) onClose();
          }, 1500);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => {
      stop = true;
      clearInterval(poll);
    };
  }, [open, paid, orderId, onPaid, onClose]);

  if (!mounted || !open) return null;

  const expired = remain <= 0 && !paid;
  const mm = Math.floor(remain / 60);
  const ss = String(remain % 60).padStart(2, "0");

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-[rgba(22,24,29,.5)] backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 400, maxWidth: "100%" }}
        className="nv-menu-down relative z-10 max-h-[92vh] overflow-auto rounded-card bg-c-card p-6 shadow-pop"
      >
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-c-text">
              {productTitle ?? L("充值积分", "Top Up Credits")}
            </h2>
            <p className="mt-1 text-[12.5px] text-c-text3">
              {productTitle
                ? L("扫码支付,支付成功后自动发放", "Scan to pay — delivered automatically")
                : (
                  <>
                    {L(`${fmtCredits(credits)} 积分`, `${fmtCredits(credits)} credits`)}
                    {hasBonus && (
                      <>
                        {" · "}
                        {L(`含赠 ${fmtCredits(bonus)}`, `incl. ${fmtCredits(bonus)} bonus`)}
                      </>
                    )}
                  </>
                )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={L("关闭", "Close")}
            className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-[9px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
          >
            <X size={17} />
          </button>
        </div>

        {paid ? (
          /* 支付成功态 */
          <div className="flex flex-col items-center gap-3 py-10">
            <CheckCircle2 className="h-14 w-14 text-c-success" strokeWidth={1.8} />
            <p className="text-[15px] font-semibold text-c-text">
              {L("支付成功 · 已到账", "Paid · Credits added")}
            </p>
          </div>
        ) : (
          <>
            {/* 支付倒计时行 */}
            <div className="mt-5 flex items-center justify-center gap-2 text-[12.5px] text-acc">
              <span
                className="grid h-[18px] w-[18px] place-items-center rounded-[5px] text-[11px] font-bold text-white"
                style={{ background: wechat ? "#07C160" : "#1677FF" }}
              >
                {wechat ? "微" : "支"}
              </span>
              {expired ? (
                <span className="text-c-text3">
                  {L("二维码已过期", "QR code expired")}
                </span>
              ) : (
                <span>
                  {L(
                    `请在 ${mm}:${ss} 内扫码完成支付`,
                    `Scan to pay within ${mm}:${ss}`
                  )}
                </span>
              )}
            </div>

            {/* 价格行 */}
            <div className="mt-3 flex items-baseline justify-center gap-2">
              <span className="text-[28px] font-bold leading-none text-acc">
                {fmtYuan(yuan)}
              </span>
              {hasBonus && (
                <>
                  <span className="text-[14px] text-c-text4 line-through">
                    {fmtYuan(originYuan)}
                  </span>
                  {discount && (
                    <span className="rounded-full bg-c-tint-g px-2 py-0.5 text-[11px] font-semibold text-c-success">
                      {discount}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 二维码 */}
            <div className="mt-5 flex justify-center">
              <div className="grid h-[200px] w-[200px] place-items-center rounded-[12px] bg-white p-3">
                {expired ? (
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={!onRefresh}
                    className="flex flex-col items-center gap-2 text-[12.5px] font-medium text-[#5b6b66] disabled:opacity-50"
                  >
                    <RefreshCw className="h-6 w-6" />
                    {L("刷新", "Refresh")}
                  </button>
                ) : qrImg ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={qrImg}
                    alt={L("支付二维码", "Payment QR code")}
                    width={176}
                    height={176}
                    className="h-[176px] w-[176px]"
                  />
                ) : (
                  <Loader2 className="h-7 w-7 animate-spin text-acc" />
                )}
              </div>
            </div>

            {/* 说明 */}
            <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-c-text3">
              <Zap className="h-3.5 w-3.5 text-c-success" />
              {L(
                "扫码后自动到账 · 不支持退款",
                "Auto-credited after scan · non-refundable"
              )}
            </p>

            {/* 取消支付 */}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full text-center text-[12.5px] text-c-text3 transition-colors hover:text-c-text2"
            >
              {L("取消支付", "Cancel payment")}
            </button>
          </>
        )}

        {/* 页脚 */}
        <div className="mt-5 border-t border-c-border2 pt-4 text-center text-[11px] text-c-text4">
          {L("支付即代表同意 ", "By paying you agree to the ")}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-c-text2 hover:underline"
          >
            {L("《服务条款》", "Terms of Service")}
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}
