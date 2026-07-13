"use client";
import { copyText } from "@/lib/clipboard";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/admin/pager";

/* ──────────────────────────────────────────────────────────────────────────
 * 兑换码管理 · 站长后台 (spec E.3)
 *
 * 闭环说明:站长在这里批量「生成兑换码」(status='unused'),把码线下/活动发放给
 * 用户。用户在前端 RechargeModal(src/components/credits/recharge-modal.tsx)的
 * 「兑换码」tab 输入码 → 后端校验后把该码从 unused → used,并给用户加积分;
 * 这里的「使用情况」列(usedBy / usedAt)就来自那一步回写。
 *
 * 后端接入点(本组件全部为前端可演示 MOCK):
 *   · 列表:    GET  /api/cardkeys           → CardKey[]
 *   · 生成:    POST /api/cardkeys/generate   { credits, count, expiry, batch } → CardKey[]
 *   · 停用/恢复: POST /api/cardkeys/:code/toggle { status }
 *   · 导出:    前端把当前列表拼成 CSV Blob 下载(无需后端)。
 * ────────────────────────────────────────────────────────────────────────── */

type CardStatus = "unused" | "used" | "disabled";

type CardKey = {
  code: string;
  credits: number;
  status: CardStatus;
  batch: string;
  created: string;
  usedBy: string | null;
  usedAt: string | null;
};

// 服务端行(/api/cardkeys 返回)→ 组件展示形态。
type CardKeyServerRow = {
  code: string;
  credits: number;
  status: CardStatus;
  batch: string;
  note: string;
  expires_at: string | null;
  created_at: string;
  used_by: string | null;
  used_at: string | null;
};
function toCard(r: CardKeyServerRow): CardKey {
  return {
    code: r.code,
    credits: r.credits,
    status: r.status,
    batch: r.note ? `${r.batch} · ${r.note}` : r.batch || "—",
    created: (r.created_at || "").slice(0, 10),
    usedBy: r.used_by,
    usedAt: r.used_at ? r.used_at.slice(0, 16).replace("T", " ") : null,
  };
}

// 控件选项 —— Segmented 的 value 必须是 string,展示与数值分开存。
const CREDIT_OPTIONS = [
  { value: "200", label: "200" },
  { value: "500", label: "500" },
  { value: "1000", label: "1,000" },
  { value: "3000", label: "3,000" },
] as const;

const COUNT_OPTIONS = [
  { value: "10", label: "10" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "200", label: "200" },
] as const;

const EXPIRY_OPTIONS = [
  { value: "forever", label: "永久" },
  { value: "30", label: "30天" },
  { value: "90", label: "90天" },
  { value: "365", label: "365天" },
] as const;

type CreditValue = (typeof CREDIT_OPTIONS)[number]["value"];
type CountValue = (typeof COUNT_OPTIONS)[number]["value"];
type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"];

type FilterValue = "all" | CardStatus;
const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unused", label: "未使用" },
  { value: "used", label: "已使用" },
  { value: "disabled", label: "已停用" },
];

// 列模板 —— 表头与数据行共用,保证对齐。
const COL_TEMPLATE = "1.7fr .8fr .8fr 1fr 1.3fr .8fr";

// 成本系数:面额(积分) / 1000 * 16(元)。
const COST_PER_KCREDIT = 16;

// 兑换码由服务端生成并入库(POST /api/cardkeys)。

function statusMeta(status: CardStatus): { label: string; cls: string } {
  switch (status) {
    case "unused":
      return { label: "未使用", cls: "bg-c-tint-g text-c-success" };
    case "used":
      return { label: "已使用", cls: "bg-c-subtle text-c-text3" };
    case "disabled":
      return { label: "已停用", cls: "bg-c-tint-r text-c-danger" };
  }
}

