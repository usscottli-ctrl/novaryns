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
import { authHeader } from "@/lib/supabase";

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
  signUp: (name: string, email: string) => void;
  signIn: (email: string) => void;
  signOut: () => void;
  changePlan: (plan: PlanKey) => Promise<Invoice | null>;
  consumeCredits: (n: number) => boolean;
  /** Replace the session with an authoritative server copy. */
  applyServerUser: (user: SessionUser | null) => void;
  syncIdentity: (identity: Identity | null) => void;
  bindSignOut: (fn: (() => void) | null) => void;
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
          if (lastEmail) {
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
        /* config unreachable — stay in local mode */
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
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

  const signOut = useCallback(() => {
    if (externalSignOut.current) externalSignOut.current();
    setUser(null);
    try {
      localStorage.removeItem(LAST_KEY);
    } catch {
      /* ignore */
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
