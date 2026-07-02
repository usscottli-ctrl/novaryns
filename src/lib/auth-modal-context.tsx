"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type AuthMode = "sign-in" | "sign-up";

type Ctx = {
  open: boolean;
  mode: AuthMode;
  /** Open the modal in either sign-in or sign-up mode (default sign-in). */
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;
  /** Switch tabs inside the modal without closing it. */
  setMode: (mode: AuthMode) => void;
};

const AuthModalContext = createContext<Ctx | null>(null);

export function AuthModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("sign-in");

  const openAuth = useCallback((m: AuthMode = "sign-in") => {
    setMode(m);
    setOpen(true);
  }, []);
  const closeAuth = useCallback(() => setOpen(false), []);

  const value = useMemo<Ctx>(
    () => ({ open, mode, openAuth, closeAuth, setMode }),
    [open, mode, openAuth, closeAuth]
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
    </AuthModalContext.Provider>
  );
}

/** Safe-to-call hook: returns no-op functions if used outside the provider. */
export function useAuthModal(): Ctx {
  const c = useContext(AuthModalContext);
  if (!c) {
    return {
      open: false,
      mode: "sign-in",
      openAuth: () => {},
      closeAuth: () => {},
      setMode: () => {},
    };
  }
  return c;
}
