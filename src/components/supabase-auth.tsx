"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ArrowLeft, Mail, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserSupabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n/locale-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { cn } from "@/lib/utils";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

// OTP signup is gated by env: only active once SMTP (Resend) is configured
// on Supabase + the dashboard's "Confirm email" is enabled. Until then we keep
// the legacy admin-createUser + signInWithPassword path so signups don't break.
const OTP_ENABLED =
  process.env.NEXT_PUBLIC_REQUIRE_EMAIL_OTP === "true";
// Google sign-in is unreachable in mainland China, so the 国内 instance hides
// it (NEXT_PUBLIC_HIDE_GOOGLE_LOGIN=true). The 海外 instance leaves it unset.
const HIDE_GOOGLE =
  process.env.NEXT_PUBLIC_HIDE_GOOGLE_LOGIN === "true";
// Phone (SMS code) login — 国内 instance only (NEXT_PUBLIC_PHONE_LOGIN=true).
// Login = register; backend uses Aliyun SMS verify + a synthetic email account.
const PHONE_LOGIN =
  process.env.NEXT_PUBLIC_PHONE_LOGIN === "true";
// WeChat 扫码登录入口 — 默认两站都显示;未配置(后台/env 无 AppID 等)时点击回退
// 「即将开放」占位浮层,不误导。可在站点 env 设 NEXT_PUBLIC_WECHAT_LOGIN=false 关闭。
// 真正扫码需微信认证服务号 + AppID/AppSecret(后台「登录与支付」可配,DB→env 兜底)。
const WECHAT_LOGIN =
  process.env.NEXT_PUBLIC_WECHAT_LOGIN !== "false";
const PHONE_RE = /^1[3-9]\d{9}$/;
// Must match the server's PHONE_EMAIL_DOMAIN so the client can derive a phone
// user's synthetic-email account for password sign-in.
const PHONE_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_PHONE_EMAIL_DOMAIN || "phone.starzeco.com";
const RESEND_COOLDOWN_SEC = 60;

// Outer page wrapper — full-page background + centering. In compact mode
// (e.g. inside the global auth modal) we render only the inner card, since the
// modal itself provides the centering / backdrop.
function PageShell({
  compact,
  children,
}: {
  compact: boolean;
  children: React.ReactNode;
}) {
  if (compact) {
    return <div className="w-full space-y-6">{children}</div>;
  }
  return (
    <div className="relative bg-aurora">
      <div className="absolute inset-0 -z-10 bg-dots opacity-50" />
      <div className="container flex min-h-[calc(100vh-4rem)] items-start justify-center pt-16 pb-16 sm:pt-24">
        <div className="w-full max-w-sm space-y-8">{children}</div>
      </div>
    </div>
  );
}

function WechatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden>
      <path
        fill="#07C160"
        d="M664 368c12 0 24 1 36 2-32-150-193-262-381-262C130 108 0 244 0 410c0 96 44 182 113 240l-28 84 98-54c35 10 70 18 109 18 11 0 22-1 33-2-7-22-11-45-11-69 0-143 130-259 287-259zM536 290c26 0 47 21 47 47s-21 47-47 47-47-21-47-47 21-47 47-47zM280 384c-26 0-47-21-47-47s21-47 47-47 47 21 47 47-21 47-47 47z"
      />
      <path
        fill="#07C160"
        d="M1024 627c0-139-130-251-280-251S464 488 464 627s130 251 280 251c31 0 62-6 91-15l82 45-23-70c58-46 130-119 130-211zM652 590c-21 0-39-18-39-39s18-39 39-39 39 18 39 39-18 39-39 39zm184 0c-21 0-39-18-39-39s18-39 39-39 39 18 39 39-18 39-39 39z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AuthPanel({
  mode,
  compact = false,
  noRedirect = false,
  onSwitchMode,
}: {
  mode: "sign-in" | "sign-up";
  /** Compact = embedded in a modal (no full-page wrapper) */
  compact?: boolean;
  /** Skip the post-auth router.push (modal-host watches user state to close) */
  noRedirect?: boolean;
  /** When set, the 「切换登录/注册」 link calls this instead of <Link>-navigating */
  onSwitchMode?: (m: "sign-in" | "sign-up") => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { t, locale } = useI18n();
  // 白标门控:开源版 = 单用户,隐藏「注册」入口只留登录;官方云/Pro = 多用户(不变)。
  // 非 Pro 时即便外部把 mode 传成 sign-up(旧路由 / ?auth=sign-up),也强制按登录渲染,
  // 彻底堵住注册路径。登录逻辑本身不动。
  const { pro } = usePaymentConfig();
  const isSignUp = pro && mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  // Phone login state (国内). loginMode defaults to phone where it's enabled.
  const [loginMode, setLoginMode] = useState<"phone" | "email">(
    PHONE_LOGIN ? "phone" : "email"
  );
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneAuthMode, setPhoneAuthMode] = useState<"code" | "password">(
    "code"
  );
  const [stage, setStage] = useState<"form" | "verify" | "reset">("form");
  const [resetSent, setResetSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // 服务协议/隐私政策同意:勾选后才能登录/注册(PRC 合规 + 设计稿要求,门控登录按钮)。
  const [agree, setAgree] = useState(false);
  // 微信扫码登录浮层:打开时取带参二维码并轮询;后端未配置(503)时回退「即将开放」占位
  const [wechatOpen, setWechatOpen] = useState(false);
  const [wxQr, setWxQr] = useState<{ sid: string; qr: string } | null>(null);
  const [wxState, setWxState] = useState<
    "loading" | "ready" | "expired" | "unavailable"
  >("loading");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const redirect = params.get("redirect");
  const plan = params.get("plan");
  const nextUrl =
    redirect ?? (plan ? `/checkout?plan=${plan}` : "/dashboard");
  const carry = new URLSearchParams();
  if (redirect) carry.set("redirect", redirect);
  if (plan) carry.set("plan", plan);
  const switchQuery = carry.toString() ? `?${carry.toString()}` : "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const q = new URLSearchParams(window.location.search);
    const desc =
      hash.get("error_description") ||
      q.get("error_description") ||
      hash.get("error") ||
      q.get("error");
    if (desc) setError(t("auth.errGooglePrefix") + decodeURIComponent(desc));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (isSignUp && password !== confirmPassword) {
      setError(t("auth.errPwMismatch"));
      return;
    }
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (isSignUp && OTP_ENABLED) {
        // Step 1: Supabase signUp triggers the OTP email (because "Confirm
        // email" is enabled in dashboard + custom SMTP template uses
        // {{ .Token }}). Then we move the user to the code-entry stage.
        const sb = browserSupabase();
        const { error: upErr } = await sb.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { name: name.trim() || cleanEmail.split("@")[0] } },
        });
        if (upErr) {
          if (/registered|exists|already/i.test(upErr.message)) {
            throw new Error(t("auth.errExists"));
          }
          throw new Error(upErr.message);
        }
        setStage("verify");
        setInfo(fmt(t("auth.infoSent"), { email: cleanEmail }));
        startCooldown();
        return;
      }

      // Legacy path: admin createUser (auto-confirmed) + signInWithPassword.
      if (isSignUp) {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail, password, name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("auth.errSignUp"));
      }
      const sb = browserSupabase();
      const { error: signErr } = await sb.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signErr) {
        throw new Error(
          isSignUp
            ? t("auth.errSignedUpButLogin") + signErr.message
            : t("auth.errBadCred")
        );
      }
      if (isSignUp) {
        try {
          sessionStorage.setItem("novaryns_welcome", "1");
        } catch {}
      }
      if (!noRedirect) router.push(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const code = otp.trim();
      if (!/^\d{6,10}$/.test(code)) {
        throw new Error(t("auth.errCodeFormat"));
      }
      const sb = browserSupabase();
      const { error: vErr } = await sb.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: "signup",
      });
      if (vErr) {
        throw new Error(
          /expired|invalid|incorrect/i.test(vErr.message)
            ? t("auth.errCodeInvalid")
            : vErr.message
        );
      }
      try {
        sessionStorage.setItem("novaryns_welcome", "1");
      } catch {}
      if (!noRedirect) router.push(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errVerify"));
    } finally {
      setLoading(false);
    }
  }

  // 忘记密码:发重置验证码(GoTrue recovery,模板是 6 位码)
  async function sendReset() {
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError(t("auth.errEmailFormat"));
      return;
    }
    setLoading(true);
    try {
      const sb = browserSupabase();
      const { error: rErr } = await sb.auth.resetPasswordForEmail(cleanEmail);
      if (rErr) throw new Error(rErr.message);
      setResetSent(true);
      setInfo(t("auth.resetSent"));
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  // 忘记密码:验证码 + 新密码 → 验证后改密码(recovery session 即已登录)
  async function confirmReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const code = otp.trim();
    if (!/^\d{6,10}$/.test(code)) {
      setError(t("auth.errCodeFormat"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("auth.errPwShort"));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(t("auth.errPwMismatch"));
      return;
    }
    setLoading(true);
    try {
      const sb = browserSupabase();
      const { error: vErr } = await sb.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: "recovery",
      });
      if (vErr) {
        throw new Error(
          /expired|invalid|incorrect/i.test(vErr.message)
            ? t("auth.errCodeInvalid")
            : vErr.message
        );
      }
      const { error: uErr } = await sb.auth.updateUser({ password: newPassword });
      if (uErr) throw new Error(uErr.message);
      if (!noRedirect) router.push(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (cooldown > 0) return;
    setError(null);
    setInfo(null);
    try {
      const sb = browserSupabase();
      const { error: rErr } = await sb.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
      });
      if (rErr) throw new Error(rErr.message);
      setInfo(t("auth.infoResent"));
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errResend"));
    }
  }

  async function googleLogin() {
    setError(null);
    setGoogleLoading(true);
    try {
      const sb = browserSupabase();
      const { data, error: oErr } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${nextUrl}` },
      });
      if (oErr) throw oErr;
      if (data?.url) window.location.assign(data.url);
    } catch (err) {
      setError(
        t("auth.errGoogleUnavailable") +
          (err instanceof Error ? `（${err.message}）` : "")
      );
      setGoogleLoading(false);
    }
  }

  async function sendPhoneCode() {
    setError(null);
    setInfo(null);
    if (!PHONE_RE.test(phone.trim())) {
      setError(t("auth.errPhoneFormat"));
      return;
    }
    setPhoneLoading(true);
    try {
      const res = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t("auth.errSendCode"));
      setPhoneSent(true);
      setInfo(t("auth.phoneCodeSent"));
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errSendCode"));
    } finally {
      setPhoneLoading(false);
    }
  }

  async function verifyPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const code = smsCode.trim();
    if (!/^\d{4,8}$/.test(code)) {
      setError(t("auth.errCodeFormat"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.token_hash) {
        throw new Error(data.error || t("auth.errVerify"));
      }
      const sb = browserSupabase();
      const { error: vErr } = await sb.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "magiclink",
      });
      if (vErr) throw new Error(vErr.message);
      // First-time phone login = registration → show the welcome toast.
      if (data.created) {
        try {
          sessionStorage.setItem("novaryns_welcome", "1");
        } catch {}
      }
      if (!noRedirect) router.push(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errVerify"));
    } finally {
      setLoading(false);
    }
  }

  // ---- 微信扫码登录:打开浮层取二维码;过期可手动刷新(wxRefresh 自增重取) ----
  const [wxRefresh, setWxRefresh] = useState(0);
  useEffect(() => {
    if (!wechatOpen) return;
    let dead = false;
    setWxState("loading");
    setWxQr(null);
    (async () => {
      try {
        const res = await fetch("/api/wechat/login/start", { method: "POST" });
        if (res.status === 503) {
          // 后端未配置(如海外站)→ 维持「即将开放」占位
          if (!dead) setWxState("unavailable");
          return;
        }
        const d = await res.json();
        if (!res.ok || !d.sid || !d.qr) throw new Error(d.error || "qr failed");
        if (dead) return;
        setWxQr({ sid: d.sid, qr: d.qr });
        setWxState("ready");
      } catch {
        // 取码失败(如接口权限未开通)→ 显示「即将开放」占位,而非误导的「已过期」
        if (!dead) setWxState("unavailable");
      }
    })();
    return () => {
      dead = true;
    };
  }, [wechatOpen, wxRefresh]);

  // 轮询扫码结果 → token_hash → verifyOtp 建会话(与手机号验证码登录同款收尾)
  useEffect(() => {
    if (!wechatOpen || wxState !== "ready" || !wxQr) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/wechat/login/poll?sid=${encodeURIComponent(wxQr.sid)}`,
          { cache: "no-store" }
        );
        const d = await r.json();
        if (d.status === "expired") {
          setWxState("expired");
          return;
        }
        if (d.status === "done" && d.token_hash) {
          clearInterval(iv);
          const sb = browserSupabase();
          const { error: vErr } = await sb.auth.verifyOtp({
            token_hash: d.token_hash,
            type: "magiclink",
          });
          if (vErr) {
            setError(vErr.message);
            setWxState("expired");
            return;
          }
          if (d.created) {
            try {
              sessionStorage.setItem("novaryns_welcome", "1");
            } catch {}
          }
          setWechatOpen(false);
          if (!noRedirect) router.push(nextUrl);
        }
      } catch {
        /* 网络抖动:继续轮询 */
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [wechatOpen, wxState, wxQr, noRedirect, nextUrl, router]);

  // Phone + password sign-in (for users who set a password in their account).
  // A phone account's identity is a synthetic email, derived client-side.
  async function phonePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!PHONE_RE.test(phone.trim())) {
      setError(t("auth.errPhoneFormat"));
      return;
    }
    setLoading(true);
    try {
      const sb = browserSupabase();
      const { error: sErr } = await sb.auth.signInWithPassword({
        email: `${phone.trim()}@${PHONE_EMAIL_DOMAIN}`,
        password,
      });
      if (sErr) throw new Error(t("auth.errBadCred"));
      if (!noRedirect) router.push(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errBadCred"));
    } finally {
      setLoading(false);
    }
  }

  // Verify stage: OTP code entry.
  if (stage === "verify") {
    return (
      <PageShell compact={compact}>
            <div className="flex flex-col items-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Mail className="h-5 w-5" />
              </span>
              <h1 className="mt-4 text-2xl font-bold tracking-tight">
                {t("auth.verifyTitle")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("auth.verifySentPre")}
                <span className="font-medium text-foreground">{email}</span>
                {t("auth.verifySentPost")}
              </p>
            </div>

            <form
              onSubmit={handleVerify}
              className="space-y-4 rounded-2xl border border-border bg-card p-6 card-shadow"
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("auth.codeLabel")}</label>
                <Input
                  inputMode="numeric"
                  pattern="\d{6,10}"
                  maxLength={10}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder={t("auth.codePlaceholder")}
                  className="text-center text-lg tracking-[0.4em]"
                  required
                  autoFocus
                />
              </div>

              {info && (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {info}
                </p>
              )}
              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="gradient"
                className="h-12 w-full text-[15px]"
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("auth.verifySubmit")}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStage("form");
                    setOtp("");
                    setError(null);
                    setInfo(null);
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  {t("auth.backToEmail")}
                </button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={cooldown > 0}
                  className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                >
                  {cooldown > 0
                    ? fmt(t("auth.resendIn"), { n: cooldown })
                    : t("auth.resend")}
                </button>
              </div>
            </form>

            <p className="text-center text-xs text-muted-foreground">
              {t("auth.spamNote")}
            </p>
      </PageShell>
    );
  }

  // Reset stage: 忘记密码(发验证码 → 验证码 + 新密码 → 重置并登录)
  if (stage === "reset") {
    return (
      <PageShell compact={compact}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {t("auth.resetTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resetSent ? t("auth.resetSubCode") : t("auth.resetSub")}
          </p>
        </div>

        <form
          onSubmit={confirmReset}
          className="space-y-4 rounded-2xl border border-border bg-card p-6 card-shadow"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("auth.email")}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={resetSent}
              required
            />
          </div>

          {resetSent && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t("auth.codeLabel")}
                </label>
                <Input
                  inputMode="numeric"
                  pattern="\d{6,10}"
                  maxLength={10}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder={t("auth.codePlaceholder")}
                  className="text-center text-lg tracking-[0.4em]"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t("auth.newPassword")}
                </label>
                <div className="relative">
                  <Input
                    type={showResetPw ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("auth.newPasswordPlaceholder")}
                    minLength={6}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw((v) => !v)}
                    aria-label={showResetPw ? t("auth.hidePw") : t("auth.showPw")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetPw ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t("auth.confirmPassword")}
                </label>
                <div className="relative">
                  <Input
                    type={showResetPw ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder={t("auth.confirmPasswordPlaceholder")}
                    minLength={6}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw((v) => !v)}
                    aria-label={showResetPw ? t("auth.hidePw") : t("auth.showPw")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetPw ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {info && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              {info}
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {!resetSent ? (
            <Button
              type="button"
              onClick={sendReset}
              variant="gradient"
              className="h-12 w-full text-[15px]"
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("auth.sendResetCode")}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="gradient"
              className="h-12 w-full text-[15px]"
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("auth.resetSubmit")}
            </Button>
          )}

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStage("form");
                setOtp("");
                setNewPassword("");
                setConfirmNewPassword("");
                setShowResetPw(false);
                setResetSent(false);
                setError(null);
                setInfo(null);
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("auth.backToEmail")}
            </button>
            {resetSent && (
              <button
                type="button"
                onClick={sendReset}
                disabled={cooldown > 0 || loading}
                className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {cooldown > 0
                  ? fmt(t("auth.resendIn"), { n: cooldown })
                  : t("auth.resend")}
              </button>
            )}
          </div>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell compact={compact}>
          {/* V2:左对齐标题(无 logo/无副标题),26px medium */}
          <div>
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.5px]">
              {isSignUp
                ? t("auth.formTitleSignUp")
                : t("auth.formTitleSignIn")}
            </h1>
            <p className="mt-1.5 text-[13px] text-c-text3">
              {locale === "en"
                ? "Sign in to start creating — new users auto-register with free credits"
                : "登录后开始创作 · 新用户自动注册并赠送体验积分"}
            </p>
          </div>

          <div
            className={cn(
              // compact(弹窗)模式下表单直接铺在 modal 白底上,字段间距更大;
              // standalone 页保留原来的白卡边框
              compact
                ? "space-y-5"
                : "space-y-4 rounded-2xl border border-border bg-card p-6 card-shadow"
            )}
          >
            {PHONE_LOGIN && (
              /* V2:下划线 tab,左对齐,选中项底部 emerald 下划线 */
              <div className="flex gap-7 border-b border-border/70">
                {(["phone", "email"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setLoginMode(m);
                      setError(null);
                      setInfo(null);
                    }}
                    className={cn(
                      "relative -mb-px pb-3 text-[16px] font-semibold transition-colors",
                      loginMode === m
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {m === "phone" ? t("auth.phoneTab") : t("auth.emailTab")}
                    {loginMode === m && (
                      <span className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {loginMode === "phone" ? (
              <form
                onSubmit={
                  phoneAuthMode === "code" ? verifyPhoneCode : phonePasswordLogin
                }
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("auth.phone")}</label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
                    }
                    placeholder={t("auth.phonePlaceholder")}
                    maxLength={11}
                    required
                  />
                </div>

                {phoneAuthMode === "code" ? (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {t("auth.smsCodeLabel")}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        inputMode="numeric"
                        value={smsCode}
                        onChange={(e) =>
                          setSmsCode(
                            e.target.value.replace(/\D/g, "").slice(0, 8)
                          )
                        }
                        placeholder={t("auth.smsCodePlaceholder")}
                        required
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={sendPhoneCode}
                        disabled={phoneLoading || cooldown > 0}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {phoneLoading && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {cooldown > 0
                          ? fmt(t("auth.resendIn"), { n: cooldown })
                          : t("auth.getCode")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {t("auth.password")}
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("auth.passwordPlaceholder")}
                      required
                    />
                  </div>
                )}

                {info && (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                    {info}
                  </p>
                )}
                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="gradient"
                  className="h-12 w-full text-[15px]"
                  disabled={loading || !agree}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {phoneAuthMode === "code"
                    ? t("auth.phoneSubmit")
                    : t("auth.submitSignIn")}
                </Button>
              </form>
            ) : (
              <>
                {!HIDE_GOOGLE && (
                  <>
                    <button
                      type="button"
                      onClick={googleLogin}
                      disabled={googleLoading || loading || !agree}
                      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                    >
                      {googleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <GoogleIcon />
                      )}
                      {t("auth.googleBtn")}
                    </button>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      {t("auth.divider")}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  </>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("auth.email")}</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("auth.password")}</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  minLength={6}
                  required
                />
                {!isSignUp && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setStage("reset");
                        setResetSent(false);
                        setOtp("");
                        setNewPassword("");
                        setConfirmNewPassword("");
                        setShowResetPw(false);
                        setError(null);
                        setInfo(null);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      {t("auth.forgotPw")}
                    </button>
                  </div>
                )}
              </div>
              {isSignUp && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("auth.confirmPassword")}
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("auth.confirmPasswordPlaceholder")}
                    minLength={6}
                    required
                  />
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="gradient"
                className="h-12 w-full text-[15px]"
                disabled={loading || !agree}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSignUp
                  ? OTP_ENABLED
                    ? t("auth.submitSendCode")
                    : t("auth.submitSignUp")
                  : t("auth.submitSignIn")}
              </Button>

                </form>
              </>
            )}

            {/* 服务协议 / 隐私政策同意(勾选后才能登录/注册) */}
            <label className="flex items-start gap-2 text-[12px] leading-relaxed text-c-text3">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[color:var(--acc)]"
              />
              <span>
                {locale === "en" ? "I have read and agree to the " : "我已阅读并同意"}
                <Link href="/terms" target="_blank" className="text-acc hover:underline">
                  {locale === "en" ? "Terms" : "《服务协议》"}
                </Link>
                {locale === "en" ? " and " : "与"}
                <Link href="/privacy" target="_blank" className="text-acc hover:underline">
                  {locale === "en" ? "Privacy Policy" : "《隐私政策》"}
                </Link>
              </span>
            </label>
          </div>

          {/* 统一底部槽位:手机/邮箱两个 tab 都占同样高度(分隔线 + 1 行),
              这样切 tab 时弹窗高度不变、不移动。
              - 手机号 tab:左边自动注册提示,右边「用密码/验证码登录」切换。
              - 邮箱 tab:「还没有账号? 免费注册」。 */}
          <div className="text-sm">
            {loginMode === "phone" ? (
              <div className="flex items-center justify-end text-muted-foreground">
                <button
                  type="button"
                  onClick={() => {
                    setPhoneAuthMode((m) => (m === "code" ? "password" : "code"));
                    setError(null);
                    setInfo(null);
                  }}
                  className="shrink-0 font-medium text-primary hover:underline"
                >
                  {phoneAuthMode === "code"
                    ? t("auth.usePwLogin")
                    : t("auth.useCodeLogin")}
                </button>
              </div>
            ) : !pro && !isSignUp ? (
              // 开源精简版 = 单用户,隐藏「注册」路径,只留登录 + 一句小字提示。
              <p className="text-muted-foreground">
                {locale === "en"
                  ? "Multi-user sign-up requires the Pro edition"
                  : "多用户注册需 Pro 版"}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {isSignUp ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
                {onSwitchMode ? (
                  <button
                    type="button"
                    onClick={() =>
                      onSwitchMode(isSignUp ? "sign-in" : "sign-up")
                    }
                    className="font-medium text-primary hover:underline"
                  >
                    {isSignUp ? t("auth.toSignIn") : t("auth.toSignUp")}
                  </button>
                ) : (
                  <Link
                    href={`${isSignUp ? "/sign-in" : "/sign-up"}${switchQuery}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {isSignUp ? t("auth.toSignIn") : t("auth.toSignUp")}
                  </Link>
                )}
              </p>
            )}
          </div>

          {/* 其他登录方式:手机/邮箱 tab 都显示(对称,保持等高)。当前只有微信占位入口。
              点击弹二维码浮层「即将开放」,真正扫码待微信开放平台资质 + 后端对接。 */}
          {WECHAT_LOGIN && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("auth.otherLogin")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setWechatOpen(true)}
                  disabled={!agree}
                  aria-label={t("auth.wechatLogin")}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <WechatIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
          )}

          {/* 微信扫码浮层:真二维码(扫码关注即登录)。后端未配置时回退「即将开放」。 */}
          {wechatOpen && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-3xl bg-card/95 px-8 backdrop-blur-sm"
              onClick={() => setWechatOpen(false)}
            >
              <div
                className="flex flex-col items-center gap-4 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-base font-semibold">
                  {t("auth.wechatScanTitle")}
                </p>
                <div className="relative flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white">
                  {wxState === "ready" && wxQr ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={wxQr.qr}
                      alt="WeChat QR"
                      className="h-full w-full object-contain"
                    />
                  ) : wxState === "loading" ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : (
                    <WechatIcon className="h-12 w-12 opacity-40" />
                  )}
                  {wxState === "expired" && (
                    <button
                      type="button"
                      onClick={() => setWxRefresh((n) => n + 1)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-card/90 text-sm font-medium"
                    >
                      {t("auth.wechatExpired")}
                      <span className="text-primary">
                        {t("auth.wechatRefresh")}
                      </span>
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {wxState === "unavailable"
                    ? t("auth.wechatComingSoon")
                    : t("auth.wechatScanHint")}
                </p>
                <button
                  type="button"
                  onClick={() => setWechatOpen(false)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("auth.wechatBack")}
                </button>
              </div>
            </div>
          )}
    </PageShell>
  );
}
