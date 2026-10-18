"use client";

import * as React from "react";
import { HardDrive, Loader2, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";

// ---------------------------------------------------------------------------
// 后台「存储治理」:用量总览 + 保留期清理。
//
// 作品数是**唯一可靠的量**:我们不存每张图的字节数,所以体积一律标「约」,
// 按经验均值折算(1K≈1.2MB、含 2K/4K 后整体约 1.8MB/张)。别把它当账单看。
// ---------------------------------------------------------------------------

// 每张图的平均体积估算(MB)。要更准就得给 app_artworks 加 size 列并回填。
const AVG_MB_PER_IMAGE = 1.8;

type Usage = {
  totalArtworks: number;
  trashArtworks: number;
  byUser: { email: string; count: number }[];
  driver: "local" | "r2";
  keepDays: number;
  trashDays: number;
};

function approxSize(n: number): string {
  const mb = n * AVG_MB_PER_IMAGE;
  return mb >= 1024 ? `≈ ${(mb / 1024).toFixed(1)} GB` : `≈ ${Math.round(mb)} MB`;
}

export function AdminStorage({ token }: { token?: string | null }) {
  const [data, setData] = React.useState<Usage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [purging, setPurging] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const headers = React.useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/storage", { headers, cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "加载失败");
      setData(d as Usage);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function purge() {
    setPurging(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/admin/storage", { method: "POST", headers });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "清理失败");
      setMsg(
        `清理完成：删除 ${d.purgedRows} 条记录、${d.deletedObjects} 个图片文件`
      );
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "清理失败");
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-c-text">存储治理</h3>
          <p className="mt-0.5 text-[12px] text-c-text3">
            作品保留 {data?.keepDays ?? "—"} 天、回收站 {data?.trashDays ?? "—"} 天，
            每日自动清理。体积为按均值估算，非精确账单。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </Button>
          <Button variant="secondary" onClick={() => void purge()} disabled={purging}>
            {purging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            立即清理超期
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-field border border-c-border bg-c-subtle px-3 py-2 text-[12.5px] text-c-text2">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded-field border border-c-border bg-acc-tint px-3 py-2 text-[12.5px] text-acc">
          {msg}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="作品总数"
              value={data.totalArtworks.toLocaleString("zh-CN")}
              suffix={approxSize(data.totalArtworks)}
              icon={<HardDrive className="h-4 w-4" />}
            />
            <StatCard
              label="回收站"
              value={data.trashArtworks.toLocaleString("zh-CN")}
              suffix={`${data.trashDays} 天后清`}
            />
            <StatCard
              label="存储后端"
              value={data.driver === "r2" ? "对象存储" : "本地磁盘"}
              accent={data.driver === "r2"}
            />
            <StatCard label="保留期" value={`${data.keepDays}`} suffix="天" />
          </div>

          {/* 本地盘要特别提醒:图片占的是服务器磁盘,满了会拖垮整机 */}
          {data.driver === "local" && (
            <div className="flex items-start gap-2 rounded-field border border-c-border bg-c-subtle px-3 py-2.5 text-[12px] leading-relaxed text-c-text2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-c-text3" />
              <span>
                当前图片存在<b>服务器本地磁盘</b>上，会占用系统盘空间。
                若图片量增长较快，建议在「接口与模型」里配置对象存储（支持
                阿里云 OSS / Cloudflare R2 等 S3 兼容服务），把图片挪出去。
              </span>
            </div>
          )}

          <div className="rounded-[16px] border border-c-border bg-c-card p-5 shadow-card">
            <h4 className="mb-3 text-[13.5px] font-semibold text-c-text">
              用量排行（按用户）
            </h4>
            {data.byUser.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-c-text3">暂无数据</p>
            ) : (
              <ul className="space-y-1.5">
                {data.byUser.map((u) => {
                  const max = Math.max(1, data.byUser[0]?.count ?? 1);
                  return (
                    <li key={u.email} className="relative">
                      <div
                        className="absolute inset-y-0 left-0 rounded-[4px] bg-acc-tint"
                        style={{ width: `${Math.max(3, (u.count / max) * 100)}%` }}
                        aria-hidden
                      />
                      <div className="relative flex items-center justify-between gap-3 px-2 py-1.5">
                        <span className="truncate text-[12.5px] text-c-text2">
                          {u.email}
                        </span>
                        <span className="flex flex-none items-baseline gap-1.5">
                          <span className="text-[12.5px] font-semibold tabular-nums text-c-text">
                            {u.count.toLocaleString("zh-CN")}
                          </span>
                          <span className="text-[11px] tabular-nums text-c-text3">
                            {approxSize(u.count)}
                          </span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-c-text3">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
