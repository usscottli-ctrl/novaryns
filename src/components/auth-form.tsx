"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { supabaseEnabled } from "@/lib/auth-mode";
import { BRAND } from "@/lib/brand";
import { OPERATOR_EMAIL } from "@/lib/operator";

function PageShell({
  compact,
  children,
}: {
  compact: boolean;
  children: React.ReactNode;
}) {
  if (compact) return <div className="w-full space-y-6">{children}</div>;
  return (
    <div className="relative bg-aurora">
      <div className="absolute inset-0 -z-10 bg-dots opacity-50" />
      <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
        <div className="w-full max-w-sm space-y-8">{children}</div>
      </div>
    </div>
  );
}

// Built-in mock auth — used only when Supabase Auth is not configured.
export function AuthForm({
  mode,
  compact = false,
  noRedirect = false,
  onSwitchMode,
}: {
  mode: "sign-in" | "sign-up";
  compact?: boolean;
  noRedirect?: boolean;
  onSwitchMode?: (m: "sign-in" | "sign-up") => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, signUp, multiUser, applyServerUser } = useAuth();
  const { pro } = usePaymentConfig();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 开源版单用户:是否已设「管理员密码」(向导里设的)。设了就走密码登录,
  // 一个密码同时登录用户 + 后台;没设(极老实例)回退旧的邮箱登录不锁死。
  const [localAvailable, setLocalAvailable] = useState<boolean | null>(null);
  // 三种模式(mock 渲染下):
  //  · multi  = Pro 原生多用户(邮箱+密码注册/登录,服务端会话)—— 优先。
  //  · pwMode = 单用户自托管(无 Supabase + 已设管理员密码)—— 一个密码进用户+后台。
  //  · legacy = 其它(旧 mock 邮箱登录)。
  const multiMode = multiUser;
  const isSignUp = (multiUser || pro) && mode === "sign-up";
  const pwMode = !multiUser && !supabaseEnabled && localAvailable === true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/login");
        const d = (await r.json()) as { localAvailable?: boolean };
        if (!cancelled) setLocalAvailable(!!d.localAvailable);
      } catch {
        if (!cancelled) setLocalAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const redirect = params.get("redirect");
  const plan = params.get("plan");
  const nextUrl =
    redirect ?? (plan ? `/checkout?plan=${plan}` : "/dashboard");
  const carry = new URLSearchParams();
  if (redirect) carry.set("redirect", redirect);
  if (plan) carry.set("plan", plan);
  const switchQuery = carry.toString() ? `?${carry.toString()}` : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Pro 原生多用户:邮箱+密码 注册/登录 → 服务端下发会话 cookie + 返回用户。
    if (multiMode) {
      try {
        const endpoint = isSignUp ? "/api/auth/register" : "/api/auth/login";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isSignUp ? { email, password, name } : { email, password }
          ),
        });
        const d = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          user?: SessionUser;
        } | null;
        if (!res.ok || !d?.ok || !d.user) {
          setError(d?.error || (isSignUp ? "注册失败" : "登录失败"));
          setLoading(false);
          return;
        }
        applyServerUser(d.user);
        setTimeout(() => {
          if (!noRedirect) router.push(nextUrl);
        }, 400);
      } catch {
        setError("网络错误,请重试");
        setLoading(false);
      }
      return;
    }

    // 开源版单用户:用向导设的管理员密码登录。校验通过 → 下发后台会话 cookie
    //(/admin 也随之解锁)+ 建立本地用户会话,一个密码登录所有地方。
    if (pwMode) {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const d = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !d?.ok) {
          setError(d?.error || "密码错误");
          setLoading(false);
          return;
        }
        signIn(OPERATOR_EMAIL);
        setTimeout(() => {
          if (!noRedirect) router.push(nextUrl);
        }, 500);
      } catch {
        setError("网络错误,请重试");
        setLoading(false);
      }
      return;
    }

    // 多用户(官方云/Pro):邮箱登录 / 注册(原逻辑不变)。
    if (isSignUp) signUp(name, email);
    else signIn(email);
    setTimeout(() => {
      if (!noRedirect) router.push(nextUrl);
    }, 700);
  }

  return (
    <PageShell compact={compact}>
      <div className="flex flex-col items-center gap-4 text-center">
        {!compact && <Logo />}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isSignUp ? `创建你的 ${BRAND} 账号` : "欢迎回来"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignUp
              ? "注册即送积分"
              : pwMode
                ? "输入管理员密码登录"
                : "登录以继续生成你的商业视觉"}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-card p-6 card-shadow"
      >
        {isSignUp && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">昵称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的称呼"
              required
            />
          </div>
        )}
        {/* 开源版单用户:只要密码;多用户:邮箱 + 密码 */}
        {!pwMode && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">邮箱</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">密码</label>
          <Input
            type="password"
            value={pwMode || multiMode ? password : undefined}
            onChange={
              pwMode || multiMode
                ? (e) => setPassword(e.target.value)
                : undefined
            }
            placeholder="••••••••"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={pwMode || multiMode ? 6 : undefined}
            required
          />
        </div>

        {error && (
          <p className="text-[13px] font-medium text-c-danger">{error}</p>
        )}

        <Button
          type="submit"
          variant="gradient"
          className="w-full"
          disabled={loading}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSignUp ? "免费注册" : "登录"}
        </Button>
      </form>

      {pwMode ? (
        // 单用户密码登录(开源版 / Pro 单用户):一句说明。
        <p className="text-center text-sm text-muted-foreground">
          用安装向导里设置的管理员密码登录
        </p>
      ) : !pro ? (
        // 开源精简版且未设密码:提示多用户需 Pro。
        <p className="text-center text-sm text-muted-foreground">
          多用户注册需 Pro 版
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "已有账号？" : "还没有账号？"}{" "}
          {onSwitchMode ? (
            <button
              type="button"
              onClick={() => onSwitchMode(isSignUp ? "sign-in" : "sign-up")}
              className="font-medium text-primary hover:underline"
            >
              {isSignUp ? "去登录" : "免费注册"}
            </button>
          ) : (
            <Link
              href={`${isSignUp ? "/sign-in" : "/sign-up"}${switchQuery}`}
              className="font-medium text-primary hover:underline"
            >
              {isSignUp ? "去登录" : "免费注册"}
            </Link>
          )}
        </p>
      )}
    </PageShell>
  );
}
