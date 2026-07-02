"use client";

import {
  ImageIcon,
  LayoutPanelTop,
  Mountain,
  LibraryBig,
  Layers,
  Wand2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";

const ICONS = [ImageIcon, LayoutPanelTop, Mountain, LibraryBig, Layers, Wand2];

export function Features() {
  const { t } = useI18n();
  return (
    <section className="bg-secondary/40 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("home.featuresKicker")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("home.featuresTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground">
            {t("home.featuresSubtitle")}
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ICONS.map((Icon, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-border bg-white p-7 transition-all hover:-translate-y-1 hover:card-shadow"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/12 to-accent/12 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">
                {t(`home.featureItems.${i}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`home.featureItems.${i}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
