"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/locale-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useAuth } from "@/lib/auth-context";

export function CTA() {
  const { t } = useI18n();
  const { openAuth } = useAuthModal();
  const { user } = useAuth();
  return (
    <section className="pb-24">
      <div className="container">
        <div className="bg-dark-module relative overflow-hidden rounded-2xl px-8 py-16 text-center sm:px-16">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#d7ff68]/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-[#1b8a78]/25 blur-3xl" />
          <div className="relative mx-auto max-w-2xl space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#d7ff68]">
              {t("home.ctaKicker")}
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t("home.ctaTitle")}
            </h2>
            <p className="text-white/60">{t("home.ctaSubtitle")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" variant="gradient">
                <Link href="/generate">
                  {t("home.ctaPrimary")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {user ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-white/5 text-white backdrop-blur-none hover:bg-white/10"
                >
                  <Link href="/dashboard">{t("home.ctaSecondary")}</Link>
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-white/5 text-white backdrop-blur-none hover:bg-white/10"
                  onClick={() => openAuth("sign-up")}
                >
                  {t("home.ctaSecondary")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
