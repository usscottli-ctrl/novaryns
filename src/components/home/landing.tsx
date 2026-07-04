"use client";

import { cdnUrl } from "@/lib/cdn";
import Link from "next/link";
import {
  Sparkles,
  Layers,
  Scissors,
  Workflow,
  Shirt,
  Megaphone,
  ArrowRight,
  Github,
  Check,
} from "lucide-react";
import { Media } from "@/components/media";
import { HeroCompare } from "@/components/home/hero-compare";
import { useI18n } from "@/lib/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import type { PickedTemplate } from "@/lib/homepage-picks";

// 开源仓库地址(开源前为占位,公开后替换)。
const GITHUB_URL = "https://github.com/usscottli-ctrl/novaryns";

// hero「随手拍 → AI 成片」对比素材(取自风扇模板:白底原图 + 赛博朋克成片)。
const HERO_BEFORE =
  "https://pub-d4d9c8471e8d4d94b159b20f7fbdb7d7.r2.dev/sources/src-1779435173185.jpeg";
const HERO_AFTER =
  "https://pub-d4d9c8471e8d4d94b159b20f7fbdb7d7.r2.dev/generations/gen-1779435172860-0.png";

export function Landing({ hot }: { hot: PickedTemplate[] }) {
  const { locale } = useI18n();
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  // 仅官方站(NOVARYNS_EDITION=cloud)显示"我们的"销售内容(三档定价 / 开通云端 /
  // 指向我们的 GitHub);自部署实例一律不显示——那是我们的获客漏斗,不该出现在别人的站上。
  const { official } = usePaymentConfig();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);

  const start = () => {
    if (user) {
      window.location.href = "/generate";
    } else {
      openAuth();
    }
  };

  const features = [
    {
      Icon: Sparkles,
      title: L("AI 生图", "AI generation"),
      desc: L(
        "一句话或参考图,几秒出可上架的电商商业图。",
        "One sentence or a reference — listing-ready shots in seconds."
      ),
    },
    {
      Icon: Layers,
      title: L("一键套图", "One-click suite"),
      desc: L(
        "上传产品图,自动出主图 + 副图 + 详情页整套素材。",
        "Upload a product, auto-generate hero + secondary + detail set."
      ),
    },
    {
      Icon: Scissors,
      title: L("抠图改图", "Cutout & edit"),
      desc: L(
        "抠图、局部改图、变清晰、风格转换、融图,一站搞定。",
        "Cutout, inpaint, upscale, restyle, fuse — all in one place."
      ),
    },
    {
      Icon: Workflow,
      title: L("节点式画布", "Node canvas"),
      desc: L(
        "在血缘画布上自由编排、迭代,版本派生一目了然。",
        "Compose and iterate freely on a lineage canvas."
      ),
    },
    {
      Icon: Shirt,
      title: L("服装电商", "Apparel"),
      desc: L(
        "服装上身、服装提取、3D 服装图、去皱,服饰全覆盖.",
        "Virtual try-on, garment extract, 3D garment, de-wrinkle."
      ),
    },
    {
      Icon: Megaphone,
      title: L("营销工具", "Marketing"),
      desc: L(
        "标题生成、印花提取、营销海报、详情页拼接、多语言翻译,营销一条龙.",
        "Titles, print extract, posters, detail pages, translation."
      ),
    },
  ];

  const trust = [
    L("无需信用卡", "No credit card"),
    L("AGPL 开源", "AGPL open-source"),
    L("Docker 一键部署", "One-click Docker deploy"),
  ];

  return (
    <div className="w-full">
      {/* ───────── Hero ───────── */}
      <section className="bg-aurora relative overflow-hidden">
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-[13px] font-medium text-muted-foreground shadow-[var(--shadow-card)]">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {L(
              "开源 · 可自部署的电商 AI 出图工作站",
              "Open-source · self-hostable e-commerce AI image studio"
            )}
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-[1.12] tracking-tight text-foreground sm:text-6xl">
            {L("电商商品图", "E-commerce shots,")}
            <br />
            {L("一句话，AI 直接出图", "one sentence — AI delivers")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {L(
              `从生图、套图到抠图改图与节点式画布工作流，${BRAND} 覆盖电商出图全流程。开源免费，亦可一键私有部署。`,
              `From generation and suites to editing and a node-based canvas workflow, ${BRAND} covers the whole e-commerce imaging pipeline. Free & open-source, or self-host in one click.`
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-white shadow-[var(--shadow-btn)] transition-[filter] [background:var(--grad-acc)] hover:brightness-[1.07]"
            >
              {L("免费开始创作", "Start creating free")}
              <ArrowRight className="h-4 w-4" />
            </button>
            {official && (
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                <Github className="h-[18px] w-[18px]" />
                GitHub
              </a>
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            {trust.map((tx) => (
              <span key={tx} className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" />
                {tx}
              </span>
            ))}
          </div>

          {/* 随手拍 → AI 成片 对比(可拖动) */}
          <div className="mx-auto mt-12 max-w-3xl">
            <HeroCompare
              before={HERO_BEFORE}
              after={HERO_AFTER}
              beforeLabel={L("随手拍 · 原图", "Snapshot")}
              afterLabel={L("AI 成片", "AI result")}
            />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {L(
                "← 拖动对比 · 随手拍的产品图，一句话变成可上架的商业大片",
                "← Drag to compare · a quick snapshot becomes a listing-ready hero shot"
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ───────── 成片展示 ───────── */}
      {hot.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {hot.slice(0, 6).map((tpl) => (
              <Link
                key={tpl.id}
                href={user ? `/generate?template=${encodeURIComponent(tpl.id)}` : "#"}
                onClick={(e) => {
                  if (!user) {
                    e.preventDefault();
                    openAuth();
                  }
                }}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-transform hover:-translate-y-1"
              >
                <Media
                  src={cdnUrl(tpl.image)}
                  alt={tpl.title}
                  gradient={tpl.gradient}
                  thumbWidth={480}
                  ratio="aspect-[3/4]"
                  className="rounded-none border-0"
                />
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  {L("AI 成片", "AI result")}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ───────── 能力区 ───────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {L("覆盖电商出图全流程", "The whole e-commerce imaging pipeline")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted-foreground sm:text-base">
          {L(
            "从一张随手拍到整套可上架素材,一个工作站全部搞定。",
            "From a quick snapshot to a full listing-ready set — one workstation does it all."
          )}
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.Icon className="h-[22px] w-[22px]" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-foreground">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 画布工作流展示 ───────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid items-center gap-8 overflow-hidden rounded-3xl border border-c-border bg-c-card p-6 shadow-card sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
          {/* 左:文案 */}
          <div className="flex flex-col gap-4">
            <span className="self-start rounded-full bg-[#F4ECFE] px-3 py-1.5 text-[12px] font-semibold text-[#9869F2]">
              {L("画布工作流", "Canvas workflow")}
            </span>
            <h2 className="text-[26px] font-bold leading-snug tracking-tight text-c-text sm:text-[28px]">
              {L("把生图、抠图、套图", "Chain generation, cutout & suites")}
              <br />
              {L("串成一条可复用的流程", "into one reusable flow")}
            </h2>
            <p className="text-[14.5px] leading-relaxed text-c-text3">
              {L(
                "节点式画布让你像搭积木一样组合 AI 步骤:上传参考 → 生成 → 批量套图 → 导出。流程可保存、可复用,一次搭好,长期受益。",
                "Compose AI steps like building blocks: upload → generate → batch suite → export. Save and reuse the flow — build once, benefit long-term."
              )}
            </p>
            <ul className="mt-1 flex flex-col gap-2.5">
              {[
                L("可视化节点 · 连线自动跟随", "Visual nodes · links auto-follow"),
                L("一次配置,批量出图", "Configure once, batch output"),
                L("流程模板一键套用", "One-click flow templates"),
              ].map((tx) => (
                <li
                  key={tx}
                  className="flex items-center gap-2.5 text-[13.5px] text-c-text2"
                >
                  <Check className="h-4 w-4 flex-none text-acc" strokeWidth={2.4} />
                  {tx}
                </li>
              ))}
            </ul>
          </div>
          {/* 右:画布预览(深色点阵 + 连线 + 节点卡;流程依次点亮动画) */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#23252C] bg-[#0E0F13] [background-image:radial-gradient(#1F2024_1px,transparent_1px)] [background-size:24px_24px]">
            <style
              dangerouslySetInnerHTML={{
                __html: `
@keyframes nvCvDraw{0%{stroke-dashoffset:200}45%,100%{stroke-dashoffset:0}}
@keyframes nvCvDraw3{0%,50%{stroke-dashoffset:120}80%,100%{stroke-dashoffset:0}}
@keyframes nvCvLit{0%,100%{border-color:#2A2C34;filter:none}8%,22%{border-color:#6366F1;filter:drop-shadow(0 0 8px rgba(99,102,241,.55))}}
@keyframes nvCvEng{0%,100%{border-color:#4F46E5;box-shadow:0 0 0 0 rgba(79,70,229,0)}40%{border-color:#818CF8;box-shadow:0 0 0 6px rgba(79,70,229,.3)}}
@keyframes nvCvOut{0%,60%{filter:none;transform:scale(1)}72%{filter:drop-shadow(0 0 12px rgba(255,255,255,.5));transform:scale(1.07)}88%,100%{filter:none;transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.nv-cv-anim [style*=animation]{animation:none!important}}
`,
              }}
            />
            <div className="nv-cv-anim absolute inset-0">
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 400 300"
                preserveAspectRatio="none"
              >
                <path
                  d="M120 90 C 180 90 160 150 215 150"
                  fill="none"
                  stroke="#6366F1"
                  strokeWidth="2.2"
                  strokeDasharray="200"
                  style={{
                    strokeDashoffset: 200,
                    animation: "nvCvDraw 3.6s ease-in-out infinite .4s",
                  }}
                />
                <path
                  d="M120 210 C 180 210 160 150 215 150"
                  fill="none"
                  stroke="#6366F1"
                  strokeWidth="2.2"
                  strokeDasharray="200"
                  style={{
                    strokeDashoffset: 200,
                    animation: "nvCvDraw 3.6s ease-in-out infinite .4s",
                  }}
                />
                <path
                  d="M320 150 C 350 150 350 110 372 110"
                  fill="none"
                  stroke="#8B5CF6"
                  strokeWidth="2.2"
                  strokeDasharray="120"
                  style={{
                    strokeDashoffset: 120,
                    animation: "nvCvDraw3 3.6s ease-in-out infinite 1.8s",
                  }}
                />
              </svg>
              {/* 提示词节点 */}
              <div
                className="absolute left-[6%] top-[19%] flex h-[50px] w-[78px] items-center justify-center rounded-[9px] border border-[#2A2C34] bg-[#191A20] text-[10px] font-semibold text-[#A6AAB4]"
                style={{ animation: "nvCvLit 3.6s ease-in-out infinite" }}
              >
                {L("提示词", "Prompt")}
              </div>
              {/* 参考图节点 */}
              <div
                className="absolute left-[6%] top-[59%] flex h-[50px] w-[78px] items-center justify-center rounded-[9px] border border-[#2A2C34] bg-[#191A20] text-[10px] font-semibold text-[#A6AAB4]"
                style={{ animation: "nvCvLit 3.6s ease-in-out infinite" }}
              >
                {L("参考图", "Reference")}
              </div>
              {/* 生成引擎节点(中心) */}
              <div
                className="absolute left-1/2 top-1/2 w-[120px] -translate-x-1/2 -translate-y-1/2 rounded-[11px] border border-acc bg-[#191A20] p-3"
                style={{ animation: "nvCvEng 3.6s ease-in-out infinite 1.4s" }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 rounded-[4px] [background:linear-gradient(160deg,#6366F1,#4F46E5)]" />
                  <span className="text-[11px] font-semibold text-[#ECEDF1]">
                    {L("生成引擎", "Engine")}
                  </span>
                </div>
                <div className="mb-1.5 h-[7px] rounded-[3px] bg-[#2A2C34]" />
                <div className="h-[7px] w-[70%] rounded-[3px] bg-[#2A2C34]" />
              </div>
              {/* 成品节点 */}
              <div
                className="absolute right-[3.5%] top-[29%] h-[56px] w-[56px] rounded-[9px] [background:radial-gradient(120%_90%_at_50%_16%,#FBFBFD,#DEE2EA)] shadow-[0_8px_18px_-6px_rgba(0,0,0,.5)]"
                style={{ animation: "nvCvOut 3.6s ease-in-out infinite 2.4s" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── 开源 / 自部署 三档(仅官方站显示;自部署实例隐藏我们的销售内容) ───────── */}
      {official && (
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight text-c-text sm:text-3xl">
          {L("开源核心,商业增值", "Open core, commercial upgrades")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-c-text3 sm:text-base">
          {L(
            "代码 AGPL 开源,可自由自部署;也提供云端托管与 Pro 商业授权。",
            "AGPL-licensed core you can self-host freely — plus managed cloud and a Pro commercial license."
          )}
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              name: L("开源自部署", "Self-host"),
              price: "¥0",
              badge: { text: "AGPL-3.0", kind: "agpl" as const },
              rows: [
                L("全部基础生成与图像工具", "All core generation & image tools"),
                L("自带算力 · API Key", "Bring your own compute / API key"),
                L("社区支持", "Community support"),
              ],
              cta: { label: L("查看 GitHub", "View GitHub"), href: GITHUB_URL, primary: false, external: true },
              featured: false,
            },
            {
              name: L("Pro 自托管", "Pro self-host"),
              price: L("¥1,999/年起", "from ¥1,999/yr"),
              badge: { text: L("推荐", "Recommended"), kind: "gold" as const },
              tag: L("源码授权", "Source license"),
              rows: [
                L("含 Pro 全部能力源码", "Full Pro source code"),
                L("商业授权 · 可闭源自用", "Commercial license · closed-source OK"),
                L("License Key 激活 · 优先支持", "License Key · priority support"),
              ],
              cta: { label: L("获取授权", "Get a license"), href: "/deploy", primary: true, external: false },
              featured: true,
            },
            {
              name: L("云端托管", "Cloud"),
              price: L("¥3,999/年起", "from ¥3,999/yr"),
              badge: { text: L("免运维", "Zero-ops"), kind: "blue" as const },
              rows: [
                L("免部署 · 自动更新", "Zero-ops · auto updates"),
                L("大陆可用 · 无需自备中转", "Works in mainland China · no relay needed"),
                L("弹性算力 · 优先队列", "Elastic compute · priority queue"),
                L("绑定域名 · 白标", "Custom domain · white-label"),
              ],
              cta: { label: L("开通云端", "Go cloud"), href: "/deploy", primary: false, external: false },
              featured: false,
            },
          ].map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col rounded-card border bg-c-card p-6",
                tier.featured
                  ? "border-[1.5px] border-acc shadow-pop"
                  : "border-c-border shadow-card"
              )}
            >
              {tier.badge.kind === "gold" && (
                <span className="absolute -top-2.5 right-5 rounded-[5px] bg-c-gold px-2 py-0.5 text-[10.5px] font-bold text-white">
                  {tier.badge.text}
                </span>
              )}
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-bold text-c-text">{tier.name}</h3>
                {tier.badge.kind === "agpl" && (
                  <span className="rounded-[5px] border border-c-success px-1.5 py-0.5 text-[10.5px] font-semibold text-c-success">
                    {tier.badge.text}
                  </span>
                )}
                {tier.badge.kind === "blue" && (
                  <span className="rounded-[5px] bg-c-tint-b px-1.5 py-0.5 text-[10.5px] font-semibold text-c-blue">
                    {tier.badge.text}
                  </span>
                )}
                {"tag" in tier && tier.tag && (
                  <span className="rounded-[5px] bg-c-tint-b px-1.5 py-0.5 text-[10.5px] font-semibold text-c-blue">
                    {tier.tag}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[24px] font-extrabold tracking-tight text-c-text">
                {tier.price}
              </p>
              <ul className="mt-4 flex-1 space-y-2.5">
                {tier.rows.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-[13px] text-c-text2">
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 flex-none",
                        tier.featured ? "text-acc" : "text-c-success"
                      )}
                    />
                    {r}
                  </li>
                ))}
              </ul>
              {tier.cta.primary ? (
                <Link
                  href={tier.cta.href}
                  className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-[11px] px-5 py-2.5 text-[14px] font-semibold text-white shadow-btn [background:var(--grad-acc)] transition-all hover:brightness-95"
                >
                  {tier.cta.label}
                </Link>
              ) : tier.cta.external ? (
                <a
                  href={tier.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-card px-5 py-2.5 text-[14px] font-medium text-c-text transition-colors hover:bg-c-subtle2"
                >
                  {tier.cta.label}
                </a>
              ) : (
                <Link
                  href={tier.cta.href!}
                  className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-card px-5 py-2.5 text-[14px] font-medium text-c-text transition-colors hover:bg-c-subtle2"
                >
                  {tier.cta.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
      )}

      {/* ───────── 底部 CTA ───────── */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <div className="bg-dark-module relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:py-16">
          <h2 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
            {L("现在就开始,免费出第一张图", "Start now — your first image is free")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
            {official
              ? L(
                  "注册即送积分,无需信用卡。也可在 GitHub 自部署私有版。",
                  "Sign up for free credits, no card needed. Or self-host from GitHub."
                )
              : L(
                  "一句话,AI 直接出图,覆盖电商出图全流程。",
                  "One sentence, AI delivers — the whole e-commerce imaging pipeline."
                )}
          </p>
          <button
            type="button"
            onClick={start}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-[15px] font-bold text-[#16181D] transition-transform hover:scale-[1.03]"
          >
            {L("免费开始创作", "Start creating free")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}
