"use client";

import { cdnUrl } from "@/lib/cdn";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, Layers, Network } from "lucide-react";
import { Media } from "@/components/media";
import { StatCard } from "@/components/ui/stat-card";
import { useI18n } from "@/lib/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { PickedTemplate } from "@/lib/homepage-picks";

type RecentWork = {
  id: string;
  image: string;
  title?: string;
  status?: string;
  gradient?: string;
  createdAt?: string;
};

export function HomeDashboard({ hot }: { hot: PickedTemplate[] }) {
  const { t, locale } = useI18n();
  const { user, ready, remaining } = useAuth();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [recent, setRecent] = useState<RecentWork[] | null>(null);
  const [stats, setStats] = useState<{ today: number; total: number }>({
    today: 0,
    total: 0,
  });

  // 问候语随本地时段
  const [greet, setGreet] = useState("home.dash.greetEvening");
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    const d = new Date();
    const h = d.getHours();
    setGreet(
      h < 12
        ? "home.dash.greetMorning"
        : h < 18
          ? "home.dash.greetAfternoon"
          : "home.dash.greetEvening"
    );
    setDateLabel(
      locale === "en"
        ? d.toLocaleDateString("en-US", { month: "long", day: "numeric" })
        : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    );
  }, [locale]);

  // 拉作品:最近 8 张 + 统计(今日生成 / 累计作品)
  useEffect(() => {
    if (!user?.email) {
      setRecent(null);
      setStats({ today: 0, total: 0 });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const arts = (d.artworks ?? []) as RecentWork[];
        if (cancelled) return;
        const done = arts.filter((a) => a.image && a.status !== "failed");
        const todayStr = new Date().toDateString();
        const today = done.filter(
          (a) => a.createdAt && new Date(a.createdAt).toDateString() === todayStr
        ).length;
        setStats({ today, total: done.length });
        setRecent(done.slice(0, 8));
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const greeting = useMemo(() => {
    if (user?.name) return `${t(greet)}，${user.name}`;
    return t("home.dash.greetGuest");
  }, [user?.name, greet, t]);

  const statCards = [
    {
      label: L("今日生成", "Today"),
      value: stats.today.toLocaleString("en-US"),
      unit: L("张", ""),
      accent: false,
    },
    {
      label: L("积分余额", "Credits"),
      value: remaining.toLocaleString("en-US"),
      unit: "",
      accent: true,
    },
    {
      label: L("累计作品", "Total works"),
      value: stats.total.toLocaleString("en-US"),
      unit: "",
      accent: false,
    },
  ];

  const entries = [
    {
      href: "/generate",
      Icon: Sparkles,
      title: L("AI 生图", "AI generation"),
      desc: L("文字 / 参考图生成电商主图", "Text or reference → product shots"),
      primary: true,
    },
    {
      href: "/suite",
      Icon: Layers,
      title: L("一键套图", "One-click suite"),
      desc: L("一张主图批量生成全套素材", "One product → a full asset set"),
      primary: false,
    },
    {
      href: "/canvas",
      Icon: Network,
      title: L("创作画布", "Canvas"),
      desc: L("节点式自由编排生成流程", "Node-based generation workflow"),
      primary: false,
    },
  ];

  return (
    <div className="w-full px-5 py-8 sm:px-6 lg:px-8">
      {/* 问候 */}
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-c-text">
          {greeting}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-c-text3">
          {dateLabel}
          {dateLabel && " · "}
          {t("home.dash.welcome")}
        </p>
      </div>

      {/* 统计三卡 */}
      <div className="mt-5 grid grid-cols-3 gap-4">
        {statCards.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            suffix={s.unit || undefined}
            accent={s.accent}
          />
        ))}
      </div>

      {/* 三入口 */}
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {entries.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className={cn(
              "group relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-card p-6 transition-all hover:-translate-y-0.5",
              e.primary
                ? "text-white shadow-btn [background:var(--grad-acc)]"
                : "border border-c-border bg-c-card shadow-card hover:border-c-border2"
            )}
          >
            {e.primary && (
              <span className="pointer-events-none absolute -bottom-8 -right-8 h-36 w-36 rounded-full bg-white/15 blur-xl" />
            )}
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-icon",
                e.primary ? "bg-white/15 text-white" : "bg-acc-tint text-acc"
              )}
            >
              <e.Icon className="h-[22px] w-[22px]" />
            </span>
            <div className="relative">
              <p
                className={cn(
                  "flex items-center gap-1.5 text-lg font-bold",
                  e.primary ? "text-white" : "text-foreground"
                )}
              >
                {e.title}
                <ArrowRight
                  className={cn(
                    "h-4 w-4 transition-transform group-hover:translate-x-0.5",
                    e.primary ? "text-white/90" : "text-primary"
                  )}
                />
              </p>
              <p
                className={cn(
                  "mt-1 text-[13px] leading-relaxed",
                  e.primary ? "text-white/80" : "text-muted-foreground"
                )}
              >
                {e.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* 最近作品(横向滚动条) */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-c-text">
            {t("home.dash.recentTitle")}
          </h2>
          {user && recent && recent.length > 0 && (
            <Link
              href="/works"
              className="inline-flex items-center gap-1 text-sm font-medium text-acc hover:underline"
            >
              {t("home.dash.viewAll")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {!ready || (user && recent === null) ? (
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="nv-skeleton aspect-[3/4] w-[150px] shrink-0 rounded-[12px]"
              />
            ))}
          </div>
        ) : !user ? (
          <div className="rounded-card border border-dashed border-c-border bg-c-card px-5 py-12 text-center text-sm text-c-text3">
            {t("home.dash.signInHint")}
          </div>
        ) : recent && recent.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {recent.slice(0, 8).map((a) => (
              <Link
                key={a.id}
                href="/works"
                className="group relative block w-[150px] shrink-0 overflow-hidden rounded-[12px] border border-c-border bg-c-subtle"
              >
                <Media
                  src={cdnUrl(a.image)}
                  alt={a.title || ""}
                  gradient={a.gradient}
                  thumbWidth={400}
                  ratio="aspect-[3/4]"
                  className="rounded-none border-0 transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-c-border bg-c-card px-5 py-12 text-center text-sm text-c-text3">
            {t("home.dash.recentEmpty")}
          </div>
        )}
      </section>

      {/* 推荐模板 */}
      {hot.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              {t("home.dash.hotTitle")}
            </h2>
            <Link
              href="/templates"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {t("home.dash.viewAll")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {hot.slice(0, 5).map((tpl) => (
              <Link
                key={tpl.id}
                href={`/generate?template=${encodeURIComponent(tpl.id)}`}
                className="group overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-all hover:-translate-y-1"
              >
                <Media
                  src={cdnUrl(tpl.image)}
                  alt={tpl.title}
                  gradient={tpl.gradient}
                  thumbWidth={480}
                  ratio="aspect-[4/5]"
                  className="rounded-none border-0"
                />
                <div className="px-3 py-2.5">
                  <p className="line-clamp-1 text-xs font-semibold text-foreground">
                    {tpl.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-primary">{tpl.category}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
