"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Lock,
  Check,
  Copy,
  Github,
  Cloud,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { authHeader } from "@/lib/supabase";
import { ProDownloadModal } from "@/components/operator/pro-download-modal";
import { CloudModal } from "@/components/operator/cloud-modal";

type InstallTab = "docker" | "script" | "platform";

// 真实安装命令:compose 一键起 app + 内置 Postgres + 数据卷(首启向导可落库)。
// 镜像由仓库 GitHub Actions 构建推送 ghcr.io/usscottli-ctrl/novaryns:latest。
const DOCKER_CMD =
  "git clone https://github.com/usscottli-ctrl/novaryns && cd novaryns && docker compose up -d";
const SCRIPT_CMD =
  "curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash";

export function DeployCenter({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [showPro, setShowPro] = React.useState(false);
  const [showCloud, setShowCloud] = React.useState(false);
  // 是否管理员:调 admin-gated 接口(/api/cardkeys 非管理员 403)校验,
  // 决定是否显示「兑换码管理」站长入口。普通用户看不到。
  const [isAdmin, setIsAdmin] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/cardkeys", { headers: await authHeader() });
        if (!cancelled) setIsAdmin(r.ok);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 更新检查(管理员):向官方站查最新版本,有新版则提示。
  const [updateInfo, setUpdateInfo] = React.useState<{
    current: string;
    latest: string;
    currentLabel: string;
    latestLabel: string;
    updateAvailable: boolean;
    reachable: boolean;
    updateCmd: string;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/update-check", {
          headers: await authHeader(),
        });
        if (r.ok && !cancelled) setUpdateInfo(await r.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 一键安装
  const [installTab, setInstallTab] = React.useState<InstallTab>("docker");
  const [copiedCmd, setCopiedCmd] = React.useState(false);
  const [licenseInput, setLicenseInput] = React.useState("");

  // 本实例 Pro 状态(/api/health,公开):决定 License 激活区显示
  //   cloud → 整块隐藏(官方云本就 Pro,无需激活);
  //   pro   → 「已激活」横幅 + 下一步指引(买家最关心「生效没有 / 然后干嘛」);
  //   else  → 激活输入框。null = 还没查到,先按未激活渲染输入框。
  const [proState, setProState] = React.useState<{
    pro: boolean;
    edition: string;
    issuer: boolean;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/health");
        const d = await r.json();
        if (!cancelled && r.ok) {
          setProState({
            pro: !!d.pro,
            edition: String(d.edition || ""),
            issuer: !!d.issuer,
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentCmd = installTab === "script" ? SCRIPT_CMD : DOCKER_CMD;

  function copyCmd() {
    navigator.clipboard?.writeText(currentCmd).then(
      () => {
        setCopiedCmd(true);
        setTimeout(() => setCopiedCmd(false), 2000);
      },
      () => toast("复制失败,请手动选择", "error")
    );
  }

  async function handleActivate() {
    const v = licenseInput.trim();
    if (!v) {
      toast("请先填写 License Key", "error");
      return;
    }
    try {
      const res = await fetch("/api/pro/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ key: v }),
      });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !d?.ok) {
        toast(d?.error || "激活失败,请检查 License Key", "error");
        return;
      }
      toast("激活成功!Pro 已解锁,正在刷新…", "success");
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast("网络错误,请重试", "error");
    }
  }

  return (
    <Shell embedded={embedded}>
      <>
        {/* ── 顶部(嵌入模式隐藏页级大标题头) ── */}
        {!embedded && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-c-text3 transition-colors hover:text-c-text"
              >
                <ArrowLeft size={14} />
                返回首页
              </Link>
              <h1 className="mt-2 text-[26px] font-bold leading-tight text-c-text">
                部署中心 · 自部署 / 授权
              </h1>
              <p className="mt-1 text-[13.5px] text-c-text3">
                开源自部署、Pro 私有授权、云端托管 —— 任选其一
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {isAdmin && (
                <Button asChild variant="secondary" size="md">
                  <Link href="/cardkeys">
                    <Mail size={14} />
                    兑换码管理
                  </Link>
                </Button>
              )}
              {/* 授权管理入口仅签发站显示(买家实例上 /licenses 会被跳走,别给入口) */}
              {proState?.issuer && (
                <Button asChild variant="secondary" size="md">
                  <Link href="/licenses">
                    <Lock size={14} />
                    我的授权
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── 三档版本卡 ── */}
        <div className="mt-7 grid grid-cols-3 gap-5">
          {/* 开源版 */}
          <PlanCard
            title="开源版"
            price="¥0"
            badge={
              <span className="inline-flex items-center rounded-[6px] border border-c-success px-2 py-[3px] text-[10.5px] font-bold text-c-success">
                AGPL-3.0
              </span>
            }
            features={[
              "全部基础生成与图像工具",
              "自带算力 · API Key",
              "社区支持",
            ]}
            checkClass="text-c-success"
            footer={
              <Button asChild variant="secondary" size="md" className="w-full">
                <a
                  href="https://github.com/usscottli-ctrl/novaryns"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github size={15} />
                  查看 GitHub
                </a>
              </Button>
            }
          />

          {/* Pro 自托管(推荐) */}
          <PlanCard
            highlighted
            title="Pro 自托管"
            price="¥1,999"
            priceSuffix="/年起"
            ribbon="推荐"
            badge={
              <span className="inline-flex items-center rounded-[6px] bg-acc-tint px-2 py-[3px] text-[10.5px] font-bold text-acc">
                源码授权
              </span>
            }
            features={[
              "含 Pro 全部能力源码",
              "商业授权 · 可闭源自用",
              "License Key 激活 · 优先支持",
            ]}
            checkClass="text-acc"
            footer={
              <Button
                variant="primary"
                size="md"
                className="w-full"
                onClick={() => setShowPro(true)}
              >
                获取授权
              </Button>
            }
          />

          {/* 云端托管 */}
          <PlanCard
            title="云端托管"
            price="¥3,999"
            priceSuffix="/年起"
            badge={
              <span className="inline-flex items-center rounded-[6px] bg-c-tint-b px-2 py-[3px] text-[10.5px] font-bold text-c-blue">
                免运维
              </span>
            }
            features={[
              "免部署 · 自动更新",
              "大陆可用 · 无需自备中转",
              "弹性算力 · 优先队列",
              "绑定域名 · 白标",
            ]}
            checkClass="text-c-blue"
            footer={
              <Button
                variant="secondary"
                size="md"
                className="w-full"
                onClick={() => setShowCloud(true)}
              >
                <Cloud size={15} />
                开通云端
              </Button>
            }
          />
        </div>

        {/* ── 一键安装卡 ── */}
        <section className="mt-6 rounded-card border border-c-border bg-c-card p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-bold text-c-text">一键安装</h2>
              <p className="mt-0.5 text-[12.5px] text-c-text3">
                选择适合你的方式,几分钟内拉起自己的实例。
              </p>
            </div>
            <Segmented<InstallTab>
              options={[
                { value: "docker", label: "Docker" },
                { value: "script", label: "安装脚本" },
                { value: "platform", label: "一键平台" },
              ]}
              value={installTab}
              onChange={setInstallTab}
              className="w-[280px]"
            />
          </div>

          <div className="mt-4">
            {installTab === "platform" ? (
              <div className="grid grid-cols-4 gap-3">
                {["Railway", "Render", "Zeabur", "Sealos"].map((p) => (
                  <a
                    key={p}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="flex items-center justify-center rounded-[10px] border border-c-border2 bg-c-card px-3 py-3 text-[13px] font-semibold text-c-text transition-colors hover:border-acc hover:bg-acc-tint"
                  >
                    {p}
                  </a>
                ))}
              </div>
            ) : (
              <div className="relative">
                <pre className="overflow-x-auto rounded-field bg-[#15161B] p-4 pr-[88px] font-mono text-[12.5px] leading-relaxed text-[#E6E8EC]">
                  {currentCmd}
                </pre>
                <button
                  type="button"
                  onClick={copyCmd}
                  className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-[8px] bg-[rgba(255,255,255,.08)] px-2.5 py-1.5 text-[11.5px] font-medium text-[#E6E8EC] transition-colors hover:bg-[rgba(255,255,255,.16)]"
                >
                  {copiedCmd ? <Check size={13} /> : <Copy size={13} />}
                  {copiedCmd ? "已复制" : "复制"}
                </button>
              </div>
            )}
          </div>

          {/* 系统更新检查 */}
          {updateInfo && (
            <div
              className={`mt-5 rounded-xl border p-4 ${
                updateInfo.updateAvailable
                  ? "border-acc bg-acc/5"
                  : "border-c-line"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-c-text">
                  {updateInfo.updateAvailable
                    ? "🎉 有新版本可更新"
                    : "✓ 已是最新版本"}
                </span>
                <span className="text-[11.5px] text-c-text3">
                  当前版本 {updateInfo.currentLabel}
                </span>
              </div>
              {updateInfo.updateAvailable && (
                <>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-c-text3">
                    最新 {updateInfo.latestLabel}。在服务器的项目目录执行下面命令即可更新
                    <b className="text-c-text2">(数据不会丢失)</b>:
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-c-subtle2 px-2.5 py-1.5 font-mono text-[12px] text-c-text2">
                      {updateInfo.updateCmd}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigator.clipboard
                          ?.writeText(updateInfo.updateCmd)
                          .then(
                            () => toast("更新命令已复制", "success"),
                            () => toast("复制失败,请手动选择", "error")
                          )
                      }
                    >
                      复制
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* License Key 激活:官方云隐藏;已激活 → 绿色状态 + 下一步指引;未激活 → 输入框 */}
          {proState?.edition !== "cloud" &&
            (proState?.pro ? (
              <div className="mt-5 border-t border-c-line pt-5">
                <div className="rounded-xl border border-c-success/40 bg-c-tint-g/40 p-4">
                  <div className="flex items-center gap-2 text-[14px] font-bold text-c-success">
                    <ShieldCheck size={16} />
                    Pro 已激活,本站已是商业版
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-c-text3">
                    多用户注册、积分计费、收款、品牌白标等能力已全部解锁。接下来推荐:
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-c-text3">
                    <li>
                      到 <Link href="/admin" className="font-medium text-acc hover:underline">后台「登录与支付」</Link>
                      开启<b className="text-c-text2">多用户注册</b>,让客户注册买积分;
                    </li>
                    <li>
                      到 <Link href="/admin" className="font-medium text-acc hover:underline">后台「品牌与站点」</Link>
                      换成你自己的<b className="text-c-text2">站名和 Logo</b>;
                    </li>
                    <li>
                      到 <Link href="/admin" className="font-medium text-acc hover:underline">后台「积分计费」</Link>
                      配置注册赠送与扣费规则。
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-5 border-t border-c-line pt-5">
                <label className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-c-text2">
                  <KeyRound size={13} className="text-c-text3" />
                  License Key 激活（Pro 自托管）
                </label>
                <div className="flex gap-2">
                  <Input
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleActivate();
                    }}
                    placeholder="NOVA-XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 font-mono tracking-wide"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleActivate}
                    className="shrink-0"
                  >
                    激活
                  </Button>
                </div>
              </div>
            ))}
        </section>

        <ProDownloadModal open={showPro} onClose={() => setShowPro(false)} />
        <CloudModal open={showCloud} onClose={() => setShowCloud(false)} />
      </>
    </Shell>
  );
}

/* ── 外壳:按 embedded 切换页级包裹 ──
 * embedded=false(独立页 /deploy):min-h-screen 满屏底色 + 外层大 padding,与原样一致。
 * embedded=true(后台内嵌):后台内容区已有底色与内边距,这里只用普通容器包住内容。 */
function Shell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) return <div>{children}</div>;
  return (
    <div className="min-h-screen bg-c-bg">
      <div className="w-full px-5 py-7 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

/* ── 版本卡 ── */
function PlanCard({
  title,
  price,
  priceSuffix,
  badge,
  ribbon,
  features,
  checkClass,
  footer,
  highlighted,
}: {
  title: string;
  price: string;
  priceSuffix?: string;
  badge: React.ReactNode;
  ribbon?: string;
  features: string[];
  checkClass: string;
  footer: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-card bg-c-card p-5",
        highlighted
          ? "border-[1.5px] border-acc shadow-pop"
          : "border border-c-border shadow-card"
      )}
    >
      {ribbon && (
        <span className="absolute -top-2.5 right-4 rounded-[5px] bg-c-gold px-2 py-[3px] text-[10.5px] font-bold text-white shadow-btn">
          {ribbon}
        </span>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-c-text">{title}</h3>
        {badge}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[28px] font-bold leading-none text-c-text">{price}</span>
        {priceSuffix && (
          <span className="text-[13px] text-c-text3">{priceSuffix}</span>
        )}
      </div>
      <ul className="mt-4 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[12.5px] text-c-text2">
            <Check
              size={15}
              strokeWidth={2.6}
              className={cn("mt-[1px] shrink-0", checkClass)}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">{footer}</div>
    </div>
  );
}

