"use client";

import Link from "next/link";
import { Github, ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { LangSwitcher } from "@/components/lang-switcher";
import { useI18n } from "@/lib/i18n/locale-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { useBrand } from "@/lib/brand-context";
import { BRAND, BRAND_PARENT_URL, BRAND_PARENT_LABEL } from "@/lib/brand";

// 开源仓库地址(与首页 landing / 部署中心保持一致)。
const GITHUB_URL = "https://github.com/usscottli-ctrl/novaryns";

export function SiteFooter() {
  const { locale } = useI18n();
  const { pro, official } = usePaymentConfig();
  const { name: brandName } = useBrand();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  // 三栏(产品 / 资源 / 关于)—— 链接全部指向真实存在的路由,不造死链。
  // 定价 / 关于我们 / 联系我们:自部署实例也显示(内容由站长在后台「站点页面」自定义)。
  // 「开源仓库」指向我们的 GitHub,仅官方站显示。空栏自动不渲染。
  const columns: {
    title: string;
    links: { href: string; label: string; external?: true }[];
  }[] = [
    {
      title: L("产品", "Product"),
      links: [
        { href: "/generate", label: L("AI 生图", "AI Generate") },
        { href: "/suite", label: L("一键套图", "Image Suite") },
        { href: "/canvas", label: L("创作画布", "Canvas") },
        { href: "/templates", label: L("模板中心", "Templates") },
      ],
    },
    {
      title: L("资源", "Resources"),
      links: [
        { href: "/tools", label: L("创作工具", "Tools") },
        { href: "/dashboard", label: L("工作台", "Workspace") },
        { href: "/works", label: L("作品库", "Works") },
        { href: "/plans", label: L("定价", "Pricing") },
      ],
    },
    {
      title: L("关于", "About"),
      links: [
        // 开源仓库(指向我们的 GitHub)仅官方站显示。
        ...(official
          ? [
              {
                href: GITHUB_URL,
                label: L("开源仓库", "Open Source"),
                external: true as const,
              },
            ]
          : []),
        ...(BRAND_PARENT_URL
          ? [{ href: BRAND_PARENT_URL, label: BRAND_PARENT_LABEL, external: true as const }]
          : []),
        { href: "/about", label: L("关于我们", "About Us") },
        { href: "/contact", label: L("联系我们", "Contact") },
      ],
    },
  ].filter((c) => c.links.length > 0);

  return (
    <footer className="border-t border-border bg-secondary/50">
      <div className="grid w-full gap-10 px-5 py-14 sm:px-6 lg:px-8 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        {/* 品牌块:Logo + 一句话 + GitHub 药丸 */}
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            {L(
              "AI 电商出图工作站 · 开源免费自部署,云端托管增值。",
              "AI e-commerce image studio — free & open to self-host, hosted plans for more."
            )}
          </p>
          {official && (
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-[10px] border border-c-border2 bg-c-card px-3 py-1.5 text-sm font-medium text-c-text2 transition-colors hover:border-c-border hover:text-c-text"
            >
              <Github className="h-4 w-4" />
              usscottli-ctrl/novaryns
            </a>
          )}
        </div>

        {columns.map((col) => (
          <div key={col.title} className="space-y-3">
            <p className="text-sm font-semibold">{col.title}</p>
            <ul className="space-y-2">
              {col.links.map((link) =>
                link.external ? (
                  <li key={link.href + link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-sm text-c-text2 transition-colors hover:text-c-text"
                    >
                      {link.label}
                      <ArrowUpRight className="ml-0.5 inline h-3 w-3 -translate-y-px" />
                    </a>
                  </li>
                ) : (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-c-text2 transition-colors hover:text-c-text"
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </div>

      {/* 底栏:版权 · 隐私 · 条款 · 部署/自托管 */}
      <div className="border-t border-border">
        <div className="flex w-full flex-col items-center gap-2 px-5 py-6 text-xs text-c-text3 sm:px-6 lg:px-8 md:flex-row md:justify-between">
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center md:justify-start md:text-left">
            <span>
              © {new Date().getFullYear()} {brandName}
            </span>
            <span>·</span>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              {L("隐私政策", "Privacy")}
            </Link>
            <span>·</span>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              {L("服务条款", "Terms")}
            </Link>
            <span>·</span>
            <Link href="/deploy" className="transition-colors hover:text-foreground">
              {L("部署 / 自托管", "Deploy / Self-host")}
            </Link>
            {/* 白标门控:非 Pro(开源精简版)显示不可移除的 Powered by 署名。
                署名归属上游产品(BRAND=Novaryns),不用运营者自定义的 brandName——
                否则自部署者改了站名会变成"Powered by 他的站名",失去上游归属意义。 */}
            {!pro && (
              <>
                <span>·</span>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium transition-colors hover:text-foreground"
                >
                  Powered by {BRAND}
                </a>
              </>
            )}
          </p>
          <LangSwitcher up full />
        </div>
      </div>
    </footer>
  );
}
