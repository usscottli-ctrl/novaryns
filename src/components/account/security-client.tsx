"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthModal } from "@/lib/auth-modal-context";
import {
  Smartphone,
  KeyRound,
  MessageCircle,
  Check,
  Loader2,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

const PHONE_RE = /^1[3-9]\d{9}$/;

const PHONE_DOMAIN =
  process.env.NEXT_PUBLIC_PHONE_EMAIL_DOMAIN || "phone.starzeco.com";

function maskPhone(p: string): string {
  return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : p;
}

export function SecurityClient() {
  const { user, ready } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const { openAuth } = useAuthModal();

  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [hasPassword, setHasPassword] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [boundPhone, setBoundPhone] = useState("");

  // Bind-phone flow (email accounts only).
  const [bindOpen, setBindOpen] = useState(false);
  const [bindPhone, setBindPhone] = useState("");
  const [bindCode, setBindCode] = useState("");
  const [bindBusy, setBindBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [bindMsg, setBindMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ready && !user) openAuth("sign-in");
  }, [ready, user, openAuth]);

  // Read markers we stamp on the user's metadata.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    browserSupabase()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const meta = (data.user?.user_metadata ?? {}) as {
          has_password?: boolean;
          bound_phone?: string;
        };
        if (meta.has_password) setHasPassword(true);
        if (meta.bound_phone) setBoundPhone(meta.bound_phone);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) clearInterval(timerRef.current);
        return c - 1;
      });
    }, 1000);
  }

  async function sendBindCode() {
    setBindMsg(null);
    if (!PHONE_RE.test(bindPhone.trim())) {
      setBindMsg({ ok: false, text: t("auth.errPhoneFormat") });
      return;
    }
    setBindBusy(true);
    try {
      const res = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: bindPhone.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || t("auth.errSendCode"));
      setBindMsg({ ok: true, text: t("auth.phoneCodeSent") });
      startCooldown();
    } catch (err) {
      setBindMsg({
        ok: false,
        text: err instanceof Error ? err.message : t("auth.errSendCode"),
      });
    } finally {
      setBindBusy(false);
    }
  }

  async function doBindPhone(e: React.FormEvent) {
    e.preventDefault();
    setBindMsg(null);
    if (!PHONE_RE.test(bindPhone.trim())) {
      setBindMsg({ ok: false, text: t("auth.errPhoneFormat") });
      return;
    }
    if (!/^\d{4,8}$/.test(bindCode.trim())) {
      setBindMsg({ ok: false, text: t("auth.errCodeFormat") });
      return;
    }
    setBindBusy(true);
    try {
      const sb = browserSupabase();
      const { data: s } = await sb.auth.getSession();
      const token = s.session?.access_token;
      const res = await fetch("/api/auth/phone/bind", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ phone: bindPhone.trim(), code: bindCode.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        if (res.status === 409)
          throw new Error(t("sec.phoneInUse"));
        throw new Error(d.error || t("sec.bindFailed"));
      }
      setBoundPhone(bindPhone.trim());
      setBindOpen(false);
      setBindPhone("");
      setBindCode("");
      setBindMsg(null);
    } catch (err) {
      setBindMsg({
        ok: false,
        text: err instanceof Error ? err.message : t("sec.bindFailed"),
      });
    } finally {
      setBindBusy(false);
    }
  }

  if (!ready || !user) {
    return (
      <div className="container py-20 text-sm text-muted-foreground">
        {t("acct.loading")}
      </div>
    );
  }

  const isPhoneUser = user.email.endsWith(`@${PHONE_DOMAIN}`);
  const account = isPhoneUser ? maskPhone(user.name) : user.email;

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 6) {
      setPwMsg({ ok: false, text: t("acct.pwTooShort") });
      return;
    }
    if (newPw !== newPw2) {
      setPwMsg({ ok: false, text: t("acct.pwMismatch") });
      return;
    }
    setPwSaving(true);
    try {
      const { error } = await browserSupabase().auth.updateUser({
        password: newPw,
        data: { has_password: true },
      });
      if (error) throw error;
      setNewPw("");
      setNewPw2("");
      setHasPassword(true);
      setPwMsg({ ok: true, text: t("acct.pwSaved") });
    } catch (err) {
      // Supabase returns English auth errors — map the common ones to the
      // current locale; fall back to a generic localized message.
      const raw = err instanceof Error ? err.message : "";
      let text = t("acct.pwFailed");
      if (/different from the old/i.test(raw)) text = t("acct.pwSameAsOld");
      else if (/at least|too short|minimum|weak/i.test(raw))
        text = t("acct.pwTooShort");
      setPwMsg({ ok: false, text });
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("sec.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("sec.subtitle")}</p>
      </div>

      {/* 基本设置 */}
      <h2 className="mb-4 text-xl font-semibold">{t("sec.basic")}</h2>
      <div className="mb-10 rounded-2xl border border-border bg-card card-shadow">
        <div className="flex items-center gap-3 px-6 py-4">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/12 to-accent/12 text-primary">
            <Smartphone className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("sec.account")}</p>
            <p className="truncate text-sm text-muted-foreground">{account}</p>
          </div>
        </div>
      </div>

      {/* 登录密码 */}
      <h2 className="mb-4 text-xl font-semibold">{t("acct.pwTitle")}</h2>
      <div className="mb-10 rounded-2xl border border-border bg-card p-6 card-shadow">
        <p className="mb-4 text-sm text-muted-foreground">{t("acct.pwHint")}</p>
        <form onSubmit={savePassword} className="max-w-sm space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("acct.pwNew")}</label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder={t("acct.pwNewPlaceholder")}
                minLength={6}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t("auth.hidePw") : t("auth.showPw")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("acct.pwConfirm")}</label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                placeholder={t("acct.pwConfirmPlaceholder")}
                minLength={6}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t("auth.hidePw") : t("auth.showPw")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {pwMsg && (
            <p
              className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                pwMsg.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
              )}
            >
              {pwMsg.text}
            </p>
          )}
          <Button type="submit" variant="gradient" disabled={pwSaving}>
            {pwSaving ? t("acct.pwSaving") : t("acct.pwSave")}
          </Button>
        </form>
      </div>

      {/* 登录方式 */}
      <h2 className="mb-4 text-xl font-semibold">{t("sec.methods")}</h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card card-shadow">
        <MethodRow
          icon={<Smartphone className="h-4 w-4" />}
          title={t("sec.mPhone")}
          desc={
            isPhoneUser || !boundPhone
              ? t("sec.mPhoneDesc")
              : `${t("sec.bound")} ${maskPhone(boundPhone)}`
          }
          status={
            isPhoneUser || boundPhone ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3" />
                {isPhoneUser ? t("sec.on") : t("sec.bound")}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setBindOpen((v) => !v);
                  setBindMsg(null);
                }}
              >
                {t("sec.bind")}
              </Button>
            )
          }
        />
        <MethodRow
          icon={<KeyRound className="h-4 w-4" />}
          title={t("sec.mPassword")}
          desc={t("sec.mPasswordDesc")}
          status={
            hasPassword ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3" />
                {t("sec.enabled")}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("sec.notSet")}
              </span>
            )
          }
        />
        <MethodRow
          icon={<MessageCircle className="h-4 w-4" />}
          title={t("sec.mWechat")}
          desc={t("sec.mWechatDesc")}
          status={
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {t("sec.soon")}
            </span>
          }
          muted
        />
      </div>

      {/* 绑定手机号 弹窗(邮箱账号、未绑定时点「绑定」打开;成功后自动关闭) */}
      {bindOpen && !isPhoneUser && !boundPhone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            setBindOpen(false);
            setBindMsg(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 card-shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <p className="font-semibold">{t("sec.bindPhoneTitle")}</p>
              <button
                type="button"
                onClick={() => {
                  setBindOpen(false);
                  setBindMsg(null);
                }}
                aria-label="关闭"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {t("sec.bindPhoneHint")}
            </p>
            <form onSubmit={doBindPhone} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("auth.phone")}</label>
              <Input
                type="tel"
                inputMode="numeric"
                value={bindPhone}
                onChange={(e) =>
                  setBindPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
                }
                placeholder={t("auth.phonePlaceholder")}
                maxLength={11}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t("auth.smsCodeLabel")}
              </label>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  value={bindCode}
                  onChange={(e) =>
                    setBindCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  placeholder={t("auth.smsCodePlaceholder")}
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={sendBindCode}
                  disabled={bindBusy || cooldown > 0}
                  className="shrink-0 whitespace-nowrap"
                >
                  {cooldown > 0
                    ? fmt(t("auth.resendIn"), { n: cooldown })
                    : t("auth.getCode")}
                </Button>
              </div>
            </div>
            {bindMsg && (
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  bindMsg.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                {bindMsg.text}
              </p>
            )}
            <Button type="submit" variant="gradient" disabled={bindBusy}>
              {bindBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("sec.bindSubmit")}
            </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MethodRow({
  icon,
  title,
  desc,
  status,
  muted,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <span
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg",
          muted
            ? "bg-secondary text-muted-foreground"
            : "bg-gradient-to-br from-primary/12 to-accent/12 text-primary"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-sm text-muted-foreground">{desc}</p>
      </div>
      {status}
    </div>
  );
}
