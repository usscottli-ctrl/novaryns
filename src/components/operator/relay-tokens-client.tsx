"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Copy, Sparkles, Radio, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/admin/pager";

/* ──────────────────────────────────────────────────────────────────────────
 * 中转密钥管理 · 签发站后台
 *
 * 闭环:站长在这里给每个 Pro 买家「生成一个中转地址」(独立 token),把地址发给
 * 买家填进他后台的「AI 服务中转地址」。买家用自己的 OpenAI Key,经 relay 转发到
 * OpenAI —— 你按中转服务收费。到期自动失效、可随时停用/续费、可看用量。
 *
 * 后端(站长 token 鉴权 + 仅签发站):
 *   · 列表:   GET    /api/operator/relay → { tokens }
 *   · 生成:   POST   /api/operator/relay { label, contact, months }
 *   · 改/续费/停用: PATCH  /api/operator/relay { id, status?|addMonths?|label?|contact? }
 *   · 删除:   DELETE /api/operator/relay { id }
 * ────────────────────────────────────────────────────────────────────────── */

type RelayStatus = "active" | "disabled" | "expired";

type RelayRow = {
  id: string;
  label: string;
  contact: string;
  kind: "byok" | "managed";
  status: RelayStatus;
  created_at: string;
  expires_at: string | null;
  request_count: number;
  quota_total: number;
  quota_used: number;
  quota_left: number | null;
  last_used_at: string | null;
  address: string;
};

// 有效期下拉:永久 / 1 / 3 / 6 / 12 个月。
const MONTH_OPTIONS = [
  { value: "0", label: "永久" },
  { value: "1", label: "1 个月" },
  { value: "3", label: "3 个月" },
  { value: "6", label: "6 个月" },
  { value: "12", label: "12 个月" },
] as const;
type MonthValue = (typeof MONTH_OPTIONS)[number]["value"];

// 类型:byok=Pro 买家自带 Key / managed=云端租户含算力(relay 注入我们的 Key + 配额)
const KIND_OPTIONS = [
  { value: "byok", label: "买家自带Key" },
  { value: "managed", label: "云端租户(含算力)" },
] as const;
type KindValue = (typeof KIND_OPTIONS)[number]["value"];

const COL_TEMPLATE = "1.3fr 2fr .8fr .9fr .7fr 1.15fr";

function statusMeta(s: RelayStatus): { label: string; cls: string } {
  if (s === "disabled") return { label: "已停用", cls: "bg-c-tint-r text-c-danger" };
  if (s === "expired") return { label: "已过期", cls: "bg-c-tint-a text-c-warn" };
  return { label: "生效中", cls: "bg-c-tint-g text-c-success" };
}

function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

// 打码地址:隐藏域名 + token,只保留 https://…/v1 结构。防截图/共享泄露海外域名与凭证。
// 复制按钮仍复制真实地址(发给买家用)。
function maskAddr(addr: string): string {
  const m = /^(https?:\/\/).+(\/v1\/?)$/.exec(addr);
  return m ? `${m[1]}••••••••••••••••${m[2]}` : "https://••••••/v1";
}

