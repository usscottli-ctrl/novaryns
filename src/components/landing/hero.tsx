"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/locale-context";
import { cdnUrl } from "@/lib/cdn";
import { cn } from "@/lib/utils";
import type { PickedTemplate } from "@/lib/homepage-picks";

export function Hero({ heroSlots }: { heroSlots: PickedTemplate[][] }) {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden bg-aurora">
      <div className="absolute inset-0 -z-10 bg-dots opacity-[0.5]" />
      <div className="container relative grid items-center gap-16 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
        <div className="space-y-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-1.5 text-sm font-semibold text-foreground backdrop-blur card-shadow">
            B2B Commerce Marketing Studio
          </span>

          <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            {t("home.heroTitle1")}
            <br />
            {t("home.heroTitle2")}
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("home.heroSubtitle")}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" variant="gradient">
              <Link href="/generate">
                {t("home.heroCtaPrimary")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/templates">{t("home.heroCtaSecondary")}</Link>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
            <div className="flex items-center gap-1.5">
              <div className="flex">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star
                    key={i}
                    className="h-4 w-4 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>
              <span className="text-sm text-muted-foreground">
                {t("home.heroRating")}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-6 text-xs font-medium text-muted-foreground">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i}>{t(`home.heroLogos.${i}`)}</span>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4">
              <FloatyCard slot={heroSlots[0]} ratioClass="aspect-[4/5]" phase={0} />
              <FloatyCard slot={heroSlots[1]} ratioClass="aspect-square" phase={1} />
            </div>
            <div className="space-y-4 pt-10">
              <FloatyCard slot={heroSlots[2]} ratioClass="aspect-square" phase={2} />
              <FloatyCard slot={heroSlots[3]} ratioClass="aspect-[4/5]" phase={3} />
            </div>
          </div>
          <div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-border bg-white px-4 py-3 text-sm card-shadow sm:block">
            <span className="text-xl font-bold text-gradient">8.2s</span>
            <span className="ml-2 text-muted-foreground">{t("home.heroTime")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// 单个 hero 卡:外层做 drift 浮动,内部多张图 8s 一轮交叉淡入
function FloatyCard({
  slot,
  ratioClass,
  phase,
}: {
  slot: PickedTemplate[] | undefined;
  ratioClass: string;
  phase: number;
}) {
  const items = slot ?? [];
  const [cur, setCur] = useState(0);

  useEffect(() => {
    if (items.length <= 1) return;
    // 每槽周期不一样,避免 4 张卡同步切换
    const interval = 7500 + phase * 600;
    const id = setInterval(() => setCur((c) => (c + 1) % items.length), interval);
    return () => clearInterval(id);
  }, [items.length, phase]);

  if (items.length === 0) {
    // 没图就放渐变占位,防止空白
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-emerald-100 to-teal-100 card-shadow hero-drift",
          ratioClass
        )}
        style={{ animationDelay: `${phase * 1.5}s` }}
      />
    );
  }

  const top = items[cur];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-secondary card-shadow hero-drift",
        ratioClass
      )}
      style={{ animationDelay: `${phase * 1.5}s` }}
    >
      {items.map((tpl, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tpl.id}
          src={cdnUrl(tpl.image)}
          alt={tpl.title}
          loading={i === 0 ? "eager" : "lazy"}
          // @ts-expect-error fetchpriority 在 React 18 typings 里没有
          fetchpriority={i === 0 ? "high" : undefined}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms]",
            i === cur ? "opacity-100" : "opacity-0"
          )}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="rounded-xl bg-white/85 px-3 py-2 backdrop-blur">
          <p className="line-clamp-1 text-sm font-semibold text-foreground">
            {top.title}
          </p>
          <p className="text-xs text-primary">{top.category}</p>
        </div>
      </div>
    </div>
  );
}
