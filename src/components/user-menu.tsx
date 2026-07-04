"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  CreditCard,
  LogOut,
  Sparkles,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { browserSupabase } from "@/lib/supabase";
import { supabaseEnabled } from "@/lib/auth-mode";
import { displayEmail } from "@/lib/account-identity";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

export function UserMenu() {
  const { user, remaining, signOut } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Detect admin to conditionally surface the 管理后台 entry.
  // 同 admin-client.tsx,共用 sessionStorage 缓存(5min TTL),避免每个页面都
  // 跑一遍 ~500ms-1.5s 的 supabase + /api/admin/settings 校验链。
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    // 先吃缓存:命中 → 立即显示 admin 菜单,后台静默 re-verify
    try {
      const raw = sessionStorage.getItem("novaryns:adminVerifiedV1");
      if (raw) {
        const c = JSON.parse(raw) as { email: string; ts: number };
        if (c.email === user.email && Date.now() - c.ts <= 5 * 60 * 1000) {
          setIsAdmin(true);
        }
      }
    } catch { /* ignore */ }
    let cancelled = false;
    (async () => {
      try {
        // Supabase(官方云)拿 token;本地管理员(开源版)没有 token,靠 cookie 鉴权,
        // 所以无 token 也要探一次 /api/admin/settings(同源请求自动带 cookie)。
        let tok: string | undefined;
        if (supabaseEnabled) {
          try {
            const { data } = await browserSupabase().auth.getSession();
            tok = data.session?.access_token;
          } catch {
            /* ignore */
          }
        }
        const res = await fetch("/api/admin/settings", {
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        });
        if (cancelled) return;
        setIsAdmin(res.ok);
        try {
          if (res.ok) {
            sessionStorage.setItem(
              "novaryns:adminVerifiedV1",
              JSON.stringify({ email: user.email, ts: Date.now() })
            );
          } else {
            sessionStorage.removeItem("novaryns:adminVerifiedV1");
          }
        } catch { /* ignore */ }
      } catch {
        /* not admin / no session — leave hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;
  const initial = user.name.trim().charAt(0).toUpperCase() || "N";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-sm transition-colors hover:bg-secondary"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))] text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden font-medium sm:block">{user.name}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card card-shadow">
          <div className="border-b border-border p-4">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            {displayEmail(user.email) && (
              <p className="truncate text-xs text-muted-foreground">
                {displayEmail(user.email)}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t("nav.credits")}
              </span>
              <span className="text-xs text-muted-foreground">
                {fmt(t("menu.remaining"), { n: remaining })}
              </span>
            </div>
          </div>
          <nav className="p-1.5">
            <MenuLink
              href="/dashboard"
              icon={<LayoutGrid className="h-4 w-4" />}
              label={t("menu.myWorks")}
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/account"
              icon={<CreditCard className="h-4 w-4" />}
              label={t("menu.account")}
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/account/security"
              icon={<Lock className="h-4 w-4" />}
              label={t("menu.security")}
              onNavigate={() => setOpen(false)}
            />
            {isAdmin && (
              <MenuLink
                href="/admin"
                icon={<ShieldCheck className="h-4 w-4" />}
                label={t("menu.admin")}
                onNavigate={() => setOpen(false)}
              />
            )}
            <button
              onClick={() => {
                setOpen(false);
                signOut();
                router.push("/");
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t("menu.signOut")}
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}