export function RelayTokensClient({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();

  const [tokens, setTokens] = React.useState<RelayRow[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [notConfigured, setNotConfigured] = React.useState(false);

  // 生成控件
  const [label, setLabel] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [months, setMonths] = React.useState<MonthValue>("12");
  const [kind, setKind] = React.useState<KindValue>("byok");
  const [quota, setQuota] = React.useState("2000"); // managed 初始配额(次)
  const [generating, setGenerating] = React.useState(false);

  // 本次新生成的行(高亮 + 顶部大地址卡,方便直接复制发货)
  const [fresh, setFresh] = React.useState<RelayRow | null>(null);
  // 默认打码显示的地址;点「眼睛」临时明文。id 在集合内=已展开。
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const toggleReveal = (id: string) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const [page, setPage] = React.useState(0);
  const PER_PAGE = 10;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/operator/relay", { headers: await authHeader() });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setDenied(true);
          else if (res.status === 503) setNotConfigured(true);
          else setLoadError(data.error || "加载失败");
          return;
        }
        setTokens(data.tokens as RelayRow[]);
      } catch {
        if (!cancelled) setLoadError("网络异常");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = React.useMemo(() => {
    let active = 0,
      off = 0,
      used = 0;
    for (const t of tokens) {
      if (t.status === "active") active++;
      else off++;
      used += t.request_count;
    }
    return { total: tokens.length, active, off, used };
  }, [tokens]);

  const pageCount = Math.max(1, Math.ceil(tokens.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = tokens.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const copy = async (text: string, ok = "已复制地址") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(ok, "success");
    } catch {
      toast("复制失败,请手动选择", "error");
    }
  };

  // ── 生成 ──
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/operator/relay", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          contact: contact.trim(),
          months: months === "0" ? null : Number(months),
          kind,
          quota: kind === "managed" ? Number(quota) || 0 : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) setDenied(true);
        else toast(data.error || "生成失败", "error");
        return;
      }
      const t = data.token as RelayRow;
      setTokens((prev) => [t, ...prev]);
      setPage(0);
      setFresh(t);
      setLabel("");
      setContact("");
      toast("已生成中转地址,复制发给买家即可", "success");
    } catch {
      toast("网络异常,请重试", "error");
    } finally {
      setGenerating(false);
    }
  };

  // ── 停用 / 启用 ──
  const handleToggle = async (t: RelayRow) => {
    const next = t.status === "disabled" ? "active" : "disabled";
    if (
      next === "disabled" &&
      !window.confirm(`确认停用「${t.label || t.id}」?该买家将立即无法使用中转。`)
    )
      return;
    const prev = tokens;
    setTokens((p) =>
      p.map((x) => (x.id === t.id ? { ...x, status: next as RelayStatus } : x))
    );
    try {
      const res = await fetch("/api/operator/relay", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setTokens((p) => p.map((x) => (x.id === t.id ? (data.token as RelayRow) : x)));
      toast(next === "disabled" ? "已停用" : "已启用", "info");
    } catch {
      setTokens(prev);
      toast("操作失败,请重试", "error");
    }
  };

  // ── 续费(在当前到期日基础上加 N 个月)──
  const handleRenew = async (t: RelayRow) => {
    const raw = window.prompt(
      `给「${t.label || t.id}」续费几个月?(在${
        t.expires_at ? `当前到期日 ${fmtDate(t.expires_at)}` : "现在"
      }基础上顺延)`,
      "12"
    );
    if (raw == null) return;
    const m = Number(raw);
    if (!Number.isFinite(m) || m <= 0) {
      toast("请输入正整数月数", "error");
      return;
    }
    try {
      const res = await fetch("/api/operator/relay", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, addMonths: m }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setTokens((p) => p.map((x) => (x.id === t.id ? (data.token as RelayRow) : x)));
      toast(`已续费 ${m} 个月`, "success");
    } catch {
      toast("续费失败,请重试", "error");
    }
  };

  // ── 充算力配额(managed;正数=充,负数=收回)──
  const handleTopup = async (t: RelayRow) => {
    const raw = window.prompt(
      `给「${t.label || t.id}」充多少算力(生图次数)?当前已用 ${t.quota_used} / 配额 ${
        t.quota_total > 0 ? t.quota_total : "不限量"
      }。填负数可收回。`,
      "1000"
    );
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) {
      toast("请输入非零整数", "error");
      return;
    }
    try {
      const res = await fetch("/api/operator/relay", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, addQuota: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setTokens((p) => p.map((x) => (x.id === t.id ? (data.token as RelayRow) : x)));
      toast(n > 0 ? `已充 ${n} 次算力` : `已收回 ${-n} 次`, "success");
    } catch {
      toast("充值失败,请重试", "error");
    }
  };

  // ── 删除 ──
  const handleDelete = async (t: RelayRow) => {
    if (
      !window.confirm(
        `确认删除「${t.label || t.id}」?删除后该地址永久失效且不可恢复。`
      )
    )
      return;
    const prev = tokens;
    setTokens((p) => p.filter((x) => x.id !== t.id));
    try {
      const res = await fetch("/api/operator/relay", {
        method: "DELETE",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      if (!res.ok) throw new Error();
      toast("已删除", "info");
    } catch {
      setTokens(prev);
      toast("删除失败,请重试", "error");
    }
  };

  // 嵌入后台时:非签发站(403)/未配置(503)直接不渲染,保持后台干净;
  // 只有真正的签发站 + 已配置 relay 才显示这块。
  if (embedded && (denied || notConfigured)) return null;

  if (denied) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 px-5 text-center">
        <h1 className="text-[18px] font-bold text-c-text">需要管理员权限</h1>
        <p className="text-[13.5px] text-c-text3">
          中转密钥管理是站长后台功能,当前账号无权访问。
        </p>
        <a
          href="/"
          className="mt-1 rounded-[10px] border border-c-border2 bg-c-card px-4 py-2 text-[13px] font-medium text-c-text transition-colors hover:bg-c-subtle"
        >
          返回首页
        </a>
      </div>
    );
  }

  return (
    <Shell embedded={embedded}>
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <nav className="flex items-center gap-1.5 text-[12.5px] text-c-text3">
              <Link href="/deploy" className="transition-colors hover:text-c-text">
                部署中心
              </Link>
              <ChevronRight size={13} className="text-c-text4" />
              <span className="text-c-text2">中转密钥</span>
            </nav>
            <h1 className="mt-2 text-[24px] font-bold leading-tight text-c-text">
              中转密钥管理 · 站长后台
            </h1>
            <p className="mt-1 text-[13.5px] text-c-text3">
              给每个 Pro 买家生成独立中转地址,到期自动失效、可停用/续费、看用量
            </p>
            {loadError && (
              <p className="mt-1.5 text-[12.5px] text-c-danger">
                {loadError} · 需站长账号登录
              </p>
            )}
          </div>
        </div>
      )}

      {embedded && (
        <div className="mb-3 mt-8 flex items-center gap-2 border-t border-border pt-6 text-sm font-semibold text-foreground">
          <Radio className="h-4 w-4 text-primary" />
          中转密钥
        </div>
      )}

      {notConfigured ? (
        <div className="mt-6 rounded-card border border-c-border bg-c-card p-6 text-[13px] leading-relaxed text-c-text3 shadow-card">
          本站未配置中转服务。需在签发站(ai.starzeco.com)服务端设置{" "}
          <code className="rounded bg-c-subtle px-1.5 py-0.5 font-mono text-[12px] text-c-text2">
            RELAY_MANAGE_URL
          </code>{" "}
          与{" "}
          <code className="rounded bg-c-subtle px-1.5 py-0.5 font-mono text-[12px] text-c-text2">
            RELAY_ADMIN_SECRET
          </code>{" "}
          后重启,才能在此发放中转地址。
        </div>
      ) : (
        <>
          {/* 统计 */}
          <div className="mt-6 grid grid-cols-4 gap-4">
            <StatCard label="总地址数" value={stats.total} suffix="个" />
            <StatCard
              label="生效中"
              value={<span className="text-c-success">{stats.active}</span>}
              suffix="个"
            />
            <StatCard
              label="停用 / 过期"
              value={<span className="text-c-danger">{stats.off}</span>}
              suffix="个"
            />
            <StatCard label="累计请求" value={stats.used} accent suffix="次" />
          </div>

          {/* 生成卡 */}
          <section className="mt-6 rounded-card border border-c-border bg-c-card p-6 shadow-card">
            <div className="flex items-center gap-2">
              <Radio size={16} className="text-acc" />
              <h2 className="text-[15px] font-semibold text-c-text">生成中转地址</h2>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
                  买家备注
                </label>
                <Input
                  value={label}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setLabel(e.target.value)
                  }
                  placeholder="例如:老王的服装店"
                />
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
                  联系方式(选填)
                </label>
                <Input
                  value={contact}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setContact(e.target.value)
                  }
                  placeholder="微信 / 手机 / 订单号"
                />
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
                  有效期
                </label>
                <Segmented<MonthValue>
                  options={MONTH_OPTIONS.map((o) => ({ ...o }))}
                  value={months}
                  onChange={setMonths}
                />
              </div>
            </div>

            {/* 类型 + 配额 */}
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
                  类型
                </label>
                <Segmented<KindValue>
                  options={KIND_OPTIONS.map((o) => ({ ...o }))}
                  value={kind}
                  onChange={setKind}
                />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-c-text4">
                  {kind === "managed"
                    ? "云端租户:relay 注入我们的 OpenAI Key,租户碰不到 Key,按下方配额计量,超额自动断供。"
                    : "买家自带 Key:买家在自己后台填自己的 OpenAI Key,我们只做中转,不消耗我们的算力。"}
                </p>
              </div>
              {kind === "managed" && (
                <div>
                  <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
                    算力配额(生图次数,0=不限量)
                  </label>
                  <Input
                    value={quota}
                    inputMode="numeric"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setQuota(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="2000"
                  />
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <Button
                variant="primary"
                size="md"
                loading={generating}
                onClick={handleGenerate}
              >
                <Sparkles size={15} />
                生成地址
              </Button>
            </div>

            {/* 本次新生成:大地址卡 + 复制 */}
            {fresh && (
              <div className="mt-5 rounded-[12px] border border-c-border bg-c-tint-g/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-c-text">
                    新地址已生成 —— 复制发给
                    {fresh.label ? `「${fresh.label}」` : "买家"}
                  </span>
                  <span className="text-[12px] text-c-text3">
                    到期:{fresh.expires_at ? fmtDate(fresh.expires_at) : "永久"}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-c-card p-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-c-text2">
                    {revealed.has(fresh.id) ? fresh.address : maskAddr(fresh.address)}
                  </code>
                  <button
                    type="button"
                    onClick={() => toggleReveal(fresh.id)}
                    aria-label={revealed.has(fresh.id) ? "隐藏" : "显示"}
                    title={revealed.has(fresh.id) ? "隐藏" : "显示完整地址"}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
                  >
                    {revealed.has(fresh.id) ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copy(fresh.address)}
                  >
                    <Copy size={14} />
                    复制
                  </Button>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-c-text3">
                  让买家把它填进自己后台的「AI 服务中转地址」,并用他自己的 OpenAI
                  Key。到期后此地址自动失效。
                </p>
              </div>
            )}
          </section>

          {/* 列表 */}
          <section className="mt-6 rounded-card border border-c-border bg-c-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-c-line px-6 py-4">
              <h2 className="text-[15px] font-semibold text-c-text">地址列表</h2>
              <span className="text-[12.5px] text-c-text3">{tokens.length} 个</span>
            </div>

            <div
              className="grid items-center gap-3 border-b border-c-line px-6 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-c-text4"
              style={{ gridTemplateColumns: COL_TEMPLATE }}
            >
              <span>买家 / 联系方式</span>
              <span>中转地址</span>
              <span>状态</span>
              <span>到期</span>
              <span>用量</span>
              <span className="text-right">操作</span>
            </div>

            {tokens.length === 0 ? (
              <div className="px-6 py-14 text-center text-[13px] text-c-text3">
                暂无地址,先在上方给买家生成一个
              </div>
            ) : (
              <ul>
                {paged.map((t) => {
                  const meta = statusMeta(t.status);
                  const isFresh = fresh?.id === t.id;
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        "grid items-center gap-3 border-b border-c-line px-6 py-3.5 last:border-b-0 transition-colors hover:bg-c-subtle2",
                        isFresh && "bg-c-tint-g/30"
                      )}
                      style={{ gridTemplateColumns: COL_TEMPLATE }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-c-text">
                          {t.label || <span className="text-c-text4">未命名</span>}
                          {t.kind === "managed" && (
                            <span className="ml-1.5 inline-flex items-center rounded-[5px] bg-c-tint-b px-1.5 py-[1px] align-middle text-[10px] font-semibold text-c-blue">
                              云端
                            </span>
                          )}
                        </span>
                        {t.contact && (
                          <span className="block truncate text-[12px] text-c-text3">
                            {t.contact}
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-mono text-[12px] text-c-text2">
                          {revealed.has(t.id) ? t.address : maskAddr(t.address)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleReveal(t.id)}
                          aria-label={revealed.has(t.id) ? "隐藏" : "显示"}
                          title={revealed.has(t.id) ? "隐藏" : "显示完整地址"}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
                        >
                          {revealed.has(t.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(t.address)}
                          aria-label="复制地址"
                          title="复制"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                      <span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-[6px] px-2 py-[3px] text-[11.5px] font-semibold",
                            meta.cls
                          )}
                        >
                          {meta.label}
                        </span>
                      </span>
                      <span className="text-[12.5px] text-c-text2">
                        {t.expires_at ? (
                          fmtDate(t.expires_at)
                        ) : (
                          <span className="text-c-text3">永久</span>
                        )}
                      </span>
                      <span className="text-[12.5px] font-medium text-c-text2">
                        {t.kind === "managed" ? (
                          <span title="已用 / 配额">
                            {t.quota_used}
                            <span className="text-c-text4">
                              /{t.quota_total > 0 ? t.quota_total : "∞"}
                            </span>
                          </span>
                        ) : (
                          t.request_count
                        )}
                      </span>
                      <span className="flex items-center justify-end gap-0.5">
                        {t.kind === "managed" && (
                          <button
                            type="button"
                            onClick={() => handleTopup(t)}
                            className="rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium text-c-blue transition-colors hover:bg-c-tint-b"
                          >
                            充配额
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRenew(t)}
                          className="rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle"
                        >
                          续费
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(t)}
                          className={cn(
                            "rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                            t.status === "disabled"
                              ? "text-c-success hover:bg-c-tint-g"
                              : "text-c-warn hover:bg-c-tint-a"
                          )}
                        >
                          {t.status === "disabled" ? "启用" : "停用"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(t)}
                          className="rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium text-c-danger transition-colors hover:bg-c-tint-r"
                        >
                          删除
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {pageCount > 1 && (
              <div className="border-t border-c-line px-6 pb-4">
                <Pager
                  page={safePage}
                  totalPages={pageCount}
                  onChange={setPage}
                  totalLabel={`共 ${tokens.length} 个`}
                />
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

function Shell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) return <div>{children}</div>;
  return <div className="w-full px-5 py-7 sm:px-6 lg:px-8">{children}</div>;
}
