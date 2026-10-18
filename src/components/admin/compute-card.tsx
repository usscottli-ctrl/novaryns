"use client";

import * as React from "react";
import { Zap, ExternalLink, RefreshCw, Loader2 } from "lucide-react";

type Data = {
  managed: boolean;
  topupUrl?: string;
  balance?: { status: string; quotaTotal: number; quotaUsed: number; quotaLeft: number | null; issuedTotal?: number; issuable?: number | null } | null;
};

// 云端托管实例的「算力」卡片(接口与模型板块顶部)。仅托管积分模式(managed)显示:
// 余额 + 去充值;并说明可随时切换自备 Key。自备 Key/开源自托管实例不渲染任何东西。
export function ComputeCard({ token }: { token: string | null }) {
  const [data, setData] = React.useState<Data | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch("/api/admin/compute", { headers, cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* 静默:非托管/网络异常都不打扰 */ }
    finally { setBusy(false); }
  }, [token]);

  React.useEffect(() => { load(); }, [load]);

  if (!data?.managed) return null;
  const b = data.balance;
  // **显示"还可发放"而不是"还能烧"**:站长实际关心的是"我还能给用户发多少积分",
  // 而 quotaLeft(= 买的 - 烧的)会把已发放但用户没花完的部分算成可用,导致超发。
  const left = b?.issuable ?? b?.quotaLeft ?? null;
  const low = left !== null && left < 600; // 剩 <100 张提示

  return (
    <div className="mb-5 rounded-xl border border-c-border2 bg-c-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-c-tint-b">
            <Zap className="h-4.5 w-4.5 text-c-blue" />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-c-text">托管算力(积分)</p>
            <p className="text-[12px] text-c-text3">本实例的生图算力由平台托管,无需配置模型 Key</p>
          </div>
        </div>
        <button type="button" onClick={load} className="rounded-lg p-1.5 text-c-text3 hover:bg-c-subtle hover:text-c-text" title="刷新">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11.5px] text-c-text3">算力余额</p>
          {b ? (
            <p className="mt-0.5 text-[24px] font-bold leading-none text-c-text">
              {left === null ? "不限量" : left.toLocaleString()}
              {left !== null && (
                <span className="ml-1.5 text-[12.5px] font-normal text-c-text3">
                  积分 ≈ {Math.floor(left / 6)} 张
                </span>
              )}
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-c-text3">余额查询暂不可用</p>
          )}
          {b?.status && b.status !== "active" && (
            <p className="mt-1 text-[12px] text-c-danger">算力已停用(实例到期?续费后自动恢复)</p>
          )}
          {low && <p className="mt-1 text-[12px] text-c-warn">余额不足 100 张,建议尽快充值以免生图中断</p>}
        </div>
        {data.topupUrl && (
          <a
            href={data.topupUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex flex-none items-center gap-1.5 rounded-xl bg-acc px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" />充值算力
          </a>
        )}
      </div>

      <p className="mt-3 border-t border-c-border2 pt-2.5 text-[12px] leading-relaxed text-c-text3">
        想改用自己的模型 Key?在下方「接口与模型」填入你的 Key 与接口地址即可切换,托管余额保留不清零,清空自填配置即切回托管模式。
      </p>
    </div>
  );
}
