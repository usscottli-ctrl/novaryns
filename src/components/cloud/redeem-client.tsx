"use client";

import * as React from "react";
import {
  Cloud, Check, Copy, ExternalLink, Loader2, CheckCircle2, AlertCircle,
  Ticket, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import {
  subdomainError, normalizeSubdomain, CLOUD_BASE_DOMAIN,
} from "@/lib/cloud";

/**
 * 云端托管「开通码」自助核销页(买家侧,无需登录 —— 码本身就是凭据)。
 *
 * 渠道(淘宝)拍下 → 自动发货发一串开通码 → 买家打开本页填子域名 + 管理员邮箱 →
 * 后端核销码并合成一张已付 cloud 订单 → 复用与线上支付完全一致的开通链路。
 * 这样店家全程不用手工问买家要资料,钱仍在渠道侧收(保住平台担保交易的信任背书)。
 */

const WECHAT_ID = "xingze063";

type Plan = { id: string; label: string; days: number; credits: number };
type Tenant = {
  status: string; subdomain: string; url: string | null;
  adminEmail: string; adminPassword: string | null; error: string | null;
};
type Step = "code" | "form" | "provisioning" | "done" | "failed";

export function RedeemClient({ initialCode }: { initialCode: string }) {
  const { toast } = useToast();

  const [step, setStep] = React.useState<Step>("code");
  const [code, setCode] = React.useState(initialCode);
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const [email, setEmail] = React.useState("");
  const [sub, setSub] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [avail, setAvail] = React.useState<boolean | null>(null);
  const [availMsg, setAvailMsg] = React.useState<string | null>(null);

  const [tenant, setTenant] = React.useState<Tenant | null>(null);
  const [failMsg, setFailMsg] = React.useState("");
  const [copied, setCopied] = React.useState("");

  const doCopy = async (text: string, tag: string) => {
    if (await copyText(text)) {
      setCopied(tag); toast("已复制", "success"); setTimeout(() => setCopied(""), 1500);
    } else toast("复制失败", "error");
  };

  // ── 子域名可用性(去抖 450ms,与 CloudModal 同款)──
  React.useEffect(() => {
    const s = normalizeSubdomain(sub);
    setAvail(null); setAvailMsg(null);
    if (!s || subdomainError(s)) return;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cloud/check-name?name=${encodeURIComponent(s)}`, { cache: "no-store" });
        const d = await r.json();
        // 竞态保护:仅当输入未变时采纳结果
        setSub((cur) => {
          if (normalizeSubdomain(cur) === s) { setAvail(!!d.available); setAvailMsg(d.error || null); }
          return cur;
        });
      } catch { /* 忽略,交由核销阶段兜底 */ }
      finally { setChecking(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [sub]);

  // ── 第一步:验码 ──
  async function checkCode(e?: React.FormEvent) {
    e?.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cloud/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check", code: c }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErr(d.error || "开通码无效"); return; }
      setPlan(d.plan); setCode(c); setStep("form");
      if (d.retryable) setErr("上次开通未成功,请换一个子域名重试(开通码仍然有效)。");
    } catch { setErr("网络异常,请重试"); }
    finally { setBusy(false); }
  }

  // ── 第二步:核销 + 开通 ──
  const fmtErr = sub ? subdomainError(sub) : null;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit = emailOk && !fmtErr && avail === true && !busy;

  async function claim(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cloud/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "claim", code, email, subdomain: normalizeSubdomain(sub),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErr(d.error || "开通失败"); return; }
      setStep("provisioning");
      poll(d.orderId);
    } catch { setErr("网络异常,请重试"); }
    finally { setBusy(false); }
  }

  // ── 第三步:轮询开通状态(与 CloudModal 同款,12 分钟超时)──
  function poll(orderId: string) {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/cloud/tenant?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const d = await r.json();
        const t: Tenant | null = d.tenant;
        if (t?.status === "active") { clearInterval(timer); setTenant(t); setStep("done"); }
        else if (t?.status === "failed") { clearInterval(timer); setFailMsg(t.error || "开通失败"); setStep("failed"); }
      } catch { /* 继续轮询 */ }
      if (Date.now() - started > 12 * 60 * 1000) {
        clearInterval(timer); setFailMsg("开通超时,请联系客服"); setStep("failed");
      }
    }, 4000);
  }

  return (
    <div className="mx-auto w-full max-w-[520px] px-4 py-10 sm:py-16">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-c-tint-b">
          <Cloud className="h-5.5 w-5.5 text-c-blue" />
        </span>
        <div>
          <h1 className="text-[19px] font-bold text-c-text">开通我的 AI 生图网站</h1>
          <p className="text-[12.5px] text-c-text3">输入开通码,2–5 分钟自动交付专属实例</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-c-line bg-c-card p-5 card-shadow">
        {/* ── 步骤 1:验码 ── */}
        {step === "code" && (
          <form onSubmit={checkCode}>
            <label className="text-[13px] font-medium text-c-text2">开通码</label>
            <p className="mt-1 text-[12px] text-c-text3">
              购买后由店铺自动发送,形如 <span className="font-mono">NVCL-XXXX-XXXX-XXXX</span>
            </p>
            <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-c-line px-3 focus-within:border-c-blue">
              <Ticket className="h-4 w-4 flex-none text-c-text3" />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="NVCL-XXXX-XXXX-XXXX"
                autoFocus
                className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[14px] tracking-wide text-c-text outline-none placeholder:text-c-text4"
              />
            </div>
            {err && <p className="mt-2 text-[12.5px] text-c-danger">{err}</p>}
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!code.trim() || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}下一步
            </Button>
          </form>
        )}

        {/* ── 步骤 2:填资料 ── */}
        {step === "form" && (
          <form onSubmit={claim}>
            {plan && (
              <div className="mb-4 flex items-center justify-between rounded-xl bg-c-subtle2 px-3.5 py-2.5">
                <span className="text-[13px] text-c-text2">
                  云端托管 · <b className="text-c-text">{plan.label}</b>
                </span>
                <span className="text-[12px] text-c-text3">
                  {plan.days} 天 · 含 {plan.credits.toLocaleString()} 算力积分
                </span>
              </div>
            )}

            <label className="text-[13px] font-medium text-c-text2">你的网站地址</label>
            <p className="mt-1 text-[12px] text-c-text3">3–30 位小写字母/数字/短横线,开通后可再绑定自有域名。</p>
            <div className="mt-2.5 flex items-center rounded-xl border border-c-line px-3 focus-within:border-c-blue">
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                placeholder="myshop"
                autoFocus
                className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-c-text outline-none placeholder:text-c-text4"
              />
              <span className="flex-none text-[13px] text-c-text3">.{CLOUD_BASE_DOMAIN}</span>
            </div>
            {sub && (
              <p className={`mt-1.5 text-[12px] ${
                fmtErr || avail === false ? "text-c-danger" : avail ? "text-c-success" : "text-c-text3"
              }`}>
                {checking ? "检查中…" : fmtErr || availMsg || (avail ? "该名称可用" : "")}
              </p>
            )}

            <label className="mt-4 block text-[13px] font-medium text-c-text2">管理员邮箱</label>
            <p className="mt-1 text-[12px] text-c-text3">这将是你新网站的管理员账号,开通凭证也会发到这里。</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-2.5 h-11 w-full rounded-xl border border-c-line bg-transparent px-3 text-[14px] text-c-text outline-none placeholder:text-c-text4 focus:border-c-blue"
            />

            {err && <p className="mt-3 text-[12.5px] text-c-danger">{err}</p>}

            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!canSubmit}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}确认开通
            </Button>
            <p className="mt-2.5 text-center text-[11px] text-c-text4">
              提交后开通码即被核销 · 开通约需 2–5 分钟
            </p>
          </form>
        )}

        {/* ── 步骤 3:开通中 ── */}
        {step === "provisioning" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-c-blue" strokeWidth={1.8} />
            <p className="text-[15px] font-semibold text-c-text">正在开通你的专属实例…</p>
            <p className="max-w-[340px] text-[12.5px] leading-relaxed text-c-text3">
              正在构建独立实例、配置算力与域名证书,约需 2–5 分钟。请勿关闭页面;
              开通完成后凭证也会发送到 <b className="text-c-text2">{email}</b>。
            </p>
          </div>
        )}

        {/* ── 步骤 4:成功 ── */}
        {step === "done" && tenant && (
          <div className="py-2">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-12 w-12 text-c-success" strokeWidth={1.8} />
              <p className="text-[16px] font-bold text-c-text">开通成功 🎉</p>
              <p className="text-[12.5px] text-c-text3">你的专属实例已就绪,可立即登录使用。</p>
            </div>
            <div className="mt-4 space-y-2 rounded-xl bg-c-subtle2 p-3.5 text-[13px]">
              <Row label="访问地址" value={tenant.url || ""} onCopy={() => doCopy(tenant.url || "", "url")} copied={copied === "url"} link />
              <Row label="管理员账号" value={tenant.adminEmail} onCopy={() => doCopy(tenant.adminEmail, "acc")} copied={copied === "acc"} />
              <Row label="初始密码" value={tenant.adminPassword || "—"} onCopy={() => doCopy(tenant.adminPassword || "", "pw")} copied={copied === "pw"} mono />
            </div>
            <p className="mt-2.5 text-[11.5px] text-c-warn">
              ⚠️ 请首次登录后尽快修改初始密码。凭证已同时发送到你的邮箱。
            </p>
            <Button variant="primary" className="mt-3 w-full" asChild>
              <a href={tenant.url || "#"} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />前往我的网站
              </a>
            </Button>
          </div>
        )}

        {/* ── 步骤 5:失败(可换名重试,码不作废)── */}
        {step === "failed" && (
          <div className="py-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-c-danger" strokeWidth={1.8} />
            <p className="mt-2 text-[15px] font-semibold text-c-text">开通未完成</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[12.5px] leading-relaxed text-c-text3">
              {failMsg || "开通过程出现问题"}。你的开通码<b className="text-c-text2">仍然有效</b>,
              可换一个网站地址重试;若多次失败请加微信 <b className="text-c-text2">{WECHAT_ID}</b> 联系客服。
            </p>
            <Button
              variant="primary" className="mt-3 w-full"
              onClick={() => { setStep("form"); setSub(""); setAvail(null); setErr(""); }}
            >
              换个地址重试
            </Button>
            <Button variant="outline" className="mt-2 w-full" onClick={() => doCopy(WECHAT_ID, "wx")}>
              {copied === "wx" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              复制微信号 {WECHAT_ID}
            </Button>
          </div>
        )}
      </div>

      {(step === "code" || step === "form") && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-c-text4">
          <MessageCircle className="h-3.5 w-3.5" />
          没有开通码?请在购买店铺联系客服,或加微信 {WECHAT_ID}
        </p>
      )}
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
