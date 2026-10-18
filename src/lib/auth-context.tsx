"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getPlan, type PlanKey } from "@/lib/mock-data";
import { BRAND } from "@/lib/brand";
import { supabaseEnabled } from "@/lib/auth-mode";
import { authHeader, browserSupabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Session + membership state.
//
// Identity (name/email) comes from Supabase Auth when configured, otherwise
// from the built-in mock sign-in/up. Plan / credits / invoices are persisted to
// Postgres when DATABASE_URL is set (detected via /api/config), and otherwise
// to localStorage keyed by email. The server, when present, is authoritative;
// localStorage is also kept as a warm cache so the UI never flashes.
// ---------------------------------------------------------------------------

export type Invoice = {
  id: string;
  date: string;
  plan: string;
  amount: number;
  status: "paid";
};

export type SessionUser = {
  name: string;
  email: string;
  plan: PlanKey;
  creditsTotal: number;
  creditsUsed: number;
  joinedAt: string;
  renewsAt: string;
  invoices: Invoice[];
  /** 累计充值 ≥ 999 元解锁「高阶」出图模式 */
  canHigh?: boolean;
};

type Identity = { name: string; email: string };

type AuthContextValue = {
  user: SessionUser | null;
  ready: boolean;
  remaining: number;
  /** "server" when Postgres is live, "local" for the localStorage mock. */
  persistMode: "local" | "server";
  /** 原生多用户模式(Pro):启用邮箱+密码注册/登录 + 服务端会话 hydrate。 */
  multiUser: boolean;
  signUp: (name: string, email: string) => void;
  signIn: (email: string) => void;
  signOut: () => Promise<void>;
  changePlan: (plan: PlanKey) => Promise<Invoice | null>;
  consumeCredits: (n: number) => boolean;
  /** Replace the session with an authoritative server copy. */
  applyServerUser: (user: SessionUser | null) => void;
  syncIdentity: (identity: Identity | null) => void;
  bindSignOut: (fn: (() => void | Promise<void>) | null) => void;
};

const STORAGE_PREFIX = "novaryns:user:";
const LAST_KEY = "novaryns:last-email";

const AuthContext = createContext<AuthContextValue | null>(null);

const keyFor = (email: string) =>
  `${STORAGE_PREFIX}${email.toLowerCase()}`;

function nextMonthISO(): string {
  // 满一个月（滚动月，保留日期）。仅本地兜底用；权威到期日来自服务端。
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function makeUser(name: string, email: string): SessionUser {
  const starter = getPlan("starter");
  return {
    name: name || email.split("@")[0] || `${BRAND} 用户`,
    email,
    plan: "starter",
    creditsTotal: starter.monthlyCredits,
    creditsUsed: 0,
    joinedAt: new Date().toISOString(),
    renewsAt: nextMonthISO(),
    invoices: [],
  };
}

function loadUser(email: string): SessionUser | null {
  try {
    const raw = localStorage.getItem(keyFor(email));
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [persistMode, setPersistMode] = useState<"local" | "server">(
    "local"
  );
  const [multiUser, setMultiUser] = useState(false);
  const multiUserRef = useRef(false);
  const serverRef = useRef(false);
  const externalSignOut = useRef<(() => void) | null>(null);

  const persist = useCallback((next: SessionUser | null) => {
    setUser(next);
    try {
      if (next) {
        localStorage.setItem(keyFor(next.email), JSON.stringify(next));
        localStorage.setItem(LAST_KEY, next.email);
      } else {
        localStorage.removeItem(LAST_KEY);
      }
    } catch {
      /* storage unavailable — keep in-memory state */
    }
  }, []);

  // Server helper: POST /api/account. Returns the user or null on any failure
  // (the caller then keeps the optimistic local copy).
  const serverPost = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data?.persisted && data.user) {
          return data as { user: SessionUser; invoice?: Invoice };
        }
      } catch {
        /* network/db error — fall back to local */
      }
      return null;
    },
    []
  );

  // Detect persistence mode, then hydrate the last session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let lastEmail: string | null = null;
      try {
        lastEmail = localStorage.getItem(LAST_KEY);
        if (lastEmail) {
          const cached = loadUser(lastEmail);
          if (cached && !cancelled) setUser(cached);
        }
      } catch {
        /* ignore */
      }

      try {
        const cfg = await fetch("/api/config").then((r) => r.json());
        if (!cancelled && cfg?.db) {
          serverRef.current = true;
          setPersistMode("server");
        }
        // 原生多用户:身份来自服务端会话 cookie(权威),不用 localStorage lastEmail。
        if (!cancelled && cfg?.multiUser) {
          multiUserRef.current = true;
          setMultiUser(true);
          try {
            const s = await fetch("/api/auth/session").then((r) => r.json());
            if (!cancelled) {
              if (s?.user) persist(s.user as SessionUser);
              else {
                // 会话无效 → 清掉可能残留的本地态
                setUser(null);
                try {
                  localStorage.removeItem(LAST_KEY);
                } catch {
                  /* ignore */
                }
              }
            }
          } catch {
            /* session unreachable — leave as-is */
          }
        } else if (!cancelled && cfg?.db && cfg?.authMode === "mock") {
          // 开源版单用户:身份以本地管理员会话(服务端 nv_admin cookie)为权威,
          // 不依赖 localStorage —— 覆盖「只从 /admin 登录、主站 auth-context 未 signIn」
          // 的情况(否则主站 user=null,作品/历史全拉不出)。
          try {
            const s = await fetch("/api/auth/session").then((r) => r.json());
            if (!cancelled) {
              if (s?.user) {
                persist(s.user as SessionUser);
              } else if (lastEmail) {
                const res = await fetch(
                  `/api/account?email=${encodeURIComponent(lastEmail)}`,
                  { headers: await authHeader() }
                ).then((r) => r.json());
                if (!cancelled && res?.persisted && res.user) {
                  persist(res.user as SessionUser);
                }
              }
            }
          } catch {
            /* session unreachable — leave as-is */
          }
        } else if (!cancelled && cfg?.db && lastEmail) {
          // 官方云(Supabase):**Supabase 会话才是登录态的唯一权威**。
          // 2026-07-20 线上 bug:会话失效后,UI 仍显示已登录(账户菜单有邮箱+积分),
          // 但生图/AI帮写等受保护接口要 Bearer token → 一律「请先登录」。
          // 根因:上面的 localStorage 暖缓存已把 user 置上,而这里只在成功时覆盖、
          // 失败时**不清除**,于是假登录态一直留着。所以拿不到 token 就必须清掉。
          const hdr = await authHeader();
          if (cfg?.authMode === "supabase" && !hdr.Authorization) {
            if (!cancelled) persist(null);
          } else {
            const res = await fetch(
              `/api/account?email=${encodeURIComponent(lastEmail)}`,
              { headers: hdr }
            ).then((r) => r.json());
            if (!cancelled && res?.persisted && res.user) {
              persist(res.user as SessionUser);
            }
          }
        }
      } catch {
        /* config unreachable — stay in local mode */
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [persist]);

  // 会话中途失效(access_token 刷新失败 / 别处登出 / 手机端存储被清)时,把 UI 登录态
  // 同步清掉 —— 否则又会出现「看着已登录、点生图说没登录」。仅 Supabase 模式需要。
  useEffect(() => {
    if (!supabaseEnabled) return;
    let sub: { unsubscribe: () => void } | null = null;
    try {
      const r = browserSupabase().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) persist(null);
      });
      sub = r?.data?.subscription ?? null;
    } catch {
      /* supabase 未配置 → 无需订阅 */
    }
    return () => sub?.unsubscribe();
  }, [persist]);

  const startSession = useCallback(
    (name: string, email: string) => {
      // Optimistic local session for instant UI.
      const existing = loadUser(email);
      persist(
        existing
          ? { ...existing, name: name || existing.name }
          : makeUser(name, email)
      );
      // Authoritative server copy when the DB is live.
      if (serverRef.current) {
        serverPost({ action: "sync", email, name }).then((r) => {
          if (r) persist(r.user);
        });
      }
    },
    [persist, serverPost]
  );

  const signUp = useCallback(
    (name: string, email: string) => startSession(name, email),
    [startSession]
  );

  const signIn = useCallback(
    (email: string) => startSession("", email),
    [startSession]
  );

  const syncIdentity = useCallback(
    (identity: Identity | null) => {
      if (!identity || !identity.email) {
        setUser(null);
        try {
          localStorage.removeItem(LAST_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      startSession(identity.name, identity.email);
    },
    [startSession]
  );

  // 退出:**先等所有会话清理完成,再整页跳回首页**。
  // 为什么跳转:退出后停在原页(尤其 /account、/generate 这类要登录的页)会看到
  // 半坏的空页面,用户根本分不清到底退没退(2026-07-20 用户反馈)。统一回首页(登出态)
  // 是淘宝/B站/YouTube 这类"有营销首页"站点的通行做法;本站登录是弹窗、没有独立登录页。
  // 为什么整页跳(而非路由跳):顺带把内存里的组件状态/缓存全部清空,杜绝上个用户的数据残留。
  // 为什么要 await:三处清理都是网络请求,不等完就跳会被浏览器打断 → 会话没清干净。
  const signOut = useCallback(async () => {
    const jobs: Promise<unknown>[] = [];
    if (externalSignOut.current) {
      const r: unknown = externalSignOut.current();
      if (r && typeof (r as Promise<void>).then === "function") jobs.push(r as Promise<void>);
    }
    // 原生多用户:清服务端会话 cookie。
    if (multiUserRef.current) {
      jobs.push(fetch("/api/auth/logout", { method: "POST" }).catch(() => {}));
    }
    // 单用户/本地管理员(无 Supabase):同时清后台会话(nv_admin)——
    // 否则「退出」后仍是隐形管理员,/deploy 更新卡等站长内容照样可见。
    if (!supabaseEnabled) {
      jobs.push(fetch("/api/admin/login", { method: "DELETE" }).catch(() => {}));
    }
    setUser(null);
    try {
      localStorage.removeItem(LAST_KEY);
    } catch {
      /* ignore */
    }
    // 最多等 2.5s,网络异常也不能把用户卡在原地
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (typeof window !== "undefined") {
      window.location.assign("/?signedout=1"); // 首页据此弹「已退出登录」
    }
  }, []);

  const bindSignOut = useCallback((fn: (() => void) | null) => {
    externalSignOut.current = fn;
  }, []);

  const applyServerUser = useCallback(
    (next: SessionUser | null) => {
      if (next) persist(next);
    },
    [persist]
  );

  const changePlan = useCallback(
    async (planKey: PlanKey): Promise<Invoice | null> => {
      if (!user) return null;

      if (serverRef.current) {
        const r = await serverPost({
          action: "plan",
          email: user.email,
          plan: planKey,
        });
        if (r) {
          persist(r.user);
          return r.invoice ?? null;
        }
      }

      // Local fallback.
      const plan = getPlan(planKey);
      const invoice: Invoice = {
        id: `inv-${Date.now()}`,
        date: new Date().toISOString(),
        plan: plan.name,
        amount: plan.priceValue,
        status: "paid",
      };
      persist({
        ...user,
        plan: planKey,
        creditsTotal: plan.monthlyCredits,
        creditsUsed: Math.min(user.creditsUsed, plan.monthlyCredits),
        renewsAt: nextMonthISO(),
        invoices:
          plan.priceValue > 0 ? [invoice, ...user.invoices] : user.invoices,
      });
      return plan.priceValue > 0 ? invoice : null;
    },
    [user, persist, serverPost]
  );

  const consumeCredits = useCallback(
    (n: number): boolean => {
      if (!user) return false;
      if (user.creditsUsed + n > user.creditsTotal) return false;
      // In server mode the generate route reserves credits and returns the
      // authoritative user (applied via applyServerUser); this optimistic
      // update just keeps the UI snappy in the meantime.
      persist({ ...user, creditsUsed: user.creditsUsed + n });
      return true;
    },
    [user, persist]
  );

  const remaining = user ? user.creditsTotal - user.creditsUsed : 0;

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        remaining,
        persistMode,
        multiUser,
        signUp,
        signIn,
        signOut,
        changePlan,
        consumeCredits,
        applyServerUser,
        syncIdentity,
        bindSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
