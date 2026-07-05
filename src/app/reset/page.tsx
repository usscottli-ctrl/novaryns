"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Check, KeyRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (pw !== pw2) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw }),
      });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !d?.ok) {
        setError(d?.error || "重置失败");
        setBusy(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/sign-in"), 1400);
    } catch {
      setError("网络错误,请重试");
      setBusy(false);
    }
  }

  return (
    <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">重置登录密码</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              设置一个新密码即可继续登录。
            </p>
          </div>
        </div>

        {!token ? (
          <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-c-danger card-shadow">
            链接无效,请从邮件里重新打开重置链接。
          </p>
        ) : done ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-8 text-center card-shadow">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-c-tint-g">
              <Check className="h-6 w-6 text-c-success" />
            </div>
            <p className="text-[15px] font-semibold">密码已重置</p>
            <p className="text-[13px] text-muted-foreground">正在带你去登录…</p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl border border-border bg-card p-6 card-shadow"
          >
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-acc" />
                新密码
              </label>
              <Input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="至少 6 位"
                minLength={6}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">确认新密码</label>
              <Input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="再次输入"
                minLength={6}
                autoComplete="new-password"
                required
              />
            </div>
            {error && (
              <p className="text-[12.5px] font-medium text-c-danger">{error}</p>
            )}
            <Button
              type="submit"
              variant="gradient"
              className="w-full"
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "提交中…" : "重置密码"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/sign-in" className="text-primary hover:underline">
                返回登录
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
