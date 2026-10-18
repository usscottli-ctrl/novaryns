"use client";
import { copyText } from "@/lib/clipboard";

import * as React from "react";
import {
  Check, Cloud, Copy, ExternalLink, MessageCircle, Loader2, CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { PayQrModal, type PayProvider } from "@/components/credits/pay-qr-modal";
import { subdomainError, normalizeSubdomain, CLOUD_BASE_DOMAIN, SALE_CLOUD_PLANS, type CloudPlan } from "@/lib/cloud";

/**
 * 云端托管开通弹窗。
 * - 购买站(ai.starzeco.com)上:自助流程 —— 选子域名 → 扫码支付 → 自动开通专属实例 →
 *   出访问地址 + 管理员初始密码(另发邮件)。见 docs/cloud-provisioning.md。
 * - 非购买站(海外官方站 / 自托管实例):引导到购买站开通,或加微信人工对接。
 */
const WECHAT_ID = "xingze063";
const CLOUD_BUY_HOST = "ai.starzeco.com";
const CLOUD_BUY_URL = `https://${CLOUD_BUY_HOST}/deploy`;

const BENEFITS = [
  "免部署 · 自动更新,无需自己的服务器",
  "大陆可用 · 无需自备中转,连模型开箱即通",
  "独立实例 · 专属子域名,可绑自有域名",
  "全白标:自有品牌名 / Logo,无平台署名",
  "每月含 1,000 算力积分(约 167 张),用完随时充值",
];

type Phase = "intro" | "provisioning" | "done" | "failed";
type Tenant = {
  status: string; subdomain: string; url: string | null;
  adminEmail: string; adminPassword: string | null; error: string | null;
};

export function CloudModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { openAuth } = useAuthModal();

  const [onBuyHost, setOnBuyHost] = React.useState(false);
  React.useEffect(() => { setOnBuyHost(window.location.host === CLOUD_BUY_HOST); }, []);

  // ── 表单 ──
  const [email, setEmail] = React.useState("");
  const [sub, setSub] = React.useState("");
  const [plan, setPlan] = React.useState<CloudPlan>(
    SALE_CLOUD_PLANS.find((p) => p.id === "yearly") ?? SALE_CLOUD_PLANS[0]
  ); // 默认年付
  const [checking, setChecking] = React.useState(false);
  const [avail, setAvail] = React.useState<boolean | null>(null);
  const [availMsg, setAvailMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState("");

  // ── 支付/开通 ──
  const [qr, setQr] = React.useState<{ orderId: string; provider: PayProvider; qrContent: string; fen: number } | null>(null);
  const [phase, setPhase] = React.useState<Phase>("intro");
  const [tenant, setTenant] = React.useState<Tenant | null>(null);
  const [failMsg, setFailMsg] = React.useState("");

  React.useEffect(() => { if (open && user?.email && !email) setEmail(user.email); }, [open, user, email]);

  // 打开时复位(除保留已填邮箱)
  React.useEffect(() => {
    if (!open) { setPhase("intro"); setQr(null); setTenant(null); setFailMsg(""); setSub(""); setAvail(null); setAvailMsg(null); }
  }, [open]);

  const fmtErr = sub ? subdomainError(sub) : null;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canBuy = emailOk && !fmtErr && avail === true && !busy;

  // 子域名可用性(去抖 450ms)
  React.useEffect(() => {
    const s = normalizeSubdomain(sub);
    setAvail(null); setAvailMsg(null);
    if (!s || subdomainError(s)) return;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cloud/check-name?name=${encodeURIComponent(s)}`, { cache: "no-store" });
        const d = await r.json();
        // 竞态保护:仅当输入未变时采纳
        setSub((cur) => { if (normalizeSubdomain(cur) === s) { setAvail(!!d.available); setAvailMsg(d.error || null); } return cur; });
      } catch { /* 忽略,交由下单/开通兜底 */ }
      finally { setChecking(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [sub]);

  const doCopy = async (text: string, tag: string) => {
    if (await copyText(text)) { setCopied(tag); toast("已复制", "success"); setTimeout(() => setCopied(""), 1500); }
    else toast("复制失败", "error");
  };

  const copyWechat = () => doCopy(WECHAT_ID, "wx");

  async function buy(method: PayProvider) {
    if (!canBuy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/payments/create", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, kind: "cloud", itemId: `${normalizeSubdomain(sub)}@${plan.id}`, method }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { toast(d.error || "下单失败", "error"); return; }
      setQr({ orderId: d.orderId, provider: d.provider, qrContent: d.qrContent, fen: d.amount });
    } catch { toast("下单失败,请重试", "error"); }
    finally { setBusy(false); }
  }

  // 支付成功 → 进入开通,轮询租户状态
  function onPaid() {
    const orderId = qr?.orderId;
    setQr(null);
    if (!orderId) return;
    setPhase("provisioning");
    // 触发开通(幂等;付款回调也会 fire-and-forget,这里确保一定启动)
    fetch("/api/cloud/provision", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    }).catch(() => {});
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/cloud/tenant?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const d = await r.json();
        const t: Tenant | null = d.tenant;
        if (t?.status === "active") { clearInterval(timer); setTenant(t); setPhase("done"); }
        else if (t?.status === "failed") { clearInterval(timer); setFailMsg(t.error || "开通失败"); setPhase("failed"); }
      } catch { /* keep polling */ }
      if (Date.now() - started > 12 * 60 * 1000) { clearInterval(timer); setFailMsg("开通超时,请联系客服"); setPhase("failed"); }
    }, 4000);
  }

  // ── 渲染:非购买站 = 引导 ──
  if (!onBuyHost) {
    return (
      <Modal open={open} onClose={onClose} width={460}>
        <Header />
        <ul className="mt-4 space-y-2">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13px] text-c-text2">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-c-blue" />{b}
            </li>
          ))}
        </ul>
        <Button variant="primary" className="mt-4 w-full" asChild>
          <a href={CLOUD_BUY_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />前往官方站开通云端
          </a>
        </Button>
        <Button variant="outline" className="mt-2 w-full" onClick={copyWechat}>
          {copied === "wx" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          或复制微信号 {WECHAT_ID}
        </Button>
        <p className="mt-2 flex items-center justify-center gap-1 text-[11.5px] text-c-text4">
          <MessageCircle className="h-3.5 w-3.5" />通过微信一对一开通,支持开具凭证
        </p>
      </Modal>
    );
  }

  // ── 渲染:购买站 = 自助流程 ──
  return (
    <>
      <Modal open={open && !qr} onClose={onClose} width={460}>
        {phase === "intro" && !user && (
          <>
            <Header />
            <ul className="mt-3.5 grid grid-cols-1 gap-1.5">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[12.5px] text-c-text2">
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-c-blue" />{b}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-xl bg-c-subtle2 p-4 text-center">
              <p className="text-[13px] text-c-text2">开通云端实例需先登录账号</p>
              <p className="mt-1 text-[12px] text-c-text3">登录后即可选择子域名并支付,实例的管理员账号即您登录所用的邮箱。</p>
              <Button variant="primary" className="mt-3 w-full" onClick={() => openAuth("sign-in")}>
                登录 / 注册后开通
              </Button>
            </div>
          </>
        )}

        {phase === "intro" && user && (
          <>
            <Header />
            <ul className="mt-3.5 grid grid-cols-1 gap-1.5">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[12.5px] text-c-text2">
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-c-blue" />{b}
                </li>
              ))}
            </ul>

            {/* 子域名 */}
            <div className="mt-4">
              <label className="text-[12px] font-semibold text-c-text2">选择你的专属子域名</label>
              <div className="mt-1.5 flex items-stretch overflow-hidden rounded-xl border border-c-border bg-c-card focus-within:border-c-blue">
                <input
                  value={sub}
                  onChange={(e) => setSub(e.target.value.toLowerCase())}
                  placeholder="yourbrand"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[14px] text-c-text outline-none"
                />
                <span className="flex items-center whitespace-nowrap border-l border-c-border bg-c-subtle2 px-3 text-[12.5px] text-c-text3">
                  .{CLOUD_BASE_DOMAIN}
                </span>
              </div>
              <div className="mt-1 min-h-[16px] text-[11.5px]">
                {fmtErr ? <span className="text-c-danger">{fmtErr}</span>
                  : checking ? <span className="text-c-text4">检查可用性…</span>
                  : avail === true ? <span className="text-c-success">✓ 可用</span>
                  : avail === false ? <span className="text-c-danger">{availMsg || "已被占用"}</span>
                  : <span className="text-c-text4">3-30 位小写字母 / 数字 / 短横线</span>}
              </div>
            </div>

            {/* 接收邮箱(= 管理员账号) */}
            <div className="mt-2">
              <label className="text-[12px] font-semibold text-c-text2">管理员邮箱(登录账号 + 凭证接收)</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-xl border border-c-border bg-c-card px-3 py-2 text-[14px] text-c-text outline-none focus:border-c-blue"
              />
            </div>

            {/* 价格 + 支付 */}
            {/* 套餐:2026-09-15 起只卖年付 ¥3,999(月付已下架,见 lib/cloud.ts) */}
            <div className={`mt-4 grid gap-2 ${SALE_CLOUD_PLANS.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {SALE_CLOUD_PLANS.map((p) => {
                const on = p.id === plan.id;
                const yearly = p.id === "yearly";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={`relative rounded-xl border p-3 text-left transition-colors ${
                      on ? "border-c-blue bg-c-tint-b" : "border-c-border bg-c-card hover:border-c-text4"
                    }`}
                  >
                    {yearly && SALE_CLOUD_PLANS.length > 1 && (
                      <span className="absolute -top-2 right-2 rounded-full bg-acc px-2 py-0.5 text-[10.5px] font-bold text-white">
                        省 17%
                      </span>
                    )}
                    <p className="text-[12px] text-c-text3">{p.label}</p>
                    <p className="mt-0.5 text-[20px] font-bold leading-none text-c-text">
                      ¥{(p.fen / 100).toLocaleString("zh-CN")}
                      <span className="ml-1 text-[12px] font-normal text-c-text3">
                        /{yearly ? "年" : "月"}
                      </span>
                    </p>
                    <p className="mt-1 text-[11.5px] text-c-text3">
                      含 {p.credits.toLocaleString("zh-CN")} 积分
                      {yearly && <span className="text-c-text4">(每月 1,000)</span>}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="primary" disabled={!canBuy} onClick={() => buy("alipay")}
                style={{ background: "#1677FF" }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}支付宝支付
              </Button>
              <Button variant="primary" disabled={!canBuy} onClick={() => buy("wechat")}
                style={{ background: "#07C160" }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}微信支付
              </Button>
            </div>
            <p className="mt-2.5 text-center text-[11px] text-c-text4">
              支付即代表同意《服务条款》· 开通约需 2–5 分钟
            </p>
          </>
        )}

        {phase === "provisioning" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-c-blue" strokeWidth={1.8} />
            <p className="text-[15px] font-semibold text-c-text">正在开通您的专属实例…</p>
            <p className="max-w-[320px] text-[12.5px] leading-relaxed text-c-text3">
              正在构建独立实例、配置算力与域名证书,约需 2–5 分钟。请勿关闭页面;
              开通完成后凭证也会发送到 <b className="text-c-text2">{email}</b>。
            </p>
          </div>
        )}

        {phase === "done" && tenant && (
          <div className="py-2">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-12 w-12 text-c-success" strokeWidth={1.8} />
              <p className="text-[16px] font-bold text-c-text">开通成功 🎉</p>
              <p className="text-[12.5px] text-c-text3">您的云端专属实例已就绪,可立即登录使用。</p>
            </div>
            <div className="mt-4 space-y-2 rounded-xl bg-c-subtle2 p-3.5 text-[13px]">
              <Row label="访问地址" value={tenant.url || ""} onCopy={() => doCopy(tenant.url || "", "url")} copied={copied === "url"} link />
              <Row label="管理员账号" value={tenant.adminEmail} onCopy={() => doCopy(tenant.adminEmail, "acc")} copied={copied === "acc"} />
              <Row label="初始密码" value={tenant.adminPassword || "—"} onCopy={() => doCopy(tenant.adminPassword || "", "pw")} copied={copied === "pw"} mono />
            </div>
            <p className="mt-2.5 text-[11.5px] text-c-warn">⚠️ 请首次登录后尽快修改初始密码。凭证已同时发送到您的邮箱。</p>
            <Button variant="primary" className="mt-3 w-full" asChild>
              <a href={tenant.url || "#"} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />前往我的实例
              </a>
            </Button>
          </div>
        )}

        {phase === "failed" && (
          <div className="py-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-c-danger" strokeWidth={1.8} />
            <p className="mt-2 text-[15px] font-semibold text-c-text">开通未完成</p>
            <p className="mx-auto mt-1 max-w-[320px] text-[12.5px] leading-relaxed text-c-text3">
              {failMsg || "开通过程出现问题"}。您已成功付款,请加微信 <b className="text-c-text2">{WECHAT_ID}</b> 联系客服,我们会尽快为您开通或处理。
            </p>
            <Button variant="outline" className="mt-3 w-full" onClick={copyWechat}>
              {copied === "wx" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}复制微信号 {WECHAT_ID}
            </Button>
          </div>
        )}
      </Modal>

      {qr && (
        <PayQrModal
          open={!!qr}
          orderId={qr.orderId}
          provider={qr.provider}
          qrContent={qr.qrContent}
          credits={0}
          bonus={0}
          fen={qr.fen}
          productTitle={`云端托管 ${normalizeSubdomain(sub)}.${CLOUD_BASE_DOMAIN}(${plan.label})`}
          onClose={() => setQr(null)}
          onPaid={onPaid}
        />
      )}
    </>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-c-tint-b">
        <Cloud className="h-5 w-5 text-c-blue" />
      </span>
      <div>
        <h3 className="text-[16px] font-bold text-c-text">云端托管开通</h3>
        <p className="text-[12.5px] text-c-text3">
          <span className="font-bold text-c-text">¥3,999</span> /年 · 免运维 · 自动开通
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, onCopy, copied, link, mono }: {
  label: string; value: string; onCopy: () => void; copied: boolean; link?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] flex-none text-c-text3">{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-c-blue hover:underline">{value}</a>
      ) : (
        <span className={`min-w-0 flex-1 truncate text-c-text ${mono ? "font-mono" : ""}`}>{value}</span>
      )}
      <button type="button" onClick={onCopy} className="flex-none rounded-md p-1 text-c-text3 hover:bg-c-subtle hover:text-c-text">
        {copied ? <Check className="h-3.5 w-3.5 text-c-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
