"use client";

import * as React from "react";
import { Copy, Loader2, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { authHeader } from "@/lib/supabase";
import { CLOUD_PLANS, SALE_CLOUD_PLANS } from "@/lib/cloud";

/* ──────────────────────────────────────────────────────────────────────────
 * 云端开通码 · 站长后台
 *
 * 闭环:这里批量生成开通码 → 导出 CSV 灌进渠道(淘宝阿奇索)自动发货库 →
 * 买家拍下自动收到码 → 自助到 /cloud/redeem 填子域名+邮箱 → 后端核销并合成
 * 一张已付 cloud 订单,复用与线上支付完全一致的开通链路(见 db.ts claimCloudCode)。
 * 开通结果在「云端租户」面板可见,续费/到期挂起/恢复全部自动生效。
 * ────────────────────────────────────────────────────────────────────────── */

type CodeRow = {
  code: string;
  plan_id: string;
  status: "unused" | "used" | "disabled";
  batch: string;
  note: string;
  expires_at: string | null;
  created_at: string;
  used_by: string | null;
  used_at: string | null;
  order_id: string | null;
};

const COUNT_OPTIONS = [
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
] as const;

const EXPIRY_OPTIONS = [
  { value: "forever", label: "永久" },
  { value: "90", label: "90天" },
  { value: "180", label: "180天" },
  { value: "365", label: "365天" },
] as const;

function statusMeta(s: CodeRow["status"]) {
  if (s === "unused") return { label: "未使用", cls: "bg-c-tint-g text-c-success" };
  if (s === "used") return { label: "已核销", cls: "bg-c-subtle text-c-text3" };
  return { label: "已停用", cls: "bg-c-tint-r text-c-danger" };
}

const COL = "1.6fr .7fr .7fr 1.1fr 1.4fr .7fr";

export function AdminCloudCodes() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<CodeRow[]>([]);
  const [stats, setStats] = React.useState({ issued: 0, used: 0 });
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const [planId, setPlanId] = React.useState(CLOUD_PLANS[1].id as string);
  const [count, setCount] = React.useState<string>("20");
  const [expiry, setExpiry] = React.useState<string>("365");
  const [batch, setBatch] = React.useState("");
  const [note, setNote] = React.useState("");
  const [fresh, setFresh] = React.useState<CodeRow[]>([]);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/admin/cloud-codes", { headers: await authHeader() });
      const d = await r.json();
      if (r.ok) { setRows(d.codes || []); setStats(d.stats || { issued: 0, used: 0 }); }
      else toast(d.error || "加载失败", "error");
    } catch { toast("加载失败", "error"); }
    finally { setLoading(false); }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/cloud-codes", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({
          planId, count: Number(count),
          expiryDays: expiry === "forever" ? null : Number(expiry),
          batch: batch.trim(), note: note.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error || "生成失败", "error"); return; }
      setFresh(d.codes || []);
      setStats(d.stats || stats);
      toast(`已生成 ${d.codes?.length ?? 0} 个开通码`, "success");
      void load();
    } catch { toast("生成失败", "error"); }
    finally { setBusy(false); }
  }

  async function toggle(code: string, cur: CodeRow["status"]) {
    const next = cur === "disabled" ? "unused" : "disabled";
    try {
      const r = await fetch("/api/admin/cloud-codes", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ code, status: next }),
      });
      if (!r.ok) throw new Error();
      setRows((s) => s.map((x) => (x.code === code ? { ...x, status: next } : x)));
    } catch { toast("操作失败", "error"); }
  }

  // 导出 CSV。**必须带 UTF-8 BOM**,否则 Excel 打开中文全是乱码(2026-07 踩过)。
  function exportCsv(list: CodeRow[], filename: string) {
    if (!list.length) { toast("没有可导出的开通码", "error"); return; }
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["开通码", "套餐", "状态", "批次", "备注", "核销截止", "生成时间", "核销人"];
    const body = list.map((r) =>
      [
        r.code,
        CLOUD_PLANS.find((p) => p.id === r.plan_id)?.label ?? r.plan_id,
        statusMeta(r.status).label,
        r.batch, r.note,
        r.expires_at ? r.expires_at.slice(0, 10) : "永久",
        (r.created_at || "").slice(0, 10),
        r.used_by ?? "",
      ].map(esc).join(",")
    );
    const csv = "﻿" + [head.map(esc).join(","), ...body].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast("已导出 CSV", "success");
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Ticket className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">云端开通码</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          仅管理员可见
        </span>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-c-text3">
        给渠道(淘宝等)自动发货用。买家拍下收到码 → 自助打开
        <code className="mx-1 rounded bg-c-subtle px-1 py-0.5 text-[11.5px]">/cloud/redeem</code>
        填网站地址与管理员邮箱 → 2–5 分钟自动开站,全程无需人工索要资料。
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="已发放" value={String(stats.issued)} />
        <StatCard label="已核销" value={String(stats.used)} />
        <StatCard label="未核销" value={String(Math.max(0, stats.issued - stats.used))} />
      </div>

      <div className="rounded-xl border border-c-line p-4">
        <h3 className="mb-3 text-[14px] font-semibold text-c-text">批量生成</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12.5px] text-c-text2">套餐</label>
            <Segmented
              value={planId} onChange={setPlanId}
              options={SALE_CLOUD_PLANS.map((p) => ({
                value: p.id,
                label: `${p.label} ¥${(p.fen / 100).toLocaleString()}`,
              }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] text-c-text2">数量</label>
            <Segmented value={count} onChange={setCount} options={COUNT_OPTIONS.map((o) => ({ ...o }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] text-c-text2">核销截止</label>
            <Segmented value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS.map((o) => ({ ...o }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-[12.5px] text-c-text2">批次号</label>
              <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="淘宝整站-202607" />
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] text-c-text2">备注</label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可留空" />
            </div>
          </div>
        </div>
        <Button variant="primary" className="mt-3" onClick={generate} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}生成开通码
        </Button>
      </div>

      {fresh.length > 0 && (
        <div className="mt-4 rounded-xl border border-c-success/40 bg-c-tint-g/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-c-text">
              本次生成 {fresh.length} 个 —— 请立即导出并灌入渠道发货库
            </h3>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => copyText(fresh.map((r) => r.code).join("\n")).then((ok) =>
                  toast(ok ? "已复制全部开通码" : "复制失败", ok ? "success" : "error"))}
              >
                <Copy className="h-3.5 w-3.5" />复制全部
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={() => exportCsv(fresh, `云端开通码_${batch || "新批次"}_${new Date().toISOString().slice(0, 10)}.csv`)}
              >
                导出 CSV
              </Button>
            </div>
          </div>
          <div className="max-h-[160px] overflow-y-auto rounded-lg bg-c-card p-2 font-mono text-[12px] leading-6 text-c-text2">
            {fresh.map((r) => <div key={r.code}>{r.code}</div>)}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-c-text">最近 500 条</h3>
        <Button variant="outline" size="sm" onClick={() => exportCsv(rows, `云端开通码_全部_${new Date().toISOString().slice(0, 10)}.csv`)}>
          导出 CSV
        </Button>
      </div>

      {loading ? (
        <p className="py-6 text-center text-[13px] text-c-text3">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-c-text3">还没有开通码,先在上面生成一批。</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-c-line">
          <div className={`grid gap-2 border-b border-c-line bg-c-subtle2 px-3 py-2 text-[12px] font-medium text-c-text3`}
               style={{ gridTemplateColumns: COL }}>
            <span>开通码</span><span>套餐</span><span>状态</span>
            <span>批次</span><span>核销人 / 时间</span><span>操作</span>
          </div>
          {rows.map((r) => {
            const m = statusMeta(r.status);
            return (
              <div key={r.code} className="grid items-center gap-2 border-b border-c-line px-3 py-2 text-[12.5px] last:border-0"
                   style={{ gridTemplateColumns: COL }}>
                <span className="truncate font-mono text-c-text">{r.code}</span>
                <span className="text-c-text2">{CLOUD_PLANS.find((p) => p.id === r.plan_id)?.label ?? r.plan_id}</span>
                <span><span className={`rounded-full px-2 py-0.5 text-[11px] ${m.cls}`}>{m.label}</span></span>
                <span className="truncate text-c-text3">{r.batch || "—"}</span>
                <span className="truncate text-c-text3">
                  {r.used_by ? `${r.used_by} · ${(r.used_at || "").slice(0, 16).replace("T", " ")}` : "—"}
                </span>
                <span>
                  {r.status !== "used" && (
                    <button type="button" onClick={() => toggle(r.code, r.status)}
                            className="text-[12px] text-c-blue hover:underline">
                      {r.status === "disabled" ? "恢复" : "停用"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
