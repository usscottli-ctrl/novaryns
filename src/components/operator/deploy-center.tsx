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
import { Switch } from "@/components/ui/switch";
import { DropZone, UploadedThumb } from "@/components/ui/dropzone";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { authHeader } from "@/lib/supabase";
import { ProDownloadModal } from "@/components/operator/pro-download-modal";
import { CloudModal } from "@/components/operator/cloud-modal";

type InstallTab = "docker" | "script" | "platform";
type BrandColor = "indigo" | "blue" | "violet";

// 真实安装命令:compose 一键起 app + 内置 Postgres + 数据卷(首启向导可落库)。
// 镜像由仓库 GitHub Actions 构建推送 ghcr.io/usscottli-ctrl/novaryns:latest。
const DOCKER_CMD =
  "git clone https://github.com/usscottli-ctrl/novaryns && cd novaryns && docker compose up -d";
const SCRIPT_CMD =
  "curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash";

const BRAND_COLORS: { value: BrandColor; hex: string; label: string }[] = [
  { value: "indigo", hex: "#4F46E5", label: "靛蓝" },
  { value: "blue", hex: "#2E7CF6", label: "湖蓝" },
  { value: "violet", hex: "#7C3AED", label: "紫罗兰" },
];

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

  // 一键安装
  const [installTab, setInstallTab] = React.useState<InstallTab>("docker");
  const [copiedCmd, setCopiedCmd] = React.useState(false);
  const [licenseInput, setLicenseInput] = React.useState("");

  // 云端品牌与域名
  const [subdomain, setSubdomain] = React.useState("");
  const [customDomain, setCustomDomain] = React.useState("");
  const [brandColor, setBrandColor] = React.useState<BrandColor>("indigo");
  const [logo, setLogo] = React.useState<string | null>(null);
  const [whiteLabel, setWhiteLabel] = React.useState(false);

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

  function onLogoFiles(files: File[]) {
    const f = files[0];
    if (f) setLogo(URL.createObjectURL(f));
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
              <Button asChild variant="secondary" size="md">
                <Link href="/licenses">
                  <Lock size={14} />
                  我的授权
                </Link>
              </Button>
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

          {/* License Key 激活 */}
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
        </section>

        {/* ── 云端品牌与域名卡 ── */}
        <section className="mt-6 rounded-card border border-c-border bg-c-card p-6 shadow-card">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-bold text-c-text">云端品牌与域名</h2>
            <span className="inline-flex items-center rounded-[6px] bg-c-tint-gold px-1.5 py-[2px] text-[10px] font-bold text-c-gold">
              PRO
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-c-text3">
            白标你的实例：专属域名、品牌主色、隐藏来源署名。
          </p>

          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
            {/* 专属子域名 */}
            <Field label="专属子域名">
              <div className="flex items-stretch overflow-hidden rounded-[10px] border border-c-border2 bg-c-subtle2 focus-within:border-[1.5px] focus-within:border-acc focus-within:bg-c-card">
                <input
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  placeholder="yourbrand"
                  spellCheck={false}
                  className="h-[40px] min-w-0 flex-1 bg-transparent px-[13px] text-[13.5px] text-c-text placeholder:text-c-text4 focus-visible:outline-none"
                />
                <span className="flex select-none items-center border-l border-c-border2 bg-c-subtle px-3 text-[13px] text-c-text4">
                  .novaryns.app
                </span>
              </div>
            </Field>

            {/* 绑定独立域名 */}
            <Field label="绑定独立域名">
              <div className="flex items-center gap-2">
                <Input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="shop.yourbrand.com"
                  spellCheck={false}
                  className="flex-1"
                />
                <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-c-tint-g px-2 py-[5px] text-[11px] font-semibold text-c-success">
                  <Check size={12} strokeWidth={2.6} />
                  已验证
                </span>
              </div>
            </Field>

            {/* 品牌主色 */}
            <Field label="品牌主色">
              <div className="flex items-center gap-3.5">
                {BRAND_COLORS.map((c) => {
                  const active = brandColor === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-label={c.label}
                      aria-pressed={active}
                      onClick={() => setBrandColor(c.value)}
                      className={cn(
                        "h-7 w-7 rounded-full transition-transform hover:scale-105",
                        active && "ring-2 ring-acc ring-offset-2"
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  );
                })}
              </div>
            </Field>

            {/* 品牌 Logo */}
            <Field label="品牌 Logo">
              {logo ? (
                <div className="flex items-center gap-3">
                  <UploadedThumb src={logo} onRemove={() => setLogo(null)} />
                  <span className="text-[12px] text-c-text3">已上传,点击 ✕ 移除</span>
                </div>
              ) : (
                <DropZone
                  compact
                  onFiles={onLogoFiles}
                  title="上传 Logo"
                  hint="PNG / SVG · 建议透明底"
                />
              )}
            </Field>
          </div>

          {/* 白标模式 */}
          <div className="mt-5 flex items-center justify-between rounded-[12px] border border-c-border bg-c-subtle2 px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-acc" />
              <div>
                <div className="text-[13.5px] font-semibold text-c-text">白标模式</div>
                <div className="mt-0.5 text-[12px] text-c-text3">
                  隐藏页脚「由星泽商图提供」,完全以你的品牌示人。
                </div>
              </div>
            </div>
            <Switch checked={whiteLabel} onChange={setWhiteLabel} />
          </div>
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

/* ── 字段容器 ── */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-medium text-c-text2">
        {label}
      </label>
      {children}
    </div>
  );
}
