"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  translate,
  lookup,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n/dict";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  // EN overlay: returns the English value if present (locale=en), else the
  // provided Chinese fallback. For data already in Chinese (e.g. PRICING).
  te: (key: string, zh: string) => string;
};

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (l: Locale) => {
      const next = normalizeLocale(l);
      setLocaleState(next);
      document.cookie = `novaryns_locale=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next === "en" ? "en" : "zh-CN";
      // Re-render server components (legal pages, metadata) under the new cookie.
      router.refresh();
    },
    [router]
  );

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  const te = useCallback(
    (key: string, zh: string) => {
      if (locale !== "en") return zh;
      const v = lookup("en", key);
      return typeof v === "string" ? v : zh;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, te }),
    [locale, setLocale, t, te]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useI18n(): Ctx {
  const c = useContext(LocaleContext);
  if (!c) {
    // Safe fallback so a component used outside the provider still renders zh.
    return {
      locale: "zh",
      setLocale: () => {},
      t: (k) => translate("zh", k),
      te: (_k, zh) => zh,
    };
  }
  return c;
}