export function CardkeysAdmin({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();

  const [cardKeys, setCardKeys] = React.useState<CardKey[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // 生成控件状态
  const [credit, setCredit] = React.useState<CreditValue>("500");
  const [count, setCount] = React.useState<CountValue>("10");
  const [expiry, setExpiry] = React.useState<ExpiryValue>("90");
  const [batchNote, setBatchNote] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  // 非管理员(401/403)→ 显示无权限页,不渲染兑换码管理界面。
  const [denied, setDenied] = React.useState(false);

  // 列表筛选
  const [filter, setFilter] = React.useState<FilterValue>("all");
  const [page, setPage] = React.useState(0);

  // 生成批次序号(批次号 B-YYMM-XX 用,确定性递增)。
  const seedRef = React.useRef(1000);

  // 载入:GET /api/cardkeys(站长 token 鉴权,非管理员返回 403)。
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cardkeys", { headers: await authHeader() });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setDenied(true);
          else setLoadError(data.error || "加载失败");
          return;
        }
        setCardKeys((data.cards as CardKeyServerRow[]).map(toCard));
      } catch {
        if (!cancelled) setLoadError("网络异常");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 统计(实时从 cardKeys 算) ──
  const totalIssued = cardKeys.length;
  const usedList = cardKeys.filter((c) => c.status === "used");
  const totalRedeemed = usedList.length;
  const redeemedCredits = usedList.reduce((sum, c) => sum + c.credits, 0);
  const redeemRate =
    totalIssued === 0 ? 0 : Math.round((totalRedeemed / totalIssued) * 100);

  // ── 预计成本 ──
  const creditNum = Number(credit);
  const countNum = Number(count);
  const estCost = Math.round((creditNum * countNum) / 1000 * COST_PER_KCREDIT);

  // ── 筛选后的列表 ──
  const visibleCards =
    filter === "all" ? cardKeys : cardKeys.filter((c) => c.status === filter);
  const CARDS_PER_PAGE = 10;
  const pageCount = Math.max(1, Math.ceil(visibleCards.length / CARDS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedCards = visibleCards.slice(
    safePage * CARDS_PER_PAGE,
    safePage * CARDS_PER_PAGE + CARDS_PER_PAGE
  );

  // ── 生成兑换码(POST /api/cardkeys,服务端生成入库) ──
  const handleGenerate = async () => {
    setGenerating(true);
    const today = new Date().toISOString().slice(0, 10);
    const batchId = `B-${today.slice(2, 4)}${today.slice(5, 7)}-${(
      seedRef.current++ % 100
    )
      .toString(36)
      .toUpperCase()
      .padStart(2, "0")}`;
    try {
      const res = await fetch("/api/cardkeys", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({
          credits: creditNum,
          count: countNum,
          expiryDays: expiry === "forever" ? null : Number(expiry),
          batch: batchId,
          note: batchNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "生成失败", "error");
      } else {
        const fresh = (data.cards as CardKeyServerRow[]).map(toCard);
        setCardKeys((prev) => [...fresh, ...prev]);
        setFilter("all");
        setPage(0);
        toast(
          `已生成 ${fresh.length} 张兑换码(每张 ${creditNum} 积分)`,
          "success"
        );
      }
    } catch {
      toast("网络异常,请重试", "error");
    } finally {
      setGenerating(false);
    }
  };

  // ── 停用 / 恢复(PATCH /api/cardkeys,乐观更新 + 失败回滚) ──
  const handleToggle = async (code: string) => {
    const target = cardKeys.find((c) => c.code === code);
    if (!target || target.status === "used") return;
    const next: CardStatus = target.status === "disabled" ? "unused" : "disabled";
    setCardKeys((prev) =>
      prev.map((c) => (c.code === code ? { ...c, status: next } : c))
    );
    try {
      const res = await fetch("/api/cardkeys", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ code, status: next }),
      });
      if (!res.ok) throw new Error();
      toast(next === "disabled" ? "已停用该兑换码" : "已恢复该兑换码", "info");
    } catch {
      setCardKeys((prev) =>
        prev.map((c) => (c.code === code ? { ...c, status: target.status } : c))
      );
      toast("操作失败,请重试", "error");
    }
  };

  // ── 复制 ──
  const handleCopy = async (code: string) => {
    try {
      if (!(await copyText(code))) throw new Error();
      toast("已复制兑换码", "success");
    } catch {
      toast("复制失败,请手动选择", "error");
    }
  };

  // ── 导出 CSV ──
  const handleExport = () => {
    const header = ["兑换码", "面额(积分)", "状态", "批次", "兑换用户", "兑换时间"];
    const statusZh: Record<CardStatus, string> = {
      unused: "未使用",
      used: "已使用",
      disabled: "已停用",
    };
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = cardKeys.map((c) =>
      [
        c.code,
        String(c.credits),
        statusZh[c.status],
        c.batch,
        c.usedBy ?? "",
        c.usedAt ?? "",
      ]
        .map(escape)
        .join(",")
    );
    const csv = "﻿" + [header.map(escape).join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `兑换码_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("已导出 CSV", "success");
  };

  if (denied) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 px-5 text-center">
        <h1 className="text-[18px] font-bold text-c-text">需要管理员权限</h1>
        <p className="text-[13.5px] text-c-text3">
          兑换码管理是站长后台功能,当前账号无权访问。
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
      {/* 面包屑 + 标题行(嵌入模式隐藏页级大标题头,导出 CSV 按钮下移到紧凑工具行) */}
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <nav className="flex items-center gap-1.5 text-[12.5px] text-c-text3">
              <Link
                href="/deploy"
                className="transition-colors hover:text-c-text"
              >
                部署中心
              </Link>
              <ChevronRight size={13} className="text-c-text4" />
              <span className="text-c-text2">兑换码管理</span>
            </nav>
            <h1 className="mt-2 text-[24px] font-bold leading-tight text-c-text">
              兑换码管理 · 站长后台
            </h1>
            <p className="mt-1 text-[13.5px] text-c-text3">
              批量生成积分兑换码,发放给用户在前端兑换成积分
            </p>
            {loadError && (
              <p className="mt-1.5 text-[12.5px] text-c-danger">
                {loadError} · 需站长账号登录
              </p>
            )}
          </div>
          <Button variant="secondary" size="md" onClick={handleExport}>
            导出 CSV
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          {loadError ? (
            <p className="text-[12.5px] text-c-danger">
              {loadError} · 需站长账号登录
            </p>
          ) : (
            <span />
          )}
          <Button variant="secondary" size="sm" onClick={handleExport}>
            导出 CSV
          </Button>
        </div>
      )}

      {/* 统计 grid */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatCard label="已发码" value={totalIssued} suffix="张" />
        <StatCard
          label="已兑换"
          value={
            <span className="text-c-success">{totalRedeemed}</span>
          }
          suffix="张"
        />
        <StatCard
          label="兑换积分总额"
          value={redeemedCredits.toLocaleString("en-US")}
          accent
        />
        <StatCard label="兑换率" value={`${redeemRate}%`} accent />
      </div>

      {/* 生成兑换码卡 */}
      <section className="mt-6 rounded-card border border-c-border bg-c-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-acc" />
          <h2 className="text-[15px] font-semibold text-c-text">生成兑换码</h2>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-5">
          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
              每张面额(积分)
            </label>
            <Segmented<CreditValue>
              options={CREDIT_OPTIONS.map((o) => ({ ...o }))}
              value={credit}
              onChange={setCredit}
            />
          </div>
          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
              生成数量
            </label>
            <Segmented<CountValue>
              options={COUNT_OPTIONS.map((o) => ({ ...o }))}
              value={count}
              onChange={setCount}
            />
          </div>
          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
              有效期
            </label>
            <Segmented<ExpiryValue>
              options={EXPIRY_OPTIONS.map((o) => ({ ...o }))}
              value={expiry}
              onChange={setExpiry}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className="min-w-[260px] flex-1">
            <Input
              value={batchNote}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setBatchNote(e.target.value)
              }
              placeholder="例如:618 大促 · 微博抽奖"
            />
          </div>
          <div className="text-[13px] text-c-text3">
            预计成本{" "}
            <span className="text-[15px] font-semibold text-acc">
              ¥{estCost.toLocaleString("en-US")}
            </span>
          </div>
          <Button
            variant="primary"
            size="md"
            loading={generating}
            onClick={handleGenerate}
          >
            <Sparkles size={15} />
            生成兑换码
          </Button>
        </div>
      </section>

      {/* 列表 */}
      <section className="mt-6 rounded-card border border-c-border bg-c-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-c-line px-6 py-4">
          <h2 className="text-[15px] font-semibold text-c-text">兑换码列表</h2>
          <Segmented<FilterValue>
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(0);
            }}
            variant="dark"
            className="w-[300px]"
          />
        </div>

        {/* 表头 */}
        <div
          className="grid items-center gap-3 border-b border-c-line px-6 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-c-text4"
          style={{ gridTemplateColumns: COL_TEMPLATE }}
        >
          <span>兑换码</span>
          <span>面额</span>
          <span>状态</span>
          <span>批次</span>
          <span>使用情况</span>
          <span className="text-right">操作</span>
        </div>

        {/* 行 */}
        {visibleCards.length === 0 ? (
          <div className="px-6 py-14 text-center text-[13px] text-c-text3">
            该状态下暂无兑换码
          </div>
        ) : (
          <ul>
            {pagedCards.map((c) => {
              const meta = statusMeta(c.status);
              const canToggle = c.status !== "used";
              return (
                <li
                  key={c.code}
                  className="grid items-center gap-3 border-b border-c-line px-6 py-3.5 last:border-b-0 transition-colors hover:bg-c-subtle2"
                  style={{ gridTemplateColumns: COL_TEMPLATE }}
                >
                  <span className="truncate font-mono text-[13px] text-c-text">
                    {c.code}
                  </span>
                  <span className="text-[13px] font-semibold text-acc">
                    {c.credits.toLocaleString("en-US")}
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
                  <span className="truncate font-mono text-[12px] text-c-text3">
                    {c.batch}
                  </span>
                  <span className="truncate text-[12.5px] text-c-text2">
                    {c.status === "used" && c.usedBy ? (
                      <span className="flex flex-col leading-tight">
                        <span className="truncate text-c-text">{c.usedBy}</span>
                        <span className="text-[11px] text-c-text4">
                          {c.usedAt}
                        </span>
                      </span>
                    ) : (
                      <span className="text-c-text4">—</span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopy(c.code)}
                      aria-label="复制兑换码"
                      title="复制"
                      className="grid h-8 w-8 place-items-center rounded-[8px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={!canToggle}
                      onClick={() => handleToggle(c.code)}
                      className={cn(
                        "rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                        !canToggle
                          ? "cursor-not-allowed text-c-text4"
                          : c.status === "disabled"
                          ? "text-c-success hover:bg-c-tint-g"
                          : "text-c-danger hover:bg-c-tint-r"
                      )}
                    >
                      {c.status === "disabled" ? "恢复" : "停用"}
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
              totalLabel={`共 ${visibleCards.length} 张`}
            />
          </div>
        )}
      </section>
    </Shell>
  );
}

/* ── 外壳:按 embedded 切换页级包裹 ──
 * embedded=false(独立页 /cardkeys):外层大 padding 容器,与原样一致。
 * embedded=true(后台内嵌):后台内容区已有底色与内边距,这里只用普通容器包住内容。 */
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
