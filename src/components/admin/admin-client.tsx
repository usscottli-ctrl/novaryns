"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { browserSupabase } from "@/lib/supabase";
import { AdminSettings } from "@/components/admin/admin-settings";

// Dedicated /admin page. Gates access: not-logged-in -> sign-in;
// logged-in-but-not-admin -> "无权限"; admin -> full console.

// sessionStorage 缓存上次校验结果(5 分钟),避免每次刷新都跑一遍 ~500-1500ms
// 的 supabase.getSession + fetch /api/admin/settings(中间还有 Supabase 远程
// auth.getUser 校验)。缓存命中时 UI 瞬时显示,后台静默 re-verify;若 re-verify
// 发现已被撤权 → 切到 denied(罕见 edge case)。
// 安全:这层缓存只控前端 UI gate,所有 admin 接口仍在服务端逐次 isAdminToken 校验。
const CACHE_KEY = "novaryns:adminVerifiedV1";
const CACHE_TTL_MS = 5 * 60 * 1000;

type AdminCache = { email: string; ts: number };
function readCache(): AdminCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as AdminCache;
    if (Date.now() - c.ts > CACHE_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}
function writeCache(email: string) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ email, ts: Date.now() })
    );
  } catch {
    /* quota / privacy mode — silently skip */
  }
}
function clearCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function AdminClient() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const [status, setStatus] = useState<"loading" | "denied" | "ok">(
    "loading"
  );

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      openAuth("sign-in");
      return;
    }

    // 先吃缓存:命中且 email 匹配 → 瞬时 ok,后台再静默校验
    const cached = readCache();
    if (cached && cached.email === user.email) {
      setStatus("ok");
    }

    let cancelled = false;
    (async () => {
      try {
        const sb = browserSupabase();
        const { data } = await sb.auth.getSession();
        const tok = data.session?.access_token;
        if (!tok) {
          clearCache();
          openAuth("sign-in");
          return;
        }
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (cancelled) return;
        if (res.ok) {
          writeCache(user.email);
          setStatus("ok");
        } else {
          clearCache();
          setStatus("denied");
        }
      } catch {
        if (!cancelled && !cached) setStatus("denied");
        // 缓存命中时网络出错就不动 UI,等下次自然刷新
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, router, openAuth]);

  if (status === "loading") {
    return (
      <div className="container flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        校验管理员权限…
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-semibold">无权限访问</p>
        <p className="text-sm text-muted-foreground">
          此页面仅限管理员。如需访问请联系站点管理员。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">管理后台</h1>
      </div>
      <AdminSettings />
    </div>
  );
}
