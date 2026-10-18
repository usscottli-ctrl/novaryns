"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Globe2,
  Loader2,
  Minus,
  MonitorSmartphone,
  RefreshCw,
  Users,
  Radio,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  countryName,
  deviceName,
  type AnalyticsOverview,
  type CountRow,
} from "@/lib/analytics";

// ---------------------------------------------------------------------------
// 后台「访问统计」面板。数据来自 /api/admin/analytics(自建 app_page_views 表)。
//
// 图表全部手写 SVG —— 项目本来没有图表库,为一个后台面板引一个 300KB 的依赖
// 不划算。折线图带十字准星 + 悬停提示,条形榜单自带数值标签(不靠颜色读数)。
// ---------------------------------------------------------------------------

type RangeKey = "1" | "7" | "30" | "90";
const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "1", label: "今天" },
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
];

const nf = new Intl.NumberFormat("zh-CN");

/** 容器实际宽度(SVG 按真实像素画,避免 viewBox 缩放把 2px 线拉粗)。 */
function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ---------------------------------------------------------------------------
// 趋势折线图:PV / UV 两条线,共用一根 Y 轴(两者同量纲,永远不上双轴)。
// ---------------------------------------------------------------------------

function TrendChart({ daily }: { daily: AnalyticsOverview["daily"] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);

  const H = 220;
  const PAD = { t: 14, r: 14, b: 26, l: 40 };
  const iw = Math.max(0, width - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;

  const max = Math.max(1, ...daily.map((d) => Math.max(d.pv, d.uv)));
  // Y 轴刻度取整到「好看」的档位,避免出现 3.7 这种刻度。
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / step) * step || 1;
  const ticks = [0, niceMax / 2, niceMax];

  const x = (i: number) =>
    PAD.l + (daily.length <= 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / niceMax) * ih;
  const line = (key: "pv" | "uv") =>
    daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d[key])}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - rect.left;
    const i = Math.round((rel / Math.max(1, iw)) * (daily.length - 1));
    setHover(Math.max(0, Math.min(daily.length - 1, i)));
  };

  const hd = hover != null ? daily[hover] : null;

  return (
    <div className="rounded-[16px] border border-c-border bg-c-card p-5 shadow-card">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[13.5px] font-semibold text-c-text">访问趋势</h4>
        {/* 两条系列 → 图例常驻,身份不靠颜色单独承担(悬停还有文字提示) */}
        <div className="flex items-center gap-4 text-[12px] text-c-text3">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-full bg-[var(--chart-1)]" />
            浏览量 PV
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-full bg-[var(--chart-2)]" />
            访客数 UV
          </span>
        </div>
      </div>

      <div ref={ref} className="relative">
        {width > 0 && daily.length > 0 && (
          <svg width={width} height={H} className="overflow-visible">
            {/* 网格与刻度:退到背景,别和数据抢注意力 */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + iw}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--c-border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.l - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-c-text4 text-[10.5px] tabular-nums"
                >
                  {nf.format(Math.round(t))}
                </text>
              </g>
            ))}

            {/* 日期轴:只标首尾和中间,密了会糊 */}
            {daily.map((d, i) => {
              const show =
                i === 0 ||
                i === daily.length - 1 ||
                (daily.length > 4 && i === Math.floor(daily.length / 2));
              if (!show) return null;
              return (
                <text
                  key={d.day}
                  x={x(i)}
                  y={H - 6}
                  textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"}
                  className="fill-c-text4 text-[10.5px] tabular-nums"
                >
                  {d.day.slice(5)}
                </text>
              );
            })}

            {hd && (
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.t}
                y2={PAD.t + ih}
                stroke="var(--c-border2, var(--c-border))"
                strokeWidth={1}
              />
            )}

            <path d={line("pv")} fill="none" stroke="var(--chart-1)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
            <path d={line("uv")} fill="none" stroke="var(--chart-2)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />

            {/* 单点时画个圆,不然一条 0 长度的线什么都看不见 */}
            {daily.length === 1 && (
              <>
                <circle cx={x(0)} cy={y(daily[0].pv)} r={4} fill="var(--chart-1)" />
                <circle cx={x(0)} cy={y(daily[0].uv)} r={4} fill="var(--chart-2)" />
              </>
            )}

            {hd && (
              <>
                {/* 悬停标记点带 2px 卡面描边,压在线上也分得清 */}
                <circle cx={x(hover!)} cy={y(hd.pv)} r={4.5}
                  fill="var(--chart-1)" stroke="var(--c-card)" strokeWidth={2} />
                <circle cx={x(hover!)} cy={y(hd.uv)} r={4.5}
                  fill="var(--chart-2)" stroke="var(--c-card)" strokeWidth={2} />
              </>
            )}

            <rect
              x={PAD.l}
              y={PAD.t}
              width={Math.max(1, iw)}
              height={ih}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
        )}

        {hd && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 rounded-ctl8 border border-c-border bg-c-card px-2.5 py-1.5 text-[11.5px] shadow-pop"
            style={{
              left: Math.min(Math.max(0, x(hover!) - 52), Math.max(0, width - 116)),
              top: 0,
            }}
          >
            <div className="mb-0.5 font-semibold text-c-text">{hd.day}</div>
            <div className="flex items-center gap-1.5 text-c-text2">
              <i className="h-[3px] w-3 rounded-full bg-[var(--chart-1)]" />
              PV <span className="tabular-nums font-semibold">{nf.format(hd.pv)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-c-text2">
              <i className="h-[3px] w-3 rounded-full bg-[var(--chart-2)]" />
              UV <span className="tabular-nums font-semibold">{nf.format(hd.uv)}</span>
            </div>
          </div>
        )}

        {daily.length === 0 && (
          <div className="flex h-[220px] items-center justify-center text-[13px] text-c-text3">
            这个区间还没有访问数据
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 维度榜单:横条 + 数值标签。单系列 → 全部用 slot-1 一个色,长度已经编码了大小,
// 不再拿颜色去重复表达同一件事。
// ---------------------------------------------------------------------------

function RankList({
  title,
  icon,
  rows,
  format,
  empty = "暂无数据",
  hint,
}: {
  title: string;
  icon: React.ReactNode;
  rows: CountRow[];
  format?: (key: string) => React.ReactNode;
  empty?: string;
  hint?: React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.pv));
  return (
    <div className="rounded-[16px] border border-c-border bg-c-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-c-text4">{icon}</span>
        <h4 className="text-[13.5px] font-semibold text-c-text">{title}</h4>
      </div>
      {hint}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-c-text3">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="relative">
              {/* 条本身是背景层,标签压在上面 —— 行既是条形图也是表格,数值可读不靠颜色 */}
              <div
                className="absolute inset-y-0 left-0 rounded-[4px] bg-acc-tint"
                style={{ width: `${Math.max(3, (r.pv / max) * 100)}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-3 px-2 py-1.5">
                <span className="truncate text-[12.5px] text-c-text2" title={r.key}>
                  {format ? format(r.key) : r.key}
                </span>
                <span className="flex flex-none items-baseline gap-1.5">
                  <span className="text-[12.5px] font-semibold tabular-nums text-c-text">
                    {nf.format(r.pv)}
                  </span>
                  <span className="text-[11px] tabular-nums text-c-text3">
                    / {nf.format(r.uv)} 人
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 相对上一等长周期的涨跌。用箭头图标 + 文字,不靠颜色表意。 */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus;
  return (
    <span className="flex items-center gap-0.5 text-[11.5px] text-c-text3">
      <Icon className="h-3 w-3" />
      <span className="tabular-nums">{Math.abs(pct)}%</span>
    </span>
  );
}

export function AdminAnalytics({ token }: { token?: string | null }) {
  const [range, setRange] = React.useState<RangeKey>("7");
  const [data, setData] = React.useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/analytics?days=${range}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "加载失败");
      setData(d as AnalyticsOverview);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [range, token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-c-text">访问统计</h3>
          <p className="mt-0.5 text-[12px] text-c-text3">
            自建统计,数据只存在本实例的数据库里;不记录访客 IP 与完整 UA。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-field border border-c-border bg-c-subtle px-3 py-2 text-[12.5px] text-c-text2">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={
                <span className="flex items-center gap-2">
                  浏览量 PV <Delta cur={data.totals.pv} prev={data.prev.pv} />
                </span>
              }
              value={nf.format(data.totals.pv)}
              icon={<Eye className="h-4 w-4" />}
            />
            <StatCard
              label={
                <span className="flex items-center gap-2">
                  访客数 UV <Delta cur={data.totals.uv} prev={data.prev.uv} />
                </span>
              }
              value={nf.format(data.totals.uv)}
              accent
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              label="会话数"
              value={nf.format(data.totals.sessions)}
              suffix={
                data.totals.sessions
                  ? `均 ${(data.totals.pv / data.totals.sessions).toFixed(1)} 页`
                  : undefined
              }
              icon={<MonitorSmartphone className="h-4 w-4" />}
            />
            <StatCard
              label="当前在线"
              value={nf.format(data.online)}
              suffix="近 30 分钟"
              icon={<Radio className="h-4 w-4" />}
            />
          </div>

          <TrendChart daily={data.daily} />

          <div className="grid gap-3 lg:grid-cols-2">
            <RankList
              title="国家 / 地区"
              icon={<Globe2 className="h-4 w-4" />}
              rows={data.countries}
              // 不加国旗 emoji:Windows 不渲染 flag emoji,区域指示符会退化成
              // 「CN」「US」这种小字母方块,反而更花。中文国名本身已经够清楚。
              format={(k) => countryName(k)}
              hint={
                data.countries.length > 0 && !data.geoReady ? (
                  <p className="mb-2 rounded-field bg-c-subtle px-2.5 py-2 text-[11.5px] leading-relaxed text-c-text3">
                    国家未解析。本站不在 Cloudflare 后面时需要本地地理库:服务器上
                    <code className="mx-1 rounded bg-c-subtle3 px-1">npm i geoip-lite</code>
                    后重启即可,历史数据不会回填。
                  </p>
                ) : undefined
              }
            />
            <RankList
              title="热门页面"
              icon={<Eye className="h-4 w-4" />}
              rows={data.paths}
            />
            <RankList
              title="来源"
              icon={<Globe2 className="h-4 w-4" />}
              rows={data.referrers}
            />
            {/* 设备与浏览器是两个维度,分开列 —— 混在一张榜单里会让人误以为
                「桌面端」和「Chrome」是并列项,而它们统计的是同一批 PV 的不同切面。 */}
            <RankList
              title="设备"
              icon={<MonitorSmartphone className="h-4 w-4" />}
              rows={data.devices.map((d) => ({ ...d, key: deviceName(d.key) }))}
            />
            <RankList
              title="浏览器"
              icon={<MonitorSmartphone className="h-4 w-4" />}
              rows={data.browsers}
            />
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
