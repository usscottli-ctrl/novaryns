"use client";

import { Upload, MousePointerClick, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";

const ICONS = [Upload, MousePointerClick, Download];
const STEPS = ["01", "02", "03"];

export function Workflow() {
  const { t } = useI18n();
  return (
    <section className="bg-secondary/40 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("home.workflowKicker")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("home.workflowTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground">
            {t("home.workflowSubtitle")}
          </p>
        </div>

        <div className="relative mt-16 grid gap-8 md:grid-cols-3">
          <div className="absolute left-[16%] right-[16%] top-8 hidden h-px bg-gradient-to-r from-primary/30 via-accent/30 to-primary/30 md:block" />
          {ICONS.map((Icon, i) => (
            <div key={STEPS[i]} className="relative text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-white text-primary card-shadow">
                <Icon className="h-6 w-6" />
              </div>
              <p className="mt-5 text-xs font-semibold tracking-widest text-primary">
                STEP {STEPS[i]}
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {t(`home.workflowItems.${i}.title`)}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {t(`home.workflowItems.${i}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
