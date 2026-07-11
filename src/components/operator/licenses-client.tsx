"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Copy, KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/admin/pager";

/* ──────────────────────────────────────────────────────────────────────────
 * 我的授权 · Pro 授权管理 (spec E.2)
 *
 * 闭环说明:站长在这里批量「生成 License」(status='active'),导出卡密上传到
 * 爱发电卡密池。买家购买源码后拿到 License Key,在自托管部署里激活;每激活一
 * 台设备会写入 app_license_activations,这里的「设备 activations/device_limit」
 * 列就来自那一步。吊销后该 Key 立即失效,已绑定的部署无法继续通过校验。
 *
 * 后端接入点(站长 token 鉴权,非管理员 403):
 *   · 列表 + 统计: GET   /api/operator/licenses → { licenses, stats }
 *   · 批量生成:    POST  /api/operator/licenses { count, deviceLimit?, expiryDays?, batch?, note? }
 *   · 吊销 / 恢复:  PATCH /api/operator/licenses { key, status: "active"|"revoked" }
 * ────────────────────────────────────────────────────────────────────────── */

type LicenseStatus = "active" | "revoked";

// 服务端行(/api/operator/licenses 返回)。
type LicenseRow = {
  key: string;
  tier: string;
  status: LicenseStatus;
  device_limit: number;
  expires_at: string | null;
  batch: string;
  note: string;
  bound_email: string | null;
  created_at: string;
  activations: number;
};

type LicenseStats = {
  issued: number;
  active: number;
  revoked: number;
  activations: number;
};

// 有效期下拉:永久 / 1年 / 2年 → expiryDays = null / 365 / 730。
const EXPIRY_OPTIONS = [
  { value: "0", label: "永久" },
  { value: "365", label: "1 年" },
  { value: "730", label: "2 年" },
] as const;
type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"];

// 列模板 —— 表头与数据行共用,保证对齐。
const COL_TEMPLATE = "1.9fr .9fr .9fr .9fr .8fr 1fr .9fr";

// 生效中的绿色徽标 / 已吊销的红色徽标。
function statusMeta(status: LicenseStatus): { label: string; cls: string } {
  return status === "revoked"
    ? { label: "已吊销", cls: "bg-c-tint-r text-c-danger" }
    : { label: "生效中", cls: "bg-c-tint-g text-c-success" };
}

// created_at / expires_at 统一裁成 YYYY-MM-DD。
function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

