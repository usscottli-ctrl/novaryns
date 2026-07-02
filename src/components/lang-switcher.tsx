"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import type { Locale } from "@/lib/i18n/dict";
import { cn } from "@/lib/utils";

// Languages with real translations. Add more here once the site is translated
// into them (each one needs a full dict entry in dict.ts).
const LANGS: { code: Locale; short: string; name: string }[] = [
  { code: "zh", short: "中", name: "中文" },
  { code: "en", short: "EN", name: "English" },
];

// Hover (desktop) + click (touch) dropdown language picker.
// up=菜单向上弹(用于页面底部 footer,避免被截到视口外);full=按钮显示全名(中文/English)。
export function LangSwitcher({
  className,
  up = false,
  full = false,
}: {
  className?: string;
  up?: boolean;
  full?: boolean;
}) {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.code === locale) ?? LANGS[0];

  function pick(code: Locale) {
    setOpen(false);
    if (code !== locale) setLocale(code);
  }

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {full ? current.name : current.short}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open !== up && "rotate-180"
          )}
        />
      </button>

      {open && (
        // pt-1/pb-1 bridges the gap so moving the cursor onto the menu keeps hover.
        <div
          className={cn(
            "absolute right-0 z-50 min-w-[170px]",
            up ? "bottom-full pb-1" : "top-full pt-1"
          )}
        >
          <div className="overflow-hidden rounded-xl border border-white/30 bg-card/50 py-1 shadow-lg backdrop-blur-lg">
            {LANGS.map((l) => {
              const active = l.code === locale;
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => pick(l.code)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <span className="w-6 text-left font-semibold">{l.short}</span>
                  <span className="flex-1 text-left">{l.name}</span>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
