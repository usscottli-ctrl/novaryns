"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { cn, formatDate } from "@/lib/utils";
import { RecordPager } from "@/components/tools/record-pager";

type Item = {
  id: string;
  delta: number;
  reason: string;
  kind: string;
  expiresAt: string | null;
  createdAt: string;
};

const TABS = ["all", "purchase", "consume", "grant", "refund", "expire"] as const;
type Tab = (typeof TABS)[number];

// 用户端「积分明细」:类别标签 + 表格(说明/变动数值/时间/到期时间),仅 30 天内。
export function CreditLedger() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PER_PAGE = 10;

  const load = useCallback(
    async (kind: Tab) => {
      if (!user) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/credits?email=${encodeURIComponent(user.email)}&kind=${kind}`,
          { headers: await authHeader() }
        );
        const j = await res.json();
        setItems(res.ok && Array.isArray(j.items) ? j.items : []);
        setPage(0);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  return (
    <div>
      {/* 类别标签 */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-secondary p-1">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === k
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`ledger.${k}`)}
          </button>
        ))}
      </div>

      {/* 表头 */}
      <div className="mt-4 grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border px-1 pb-2 text-xs font-semibold text-muted-foreground sm:gap-8">
        <span>{t("ledger.colDesc")}</span>
        <span className="text-right">{t("ledger.colDelta")}</span>
        <span className="hidden sm:block">{t("ledger.colTime")}</span>
        <span className="hidden sm:block">{t("ledger.colExpiry")}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("ledger.empty")}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items
            .slice(page * PER_PAGE, (page + 1) * PER_PAGE)
            .map((it) => (
            <div
              key={it.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-1 py-3.5 text-sm sm:gap-8"
            >
              <span className="truncate">{it.reason}</span>
              <span
                className={cn(
                  "text-right font-semibold tabular-nums",
                  it.delta >= 0 ? "text-primary" : "text-[#e5484d]"
                )}
              >
                {it.delta >= 0 ? "+" : ""}
                {it.delta}
              </span>
              <span className="hidden text-muted-foreground sm:block">
                {formatDate(it.createdAt, true)}
              </span>
              <span className="hidden text-muted-foreground sm:block">
                {it.expiresAt ? formatDate(it.expiresAt) : "-"}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length > PER_PAGE && (
        <RecordPager
          page={page}
          total={Math.ceil(items.length / PER_PAGE)}
          onPage={setPage}
        />
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("ledger.note30")}
      </p>
    </div>
  );
}