export function LicensesClient({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();

  const [licenses, setLicenses] = React.useState<LicenseRow[]>([]);
  const [stats, setStats] = React.useState<LicenseStats>({
    issued: 0,
    active: 0,
    revoked: 0,
    activations: 0,
  });
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // 非管理员(401/403)→ 显示无权限页,不渲染授权管理界面。
  const [denied, setDenied] = React.useState(false);
  // 本站是否为许可证签发站(默认 true,GET 回来再校正);非签发站禁止生成。
  const [issuer, setIssuer] = React.useState(true);
  // 首次 GET 是否已返回:嵌入模式在结果回来前不渲染,非签发站(买家实例)直接整块隐藏。
  const [loaded, setLoaded] = React.useState(false);

  // 生成控件状态
  const [count, setCount] = React.useState("10");
  const [expiry, setExpiry] = React.useState<ExpiryValue>("365");
  const [deviceLimit, setDeviceLimit] = React.useState("3");
  const [note, setNote] = React.useState("");
  const [generating, setGenerating] = React.useState(false);

  // 本批新生成的 key(高亮 + 一键复制全部,方便导出上传卡密池)。
  const [freshKeys, setFreshKeys] = React.useState<string[]>([]);

  // 生成批次序号(批次号 L-YYMM-XX 用,确定性递增)。
  const seedRef = React.useRef(1000);

  // 载入:GET /api/operator/licenses(站长 token 鉴权)。
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/operator/licenses", {
          headers: await authHeader(),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setDenied(true);
          else setLoadError(data.error || "加载失败");
          return;
        }
        setLicenses(data.licenses as LicenseRow[]);
        setStats(data.stats as LicenseStats);
        setIssuer(data.issuer !== false);
      } catch {
        if (!cancelled) setLoadError("网络异常");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countNum = Number(count);
  const deviceLimitNum = Number(deviceLimit);
  const countValid = Number.isInteger(countNum) && countNum > 0 && countNum <= 500;
  const deviceLimitValid =
    Number.isInteger(deviceLimitNum) && deviceLimitNum > 0 && deviceLimitNum <= 100;

  // 本批新生成的 key,按当前列表顺序稳定标记高亮。
  const freshSet = React.useMemo(() => new Set(freshKeys), [freshKeys]);
  const [page, setPage] = React.useState(0);
  const LICENSES_PER_PAGE = 10;
  const pageCount = Math.max(1, Math.ceil(licenses.length / LICENSES_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedLicenses = licenses.slice(
    safePage * LICENSES_PER_PAGE,
    safePage * LICENSES_PER_PAGE + LICENSES_PER_PAGE
  );

  // ── 批量生成(POST /api/operator/licenses,服务端生成入库) ──
  const handleGenerate = async () => {
    if (!issuer) {
      toast("本站不是签发站,请到国内主站后台生成许可证", "error");
      return;
    }
    if (!countValid) {
      toast("数量需 1–500 的整数", "error");
      return;
    }
    if (!deviceLimitValid) {
      toast("设备数需 1–100 的整数", "error");
      return;
    }
    setGenerating(true);
    const today = new Date().toISOString().slice(0, 10);
    const batchId = `L-${today.slice(2, 4)}${today.slice(5, 7)}-${(
      seedRef.current++ % 100
    )
      .toString(36)
      .toUpperCase()
      .padStart(2, "0")}`;
    try {
      const res = await fetch("/api/operator/licenses", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({
          count: countNum,
          deviceLimit: deviceLimitNum,
          expiryDays: expiry === "0" ? null : Number(expiry),
          batch: batchId,
          note: note.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) setDenied(true);
        else toast(data.error || "生成失败", "error");
        return;
      }
      const fresh = data.licenses as LicenseRow[];
      setLicenses((prev) => [...fresh, ...prev]);
      setPage(0);
      setStats(data.stats as LicenseStats);
      setFreshKeys(fresh.map((l) => l.key));
      toast(`已生成 ${fresh.length} 个 License`, "success");
    } catch {
      toast("网络异常,请重试", "error");
    } finally {
      setGenerating(false);
    }
  };

  // ── 吊销 / 恢复(PATCH /api/operator/licenses,乐观更新 + 失败回滚) ──
  const handleToggle = async (key: string) => {
    const target = licenses.find((l) => l.key === key);
    if (!target) return;
    const next: LicenseStatus = target.status === "revoked" ? "active" : "revoked";
    // 吊销要二次确认(会让已绑定部署失效)。
    if (
      next === "revoked" &&
      !window.confirm(`确认吊销 License ${key}?吊销后已绑定的部署将无法继续校验。`)
    ) {
      return;
    }
    setLicenses((prev) =>
      prev.map((l) => (l.key === key ? { ...l, status: next } : l))
    );
    setStats((prev) => {
      const d = next === "revoked" ? -1 : 1;
      return { ...prev, active: prev.active + d, revoked: prev.revoked - d };
    });
    try {
      const res = await fetch("/api/operator/licenses", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ key, status: next }),
      });
      if (!res.ok) throw new Error();
      toast(next === "revoked" ? "已吊销该 License" : "已恢复该 License", "info");
    } catch {
      setLicenses((prev) =>
        prev.map((l) => (l.key === key ? { ...l, status: target.status } : l))
      );
      setStats((prev) => {
        const d = next === "revoked" ? -1 : 1;
        return { ...prev, active: prev.active - d, revoked: prev.revoked + d };
      });
      toast("操作失败,请重试", "error");
    }
  };

  // ── 复制单个 key ──
  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast("已复制 License", "success");
    } catch {
      toast("复制失败,请手动选择", "error");
    }
  };

  // ── 复制本批全部(换行分隔,直接粘进爱发电卡密池) ──
  const handleCopyBatch = async () => {
    if (freshKeys.length === 0) return;
    try {
      await navigator.clipboard.writeText(freshKeys.join("\n"));
      toast(`已复制本批 ${freshKeys.length} 个 License`, "success");
    } catch {
      toast("复制失败,请手动选择", "error");
    }
  };

  // 嵌入后台:非签发站(买家自托管实例)整块隐藏——「生成 License」是官方签发站
  // 专属运营功能,买家实例不该看到这块界面(标题也在组件内,一起消失)。
  if (embedded && (!loaded || !issuer || denied)) return null;

  if (denied) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 px-5 text-center">
        <h1 className="text-[18px] font-bold text-c-text">需要管理员权限</h1>
        <p className="text-[13.5px] text-c-text3">
          授权管理是站长后台功能,当前账号无权访问。
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
      {/* 嵌入模式:自带分隔与标题(签发站才会走到这里,非签发站上面已 return null) */}
      {embedded && (
        <div className="mb-2 mt-8 flex items-center gap-2 border-t border-border pt-6 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" />
          授权管理
        </div>
      )}
      {/* 面包屑 + 标题行(嵌入模式隐藏页级大标题头,仅保留加载错误提示) */}
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <nav className="flex items-center gap-1.5 text-[12.5px] text-c-text3">
              <Link href="/deploy" className="transition-colors hover:text-c-text">
                部署中心
              </Link>
              <ChevronRight size={13} className="text-c-text4" />
              <span className="text-c-text2">我的授权</span>
            </nav>
            <h1 className="mt-2 text-[24px] font-bold leading-tight text-c-text">
              授权管理 · 站长后台
            </h1>
            <p className="mt-1 text-[13.5px] text-c-text3">
              批量生成 Pro 自托管 License,导出上传到爱发电卡密池售卖
            </p>
            {loadError && (
              <p className="mt-1.5 text-[12.5px] text-c-danger">
                {loadError} · 需站长账号登录
              </p>
            )}
          </div>
        </div>
      ) : (
        loadError && (
          <p className="text-[12.5px] text-c-danger">
            {loadError} · 需站长账号登录
          </p>
        )
      )}

      {/* 统计 grid */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatCard label="已发放" value={stats.issued} suffix="个" />
        <StatCard
          label="生效中"
          value={<span className="text-c-success">{stats.active}</span>}
          suffix="个"
        />
        <StatCard
          label="已吊销"
          value={<span className="text-c-danger">{stats.revoked}</span>}
          suffix="个"
        />
        <StatCard label="已激活设备" value={stats.activations} accent suffix="台" />
      </div>

      {/* 生成 License 卡 */}
      <section className="mt-6 rounded-card border border-c-border bg-c-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-acc" />
          <h2 className="text-[15px] font-semibold text-c-text">生成 License</h2>
        </div>

        {/* 非签发站警示:此处生成的 Key 落本站独立库,买家默认校验国内主站查不到 →
            激活不了的死 Key。引导到国内主站后台发放。 */}
        {!issuer && (
          <div className="mt-4 rounded-[12px] border border-c-danger/40 bg-c-tint-r/40 px-4 py-3 text-[12.5px] leading-relaxed text-c-danger">
            本站不是许可证「签发站」。买家实例默认向国内主站 ai.starzeco.com 校验,
            此处生成的 Key 存在本站独立数据库、买家将无法激活。
            <b>请到国内主站后台「授权管理」生成并发放许可证。</b>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
              生成数量(1–500)
            </label>
            <Input
              value={count}
              inputMode="numeric"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCount(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="10"
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
          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-c-text3">
              设备数上限
            </label>
            <Input
              value={deviceLimit}
              inputMode="numeric"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDeviceLimit(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="3"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className="min-w-[260px] flex-1">
            <Input
              value={note}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNote(e.target.value)
              }
              placeholder="备注,例如:爱发电 · 源码 Pro 版"
            />
          </div>
          <Button
            variant="primary"
            size="md"
            loading={generating}
            disabled={!issuer || !countValid || !deviceLimitValid}
            onClick={handleGenerate}
            title={!issuer ? "本站非签发站,请到国内主站生成" : undefined}
          >
            <Sparkles size={15} />
            生成
          </Button>
        </div>

        {/* 本批新生成:高亮 + 一键复制全部 */}
        {freshKeys.length > 0 && (
          <div className="mt-5 rounded-[12px] border border-c-border bg-c-tint-g/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-c-text">
                本批新生成 {freshKeys.length} 个 License
              </span>
              <Button variant="secondary" size="sm" onClick={handleCopyBatch}>
                <Copy size={14} />
                复制全部
              </Button>
            </div>
            <div className="mt-3 max-h-[160px] overflow-auto rounded-[8px] bg-c-card p-3">
              <ul className="flex flex-col gap-1">
                {freshKeys.map((k) => (
                  <li
                    key={k}
                    className="truncate font-mono text-[12.5px] text-c-text2"
                  >
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* 列表 */}
      <section className="mt-6 rounded-card border border-c-border bg-c-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-c-line px-6 py-4">
          <h2 className="text-[15px] font-semibold text-c-text">License 列表</h2>
          <span className="text-[12.5px] text-c-text3">{licenses.length} 个</span>
        </div>

        {/* 表头 */}
        <div
          className="grid items-center gap-3 border-b border-c-line px-6 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-c-text4"
          style={{ gridTemplateColumns: COL_TEMPLATE }}
        >
          <span>License Key</span>
          <span>版本</span>
          <span>状态</span>
          <span>有效期</span>
          <span>设备</span>
          <span>创建 / 备注</span>
          <span className="text-right">操作</span>
        </div>

        {/* 行 */}
        {licenses.length === 0 ? (
          <div className="px-6 py-14 text-center text-[13px] text-c-text3">
            暂无 License,先在上方生成一批
          </div>
        ) : (
          <ul>
            {pagedLicenses.map((l) => {
              const meta = statusMeta(l.status);
              const isFresh = freshSet.has(l.key);
              return (
                <li
                  key={l.key}
                  className={cn(
                    "grid items-center gap-3 border-b border-c-line px-6 py-3.5 last:border-b-0 transition-colors hover:bg-c-subtle2",
                    isFresh && "bg-c-tint-g/30"
                  )}
                  style={{ gridTemplateColumns: COL_TEMPLATE }}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-[13px] text-c-text">
                      {l.key}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(l.key)}
                      aria-label="复制 License"
                      title="复制"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
                    >
                      <Copy size={13} />
                    </button>
                  </span>
                  <span className="truncate text-[12.5px] text-c-text2">
                    {l.tier}
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
                    {l.expires_at ? (
                      fmtDate(l.expires_at)
                    ) : (
                      <span className="text-c-text3">永久</span>
                    )}
                  </span>
                  <span className="text-[12.5px] font-medium text-c-text2">
                    <span
                      className={cn(
                        l.activations >= l.device_limit && "text-c-danger"
                      )}
                    >
                      {l.activations}
                    </span>
                    <span className="text-c-text4">/{l.device_limit}</span>
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-c-text3">
                    <span className="text-c-text2">{fmtDate(l.created_at)}</span>
                    {l.note ? (
                      <span className="text-c-text4"> · {l.note}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggle(l.key)}
                      className={cn(
                        "rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                        l.status === "revoked"
                          ? "text-c-success hover:bg-c-tint-g"
                          : "text-c-danger hover:bg-c-tint-r"
                      )}
                    >
                      {l.status === "revoked" ? "恢复" : "吊销"}
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
              totalLabel={`共 ${licenses.length} 个`}
            />
          </div>
        )}
      </section>
    </Shell>
  );
}

/* ── 外壳:按 embedded 切换页级包裹 ──
 * embedded=false(独立页 /licenses):外层大 padding 容器,与原样一致。
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
