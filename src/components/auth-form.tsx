"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { BRAND } from "@/lib/brand";

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
  const { signIn, signUp } = useAuth();
  // 白标门控:开源版 = 单用户,隐藏「注册」入口只留登录;官方云/Pro = 多用户(不变)。
  const { pro } = usePaymentConfig();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const isSignUp = pro && mode === "sign-up";

  const redirect = params.get("redirect");
  const plan = params.get("plan");
  const nextUrl =
    redirect ?? (plan ? `/checkout?plan=${plan}` : "/dashboard");
  const carry = new URLSearchParams();
  if (redirect) carry.set("redirect", redirect);
  if (plan) carry.set("plan", plan);
  const switchQuery = carry.toString() ? `?${carry.toString()}` : "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
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
            {isSignUp ? "注册即送积分" : "登录以继续生成你的商业视觉"}
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
        <div className="space-y-1.5">
          <label className="text-sm font-medium">密码</label>
          <Input type="password" placeholder="••••••••" required />
        </div>

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

      {!pro ? (
        // 开源精简版 = 单用户,隐藏「注册」路径,只留登录 + 一句小字提示。
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
