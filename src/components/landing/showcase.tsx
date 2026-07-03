"use client";

import { cdnUrl } from "@/lib/cdn";
import { Media } from "@/components/media";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";
import type { PickedTemplate } from "@/lib/homepage-picks";

export function Showcase({ items }: { items: PickedTemplate[] }) {
  const { t } = useI18n();
  return (
    <section className="py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("home.showcaseKicker")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("home.showcaseTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground">
            {t("home.showcaseSubtitle")}
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((tpl, i) => (
            <div
              key={tpl.id}
              className={cn(
                "group overflow-hidden rounded-2xl border border-border bg-white transition-all hover:-translate-y-1 hover:card-shadow show-drift"
              )}
              style={{ animationDelay: `${i * 0.6}s` }}
            >
              <Media
                src={cdnUrl(tpl.image)}
                alt={tpl.title}
                gradient={tpl.gradient}
                ratio="aspect-[4/5]"
                className="rounded-none border-0"
              />
              <div className="space-y-1 p-4">
                <p className="text-xs font-medium text-primary">
                  {tpl.category}
                </p>
                <p className="text-sm font-semibold leading-snug">
                  {tpl.title}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
