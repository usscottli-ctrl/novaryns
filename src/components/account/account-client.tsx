"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  LogOut,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useRecharge } from "@/lib/recharge-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { displayEmail } from "@/lib/account-identity";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { CreditLedger } from "@/components/credits/credit-ledger";
import { CREDIT_PACKS, fmtCredits } from "@/lib/mock-data";
import { usePaymentConfig } from "@/lib/payment-context";

export function AccountClient() {
  const { user, ready, remaining, signOut } = useAuth();
  const { t, locale } = useI18n();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);
  const { openAuth } = useAuthModal();
  const { openRecharge } = useRecharge();
  const { rechargeEnabled, pro } = usePaymentConfig();
  const [totalWorks, setTotalWorks] = useState<number | null>(null);

  useEffect(() => {
    if (ready && !user) openAuth("sign-in");
  }, [ready, user, openAuth]);

  // 累计生成张数
  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const arts = (d.artworks ?? []) as { image?: string; status?: string }[];
        if (!cancelled)
          setTotalWorks(arts.filter((a) => a.image && a.status !== "failed").length);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  if (!ready || !user) {
    return (
      <div className="w-full px-5 py-20 text-sm text-c-text3 sm:px-6 lg:px-8">
        {t("acct.loading")}
      </div>
    );
  }

  const initial = user.name?.trim().charAt(0).toUpperCase() || "U";
  const usedCredits = Math.max(0, user.creditsTotal - remaining);

  const settings: {
    label: string;
    desc: string;
    Icon: typeof ShieldCheck;
    tint: string;
    color: string;
    href?: string;
    onClick?: () => void;
    danger?: boolean;
  }[] = [
    {
      label: L("账号与安全", "Account & security"),
      desc: L("密码、登录方式", "Password & sign-in"),
      Icon: ShieldCheck,
      tint: "var(--c-tint-b)",
      color: "var(--c-blue)",
      href: "/account/security",
    },
    {
      label: L("退出登录", "Sign out"),
      desc: "",
      Icon: LogOut,
      tint: "var(--c-tint-r)",
      color: "var(--c-danger)",
      onClick: signOut,
      danger: true,
    },
  ];

  return (
    <div className="w-full px-5 py-7 sm:px-6 lg:px-8">
      <h1 className="text-[26px] font-bold text-c-text">{t("acct.title")}</h1>

      {/* 资料卡 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-card border border-c-border bg-c-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <span className="grid h-[60px] w-[60px] place-items-center rounded-full text-[24px] font-bold text-white [background:var(--grad-acc)]">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="text-[17px] font-bold text-c-text">{user.name}</p>
            <p className="truncate text-[12.5px] text-c-text3">
              {displayEmail(user.email) || user.email}
            </p>
          </div>
        </div>
        {rechargeEnabled && (
          <Button variant="primary" onClick={() => openRecharge("pay")}>
            {L("充值积分", "Top up")}
          </Button>
        )}
        {pro && !rechargeEnabled && (
          <Button variant="primary" onClick={() => openRecharge("code")}>
            {L("兑换码", "Redeem code")}
          </Button>
        )}
      </div>

      {/* 统计三卡 */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-c-border bg-c-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-c-text3">{L("积分余额", "Credits")}</span>
            {rechargeEnabled && (
              <button
                type="button"
                onClick={() => openRecharge("pay")}
                className="inline-flex items-center gap-0.5 text-[12px] font-medium text-acc hover:underline"
              >
                {L("充值", "Top up")}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
            {pro && !rechargeEnabled && (
              <button
                type="button"
                onClick={() => openRecharge("code")}
                className="inline-flex items-center gap-0.5 text-[12px] font-medium text-acc hover:underline"
              >
                {L("兑换码", "Redeem")}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="mt-2.5 text-[27px] font-bold leading-none tabular-nums text-acc">
            {fmtCredits(remaining)}
          </div>
        </div>
        <StatCard
          label={L("累计已用", "Used")}
          value={fmtCredits(usedCredits)}
          suffix={L("积分", "")}
        />
        <StatCard
          label={L("累计生成", "Total works")}
          value={totalWorks === null ? "—" : fmtCredits(totalWorks)}
          suffix={L("张", "")}
        />
      </div>

      {/* 两栏 */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* 左:积分明细 */}
        <div className="rounded-card border border-c-border bg-c-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-c-text">
              {L("积分明细", "Credit history")}
            </h2>
          </div>
          <CreditLedger />
        </div>

        {/* 右:充值 + 设置 */}
        <div className="space-y-5">
          {rechargeEnabled && (
            <div className="rounded-card border border-c-border bg-c-card p-5 shadow-card">
              <h2 className="text-[15px] font-semibold text-c-text">
                {L("积分充值", "Top up")}
              </h2>
              <p className="mt-0.5 text-[12px] text-c-text3">
                {L("按量付费,充越多赠越多", "Pay as you go · the more you top up, the more bonus")}
              </p>
              <div className="mt-3 space-y-2">
                {CREDIT_PACKS.slice(0, 3).map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openRecharge("pay")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-field border px-3.5 py-2.5 text-left transition-colors",
                      i === 1
                        ? "border-acc-border bg-acc-tint"
                        : "border-c-border2 hover:bg-c-subtle2"
                    )}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-[14px] font-bold tabular-nums text-c-text">
                        {fmtCredits(p.credits)}
                      </span>
                      {p.bonus > 0 && (
                        <span className="rounded-[4px] bg-c-tint-g px-1 py-0.5 text-[10px] font-bold text-c-success">
                          {L("赠", "+")} {fmtCredits(p.bonus)}
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] font-semibold text-c-text">{p.price}</span>
                  </button>
                ))}
              </div>
              <Button
                variant="primary"
                size="md"
                className="mt-3 w-full justify-center"
                onClick={() => openRecharge("pay")}
              >
                {L("去充值", "Top up")}
              </Button>
            </div>
          )}

          {/* 设置列表 */}
          <div className="rounded-card border border-c-border bg-c-card p-2 shadow-card">
            {settings.map((s) => {
              const inner = (
                <>
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-icon"
                    style={{ background: s.tint, color: s.color }}
                  >
                    <s.Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[13.5px] font-medium",
                        s.danger ? "text-c-danger" : "text-c-text"
                      )}
                    >
                      {s.label}
                    </span>
                    {s.desc && (
                      <span className="block truncate text-[11.5px] text-c-text3">
                        {s.desc}
                      </span>
                    )}
                  </span>
                  {!s.danger && (
                    <ChevronRight className="h-4 w-4 flex-none text-c-text4" />
                  )}
                </>
              );
              const cls =
                "flex w-full items-center gap-3 rounded-field px-2.5 py-2.5 text-left transition-colors hover:bg-c-subtle";
              return s.href ? (
                <Link key={s.label} href={s.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button key={s.label} type="button" onClick={s.onClick} className={cls}>
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
